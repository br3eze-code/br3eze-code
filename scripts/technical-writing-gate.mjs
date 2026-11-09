#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const documentationFiles = [
  'docs/architecture/diagnostic-observation.md',
  'docs/troubleshooting/diagnostic-observation.md',
];
const vagueTerms = /\b(?:simply|easily|obviously|just|etc\.|and\/or)\b/i;
const maxWordsPerSentence = 26;

function stripMarkup(value) {
  return value
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/!?\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*(?:[-*+] |\d+\. )/gm, '')
    .replace(/[*_~>#]/g, ' ');
}

export function inspectTechnicalText(value, { file = '<input>', maxWords = maxWordsPerSentence } = {}) {
  const findings = [];
  const lines = stripMarkup(String(value)).split(/\r?\n/);
  lines.forEach((line, index) => {
    const text = line.trim();
    if (!text) return;
    if (vagueTerms.test(text)) findings.push({ file, line: index + 1, rule: 'vague-term', text });
    const sentences = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [];
    for (const sentence of sentences) {
      const words = sentence.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) || [];
      if (words.length > maxWords) findings.push({ file, line: index + 1, rule: 'long-sentence', words: words.length, text: sentence.trim() });
    }
  });
  return findings;
}

async function readSource(relative) {
  return fs.readFile(path.join(root, relative), 'utf8');
}

export async function runTechnicalWritingGate() {
  const findings = [];
  for (const relative of documentationFiles) {
    findings.push(...inspectTechnicalText(await readSource(relative), { file: relative }));
  }

  const toolsPath = 'src/core/diagnostics/diagnostic-tools.js';
  const toolsSource = await readSource(toolsPath);
  for (const match of toolsSource.matchAll(/description:\s*'([^']+)'/g)) {
    findings.push(...inspectTechnicalText(match[1], { file: toolsPath }));
  }

  const cliPath = 'main.js';
  const cliSource = await readSource(cliPath);
  const cliDescription = cliSource.match(/program\.command\('debug \[mode\]'\)\.description\('([^']+)'\)/);
  if (!cliDescription) {
    findings.push({ file: cliPath, line: 1, rule: 'missing-cli-description', text: 'Could not find the debug command description.' });
  } else {
    findings.push(...inspectTechnicalText(cliDescription[1], { file: cliPath }));
  }

  if (findings.length) {
    console.error('Technical writing gate failed:');
    for (const finding of findings) console.error(`- ${finding.file}:${finding.line} [${finding.rule}] ${finding.text}`);
    return false;
  }
  console.log('Technical writing gate passed. This is not a formal ASD-STE100 compliance check.');
  return true;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runTechnicalWritingGate().then((passed) => {
    if (!passed) process.exitCode = 1;
  }).catch((error) => {
    console.error(`Technical writing gate could not complete: ${error.message}`);
    process.exitCode = 1;
  });
}
