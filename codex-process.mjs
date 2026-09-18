import fs from 'node:fs';
import path from 'node:path';

// Resolve the official npm launcher without cmd.exe shell interpolation.
export function codexInvocation(env = process.env, platform = process.platform) {
  const override = env.FRANKLIN_CODEX_CLI_PATH;
  if (override && /\.js$/i.test(override)) return { command: process.execPath, prefix: [override] };
  if (override && !/\.(cmd|bat)$/i.test(override)) return { command: override, prefix: [] };
  if (platform !== 'win32') return { command: override || 'codex', prefix: [] };
  const paths = override ? [override] : String(env.PATH || env.Path || '').split(path.delimiter).map(dir => path.join(dir.replace(/^"|"$/g, ''), 'codex.cmd'));
  for (const launcher of paths) {
    const entry = path.join(path.dirname(launcher), 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
    if (fs.existsSync(launcher) && fs.existsSync(entry)) return { command: process.execPath, prefix: [entry] };
  }
  throw new Error('Official Codex CLI not found. Install Codex CLI or set FRANKLIN_CODEX_CLI_PATH to its executable.');
}

export function codexEnvironment() {
  const env = { ...process.env };
  for (const key of ['CODEX_APP_TOOLS_PIPE_PATH', 'CODEX_THREAD_ID', 'CODEX_SESSION_ID']) delete env[key];
  return env;
}
