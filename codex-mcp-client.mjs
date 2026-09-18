import { spawn } from 'node:child_process';
import { codexInvocation, codexEnvironment } from './codex-process.mjs';

// Official Codex app-server owns MCP configuration and OAuth. This client
// never reads credential files or forwards credentials to Franklin clients.
export class CodexMcpClient {
  constructor({ cwd = process.cwd(), timeoutMs = 120_000 } = {}) {
    this.cwd = cwd;
    this.timeoutMs = timeoutMs;
    this.pending = new Map();
    this.nextId = 1;
  }

  async start() {
    const { command, prefix } = codexInvocation();
    this.child = spawn(command, [...prefix, 'app-server', '--stdio'], {
      cwd: this.cwd, env: codexEnvironment(), windowsHide: true, shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let buffer = '';
    this.child.stdout.on('data', chunk => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        let message;
        try { message = JSON.parse(line); } catch { continue; }
        if (message.method && message.id != null) {
          // Do not silently approve elicitation or other server requests.
          this.child.stdin.write(JSON.stringify({ id: message.id, error: { code: -32601, message: 'Interactive approval requires the Codex host.' } }) + '\n');
          continue;
        }
        const pending = this.pending.get(message.id);
        if (!pending) continue;
        this.pending.delete(message.id);
        clearTimeout(pending.timer);
        if (message.error) pending.reject(Object.assign(new Error('Codex MCP host request failed: ' + message.error.code), { code: 'codex_mcp_rpc_error', rpcError: message.error }));
        else pending.resolve(message.result);
      }
    });
    this.child.stderr.resume(); // Diagnostics may contain credentials: never relay.
    const fail = () => {
      for (const p of this.pending.values()) {
        clearTimeout(p.timer);
        p.reject(Object.assign(new Error('Codex MCP host disconnected.'), { code: 'codex_mcp_disconnected' }));
      }
      this.pending.clear();
    };
    this.child.on('error', fail);
    this.child.on('close', fail);
    this.child.stdin.on('error', fail);
    await this.request('initialize', { clientInfo: { name: 'franklin_canvas', version: '0.1.0' } });
    this.child.stdin.write(JSON.stringify({ method: 'initialized' }) + '\n');
    const result = await this.request('thread/start', { cwd: this.cwd, ephemeral: true, sandbox: 'read-only' });
    this.threadId = result.thread.id;
    return this;
  }

  request(method, params) {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(Object.assign(new Error('Codex MCP host timed out.'), { code: 'codex_mcp_timeout' }));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
    });
  }

  async listServers() {
    const servers = [];
    let cursor;
    do {
      const page = await this.request('mcpServerStatus/list', { threadId: this.threadId, detail: 'toolsAndAuthOnly', ...(cursor ? { cursor } : {}) });
      servers.push(...page.data);
      cursor = page.nextCursor;
    } while (cursor);
    return servers;
  }

  call(server, tool, args) {
    return this.request('mcpServer/tool/call', { threadId: this.threadId, server, tool, arguments: args });
  }

  close() {
    this.child?.stdin.end();
    this.child?.kill();
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error('Codex MCP client closed.'));
    }
    this.pending.clear();
  }
}
