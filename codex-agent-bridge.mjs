import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { materializeMedia, copyImportedMedia } from './media-import.mjs';

const CODEX_HOME = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
const GENERATED_DIR = path.join(CODEX_HOME, 'generated_images');

const FALLBACK_CODEX_MODELS = [
  { id: 'gpt-5.6-sol', label: 'Codex · GPT-5.6-Sol', defaultEffort: 'medium', efforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'] },
  { id: 'gpt-5.6-terra', label: 'Codex · GPT-5.6-Terra', defaultEffort: 'medium', efforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'] },
  { id: 'gpt-5.6-luna', label: 'Codex · GPT-5.6-Luna', defaultEffort: 'medium', efforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'] },
  { id: 'gpt-6-astra', label: 'Codex · GPT-6-Astra', defaultEffort: 'medium', efforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'] },
  { id: 'gpt-5.5', label: 'Codex · GPT-5.5', defaultEffort: 'xhigh', efforts: ['low', 'medium', 'high', 'xhigh'] },
];

export function getCodexModels() {
  try {
    const file = path.join(CODEX_HOME, 'models_cache.json');
    const cache = JSON.parse(fs.readFileSync(file, 'utf8'));
    const models = (cache.models || [])
      .filter((model) => model.visibility === 'list' && model.supported_in_api !== false)
      .map((model) => ({
        id: model.slug,
        label: `Codex · ${model.display_name || model.slug}`,
        defaultEffort: model.default_reasoning_level || 'medium',
        efforts: (model.supported_reasoning_levels || []).map((level) => level.effort).filter(Boolean),
      }));
    if (models.length) return models;
  } catch { /* use the known-safe local defaults */ }
  return FALLBACK_CODEX_MODELS;
}

function codexCommand() {
  // Allow an explicit Franklin override, otherwise use the PATH CLI.
  if (process.env.FRANKLIN_CODEX_CLI_PATH) return process.env.FRANKLIN_CODEX_CLI_PATH;
  if (process.platform === 'win32') {
    return 'codex.cmd';
  }
  return 'codex';
}

function cleanCodexEnv() {
  const codexEnv = { ...process.env };
  if (process.env.CODEX_HOME) codexEnv.CODEX_HOME = process.env.CODEX_HOME;
  // Keep the MCP runtime path, but do not bind the child to the parent
  // Desktop thread or app-tool pipe.
  for (const key of ['CODEX_CI', 'CODEX_APP_TOOLS_PIPE_PATH', 'CODEX_THREAD_ID', 'CODEX_SESSION_ID', 'CODEX_INTERNAL_ORIGINATOR_OVERRIDE']) delete codexEnv[key];
  return codexEnv;
}

function parseJsonLines(text) {
  const events = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    if (!line.trim().startsWith('{')) continue;
    try { events.push(JSON.parse(line)); } catch { /* diagnostics are not JSONL */ }
  }
  return events;
}

function textFromEvents(events) {
  return events
    .filter((e) => e.type === 'item.completed' && e.item?.type === 'agent_message')
    .map((e) => e.item.text || '')
    .filter(Boolean)
    .at(-1) || '';
}

function findJsonObject(text) {
  const raw = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(raw); } catch { /* continue */ }
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try { return JSON.parse(raw.slice(start, end + 1)); } catch { /* continue */ }
  }
  return null;
}

function walk(value, visit) {
  if (!value || typeof value !== 'object') return;
  visit(value);
  if (Array.isArray(value)) for (const item of value) walk(item, visit);
  else for (const item of Object.values(value)) walk(item, visit);
}

function collectPaths(events) {
  const paths = [];
  walk(events, (value) => {
    for (const [key, item] of Object.entries(value)) {
      if (typeof item !== 'string' || !/(path|file|output|artifact)/i.test(key)) continue;
      if (/\.(png|jpe?g|webp)$/i.test(item) && fs.existsSync(item)) paths.push(item);
    }
  });
  return [...new Set(paths)];
}

function recentGeneratedImages(sinceMs) {
  if (!fs.existsSync(GENERATED_DIR)) return [];
  return fs.readdirSync(GENERATED_DIR)
    .map((name) => path.join(GENERATED_DIR, name))
    .filter((file) => /\.(png|jpe?g|webp)$/i.test(file) && fs.statSync(file).mtimeMs >= sinceMs)
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
}

export async function runCodexExec({ prompt, images = [], cwd, model, reasoningEffort, timeoutMs = 15 * 60 * 1000, sandbox = 'workspace-write', onEvent }) {
  // TopView uses codex-mcp-client.mjs; this executor is for reasoning/images.
  const args = ['exec', '--json', '--skip-git-repo-check', '-s', sandbox, '-C', cwd];
  if (model) args.push('-m', model);
  if (['low', 'medium', 'high', 'xhigh', 'max', 'ultra'].includes(reasoningEffort)) args.push('-c', `model_reasoning_effort=${reasoningEffort}`);
  for (const image of images) args.push('-i', image);
  const startedAt = Date.now();
  const codexEnv = cleanCodexEnv();
  const child = spawn(codexCommand(), args, {
    cwd,
    env: codexEnv,
    shell: process.platform === 'win32' && /\.(cmd|bat)$/i.test(codexCommand()),
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  let pendingLine = '';
  child.stdout.on('data', (chunk) => {
    const text = chunk.toString();
    stdout += text;
    pendingLine += text;
    const lines = pendingLine.split(/\r?\n/);
    pendingLine = lines.pop() || '';
    for (const line of lines) {
      if (!line.trim().startsWith('{')) continue;
      try { onEvent?.(JSON.parse(line)); } catch { /* final parser handles diagnostics */ }
    }
  });
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  const timer = setTimeout(() => child.kill(), timeoutMs);
  const result = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal }));
    child.stdin.end(prompt);
  }).finally(() => clearTimeout(timer));
  const events = parseJsonLines(stdout);
  if (result.code !== 0) {
    const detail = textFromEvents(events) || stderr.replace(/\s+/g, ' ').slice(-500);
    if (/login|auth|unauthorized|not authenticated/i.test(detail)) throw new Error('Codex authentication is required. Run the supported Codex login flow and retry.');
    throw new Error(`Codex bridge failed${detail ? `: ${detail}` : ''}`);
  }
  return { events, text: textFromEvents(events), stdout, stderr, startedAt };
}

