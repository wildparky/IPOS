import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import ts from 'typescript';
const source = ts.transpileModule(fs.readFileSync(new URL('../src/uuid.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
test('LAN HTTP fallback generates unique UUID v4 without randomUUID', () => {
  const context = { exports: {}, crypto: { getRandomValues: array => webcrypto.getRandomValues(array) } };
  vm.runInNewContext(source, context);
  const ids = Array.from({ length: 1000 }, () => context.exports.randomUUID());
  assert.equal(new Set(ids).size, 1000);
  for (const id of ids) assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});
test('secure context uses native UUID', () => {
  const context = { exports: {}, crypto: { randomUUID: () => 'native-result' } };
  vm.runInNewContext(source, context);
  assert.equal(context.exports.randomUUID(), 'native-result');
});
