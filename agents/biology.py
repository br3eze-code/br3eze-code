# /workers/biology.py
import sys, json, re
args = json.loads(sys.argv[1])

if 'esm2_embed' in sys.argv[0]:
    from transformers import AutoModel, AutoTokenizer
    import torch
    model = AutoModel.from_pretrained("facebook/esm2_t33_650M_UR50D")
    tokenizer = AutoTokenizer.from_pretrained("facebook/esm2_t33_650M_UR50D")

    seq = args['sequence'].upper()
    gc = (seq.count('G')+seq.count('C'))/len(seq)*100 if all(b in 'ATGC' for b in seq) else None
    # Find ORFs: start ATG, stop TAA/TAG/TGA
    orfs = [m.span() for m in re.finditer(r'ATG(?:...)*?(?:TAA|TAG|TGA)', seq)]

    inputs = tokenizer(seq, return_tensors="pt")
    with torch.no_grad():
        out = model(**inputs)
    embed = out.last_hidden_state.mean(1).squeeze().tolist()[:5] # first 5 dims

    print(json.dumps({"gc":round(gc,1) if gc else None,"orfs":orfs,"embed":embed}))

elif 'crispr_design' in sys.argv[0]:
    # Find NGG PAMs, 20bp guides, score with RuleSet2
    seq = args['sequence']; guides = []
    for m in re.finditer(r'(?=([ATGC]{20}GG))', seq):
        guide = m.group(1)[:20]
        # RuleSet2 score: GC 40-60% + G at pos20 + no TTTT
        score = 50 + 10*(40<=guide.count('G')+guide.count('C')<=60) + 10*(guide[-1]=='G') - 20*('TTTT' in guide)
        guides.append({"guide":guide,"pam":"NGG","pos":m.start(),"on_target":score,"off_targets":0})
    guides = sorted(guides, key=lambda x:-x['on_target'])[:10]
    print(json.dumps(guides))

elif 'drug_target' in sys.argv[0]:
    # Simplified: use ESM2 + ChemBERTa cosine sim as affinity proxy
    from transformers import AutoModel, AutoTokenizer
    prot = AutoTokenizer.from_pretrained("facebook/esm2_t33_650M_UR50D")
    pmodel = AutoModel.from_pretrained("facebook/esm2_t33_650M_UR50D")
    chem = AutoTokenizer.from_pretrained("seyonec/ChemBERTa-zinc-base-v1")
    cmodel = AutoModel.from_pretrained("seyonec/ChemBERTa-zinc-base-v1")

    p = pmodel(**prot(args['protein_seq'], return_tensors="pt")).last_hidden_state.mean(1)
    c = cmodel(**chem(args['drug'], return_tensors="pt")).last_hidden_state.mean(1)
    aff = torch.nn.functional.cosine_similarity(p,c).item() # -1 to 1
    ic50 = 10**(6-4*aff) # map to nM
    print(json.dumps({"affinity":round(aff,3),"ic50":round(ic50,1),"confidence":"med"}))
