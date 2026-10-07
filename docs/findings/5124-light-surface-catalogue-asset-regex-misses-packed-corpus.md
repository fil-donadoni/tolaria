---
title: The light-surface guard's catalogue-asset regex no longer matches the asset the client fetches
discoveredBy: 5124
status: draft
confidence: high
---

**What is wrong.** `lightSurfaceViolations` flags a light-surface chunk that
names "the compiled catalogue asset, so it can fetch it" by testing
`CATALOGUE_ASSET` (`scripts/lib/asset-graph.ts:70`):
`/(?:^|["'/])(?:full-)?catalogue-[0-9a-f]{8,}[^"']*\.(?:json|gz)/`. That
matched the client asset while it was `catalogue-<hex hash>.json`. Since
issue #4861 the client fetches `data/catalogue/packed-corpus.json?url`
(`src/lib/catalogueArtifact.ts:27`), which Vite emits as
`packed-corpus-<vite hash>.json`. The regex does not match that name, so a
light surface (login, lobby) that started fetching the packed corpus would
pass this check. Issue #5124 removed the last `catalogue-<hex>.json` from the
tree, so the only remaining match is the full-catalogue gzip.

**Evidence.** `CATALOGUE_ASSET` needs `catalogue-` followed by 8+ hex chars.
`packed-corpus-…` does not contain `catalogue-`. The comment above the regex
still says "the one-file artifact the gate fetches", which describes the
retired file.

**Why it may not deserve its own issue.** The heavy-chunk and
`ENGINE_SENTINEL` checks in the same function still catch the usual way a
light surface reaches the catalogue, which is by importing the engine. The
fix is one regex alternative (`packed-corpus-[^"']*\.json`) plus a fixture,
so it could be a line on the next issue that touches `asset-graph.ts`
instead of an issue of its own.
