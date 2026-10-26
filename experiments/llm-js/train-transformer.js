#!/usr/bin/env node
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { TransformerLM } from "./general-transformer.js";
import { deriveTransformerConfig } from "./model-config.js";

const DEFAULT_TEXT = "A small transformer predicts the next character.\nLearning systems improve through repeated examples.\n";
function option(args,name,fallback){const i=args.indexOf(name);return i>=0&&args[i+1]&&!args[i+1].startsWith("--")?args[i+1]:fallback;}
function num(args,name,fallback){const v=Number(option(args,name,String(fallback)));if(!Number.isFinite(v))throw new Error("invalid "+name);return v;}
function rngFor(seed){let s=seed>>>0;return()=>{s=(s+0x6D2B79F5)>>>0;let t=s;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296;};}

export async function trainTransformerCli(args=process.argv.slice(2)){
 const input=option(args,"--input",null),text=input?await readFile(resolve(input),"utf8"):DEFAULT_TEXT;
 const chars=[...text];if(chars.length<10)throw new Error("training text must contain at least 10 characters");
 const vocab=[...new Set(chars)].sort(),ids=chars.map(c=>vocab.indexOf(c));
 const steps=num(args,"--steps",200),depthArg=option(args,"--depth",null),contextSize=num(args,"--context",16),learningRate=num(args,"--lr",.001),seed=num(args,"--seed",42),generate=num(args,"--generate",80);
 const depth=depthArg===null?null:Number(depthArg);
 const preset=depth===null?null:deriveTransformerConfig({depth,vocabSize:vocab.length,contextSize,seed});
 const width=num(args,"--width",preset?.width??8),heads=num(args,"--heads",preset?.heads??2),layers=num(args,"--layers",preset?.layers??2),hiddenSize=num(args,"--hidden",preset?.hiddenSize??width*4);
 for(const [name,v,min,max] of [["steps",steps,1,100000],["context",contextSize,2,256],["width",width,2,64],["heads",heads,1,64],["layers",layers,1,8],["hidden",hiddenSize,1,256],["generate",generate,0,10000]])if(!Number.isInteger(v)||v<min||v>max)throw new Error("--"+name+" must be an integer from "+min+" to "+max);
 if(width%heads)throw new Error("--width must be divisible by --heads");
 if(depth!==null&&(!Number.isInteger(depth)||depth<1||depth>8))throw new Error("--depth must be an integer from 1 to 8");
 if(!(learningRate>0)||learningRate>.1)throw new Error("--lr must be > 0 and <= 0.1");
 const split=Math.max(contextSize+2,Math.floor(ids.length*.9));if(split>=ids.length)throw new Error("text is too short for this context; provide more training text or reduce --context");
 const train=ids.slice(0,split),validation=ids.slice(split),rng=rngFor(seed^0x54464d);
 const checkpointPath=resolve(option(args,"--checkpoint","experiments/llm-js/transformer-checkpoint.json"));
 let model;
 const resume=option(args,"--resume",null);
 if(resume){const saved=JSON.parse(await readFile(resolve(resume),"utf8"));if(JSON.stringify(saved.vocabulary)!==JSON.stringify(vocab))throw new Error("resume checkpoint vocabulary does not match input text");model=TransformerLM.fromJSON(saved.model);}
 else model=new TransformerLM(vocab.length,{contextSize,width,heads,layers,hiddenSize,seed});
 const window=(source)=>{const length=Math.min(contextSize,source.length-1),start=Math.floor(rng()*(source.length-length));return {x:source.slice(start,start+length),y:source.slice(start+1,start+length+1)};};
 const evalSample=window(validation),initialValidation=model.loss(evalSample.x,evalSample.y).value;
 for(let step=1;step<=steps;step++){const b=window(train);const loss=model.trainStep(b.x,b.y,{learningRate});if(step===1||step===steps||step%Math.max(1,Math.floor(steps/10))===0)process.stdout.write("step "+step+"/"+steps+" loss="+loss.toFixed(4)+"\n");}
 const finalValidation=model.loss(evalSample.x,evalSample.y).value;
 const sample=model.generate([ids[0]],{maxNewTokens:generate,seed}).map(i=>vocab[i]).join("");
 await mkdir(dirname(checkpointPath),{recursive:true});await writeFile(checkpointPath,JSON.stringify({format:"br3eze-transformer-training-v1",vocabulary:vocab,model:model.toJSON()}),"utf8");
 process.stdout.write("vocab="+vocab.length+" width="+width+" heads="+heads+" layers="+layers+" validationLossBefore="+initialValidation.toFixed(4)+" validationLossAfter="+finalValidation.toFixed(4)+"\n\n--- sample ---\n"+sample+"\ncheckpoint="+checkpointPath+"\n");
 return {initialValidation,finalValidation,checkpoint:checkpointPath,config:{vocabSize:vocab.length,contextSize,width,heads,layers,hiddenSize,seed}};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)trainTransformerCli().catch(e=>{console.error("transformer training: "+e.message);process.exitCode=1;});
