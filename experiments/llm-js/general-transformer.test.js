import test from "node:test";
import assert from "node:assert/strict";
import { TransformerLM } from "./general-transformer.js";

test("multi-head multi-layer Transformer returns finite next-token logits",()=>{const m=new TransformerLM(7,{contextSize:5,width:4,heads:2,layers:2,hiddenSize:8,seed:7});const y=m.forward([0,1,2]);assert.deepEqual(y.shape,[3,7]);assert.ok(y.data.every(Number.isFinite));});
test("AdamW reduces loss on a repeated tiny sequence",()=>{const m=new TransformerLM(4,{contextSize:4,width:4,heads:2,layers:1,hiddenSize:8,seed:3});const x=[0,1,2],y=[1,2,3],before=m.loss(x,y).value;for(let i=0;i<30;i++)m.trainStep(x,y,{learningRate:.01,weightDecay:0});const after=m.loss(x,y).value;assert.ok(Number.isFinite(after));assert.ok(after<before,`expected loss reduction: ${before} -> ${after}`);});
test("checkpoint round-trip preserves logits, optimizer step and deterministic sampling",()=>{const m=new TransformerLM(5,{contextSize:4,width:4,heads:2,layers:1,hiddenSize:8,seed:9});m.trainStep([0,1,2],[1,2,3],{learningRate:.005});const y=m.forward([0,1,2]).toArray(),r=TransformerLM.fromJSON(JSON.parse(JSON.stringify(m.toJSON())));assert.deepEqual(r.forward([0,1,2]).toArray(),y);assert.equal(r.optimizerStep,m.optimizerStep);assert.deepEqual(r.generate([0],{maxNewTokens:8,seed:123}),m.generate([0],{maxNewTokens:8,seed:123}));});
test("invalid configuration and token IDs are rejected",()=>{assert.throws(()=>new TransformerLM(5,{width:5,heads:2}),/divisible by heads/);const m=new TransformerLM(5,{width:4,heads:2});assert.throws(()=>m.forward([0,5]),/valid and fit/);});
