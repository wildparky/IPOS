import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { CodexMcpClient } from './codex-mcp-client.mjs';
import { materializeMedia, copyImportedMedia } from './media-import.mjs';

const REQUIRED_TOOLS = ['topview_get_generation_config', 'topview_generate_video', 'topview_query_task'];
const fail = (code, message, extra = {}) => Object.assign(new Error(message), { code, ...extra });
const normalizeModel = value => String(value || '').replace(/^topview\//, '').toLowerCase().replace(/[^a-z0-9]/g, '');

export function unwrapTopview(response) {
  let data = response.structuredContent || response.structured_content;
  if (!data) for (const item of response.content || []) {
    if (item.type !== 'text') continue;
    try { data = JSON.parse(item.text); break; } catch { /* skip non-JSON */ }
  }
  if (response.isError || !data) throw fail('topview_tool_error', 'TopView MCP returned an error or unreadable response.');
  if (data.code != null && !['200', '0'].includes(String(data.code))) {
    const auth = ['401', '403'].includes(String(data.code));
    throw fail(auth ? 'topview_authentication_required' : 'topview_generation_failed', auth
      ? 'TopView MCP authentication required. Run codex mcp login topview-mcp.'
      : `TopView rejected the request (code ${String(data.code).replace(/[^a-z0-9_-]/gi, '').slice(0, 30)}).`, { provider_code: data.code });
  }
  return data;
}

export async function discoverTopview(client) {
  const server = (await client.listServers()).find(s => s.name === 'topview-mcp');
  if (!server) throw fail('topview_mcp_not_configured', 'TopView MCP is not configured in the Codex host.');
  if (server.authStatus === 'notLoggedIn' || server.runtimeStatus === 'authenticationRequired') throw fail('topview_authentication_required', 'TopView MCP authentication required. Run codex mcp login topview-mcp.');
  const tools = new Map(Object.values(server.tools || {}).map(tool => [tool.name, tool]));
  const missing = REQUIRED_TOOLS.filter(name => !tools.has(name));
  if (missing.length) throw fail('topview_mcp_tools_unavailable', `TopView MCP is missing video tools: ${missing.join(', ')}.`);
  return { name: server.name, tools };
}

export function buildTopviewSubmit(input, config, submitTool, fileIds = []) {
  const mode = input.inputMode || (fileIds.length ? 'singleImage' : 'text');
  const taskType = { text: 'text_to_video', textToVideo: 'text_to_video', singleImage: 'image_to_video', firstLast: 'image_to_video', omniReference: 'omni_reference' }[mode];
  if (!taskType) throw fail('topview_unsupported_input_mode', 'Unsupported TopView input mode.');
  const models = (config.models || []).filter(m => /^seedance/i.test(m.submitModel || '') && m.status !== 0);
  const requested = !input.model || input.model === 'topview/seedance' ? config.modelSelectionPolicy?.preferredSubmitModel : input.model;
  const model = models.find(m => [m.submitModel, m.displayName, m.backendModelCode].some(v => normalizeModel(v) === normalizeModel(requested)));
  if (!model || (model.taskType && model.taskType !== taskType)) throw fail('topview_unsupported_model_mode', 'The selected Seedance model does not support this mode.');
  if (taskType === 'image_to_video') {
    const modes = model.inputModes || [model.inputImageMode];
    if (mode === 'firstLast' && !modes.includes('startEndFrame')) throw fail('topview_unsupported_model_mode', 'This model does not support First / Last mode.');
    if (mode === 'singleImage' && !modes.includes('singleImage') && !modes.includes('startEndFrame')) throw fail('topview_unsupported_model_mode', 'This model does not support an image input.');
    const limit = mode === 'firstLast' ? 2 : 1;
    if (!fileIds.length || fileIds.length > limit) throw fail('topview_invalid_images', `This mode requires ${limit === 2 ? 'one or two images' : 'one image'}.`);
  }
  if (taskType === 'text_to_video' && fileIds.length) throw fail('topview_invalid_images', 'Choose an image input mode to use connected images.');
  if (taskType === 'omni_reference' && !fileIds.length) throw fail('topview_invalid_images', 'Omni Reference requires at least one reference image.');
  const props = (submitTool.inputSchema || submitTool.input_schema)?.properties?.req?.properties;
  if (!props) throw fail('topview_schema_changed', 'TopView submit schema changed; refresh the integration.');
  const req = { taskType, model: model.submitModel };
  const options = model.submitParameterOptions || {};
  const defaults = model.defaultSubmitParameters || {};
  const supplied = { resolution: input.resolution == null ? undefined : Number(String(input.resolution).replace(/p$/, '')), duration: input.durationS, aspectRatio: input.aspectRatio };
  for (const key of new Set([...Object.keys(options), ...Object.keys(defaults)])) {
    if (!props[key]) continue;
    const value = supplied[key] ?? defaults[key];
    if (value == null) continue;
    if (Array.isArray(options[key]) && !options[key].includes(value)) throw fail('topview_invalid_parameter', `Unsupported ${key} for ${model.submitModel}: ${String(value)}.`);
    req[key] = value;
  }
  if (props.prompt) req.prompt = input.prompt;
  if (taskType === 'image_to_video') {
    req.firstFrameFileId = fileIds[0];
    if (fileIds[1]) req.endFrameFileId = fileIds[1];
  } else if (taskType === 'omni_reference') req.inputImages = fileIds.map((fileId, i) => ({ fileId, name: `Image${i + 1}` }));
  if (props.generatingCount) req.generatingCount = 1;
  for (const field of model.requiredSubmitFields || []) if (req[field] == null || req[field] === '') throw fail('topview_missing_parameter', `Missing required TopView parameter: ${field}.`);
  for (const field of Object.keys(req)) if (!props[field]) throw fail('topview_schema_changed', `TopView submit schema does not accept ${field}.`);
  return req;
}

export function topviewTaskState(data) {
  const result = data.result && typeof data.result === 'object' ? data.result : data;
  const status = String(result.status ?? result.taskStatus ?? data.status ?? '').toLowerCase();
  const taskId = result.taskId || result.task_id || data.taskId;
  const state = { task_id: typeof taskId === 'string' ? taskId : null, status };
  const progress = result.progress ?? result.percentage ?? result.percent;
  if (progress != null && progress !== '' && Number.isFinite(Number(progress))) state.progress = Math.max(0, Math.min(1, Number(progress) > 1 ? Number(progress) / 100 : Number(progress)));
  const eta = result.etaSeconds ?? result.eta_seconds ?? result.remainingSeconds;
  if (eta != null && eta !== '' && Number.isFinite(Number(eta))) state.etaSeconds = Math.max(0, Number(eta));
  return state;
}

export function resultVideoUrls(data) {
  const urls = [];
  const visit = (value, context = '') => {
    if (typeof value === 'string') {
      if (/^https:\/\//i.test(value) && (/video|download|output|result/i.test(context) || /\.(mp4|webm|mov)(?:[?#]|$)/i.test(value))) urls.push(value);
    } else if (Array.isArray(value)) value.forEach(v => visit(v, context));
    else if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) {
      if (/thumbnail|cover|input|reference|upload/i.test(key)) continue;
      visit(child, `${context}.${key}`);
    }
  };
  visit(data.result ?? data, 'result');
  return [...new Set(urls)];
}

async function uploadImage(client, server, file) {
  if (!server.tools.has('ta_upload_credential') || !server.tools.has('ta_upload_check_file')) throw fail('topview_upload_unavailable', 'TopView MCP upload tools are unavailable.');
  const format = path.extname(file).slice(1).toLowerCase().replace('jpeg', 'jpg');
  if (!['png', 'jpg', 'webp'].includes(format)) throw fail('topview_invalid_images', 'Unsupported reference image format.');
  const credential = unwrapTopview(await client.call(server.name, 'ta_upload_credential', { format })).result;
  if (!credential?.fileId || !/^https:\/\//i.test(credential.uploadUrl || '')) throw fail('topview_upload_failed', 'TopView did not return a valid private upload destination.');
  // Presigned upload URLs stay in memory only.
  const response = await fetch(credential.uploadUrl, { method: 'PUT', body: fs.readFileSync(file), signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw fail('topview_upload_failed', `TopView image upload failed (HTTP ${response.status}).`);
  for (let attempt = 0; attempt < 5; attempt++) {
    if (unwrapTopview(await client.call(server.name, 'ta_upload_check_file', { fileId: credential.fileId })).result === true) return credential.fileId;
    await delay(1000);
  }
  throw fail('topview_upload_failed', 'TopView could not confirm the uploaded reference image.');
}

async function importVideo(urls, jobsDir, jobId) {
  const workDir = path.join(jobsDir, 'topview-work', jobId);
  fs.mkdirSync(workDir, { recursive: true });
  for (const url of urls) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
      if (!response.ok) continue;
      const buffer = Buffer.from(await response.arrayBuffer());
      const mp4 = buffer.length > 12 && buffer.toString('ascii', 4, 8) === 'ftyp';
      const webm = buffer.length > 4 && buffer.readUInt32BE(0) === 0x1a45dfa3;
      if (!mp4 && !webm) continue;
      const file = path.join(workDir, `result.${webm ? 'webm' : 'mp4'}`);
      fs.writeFileSync(file, buffer);
      const imported = copyImportedMedia(file, jobsDir, jobId);
      return { path: imported.path, resultUrl: `/api/generated/${jobId}.${imported.ext}` };
    } catch { /* try the next provider output URL; never resubmit */ }
  }
  throw fail('topview_import_failed', 'TopView generation completed, but video import failed. The task ID was retained; do not regenerate to retry import.');
}

export async function topviewStatus() {
  const client = new CodexMcpClient();
  try {
    await client.start();
    const server = await discoverTopview(client);
    unwrapTopview(await client.call(server.name, 'topview_get_generation_config', { req: { type: 'video', taskType: 'text_to_video' } }));
    return { connected: true, provider: 'topview', model: 'seedance', transport: 'codex-app-server' };
  } catch (error) {
    return { connected: false, provider: 'topview', model: 'seedance', error: error.code || 'topview_connection_failed' };
  } finally { client.close(); }
}

export async function topviewGenerateVideo(input, { client = new CodexMcpClient(), pollMs = 10_000, timeoutMs = 25 * 60_000, sleep = delay, importResult = importVideo } = {}) {
  const { jobsDir, jobId, onProgress } = input;
  const urls = [...new Set([...(input.imageUrls || []), input.imageUrl, input.imageUrl2].filter(Boolean))];
  let taskId;
  try {
    await client.start();
    const server = await discoverTopview(client);
    const taskType = input.inputMode === 'omniReference' ? 'omni_reference' : ['firstLast', 'singleImage'].includes(input.inputMode) || (!input.inputMode && urls.length) ? 'image_to_video' : 'text_to_video';
    const config = unwrapTopview(await client.call(server.name, 'topview_get_generation_config', { req: { type: 'video', taskType } })).result;
    const tool = server.tools.get('topview_generate_video');
    // Validate before uploads and paid submission.
    buildTopviewSubmit(input, config, tool, urls.map((_, i) => `preflight-${i}`));
    const fileIds = [];
    for (const url of urls) fileIds.push(await uploadImage(client, server, await materializeMedia(url, { jobsDir })));
    const req = buildTopviewSubmit(input, config, tool, fileIds);
    const receiptDir = path.join(jobsDir, 'topview-work', jobId);
    fs.mkdirSync(receiptDir, { recursive: true });
    const receipt = { provider: 'topview', transport: 'codex-app-server', taskType, model: req.model, duration: req.duration, resolution: req.resolution, aspectRatio: req.aspectRatio, referenceCount: fileIds.length, submitStartedAt: new Date().toISOString() };
    const save = update => { Object.assign(receipt, update); fs.writeFileSync(path.join(receiptDir, 'task.json'), JSON.stringify(receipt, null, 2)); };
    save({ status: 'submitting' });
    const submitted = unwrapTopview(await client.call(server.name, 'topview_generate_video', { req }));
    taskId = topviewTaskState(submitted).task_id;
    if (!taskId && typeof submitted.result === 'string') taskId = submitted.result;
    if (!taskId) throw fail('topview_submit_unknown', 'TopView submit returned no task ID. Check TopView before retrying to avoid duplicate charges.');
    save({ task_id: taskId, status: 'running' });
    onProgress?.({ status: 'running', task_id: taskId });
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const data = unwrapTopview(await client.call(server.name, 'topview_query_task', { req: { taskType, taskId, needCloudFrontUrl: true, shortenUrls: false } }));
      const state = topviewTaskState(data);
      onProgress?.({ ...state, task_id: taskId });
      if (['failed', 'failure', 'error', 'cancelled', 'canceled'].includes(state.status)) {
        save({ status: 'error' });
        throw fail('topview_generation_failed', 'TopView video generation failed. The task ID was retained.');
      }
      if (['success', 'succeeded', 'completed', 'done'].includes(state.status)) {
        const resultUrls = resultVideoUrls(data);
        save({ status: 'generated', resultUrls });
        const imported = await importResult(resultUrls, jobsDir, jobId);
        save({ status: 'done', resultUrl: imported.resultUrl });
        return { ok: true, kind: 'video', provider: 'topview', model: req.model, ...imported, task_id: taskId, prompt: input.prompt, metadata: { transport: 'codex-app-server', taskType, submitModel: req.model, referenceCount: fileIds.length } };
      }
      await sleep(pollMs);
    }
    throw fail('topview_task_timeout', 'TopView task is still pending. The task ID was retained; do not submit again.');
  } catch (error) {
    error.task_id = taskId || null;
    if (!error.code?.startsWith('topview_')) error = fail('topview_connection_failed', 'TopView MCP host connection failed. Check the Codex MCP login and connection.', { task_id: taskId || null });
    throw error;
  } finally { client.close(); }
}
