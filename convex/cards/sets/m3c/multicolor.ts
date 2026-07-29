// M3C — multicolor cards, split by colour per ADR 0043. The registry's
// `import * as m3c from "./sets/m3c"` resolves through m3c/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import type { CardDefinition } from "../../types";

// Satya, Aetherflux Genius — {1}{U}{R}{W} Legendary Creature — Human
// Artificer, 3/5 (issue #1195, parent #697 Cube CAP: Energy). "Menace, haste.
// Whenever Satya attacks, create a tapped and attacking token that's a copy
// of up to one other target nontoken creature you control. You get {E}{E}
// (two energy counters). At the beginning of the next end step, sacrifice
// that token unless you pay an amount of {E} equal to its mana value."
//
// Was a tracked stop-and-issue stub (#1195) blocked on three capabilities
// beyond the Energy resource (#697's `getEnergy`/`payEnergy`), all closed by
// this issue:
//
//   (1) TAPPED-AND-ATTACKING token copy (CR 508.4) — `TokenSpec` gains two
//       orthogonal entry-state flags, `entersTapped` / `entersAttacking`
//       (`cards/types.ts`), honored by `createTokenPermanents`
//       (`gre/state.ts`): `entersTapped` taps the token unconditionally
//       (independent of vigilance — CR 508.4 attacking-token entry bypasses
//       the normal tap-to-attack rule, CR 508.1f, entirely); `entersAttacking`
//       routes the token through the shared `markAttacking` helper
//       (`gre/combat.ts`), which sets BOTH engine-wide representations of
//       "attacking" together — `state.combat.attackerIds` membership AND the
//       per-permanent `isAttacking` flag — joining the CURRENT combat without
//       running the normal declare-attackers action. It never emits
//       ATTACKERS_DECLARED and correctly never "attacked" for trigger
//       purposes (CR 508.4's own distinction), while `isAttacking` being set
//       means it DOES count as an "attacking creature" for every OTHER
//       combat-scoped read (Assault-Formation-style statics,
//       `combatRoleFilter` targeting, `PermanentFilter.isAttacking`,
//       `SpellContext.getIsAttacking`, and the frontend's blocker-assignment
//       affordance) — see `markAttacking`'s own doc comment for why a single
//       shared helper exists (an earlier revision of this code set only
//       `attackerIds` directly and left `isAttacking` unset, review-caught
//       before landing).
//       DIVERGENCE (tracked-by: #1865): the token always attacks the
//       DEFENDING PLAYER — CR 508.4's controller-choice of a defending
//       planeswalker instead is not offered. This is a REAL gap against the
//       current pool, not a hypothetical future card: planeswalkers ship
//       across many already-shipped sets (dka/kld/wwk/lrw/war/isd/dom/clb/
//       znr/mh2/one), and the engine already fully models attacking them
//       (`combat.attackTargets`, `gre/phases.ts`, `gre/moves.ts`) — so this
//       needs its own slice rather than shipping silently narrower than the
//       CR. Satya's own oracle text is silent on the point.
//       `createTokenCopy`'s Op-level `entersTapped`/`entersAttacking` mirror
//       the same two flags through to `SpellContext.createTokenCopyOf`'s new
//       `opts` (applied to the internal placeholder token BEFORE `applyCopy`
//       overwrites its copiable characteristics — entry state is independent
//       of what gets copied). Also fixes a real, standing DIVERGENCE: Dance
//       of Many's ETB trigger has documented since #1459 that
//       `TargetRequirement` has no token filter, so its copy target could
//       (incorrectly) be a token creature — see (3) below, now closed there
//       too.
//
//   (2) Delayed "sacrifice unless you pay {E} equal to its mana value" (CR
//       603.7 + 122.1 + 118.4) — a `delayedTrigger("next-end-step")` whose
//       body is `mayPay` + `if !$paid then sacrifice`, the EXACT Flash /
//       Guide-of-Souls shape, except the `mayPay` cost is a RUNTIME amount.
//       `MayPayCost.energy` (Guide of Souls, #1194) is a fixed literal; this
//       needs the token's own mana value, known only once the copy exists.
//       New `DynamicMayPayEnergyCost` (`{ energyEqualTo: EffectValue }`,
//       `cards/types.ts`) is the energy-leg sibling of the existing
//       `DynamicMayPayManaCost` (`{ manaCostOf, reducedBy }`, Flash, #1150):
//       `energyEqualTo` reuses the EXISTING `EffectValue` grammar wholesale
//       (`{ manaValue: { of: { ref: "$token" } } }`) rather than a bespoke
//       reader, resolved by `resolveMayPayCost` (`gre/effects/interpreter.ts`)
//       through the SAME `resolveValue` every other numeric Op parameter
//       uses — no new primitive, no new value kind (ADR 0045 "generalize,
//       don't add"). `$token` crosses the schedule→fire boundary as a bare
//       `capture` ref to `createTokenCopy`'s own `$copy` bind (ADR 0048),
//       exactly like Minsc & Boo's `$sacked` capture. The whole
//       `delayedTrigger` is scheduled only `if` a copy actually exists
//       (`objectMatchesFilter`, issue #1747) — mirrors Phelia's own `if
//       (!target) return` guard against a phantom "sacrifice that token…"
//       stack item when nothing was copied.
//
//   (3) "up to one OTHER target nontoken creature you control" (CR 601.2c /
//       603.3d) — `targetRequirement: { type: "Creature", count: { min: 0,
//       max: 1 }, controller: "you", excludeSource: true, isToken: false }`.
//       `excludeSource` ("other") and `count: {min:0,max:1}` ("up to one")
//       already shipped (Phelia, MH3). `isToken: false` ("nontoken") is NEW:
//       `TargetRequirement.isToken` (`cards/types.ts`), wired through the
//       single target-filter authority (`gre/targetFilters.ts`, ADR 0068) —
//       `getLegalTargets` / `selectTarget` (`game.ts`) / the frontend's
//       `matchesPermanentTargetFilters` (`src/lib/card-utils.ts`) all route
//       through the SAME registry, so the offered/accepted/highlighted sets
//       can't diverge (the Phelia bug class). Mirrors the pre-existing
//       `PermanentFilter.isToken` / `EffectCardFilter.isToken` exact-match
//       semantics, just exposed on the ANNOUNCED-target shape those two
//       didn't cover yet.
//
// "You get {E}{E}" is UNCONDITIONAL (a separate Oracle sentence from the
// token creation, CR 608.2b "as much as it can" convention for the REST of
// the ability) — it fires even when nothing was copied (no legal nontoken
// creature you control, or the controller declined the up-to-one pick).
export const satyaAetherfluxGenius: CardDefinition = {
    id: "3b964bbe-54cc-425c-9cc6-c877f82af7ba",
    rarity: "rare",
    name: "Satya, Aetherflux Genius",
    oracleText:
        "Menace, haste\nWhenever Satya attacks, create a tapped and attacking token that's a copy of up to one other target nontoken creature you control. You get {E}{E} (two energy counters). At the beginning of the next end step, sacrifice that token unless you pay an amount of {E} equal to its mana value.",
    manaCost: { X: 1, U: 1, R: 1, W: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Artificer"],
    supertypes: ["Legendary"],
    power: 3,
    toughness: 5,
    staticAbilities: ["menace", "haste"],
    triggeredAbilities: [
        {
            id: "satya-aetherflux-genius-attack",
            oracleText:
                "Whenever Satya attacks, create a tapped and attacking token that's a copy of up to one other target nontoken creature you control. You get {E}{E} (two energy counters). At the beginning of the next end step, sacrifice that token unless you pay an amount of {E} equal to its mana value.",
            event: "ATTACKERS_DECLARED",
            // CR 603.3d — "up to one OTHER target nontoken creature you
            // control" is a REAL target chosen when this trigger is put on
            // the stack (not a resolution-time choice), so it is subject to
            // hexproof / protection / ward and fires "becomes the target"
            // triggers (Mijae Djinn precedent for "whenever THIS creature
            // attacks" — `event.attackerIds.includes(self.id)`, distinct from
            // Guide of Souls' "whenever YOU attack").
            targetRequirement: {
                type: "Creature",
                count: { min: 0, max: 1 },
                controller: "you",
                excludeSource: true,
                isToken: false,
            },
            matches: (event, self) =>
                event.type === "ATTACKERS_DECLARED" &&
                event.attackerIds.includes(self.id),
            effects: [
                {
                    op: "createTokenCopy",
                    source: { target: 0 },
                    controller: "controller",
                    entersTapped: true,
                    entersAttacking: true,
                    bind: "$copy",
                },
                // Unconditional — see the file-header note.
                { op: "getEnergy", player: "controller", amount: 2 },
                {
                    op: "if",
                    // "up to one": nothing chosen, or the source left the
                    // battlefield before this Op ran (CR 608.2b) — either way
                    // `createTokenCopy` skipped and `$copy` was never bound,
                    // so `objectMatchesFilter` reads false and no phantom
                    // delayed trigger is scheduled (Phelia precedent).
                    predicate: {
                        objectMatchesFilter: { ref: "$copy" },
                        filter: { type: "Creature" },
                    },
                    then: [
                        {
                            op: "delayedTrigger",
                            timing: "next-end-step",
                            oracleText:
                                "Sacrifice that token unless you pay an amount of {E} equal to its mana value.",
                            capture: { $token: { ref: "$copy" } },
                            effects: [
                                {
                                    op: "mayPay",
                                    player: "controller",
                                    cost: {
                                        energyEqualTo: {
                                            manaValue: {
                                                of: { ref: "$token" },
                                            },
                                        },
                                    },
                                    prompt: "Pay {E} equal to its mana value?",
                                    bind: "$paid",
                                },
                                {
                                    op: "if",
                                    predicate: { not: { binding: "$paid" } },
                                    then: [
                                        {
                                            op: "sacrifice",
                                            target: { ref: "$token" },
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                },
            ],
        },
    ],
};
