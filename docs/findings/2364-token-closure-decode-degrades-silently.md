---
title: TokenSpec.triggeredAbilities/activatedAbilities decode to a non-firing stub on a cold registry miss
discoveredBy: 2364
status: declined
reason: the DSL-surface half (EffectTokenSpec.triggeredAbilities) is now fixed for real in PR #2426's second round (see the update below); the remaining closure-bearing (resolve()-only) half has zero shipped consumers as of #2426, so there is nothing in the pool that depends on it — reopen if a future card needs both a resolve() body and cold-decode survival at once.
confidence: medium
---

**Update (review of PR #2426, round 2).** The claim below that
`EffectTokenSpec.triggeredAbilities` "gets FULL decode fidelity for free…no
degradation there at all" was WRONG when this finding was first drafted —
`maybeSynthesizeToken` never actually called `resolveTokenTriggeredAbilities`
on decode, so the DSL surface degraded to the exact same non-firing stub as
the closure-bearing surface (review-caught, see `convex/cards/types.ts`'s
`TokenTriggeredAbility` doc and `convex/cards/registry.ts`'s 15th-segment
comments for the fix). That gap is now closed for real:
`tokenDefinitionId` folds an ability's `effects` into the 15th segment
whenever the built `TriggeredAbility` carries one, and `maybeSynthesizeToken`
rebuilds a REAL, working ability through `resolveTokenTriggeredAbilities` on
a cold decode when `effects` survived — proven end-to-end in
`convex/cards/abilities/tokens/__tests__/tokenTriggeredAbility.test.ts`
("…fires for REAL after a genuinely cold decode…"). Separately, Vaultborn
Tyrant no longer uses `TokenSpec.triggeredAbilities` at all — its dies
trigger now calls `SpellContext.createTokenCopyOf`, which id-swaps the token
onto the printed card's OWN registered definition (no synthesized `token:`
id, no decode path involved, and free art as a side effect) — so the
"Vaultborn Tyrant … the only current consumer" premise below no longer holds
either; there is currently NO shipped consumer of the closure-bearing
`TokenSpec.triggeredAbilities` surface at all.

The remainder of this finding — the closure-bearing `TokenSpec.
triggeredAbilities`/`activatedAbilities` degradation — is UNCHANGED and still
accurate; kept below for the original analysis.

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
only `id`/`oracleText`/`event` — UNLESS the ability happens to carry
`effects` (built via `enteredTrigger`/`diedTrigger`'s `effects:` param
instead of `resolve:`), in which case it now gets the same real rebuild the
DSL surface gets — and otherwise decodes a SAFE, NEVER-FIRING stub
(`matches: () => false`) — no crash, but the ability silently stops firing
in that isolate for the rest of its lifetime once decoded, which is exactly
the "silently drops the ability" failure class `TokenStaticEffectKey`'s own
doc comment (`convex/cards/tokenStaticEffects.ts`) already names and was
built to close for CONTINUOUS static effects specifically.

**Evidence.**

- `convex/cards/sharedTokens.ts:24-41` — `TREASURE_TOKEN`'s `effect` closure,
  pre-existing, unaffected by this PR.
- `convex/cards/registry.ts` — `tokenDefinitionId`'s 15th segment and
  `maybeSynthesizeToken`'s decode, both added by #2364, both documented
  inline; the `effects`-present branch now rebuilds for real, the
  `resolve()`-only (no `effects`) branch still falls to the stub.
  (Renumbered from the 14th segment during the #2364/#2380 rebase — #2380
  claimed index 13 for planeswalker `loyalty` first.)
- `convex/cards/tokenStaticEffects.ts:1-30` — the "keys not closures, one
  shared factory table" fix that closed this EXACT failure class for static
  effects (Urza's Saga's Construct dying to CR 704.5f after a cold decode).

**Why it may not deserve its own issue yet.** No shipped card exercises a
closure-bearing (`resolve()`-only, no `effects`) `TokenSpec.
triggeredAbilities` at all any more (Vaultborn Tyrant's own former use is
gone, per the update above), so there is nothing in the current pool that
depends on surviving a cold decode via this narrower remaining gap. A fix
would need the SAME "keys → named factory" treatment `tokenStaticEffects.ts`
already proves out, generalized to a closure a factory can't rebuild from
data alone — not really solvable the same way, since a `resolve()` body is
arbitrary code, not a named enum value. Worth revisiting only if a future
card's token trigger genuinely needs BOTH a `resolve()` body (something the
Effect Script DSL can't express) AND survival through a cold isolate
simultaneously — not demonstrated against the current pool.
