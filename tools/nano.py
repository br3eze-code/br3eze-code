# /workers/nano.py - runs on Cloudflare Worker, Lambda@Edge, or local
import sys, json, time
# Using a tiny model like Phi-3-mini, TinyLlama, or Qwen-0.5B quant
from transformers import pipeline

pipe = pipeline("text-generation", model="HuggingFaceTB/SmolLM-135M-Instruct", device="cpu")
start = time.time()

args = json.loads(sys.argv[1])
prompt = ""

if args['action'] == 'classify':
    prompt = f"Labels: {args['labels']}\nText: {args['text']}\nReturn one label:"
elif args['action'] == 'extract':
    prompt = f"Extract JSON matching: {args['schema']}\nText: {args['text']}\nJSON:"
elif args['action'] == 'tag':
    prompt = f"Generate 3 tags for: {args['text']}\nTags:"
elif args['action'] == 'summarize':
    prompt = f"Summarize in 1 sentence: {args['text']}"

out = pipe(prompt, max_new_tokens=args.get('max_tokens', 64), do_sample=False)[0]['generated_text']
result = out.split(prompt)[-1].strip()
latency = int((time.time() - start) * 1000)

print(json.dumps({"result": result, "latency_ms": latency}))
