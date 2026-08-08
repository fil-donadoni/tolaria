---
title: Urza's Saga's local Construct token spec duplicates the new shared factory
discoveredBy: 2371
status: draft
confidence: high
---

**What is wrong.** `convex/cards/sets/mh2/colorless.ts` defines
`URZAS_SAGA_CONSTRUCT_TOKEN` as a local `TokenSpec` constant (chapter II's
"0/0 colorless Construct artifact creature token with 'This token gets +1/+1
for each artifact you control'"). Issue #2371 (Urza, Lord High Artificer)
needed the IDENTICAL token shape and extracted a shared factory,
`constructArtifactsYouControlToken(imagePrintId)`, into
`convex/cards/sharedTokens.ts` — per CLAUDE.md primitive reuse ("two
consumers earns extraction"). Urza (MH1) was switched over to the shared
factory; Urza's Saga's own local constant was deliberately left untouched.

**Evidence.** `convex/cards/sets/mh2/colorless.ts:64-72`
(`URZAS_SAGA_CONSTRUCT_TOKEN`) and `convex/cards/sharedTokens.ts` (the new
`constructArtifactsYouControlToken` factory) now carry the exact same
`types`/`subtypes`/`power`/`toughness`/`staticEffectKeys` shape, defined
twice. A future edit to the Construct's shape (a new static ability, a
counters-on-entry change) has to remember to touch both sites, and nothing
would flag a drift between them.

**Why it wasn't fixed here.** The batch this issue landed in ran several
sibling subagents shipping other cube cards in parallel, each restricted to
touching only its own `convex/cards/sets/<code>/` directory to keep the
merge-train's conflict graph file-disjoint (`mh2` was out of issue #2371's
declared scope). Retrofitting Urza's Saga to import the shared factory is a
same-shape, low-risk two-line change
(`URZAS_SAGA_CONSTRUCT_TOKEN` → `constructArtifactsYouControlToken("a7caaf39-8f16-4f1d-bee6-a45674306319")`),
safe to fold into any future PR that touches `mh2/colorless.ts` anyway.

**Why it may not deserve its own issue.** It's cosmetic duplication with no
behavioral divergence today (both specs decode to the identical CDA via the
same `pt-cda-artifacts-you-control` registry key) — a one-line note on
whichever tracker next revisits `mh2/colorless.ts`, rather than a standalone
ticket, is probably the right weight.