export async function runCodexAgentChat({ system, messages, tools, model, reasoningEffort }) {
  const compactTools = (tools || []).map((tool) => ({
    name: tool.function?.name,
    description: tool.function?.description,
    parameters: tool.function?.parameters,
  }));
  const prompt = [
    'You are the reasoning engine for Franklin Canvas Media Agent.',
    'Use the authenticated Codex OAuth session. Do not use an API key.',
    'Do not call Codex built-in tools, image_gen, shell, filesystem, web, or MCP tools yourself.',
    'The frontend will execute the returned Franklin tool calls and send their results in a later turn.',
    'Return exactly one JSON object and no markdown with this schema:',
    '{"message":{"role":"assistant","content":null,"tool_calls":[{"id":"call_1","type":"function","function":{"name":"tool_name","arguments":"JSON string"}}]},"finish_reason":"tool_calls"}',
    'If no tool is needed, return tool_calls as [] and finish_reason as "stop".',
    'Choose only from the supplied tools. Keep arguments valid JSON. Preserve the user language in prompts.',
    'SYSTEM:\n' + String(system || ''),
    'TOOLS:\n' + JSON.stringify(compactTools),
    'CONVERSATION:\n' + JSON.stringify(messages || []),
  ].join('\n\n');
  const run = await runCodexExec({ prompt, cwd: process.cwd(), model, reasoningEffort, sandbox: 'read-only', timeoutMs: 120_000 });
  const parsed = findJsonObject(run.text);
  const message = parsed?.message && typeof parsed.message === 'object'
    ? parsed.message
    : { role: 'assistant', content: run.text || '', tool_calls: [] };
  if (!Array.isArray(message.tool_calls)) message.tool_calls = [];
  return { message: { role: 'assistant', ...message }, finish_reason: parsed?.finish_reason || (message.tool_calls.length ? 'tool_calls' : 'stop') };
}

export async function codexStatus() {
  return new Promise((resolve) => {
    const codexEnv = cleanCodexEnv();
    const child = spawn(codexCommand(), ['login', 'status'], {
      cwd: process.cwd(), env: codexEnv,
      shell: process.platform === 'win32' && /\.(cmd|bat)$/i.test(codexCommand()), stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    let error = '';
    const timer = setTimeout(() => child.kill(), 15_000);
    child.stdout.on('data', (chunk) => { output += chunk.toString(); });
    child.stderr.on('data', (chunk) => { error += chunk.toString(); });
    child.once('error', (err) => { clearTimeout(timer); resolve({ connected: false, provider: 'codex', error: err.message }); });
    child.once('close', (code) => {
      clearTimeout(timer);
      const safe = `${output} ${error}`.replace(/\s+/g, ' ').trim();
      resolve({ connected: code === 0 && /logged in/i.test(safe), provider: 'codex', model: 'codex-image', models: getCodexModels(), ...(code === 0 ? {} : { error: 'Codex authentication is required.' }) });
    });
  });
}

async function runImage({ prompt, inputImage, jobsDir, jobId, edit, aspectRatio, size, quality }) {
  const workDir = path.join(jobsDir, 'codex-work', jobId);
  fs.mkdirSync(workDir, { recursive: true });
  const images = inputImage ? [await materializeMedia(inputImage, { jobsDir })] : [];
  const mode = edit ? 'edit the attached image' : 'generate a new image';
  const run = await runCodexExec({
    cwd: workDir,
    images,
    prompt: [
      `Use Codex built-in image_gen only to ${mode}.`,
      'Do not use an OpenAI API key, REST API, or CLI image fallback.',
      'Preserve all edit invariants in the request and create a new non-destructive result.',
      ...(aspectRatio && aspectRatio !== 'auto' ? [`Requested aspect ratio: ${aspectRatio}.`] : ['Use the best automatic output size.']),
      ...(size && size !== 'auto' ? [`Requested output size: ${size}.`] : ['Use the automatic size for this image.']),
      ...(quality ? [`Requested Codex image quality: ${quality}.`] : []),
      `User request: ${prompt}`,
      'After generation, ensure the final PNG/JPEG/WEBP is present in the current working directory or report its absolute path.',
      'Return exactly one JSON object: {"ok":true,"kind":"image","provider":"codex","model":"codex-image","path":"absolute image path","text":"short summary"}.',
    ].join('\n'),
  });
  const structured = findJsonObject(run.text) || {};
  const candidates = [structured.path, ...collectPaths(run.events), ...recentGeneratedImages(run.startedAt)].filter(Boolean);
  const source = candidates.find((candidate) => fs.existsSync(candidate));
  if (!source) throw new Error('Codex image generation completed but no image file was returned');
  const imported = copyImportedMedia(source, jobsDir, jobId, 'png');
  return { ok: true, kind: 'image', provider: 'codex', model: 'codex-image', path: imported.path, resultUrl: `/api/generated/${jobId}.${imported.ext}`, prompt, metadata: { summary: structured.text || run.text.slice(0, 500), edit } };
}

export async function codexGenerateImage(args) {
  return runImage({ ...args, edit: false });
}

export async function codexEditImage(args) {
  return runImage({ ...args, edit: true });
}
