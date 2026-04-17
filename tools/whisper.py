# /workers/whisper.py - runs on your machine or VPS
import sys, json, whisper
model = whisper.load_model("base") # or large-v3 on GPU
audio_url = json.loads(sys.argv[1])['url']
result = model.transcribe(audio_url, word_timestamps=True)
print(json.dumps({"text": result["text"], "segments": result["segments"], "duration": result["segments"][-1]["end"]}))
