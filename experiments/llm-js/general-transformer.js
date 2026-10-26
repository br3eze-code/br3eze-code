import { Tensor } from "./tensor.js";
import { embedding, row, crossEntropy, softmax } from "./ops.js";
import { linear, layerNorm } from "./layers.js";
import { causalSelfAttention } from "./attention.js";

function rngFor(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const zeros = n => Tensor.vector(new Array(n).fill(0));
function randomMatrix(rows, cols, rng, scale = Math.sqrt(2 / (rows + cols))) {
  return new Tensor(Array.from({ length: rows * cols }, () => (rng() * 2 - 1) * scale), [rows, cols]);
}
function concatColumns(tensors) {
  if (!tensors.length) throw new TypeError("at least one tensor is required");
  const rows = tensors[0].shape[0];
  if (tensors.some(t => t.shape.length !== 2 || t.shape[0] !== rows)) throw new RangeError("column tensors must have equal row counts");
  const widths = tensors.map(t => t.shape[1]), width = widths.reduce((a,b) => a+b, 0);
  const out = new Tensor(new Float64Array(rows * width), [rows, width]);
  let offset = 0;
  tensors.forEach((t, index) => { const w = widths[index]; for (let r=0;r<rows;r++) out.data.set(t.data.slice(r*w,(r+1)*w),r*width+offset); offset += w; });
  out.parents = tensors;
  out._backward = () => { let start=0; tensors.forEach((t,index)=>{ const w=widths[index]; for(let r=0;r<rows;r++) for(let c=0;c<w;c++) t.grad[r*w+c] += out.grad[r*width+start+c]; start += w; }); };
  return out;
}

/** Configurable decoder-only Transformer LM. CPU/Float64 reference implementation for learning. */
export class TransformerLM {
  constructor(vocabSize, { contextSize=32, width=16, heads=2, layers=2, hiddenSize=width*4, seed=42 }={}) {
    for (const [n,v,min] of [["vocabSize",vocabSize,2],["contextSize",contextSize,2],["width",width,2],["heads",heads,1],["layers",layers,1],["hiddenSize",hiddenSize,1]]) if(!Number.isInteger(v)||v<min) throw new RangeError(n+" must be an integer >= "+min);
    if(width%heads) throw new RangeError("width must be divisible by heads");
    Object.assign(this,{vocabSize,contextSize,width,heads,layers,hiddenSize,seed});
    const rng=rngFor(seed), d=width, hd=width/heads, h=hiddenSize, init=(a,b)=>randomMatrix(a,b,rng), norm=()=>({gamma:Tensor.vector(new Array(d).fill(1)),beta:zeros(d)});
    this.tokenEmbedding=randomMatrix(vocabSize,d,rng,.04); this.positionEmbedding=randomMatrix(contextSize,d,rng,.04);
    this.blocks=Array.from({length:layers},()=>{const b={ln1:norm(),ln2:norm(),heads:[]}; for(let i=0;i<heads;i++) b.heads.push({qW:init(d,hd),qB:zeros(hd),kW:init(d,hd),kB:zeros(hd),vW:init(d,hd),vB:zeros(hd)}); b.attnW=init(d,d);b.attnB=zeros(d);b.ff1W=init(d,h);b.ff1B=zeros(h);b.ff2W=init(h,d);b.ff2B=zeros(d);return b;});
    this.finalNorm=norm();this.lmW=init(d,vocabSize);this.lmB=zeros(vocabSize);
    this.parameters=[this.tokenEmbedding,this.positionEmbedding,...this.blocks.flatMap(b=>[b.ln1.gamma,b.ln1.beta,...b.heads.flatMap(a=>[a.qW,a.qB,a.kW,a.kB,a.vW,a.vB]),b.attnW,b.attnB,b.ln2.gamma,b.ln2.beta,b.ff1W,b.ff1B,b.ff2W,b.ff2B]),this.finalNorm.gamma,this.finalNorm.beta,this.lmW,this.lmB];
    this.optimizerStep=0;this.adamM=this.parameters.map(p=>new Float64Array(p.size));this.adamV=this.parameters.map(p=>new Float64Array(p.size));
  }
  forward(ids) {
    if(!Array.isArray(ids)||!ids.length||ids.length>this.contextSize||ids.some(i=>!Number.isInteger(i)||i<0||i>=this.vocabSize)) throw new RangeError("token IDs must be valid and fit within contextSize");
    let x=embedding(this.tokenEmbedding,ids).add(embedding(this.positionEmbedding,ids.map((_,i)=>i)));
    for(const b of this.blocks){const n=layerNorm(x,b.ln1.gamma,b.ln1.beta);const joined=concatColumns(b.heads.map(a=>causalSelfAttention(linear(n,a.qW,a.qB),linear(n,a.kW,a.kB),linear(n,a.vW,a.vB)).output));x=x.add(linear(joined,b.attnW,b.attnB));const m=layerNorm(x,b.ln2.gamma,b.ln2.beta);x=x.add(linear(linear(m,b.ff1W,b.ff1B).relu(),b.ff2W,b.ff2B));}
    return linear(layerNorm(x,this.finalNorm.gamma,this.finalNorm.beta),this.lmW,this.lmB);
  }
  loss(inputs,targets){if(!Array.isArray(inputs)||!Array.isArray(targets)||!inputs.length||inputs.length!==targets.length||inputs.length>this.contextSize)throw new RangeError("inputs and targets must be equal non-empty sequences within contextSize");const logits=this.forward(inputs);let total=null;for(let i=0;i<targets.length;i++){const t=crossEntropy(row(logits,i),targets[i]);total=total===null?t:total.add(t);}return total.mul(1/targets.length);}
  trainStep(inputs,targets,{learningRate=.001,weightDecay=.01,beta1=.9,beta2=.999,epsilon=1e-8,maxGradientNorm=1}={}) {
    if(!(learningRate>0)||!Number.isFinite(learningRate)||!(weightDecay>=0)||!Number.isFinite(weightDecay))throw new RangeError("invalid learningRate or weightDecay");
    for(const p of this.parameters)p.zeroGrad();const loss=this.loss(inputs,targets);if(!Number.isFinite(loss.value))throw new Error("non-finite loss");loss.backward();let norm2=0;
    for(const p of this.parameters)for(const g of p.grad){if(!Number.isFinite(g))throw new Error("non-finite gradient");norm2+=g*g;}
    const norm=Math.sqrt(norm2),scale=norm>maxGradientNorm?maxGradientNorm/norm:1;this.optimizerStep++;const c1=1-beta1**this.optimizerStep,c2=1-beta2**this.optimizerStep;
    this.parameters.forEach((p,j)=>{const m=this.adamM[j],v=this.adamV[j];for(let i=0;i<p.size;i++){const g=p.grad[i]*scale;m[i]=beta1*m[i]+(1-beta1)*g;v[i]=beta2*v[i]+(1-beta2)*g*g;p.data[i]-=learningRate*((m[i]/c1)/(Math.sqrt(v[i]/c2)+epsilon)+weightDecay*p.data[i]);}});
    return loss.value;
  }
  generate(seedIds,{maxNewTokens=100,temperature=1,seed=this.seed}={}){if(!Array.isArray(seedIds)||!seedIds.length||seedIds.some(i=>!Number.isInteger(i)||i<0||i>=this.vocabSize))throw new RangeError("seedIds must be valid token IDs");if(!Number.isInteger(maxNewTokens)||maxNewTokens<0||!(temperature>0)||!Number.isFinite(temperature))throw new RangeError("invalid generation options");const rng=rngFor(seed),out=[...seedIds];for(let n=0;n<maxNewTokens;n++){const ctx=out.slice(-this.contextSize),p=softmax(row(this.forward(ctx),ctx.length-1).mul(1/temperature)).data;let draw=rng(),next=p.length-1;for(let i=0;i<p.length;i++){draw-=p[i];if(draw<=0){next=i;break;}}out.push(next);}return out;}
  toJSON(){return {format:"br3eze-transformer-lm-v1",config:{vocabSize:this.vocabSize,contextSize:this.contextSize,width:this.width,heads:this.heads,layers:this.layers,hiddenSize:this.hiddenSize,seed:this.seed},optimizerStep:this.optimizerStep,parameters:this.parameters.map(p=>({shape:p.shape,data:Array.from(p.data)})),adamM:this.adamM.map(a=>Array.from(a)),adamV:this.adamV.map(a=>Array.from(a))};}
  static fromJSON(c){if(!c||c.format!=="br3eze-transformer-lm-v1"||!c.config||!Array.isArray(c.parameters))throw new TypeError("invalid TransformerLM checkpoint");const m=new TransformerLM(c.config.vocabSize,c.config);if(c.parameters.length!==m.parameters.length)throw new RangeError("checkpoint parameter count mismatch");m.parameters.forEach((p,i)=>{const s=c.parameters[i];if(!s||JSON.stringify(s.shape)!==JSON.stringify(p.shape)||!Array.isArray(s.data)||s.data.length!==p.size||s.data.some(v=>!Number.isFinite(v)))throw new RangeError("invalid parameter "+i);p.data.set(s.data);});if(c.adamM&&c.adamV){if(c.adamM.length!==m.parameters.length||c.adamV.length!==m.parameters.length)throw new RangeError("optimizer state mismatch");m.adamM=c.adamM.map(a=>Float64Array.from(a));m.adamV=c.adamV.map(a=>Float64Array.from(a));if(m.adamM.some((a,i)=>a.length!==m.parameters[i].size)||m.adamV.some((a,i)=>a.length!==m.parameters[i].size))throw new RangeError("optimizer shape mismatch");}m.optimizerStep=Number.isInteger(c.optimizerStep)&&c.optimizerStep>=0?c.optimizerStep:0;return m;}
}
