---
title: TokenSpec.triggeredAbilities/activatedAbilities decode to a non-firing stub on a cold registry miss
discoveredBy: 2364
status: draft
confidence: medium
---

**What is wrong.** `TokenSpec.triggeredAbilities`/`activatedAbilities` are
closure-bearing (`TriggeredAbility[]`/`ActivatedAbility[]`, the `resolve()`
escape hatch's full generality). `tokenDefinitionId` (`convex/cards/
registry.ts`) folds them into the token's content-derived id string so two
differently-abled tokens get distinct definitions, but a closure cannot ride
a string — only the JSON-safe fields survive. `createTokenPermanents`
(`convex/gre/state.ts`) always registers the REAL object with working
closures directly into the in-memory registry at token-creation time, so the
common/live-game path (same isolate, registry hit) is fully correct. The
degraded path is `maybeSynthesizeToken`'s decode (`convex/cards/registry.ts`)
on a registry MISS — a cold Convex isolate that never ran the creating
card's effect this session, or the client bundle. For `activatedAbilities`
this was already the PRE-EXISTING behaviour before issue #2364 (e.g.
`TREASURE_TOKEN`'s `effect: (ctx) => ctx.addMana(...)` closure,
`convex/cards/sharedTokens.ts:35`, is silently dropped on decode — the
ability displays but its activation body is missing, an optional field so no
crash). Issue #2364 extended the SAME pattern to `triggeredAbilities`, where
`matches` is a REQUIRED field: a naive decode would either crash (missing
required field) or need a fallback. The shipped fix
(`convex/cards/registry.ts` `tokenDefinitionId`/`maybeSynthesizeToken`,
`convex/cards/types.ts`'s `TokenSpec.triggeredAbilities` doc comment) encodes
only `id`/`oracleText`/`event` and decodes a SAFE, NEVER-FIRING stub
(`matches: () => false`) — no crash, but the ability silently stops firing
in that isolate for the rest of its lifetime once decoded, which is exactly
the "silently drops the ability" failure class `TokenStaticEffectKey`'s own
doc comment (`convex/cards/tokenStaticEffects.ts`) already names and was
built to close for CONTINUOUS static effects specifically.

**Evidence.**

- `convex/cards/sharedTokens.ts:24-41` — `TREASURE_TOKEN`'s `effect` closure,
  pre-existing, unaffected by this PR.
- `convex/cards/registry.ts` — `tokenDefinitionId`'s 15th segment (id/
  oracleText/event only) and `maybeSynthesizeToken`'s `matches: () => false`
  stub, both added by #2364, both documented inline as a deliberate
  degradation. (Renumbered from the 14th segment during the #2364/#2380
  rebase — #2380 claimed index 13 for planeswalker `loyalty` first.)
- `convex/cards/tokenStaticEffects.ts:1-30` — the "keys not closures, one
  shared factory table" fix that closed this EXACT failure class for static
  effects (Urza's Saga's Construct dying to CR 704.5f after a cold decode).

**Why it may not deserve its own issue yet.** No shipped card exercises a
closure-bearing `TokenSpec.triggeredAbilities` in a way that depends on
surviving a cold decode: Vaultborn Tyrant (the only current consumer) creates
its token and the token's abilities fire within the SAME server call chain
that registers them, and — separately — `EffectTokenSpec.triggeredAbilities`
(the DSL-authored, mass-market path per ADR 0045) gets FULL decode fidelity
for free, because its restricted descriptor is JSON-pure from the start and
`resolveTokenTriggeredAbilities` (`convex/cards/tokenTriggeredAbilities.ts`)
rebuilds the real closure identically on both the register and the decode
side — no degradation there at all. A `TokenSpec`-side (closure-bearing)
fix would need the SAME "keys → named factory" treatment
`tokenStaticEffects.ts` already proves out, generalized to triggered/
activated abilities; worth doing if a future card's token trigger genuinely
needs to survive a cold isolate (a long-running persistent token whose
ability must keep firing turns after creation, in a deployment where
isolates recycle) — not yet demonstrated against the current pool.
