# Changelog

## 2026-09-18 — fb6ff30

Commit: [Codex / TopView bridges and server-backed Canvas](https://github.com/wildparky/franklin-canvas/commit/fb6ff30)

- Added Codex delegation and TopView MCP video execution through the official host.
- Added Seedance model/mode controls, provider progress, reference upload and local result import.
- Added multi-image file drop, original-ratio photo nodes and original TopView reference transfer.
- Moved canonical projects to revision-checked backend files; preserved browser recovery and backups.
- Externalized inline media to content-addressed project files without deleting source bytes.
- Added lightweight project summaries, on-demand graph loading and read-only media inventory.
- Added UUID fallback for LAN HTTP and configured the development HTTPS hostname allowlist.
- Preserved existing BlockRun paths and Canvas/Media Agent operations.

Validation: build passed (large-chunk warning); 29 tests passed, 1 Windows symlink test skipped.
Known limits: no realtime collaboration/automatic merge, no automatic media deletion,
no built-in multi-user authentication; some state remains browser-local.
Tailscale Serve setup is host configuration, not deployed by this commit.

## Documentation follow-up

Added the docs directory and README navigation describing setup, architecture,
generation, storage, remote access and troubleshooting. No runtime behavior change.
