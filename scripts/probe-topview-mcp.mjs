import { CodexMcpClient } from '../codex-mcp-client.mjs';
import { discoverTopview, unwrapTopview } from '../topview-video-bridge.mjs';

const client = new CodexMcpClient();
try {
  await client.start();
  const server = await discoverTopview(client);
  const data = unwrapTopview(await client.call(server.name, 'topview_get_generation_config', { req: { type: 'video', taskType: 'text_to_video' } }));
  console.log(JSON.stringify({ connected: true, server: server.name, transport: 'codex-app-server', toolCount: server.tools.size, models: data.result.models.filter(m => /^Seedance/i.test(m.submitModel)).map(m => m.submitModel) }));
} catch (error) {
  console.error(error.code || 'topview_connection_failed');
  process.exitCode = 1;
} finally {
  client.close();
}
