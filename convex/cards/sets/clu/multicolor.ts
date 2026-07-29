// clu — multicolor cards (ADR 0043 colour split). Modern Scryfall oracle
// text is authoritative (ADR 0004).

// import type { CardDefinition } from "../../types";

// Carnage Interpreter — {1}{B/R}{B/R} Creature — Devil Detective, 3/3 (CLU
// 26, Vintage Cube FREE residue tranche, issue #1309, parent PRD #620).
// "When this creature enters, discard your hand, then investigate four
// times. As long as you have one or fewer cards in hand, this creature gets
// +2/+2 and has menace." STOP-AND-ISSUE at the COST, before either ability
// clause even matters: {1}{B/R}{B/R} is TWO hybrid B/R pips. `ManaCost`
// (cards/types.ts) has no hybrid representation at all (only fixed
// per-colour counts) — no faithful way to declare "castable for either
// {1}{B}{B}, {1}{B}{R}, or {1}{R}{R}" today. Tracked by #782 ([engine]
// Hybrid mana cost encoding), the SAME gap blocking Manamorphose
// (`shm/multicolor.ts`) and Deathrite Shaman (`rtr/multicolor.ts`) — #782's
// own acceptance criteria already name this exact card. `manaCost` is
// omitted below (mirrors the Manamorphose/Deathrite Shaman stubs) since #782
// leaves no faithful encoding to write.
//
// (Separately, both ability clauses' OWN gaps that once blocked them are
// now CLOSED, for whoever revisits this card once #782 lands: the ETB's
// "discard your hand" gap — #1279 shipped the `discard` Op's bulk
// whole-hand shape, the Wheel of Fortune / Anje's Ravager shape those cards
// migrated to `effects[]` on; and the static ability's "and has menace"
// half — #1379 confirmed the existing SBA re-apply sweep
// (`refreshCounterGatedStatics`, `gre/state.ts`, called every
// `checkStateBasedActions` pass, `gre/sba.ts`) already re-evaluates a
// `keyword-grant.condition` gated on NON-battlefield state (hand size) live,
// the same way it does for Kavu Runner's board-state gate (issue #1095) —
// no new live-read path was needed, just the small `id`/`hand` plumbing on
// `StaticEffectStateView` (`cards/types.ts`) so a hand-size predicate can be
// written with the same signature. Once #782 unblocks the cost, both
// clauses attach with the SAME hand-size `condition` closure: `pt-buff` for
// +2/+2 (mirrors Jihad, `arn/white.ts`) and `keyword-grant` for menace
// (mirrors Kavu Runner, `inv/red.ts`) — see
// `gre/__tests__/keywordGrantHandSizeCondition.test.ts` for the proof.
// #782 (hybrid mana cost) remains the SOLE blocker.)
// tracked-by: #782
// export const carnageInterpreter: CardDefinition = {
//     id: "f6fb576e-a4a4-496b-b553-3f81cc651210", // CLU 26
//     name: "Carnage Interpreter",
//     rarity: "rare",
//     types: ["Creature"],
//     subtypes: ["Devil", "Detective"],
//     power: 3,
//     toughness: 3,
// };

export {};
