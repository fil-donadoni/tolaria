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
// (Separately, BOTH ability clauses have their own real gaps worth noting
// for whoever revisits this card once #782 lands: the ETB's "discard your
// hand" gap is now CLOSED — #1279 shipped the `discard` Op's bulk whole-hand
// shape, the Wheel of Fortune / Anje's Ravager shape those cards migrated to
// `effects[]` on; and the static ability's "and has menace" half
// needs a live-recomputed conditional keyword grant — `StaticKeywordGrant`
// mutation-syncs only on battlefield enter/leave, never on a hand-size
// change alone — tracked-by #1379 (which also covers the small
// `StaticEffectStateView` hand-size plumbing the +2/+2 half alone would
// still need before it could read via `pt-buff`'s existing `condition`
// gate). None of that unblocks the card while #782 blocks the cost, so it
// stays a stub until #782 lands.)
// tracked-by: #782, #1279, #1379
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
