import test from "node:test";
import assert from "node:assert/strict";
import { TransformerLM } from "./general-transformer.js";

test("multi-head multi-layer Transformer returns finite next-token logits",()=>{const m=new TransformerLM(7,{contextSize:5,width:4,heads:2,layers:2,hiddenSize:8,seed:7});const y=m.forward([0,1,2]);assert.deepEqual(y.shape,[3,7]);assert.ok(y.data.every(Number.isFinite));});
test("AdamW reduces loss on a repeated tiny sequence",()=>{const m=new TransformerLM(4,{contextSize:4,width:4,heads:2,layers:1,hiddenSize:8,seed:3});const x=[0,1,2],y=[1,2,3],before=m.loss(x,y).value;for(let i=0;i<30;i++)m.trainStep(x,y,{learningRate:.01,weightDecay:0});const after=m.loss(x,y).value;assert.ok(Number.isFinite(after));assert.ok(after<before,`expected loss reduction: ${before} -> ${after}`);});
test("checkpoint round-trip preserves logits, optimizer step and deterministic sampling",()=>{const m=new TransformerLM(5,{contextSize:4,width:4,heads:2,layers:1,hiddenSize:8,seed:9});m.trainStep([0,1,2],[1,2,3],{learningRate:.005});const y=m.forward([0,1,2]).toArray(),r=TransformerLM.fromJSON(JSON.parse(JSON.stringify(m.toJSON())));assert.deepEqual(r.forward([0,1,2]).toArray(),y);assert.equal(r.optimizerStep,m.optimizerStep);assert.deepEqual(r.generate([0],{maxNewTokens:8,seed:123}),m.generate([0],{maxNewTokens:8,seed:123}));});
test("invalid configuration and token IDs are rejected",()=>{assert.throws(()=>new TransformerLM(5,{width:5,heads:2}),/divisible by heads/);const m=new TransformerLM(5,{width:4,heads:2});assert.throws(()=>m.forward([0,5]),/valid and fit/);});

test("optimizer rejects invalid hyperparameters before updating weights", () => {
  const m = new TransformerLM(4, { contextSize: 4, width: 4, heads: 2, layers: 1, hiddenSize: 8, seed: 4 });
  const before = m.toJSON().parameters.map(p => [...p.data]);
  assert.throws(() => m.trainStep([0, 1], [1, 2], { beta1: 1 }), /beta1 and beta2/);
  assert.throws(() => m.trainStep([0, 1], [1, 2], { beta2: -0.1 }), /beta1 and beta2/);
  assert.throws(() => m.trainStep([0, 1], [1, 2], { epsilon: 0 }), /epsilon and maxGradientNorm/);
  assert.deepEqual(m.toJSON().parameters.map(p => [...p.data]), before);
});

test("checkpoint loader rejects non-finite or negative optimizer moments", () => {
  const m = new TransformerLM(4, { contextSize: 4, width: 4, heads: 2, layers: 1, hiddenSize: 8, seed: 5 });
  const badMoment = m.toJSON();
  badMoment.adamM[0][0] = Number.NaN;
  assert.throws(() => TransformerLM.fromJSON(badMoment), /invalid optimizer state/);
  const badVariance = m.toJSON();
  badVariance.adamV[0][0] = -1;
  assert.throws(() => TransformerLM.fromJSON(badVariance), /invalid optimizer state/);
  const badStep = m.toJSON();
  badStep.optimizerStep = -1;
  assert.throws(() => TransformerLM.fromJSON(badStep), /invalid optimizer step/);
});
