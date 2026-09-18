# Project media storage

Canonical project graphs remain at `~/.franklin/projects/<id>.json` for compatibility.
Media is content-addressed under `<id>/media/uploads/` and `<id>/media/generated/`.
Node IDs, edges, prompts and settings are unchanged. Recognized URL fields are
rewritten to `/api/project-media/<id>/<bucket>/<sha256>.<extension>` when saved.
Original bytes are preserved, duplicates within a bucket reused and verified.

The browser applies server-returned URL replacements to live nodes without
replacing newer graph edits. Subsequent queued saves use these canonical URLs.
Initial uploads still travel as data URLs once; subsequent graph saves do not.

Codex/TopView input materialization, describe_media and video stitching/film
assembly resolve the new URLs locally. HTTP serving supports byte ranges.
Legacy `/api/generated/` URLs remain usable; generation output is copied into
the project on its next save. Node/project deletion never removes media, so
other nodes, collections, timelines and backups retain their references.

`ProjectStorage.migrateMedia()` explicitly migrates existing JSON with backups
and revision increments. Stop the backend during an offline migration and
reload browser clients afterward. No migration runs implicitly on GET.
Backups live in `.backups`; shared generated source files are not removed.

Projects UI polls `/api/projects?summary=1` (no nodes/edges) and loads the selected
graph from `/api/projects/<id>`. The legacy full-list API remains compatible.
Summary polling does not change an already loaded canvas's revision token.

Projects includes a read-only media inventory at `/api/media/audit`. It checks
project/timeline URLs, backup URLs and inline backup content hashes, plus collection
URLs supplied by the current browser. Files younger than 30 days are not candidates.
Other browsers' unsynced references remain unknown: candidates are not confirmed
safe to delete. There is no delete/move/cleanup endpoint. Temporary task directories
and backup JSON sizes are excluded from the inventory. JSON reference read failures
make all otherwise-unreferenced old files unverified, not cleanup candidates.

Current limitations: no orphan-media garbage collection; local-only legacy browser recovery is explicit.
Moving a project between machines requires its JSON and media directory plus
any cross-project or external references, not just the JSON file.
