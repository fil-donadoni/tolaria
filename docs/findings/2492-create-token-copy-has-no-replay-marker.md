---
title: createTokenCopy has no as-enters replay marker and never reads the copied definition's asEnters
discoveredBy: 2492
status: draft
confidence: medium
---

**What is wrong.** #2492 gave the `createToken` Op executor the ADR 0100 D5
idempotent-commit marker so a token entry that parks on an as-enters choice
cannot duplicate its batch when the resolution re-enters. Its sibling
`createTokenCopy` got neither half:

1. **No replay marker.** It has a different batch shape — its own `count`,
   looped one copy at a time through `ctx.createTokenCopyOf` — so the whole-batch
   marker `createToken` uses does not transfer verbatim: a park landing between
   loop iterations needs a per-iteration index, not a single before/after flag.
   Today this is latent because no `TokenSpec` produced by that Op declares
   `asEnters`, so no copy token ever parks. #2496 review round 2 sharpened what
   the gap would cost: a parking Op now SUSPENDS the script, and the resume
   re-executes the Op at exactly its checkpointed position — so a markerless
   `createTokenCopy` would duplicate its own copies, where before it replayed
   the whole script.
2. **A copied definition's `asEnters` is never discovered.** CR 707.6 — "if an
   object enters the battlefield as a copy of another permanent, the object's
   controller will get to make any 'as [this] enters the battlefield' choices for
   it". `createTokenCopyOf` builds a 0/0 placeholder token, runs it through the
   CR 614 chokepoint, and only afterwards calls `applyCopy` — so the chokepoint
   consults the PLACEHOLDER's declaration, never the copied card's. A token copy
   of a Clone-shaped card would silently owe nothing.

**Evidence.**

- `convex/gre/effects/interpreter.ts` — `createToken` executor: `doneKey` /
  `recallChoice` / `noteChoice` added in #2492; the `createTokenCopy` executor
  immediately below has no `recallChoice`/`noteChoice` call at all, and resolves
  its own `count` independently before looping `ctx.createTokenCopyOf(...)`.
- `convex/gre/state.ts` — `SpellContext.createTokenCopyOf` creates the token via
  `createTokenPermanents` with `deferEntryEvent: true` and applies the copy
  afterwards; the chokepoint call inside `createTokenPermanents` receives
  `declaredEntersWith: spec.entersWith`, which for that path is the placeholder
  spec's (empty) clause.
- Registration side: #2492 does register `entersWith.asEnters` onto a token's
  synthesized `CardDefinition` (and folds it into `tokenDefinitionId`), so the
  discovery path exists — nothing reads it on the copy route.

**Why it may not deserve its own issue.** Both halves are squarely inside
slice 4's scope (#2451, the `copy` leg), which ADR 0100 already names as the
owner of "D5's per-token replay marker for row C". If #2451 is worked as
specified this finding is simply part of it, and a separate ticket would
duplicate it. It is written down because the ADR's prose describes the
`createToken` shape only, and an implementer reading D5 could reasonably
conclude the marker work was already done by #2492.
