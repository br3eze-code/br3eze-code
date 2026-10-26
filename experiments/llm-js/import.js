import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

/**
 * Import weights into an already-configured TinyGPT without replacing Tensor
 * objects. Accepts this project's checkpoint JSON or a plain {state_dict}
 * / {parameters} mapping whose values are {shape,data}, nested numeric arrays,
 * or typed arrays. Standard framework keys can be mapped explicitly.
 */
export function importWeights(model, source, { nameMap = {}, strict = true, transpose = true } = {}) {
  if (!model?.params || !Array.isArray(model.parameterList)) {
    throw new TypeError("importWeights expects a TinyGPT-compatible model");
  }
  const checkpoint = typeof source === "string" ? JSON.parse(source) : source;
  if (!checkpoint || typeof checkpoint !== "object") throw new TypeError("checkpoint must be an object or JSON string");

  if (checkpoint.format === "br3eze-llm-js-tiny-gpt-v1") {
    for (const key of ["vocabSize", "contextSize", "embeddingSize", "hiddenSize", "numHeads", "numLayers"]) {
      if (checkpoint[key] !== model[key]) throw new RangeError(`checkpoint ${key} mismatch: expected ${model[key]}, received ${checkpoint[key]}`);
    }
  }
  const state = checkpoint.parameters ?? checkpoint.state_dict ?? checkpoint.model ?? checkpoint;
  const imported = [];
  const missing = [];
  const unexpected = new Set(Object.keys(state));
  for (const [name, tensor] of Object.entries(model.params)) {
    const candidates = [nameMap[name], name, ...aliases(name)].filter(Boolean);
    const key = candidates.find((candidate) => Object.hasOwn(state, candidate));
    if (!key) { missing.push(name); continue; }
    unexpected.delete(key);
    const item = state[key];
    let shape = item?.shape;
    let values = item?.data ?? item?.values;
    if (!values && Array.isArray(item)) {
      if (Array.isArray(item[0])) {
        shape = [item.length, item[0].length];
        values = item.flat();
      } else {
        shape = [item.length];
        values = item;
      }
    }
    if (ArrayBuffer.isView(item) && !(item instanceof DataView)) {
      shape = tensor.shape;
      values = Array.from(item);
    }
    if (!Array.isArray(values) && !ArrayBuffer.isView(values)) {
      throw new TypeError(`unsupported weight representation for ${key}`);
    }
    values = Array.from(values);
    const expectedShape = tensor.shape;
    const shapeMatches = (a, b) => Array.isArray(a) && a.length === b.length && a.every((v, i) => v === b[i]);
    if (shape && !shapeMatches(shape, expectedShape)) {
      const canTranspose = transpose && expectedShape.length === 2 && shapeMatches(shape, [...expectedShape].reverse());
      if (!canTranspose) throw new RangeError(`shape mismatch for ${key}: expected [${expectedShape}], received [${shape}]`);
      const [rows, cols] = shape;
      const original = values;
      values = Array.from({ length: rows * cols }, (_, i) => original[(i % rows) * cols + Math.floor(i / rows)]);
      shape = [...expectedShape];
    }
    if (values.length !== tensor.size) throw new RangeError(`size mismatch for ${key}: expected ${tensor.size}, received ${values.length}`);
    if (values.some((value) => typeof value !== "number" || !Number.isFinite(value))) {
      throw new TypeError(`non-finite or non-numeric weight values for ${key}`);
    }
    tensor.data.set(values);
    tensor.zeroGrad();
    imported.push({ source: key, target: name, shape: [...expectedShape] });
  }
  if (strict && missing.length) throw new RangeError(`checkpoint missing model parameters: ${missing.join(", ")}`);
  return { imported, missing, unexpected: [...unexpected] };
}

function aliases(name) {
  // Small explicit bridge for common GPT-2-style names. This does not make
  // architecture-incompatible checkpoints compatible; dimensions still gate import.
  const block = name.match(/^block(\d+)_(.+)$/);
  if (block) {
    const [, layer, suffix] = block;
    const map = {
      ln1Gamma: `transformer.h.${layer}.ln_1.weight`,
      ln1Beta: `transformer.h.${layer}.ln_1.bias`,
      qWeight: `transformer.h.${layer}.attn.q_proj.weight`,
      qBias: `transformer.h.${layer}.attn.q_proj.bias`,
      kWeight: `transformer.h.${layer}.attn.k_proj.weight`,
      kBias: `transformer.h.${layer}.attn.k_proj.bias`,
      vWeight: `transformer.h.${layer}.attn.v_proj.weight`,
      vBias: `transformer.h.${layer}.attn.v_proj.bias`,
      attentionWeight: `transformer.h.${layer}.attn.out_proj.weight`,
      attentionBias: `transformer.h.${layer}.attn.out_proj.bias`,
      ln2Gamma: `transformer.h.${layer}.ln_2.weight`,
      ln2Beta: `transformer.h.${layer}.ln_2.bias`,
      ff1Weight: `transformer.h.${layer}.mlp.c_fc.weight`,
      ff1Bias: `transformer.h.${layer}.mlp.c_fc.bias`,
      ff2Weight: `transformer.h.${layer}.mlp.c_proj.weight`,
      ff2Bias: `transformer.h.${layer}.mlp.c_proj.bias`
    };
    return [map[suffix]].filter(Boolean);
  }
  const common = {
    tokenEmbedding: ["transformer.wte.weight", "wte.weight"],
    positionEmbedding: ["transformer.wpe.weight", "wpe.weight"],
    finalGamma: ["transformer.ln_f.weight", "ln_f.weight"],
    finalBeta: ["transformer.ln_f.bias", "ln_f.bias"],
    lmHeadWeight: ["lm_head.weight"],
    lmHeadBias: ["lm_head.bias"]
  };
  return common[name] ?? [];
}

export async function loadCheckpoint(path) {
  return JSON.parse(await readFile(resolve(path), "utf8"));
}
