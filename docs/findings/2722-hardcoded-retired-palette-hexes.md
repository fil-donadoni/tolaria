---
title: json-tree-view.tsx hard-codes the Antique Bronze palette and is now the only surface still wearing it
discoveredBy: 2722
status: draft
confidence: high
---

**What is wrong.** Identity v4 (#2722) moved every semantic colour token, and
the guard in `design-tokens.test.ts` keeps `src/index.css` and the typed mirror
in step. It cannot see a component that copied the hexes into a JS object —
and one did. That surface now renders the retired warm palette on the new cold
ground, which is the single most visible way a "values-only" swap can look
broken.

**Evidence.** `src/components/ui/json-tree-view.tsx:13-27` is a base16 theme
whose every entry is a v3 hex with the token name in a trailing comment:

```
base01: "#241d12" /* surface-elevated */,   → v4 surface-elevated is #1c2027
base02: "#2e2516" /* border-subtle */,      → v4 border-subtle    is #2d2f32
base03: "#968a68" /* text-disabled */,      → v4 text-disabled    is #949089
base05: "#e9e0cb" /* text */,               → v4 text             is #e8e2d2
base0A: "#c9a24b" /* accent */,             → v4 accent           is #efe9da
```

The comments prove the intent was "these ARE the tokens", so the fix is to read
them from `@/lib/design-tokens`'s `PALETTE_TOKENS` rather than to re-type the
new hexes — which would just reset the same trap for identity v5. A sweep for
the other retired hexes across `src/` and `scripts/` found no third site.

**Why it may not deserve its own issue.** #2733 already owns "deckbuilder,
Draft Room, Limited pages, settings, loading/404: inherit the skin, fix
leftovers", and the JSON tree view is dev-panel chrome that a player never
sees — so this is plausibly one line on #2733 or on #2734 (closure) rather than
a ticket of its own. It is called out here because it is invisible to every
guard in the repo, so if neither slice happens to open the file it survives the
whole PRD.
