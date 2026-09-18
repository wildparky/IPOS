# TopView MCP bridge

Franklin video jobs use the official `codex app-server --stdio` host. The
host reads registered MCP servers and manages TopView OAuth. Franklin does
not read OAuth credentials, reuse them as API keys, or ask a language model
to discover, submit, or poll video tasks.

## Setup

Install the official Codex CLI on PATH. Register the server once if absent:

```powershell
codex mcp add topview-mcp --url https://mcp.topview.ai/mcp
codex mcp login topview-mcp
node scripts/probe-topview-mcp.mjs
```

The probe queries discovery and generation configuration only; it does not
submit a paid video. Restart the Franklin backend after configuration changes.
Use `FRANKLIN_CODEX_CLI_PATH` for an explicit official executable or npm CLI
entry point. The integration requires an installed CLI exposing
`mcpServerStatus/list` and `mcpServer/tool/call` in its app-server protocol.

## Execution

1. Initialize the official host and a transient MCP thread (no model turn).
2. Discover the live server tool schemas and confirm the three video tools.
3. Call `topview_get_generation_config` for the selected task type; validate
   the exact Seedance model, input mode, duration, resolution, and ratio.
4. Upload references using `ta_upload_credential`, private PUT, then
   `ta_upload_check_file`. Upload URLs stay in memory, never logs or receipts.
5. Call the discovered `topview_generate_video` hot tool exactly once.
6. Persist its task ID, poll `topview_query_task`, and import the video bytes
   into Franklin's existing generated-media storage.

`get_tool_schema` is for TopView deferred data tools, not video hot tools.
Only supported submit parameters are sent. In particular, image-to-video
omits aspectRatio when the model determines it from the reference image.
The current standalone tool schema does not expose an audio toggle, so
Franklin cannot force `generateAudio` through this interface.

TopView ETA/progress values are forwarded only when reported. Missing fields
remain null. A local elapsed-time clock is not a provider ETA.

## Recovery and credentials

Codex owns OAuth storage under the user's configured Codex home and/or its
credential store. Franklin never parses those files. Job receipts live under
`~/.franklin/web-jobs/topview-work/<jobId>/task.json` and contain model/settings,
task ID, and output URLs after completion. They contain no prompts, upload
URLs, or authentication tokens. Treat result URLs as private media links.

When polling/import fails, use the saved task ID/result to recover; do not
automatically resubmit. Submission transport errors may have an unknown
remote outcome. The bridge does not retry a paid submission automatically.

Run `npm test`, `npm run typecheck`, and `npm run build` for local checks.
