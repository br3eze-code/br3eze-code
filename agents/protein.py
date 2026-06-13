# /workers/protein.py
import sys, json, torch
from transformers import AutoTokenizer, EsmForProteinFolding
args = json.loads(sys.argv[1])

if 'esmfold' in sys.argv[0]:
    model = EsmForProteinFolding.from_pretrained("facebook/esmfold_v1")
    tokenizer = AutoTokenizer.from_pretrained("facebook/esmfold_v1")
    model = model.cuda() if torch.cuda.is_available() else model

    inputs = tokenizer(args['sequence'], return_tensors="pt", add_special_tokens=False)
    with torch.no_grad():
        output = model(**inputs)

    pdb = model.output_to_pdb(output)[0]
    plddt = output['plddt'].mean().item()
    ptm = output['ptm'].item()

    print(json.dumps({"pdb": pdb, "plddt": round(plddt,1), "ptm": round(ptm,3)}))

elif 'esm_stability' in sys.argv[0]:
    from transformers import AutoModel, AutoTokenizer
    model = AutoModel.from_pretrained("facebook/esm2_t33_650M_UR50D")
    tokenizer = AutoTokenizer.from_pretrained("facebook/esm2_t33_650M_UR50D")
    inputs = tokenizer(args['sequence'], return_tensors="pt")
    with torch.no_grad():
        results = model(**inputs, output_hidden_states=True)
    # Stability = mean of final layer CLS token
    stab = results.hidden_states[-1][0,0,:].mean().item()
    print(json.dumps({"stability": round(stab,3), "percentile": 85})) # mock percentile
