import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildTopviewSubmit, topviewGenerateVideo, topviewTaskState, unwrapTopview, resultVideoUrls } from '../topview-video-bridge.mjs';

const tool = { name: 'topview_generate_video', inputSchema: { properties: { req: { properties: Object.fromEntries(['taskType', 'model', 'prompt', 'resolution', 'duration', 'aspectRatio', 'firstFrameFileId', 'endFrameFileId', 'inputImages', 'generatingCount'].map(k => [k, {}])) } } } };
function config(taskType = 'text_to_video', name = 'Seedance 1.0 Pro Fast') {
  const image = taskType === 'image_to_video';
  return { models: [{ submitModel: name, taskType, status: 1,
    inputModes: name.endsWith('Fast') ? ['singleImage'] : ['startEndFrame'],
    requiredSubmitFields: ['taskType', 'model', ...(image ? ['firstFrameFileId'] : ['prompt', 'aspectRatio']), 'resolution', 'duration'],
    defaultSubmitParameters: { resolution: 720, duration: 5, ...(!image && { aspectRatio: '16:9' }) },
    submitParameterOptions: { resolution: [720, 1080], duration: [5, 10], ...(!image && { aspectRatio: ['16:9', '9:16'] }) },
  }] };
}
const input = { model: 'topview/seedance-1.0-pro-fast', prompt: 'test', durationS: 5, aspectRatio: '16:9', resolution: '720p', inputMode: 'text' };
test('Canvas forwards selected input mode to the OAuth media bridge', () => {
  const source = fs.readFileSync(new URL('../src/views/CanvasView.tsx', import.meta.url), 'utf8');
  const bridgeCall = source.slice(source.indexOf('? await bridgeMedia({'), source.indexOf(': await generate({', source.indexOf('? await bridgeMedia({')));
  assert.match(bridgeCall, /inputMode:\s*mode === 'videogen' \? d\.inputMode : undefined/);
});

test('live model contract maps frontend slug and numeric resolution exactly', () => {
  const req = buildTopviewSubmit(input, config(), tool);
  assert.equal(req.model, 'Seedance 1.0 Pro Fast');
  assert.equal(req.resolution, 720);
  assert.equal(req.aspectRatio, '16:9');
  assert.equal(req.taskType, 'text_to_video');
});
test('single image omits ratio when input image determines it', () => {
  const req = buildTopviewSubmit({ ...input, inputMode: 'singleImage' }, config('image_to_video'), tool, ['file-a']);
  assert.equal(req.firstFrameFileId, 'file-a');
  assert.equal(req.aspectRatio, undefined);
  assert.equal(req.endFrameFileId, undefined);
});
test('first/last preserves frame order and rejects incompatible model', () => {
  assert.throws(() => buildTopviewSubmit({ ...input, inputMode: 'firstLast' }, config('image_to_video'), tool, ['a', 'b']), { code: 'topview_unsupported_model_mode' });
  const req = buildTopviewSubmit({ ...input, model: 'topview/seedance-1.0-pro', inputMode: 'firstLast' }, config('image_to_video', 'Seedance 1.0 Pro'), tool, ['a', 'b']);
  assert.equal(req.firstFrameFileId, 'a');
  assert.equal(req.endFrameFileId, 'b');
});
test('omni includes every reference in order', () => {
  const req = buildTopviewSubmit({ ...input, model: 'topview/seedance-2.0', inputMode: 'omniReference' }, config('omni_reference', 'Seedance 2.0'), tool, ['a', 'b', 'c']);
  assert.deepEqual(req.inputImages.map(i => i.fileId), ['a', 'b', 'c']);
});
test('unknown model and unsupported duration never silently fall back', () => {
  assert.throws(() => buildTopviewSubmit({ ...input, model: 'invented' }, config(), tool), { code: 'topview_unsupported_model_mode' });
  assert.throws(() => buildTopviewSubmit({ ...input, durationS: 6 }, config(), tool), { code: 'topview_invalid_parameter' });
});
test('ETA/progress absent stays absent; zero is a real value', () => {
  assert.deepEqual(topviewTaskState({ result: { status: 'running' } }), { status: 'running', task_id: null });
  assert.deepEqual(topviewTaskState({ result: { status: 'running', taskId: 'task', progress: 30, etaSeconds: 0 } }), { status: 'running', task_id: 'task', progress: 0.3, etaSeconds: 0 });
});
test('provider auth/errors do not leak arbitrary response secrets', () => {
  assert.throws(() => unwrapTopview({ structuredContent: { code: 401, message: 'secret-token' } }), e => e.code === 'topview_authentication_required' && !e.message.includes('secret-token'));
  assert.throws(() => unwrapTopview({ structuredContent: { code: 4000, message: 'secret-token' } }), e => e.code === 'topview_generation_failed' && !e.message.includes('secret-token'));
});
test('only output URLs are considered; reference/thumbnail URLs excluded', () => {
  assert.deepEqual(resultVideoUrls({ result: { videos: [{ url: 'https://example.test/output.mp4' }], thumbnail: 'https://example.test/cover.png', inputImages: ['https://example.test/input.png'] } }), ['https://example.test/output.mp4']);
});

function fakeClient(sequence) {
  const calls = [];
  return { calls, closed: false, async start() {}, close() { this.closed = true; },
    async listServers() { return [{ name: 'topview-mcp', authStatus: 'oAuth', tools: { a: tool, b: { name: 'topview_query_task' }, c: { name: 'topview_get_generation_config' } } }]; },
    async call(server, name, args) {
      calls.push({ name, args });
      let result;
      if (name === 'topview_get_generation_config') result = config();
      else if (name === 'topview_generate_video') result = { taskId: 'paid-task' };
      else result = sequence.shift();
      return { structuredContent: { code: 200, result } };
    },
  };
}
test('submit once, poll, import, persist task; never use model executor', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'franklin-topview-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const client = fakeClient([{ status: 'running', progress: 20 }, { status: 'success', videoUrl: 'https://example.test/result.mp4' }]);
  const updates = [];
  const result = await topviewGenerateVideo({ ...input, jobsDir: dir, jobId: 'job', onProgress: s => updates.push(s) }, { client, sleep: async () => {}, importResult: async urls => { assert.equal(urls.length, 1); return { resultUrl: '/api/generated/job.mp4' }; } });
  assert.equal(result.task_id, 'paid-task');
  assert.equal(client.calls.filter(c => c.name === 'topview_generate_video').length, 1);
  assert.equal(updates[1].progress, 0.2);
  assert.equal(client.closed, true);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'topview-work/job/task.json'))).status, 'done');
});
test('import failure retains task and output URLs without resubmitting', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'franklin-topview-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const client = fakeClient([{ status: 'success', videoUrl: 'https://example.test/result.mp4' }]);
  await assert.rejects(topviewGenerateVideo({ ...input, jobsDir: dir, jobId: 'job' }, { client, importResult: async () => { throw Object.assign(new Error('Import failed'), { code: 'topview_import_failed' }); } }), e => e.task_id === 'paid-task' && e.code === 'topview_import_failed');
  assert.equal(client.calls.filter(c => c.name === 'topview_generate_video').length, 1);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'topview-work/job/task.json'))).resultUrls, ['https://example.test/result.mp4']);
  assert.equal(client.closed, true);
});
