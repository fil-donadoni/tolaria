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
// half — #1379's FIRST pass shipped with a FALSE conclusion ("the existing
// SBA re-apply sweep alone is sufficient, no new live-read path needed"),
// which a review caught and disproved: `checkStateBasedActions` does run
// `refreshCounterGatedStatics`, but NOT every state-changing mutation calls
// `checkStateBasedActions` before persisting a stable position —
// `announceCast` moves a card hand→stack and saves with ZERO SBA pass in the
// path, and casting is the single most common way a hand shrinks to the ≤1
// threshold this clause names. The FIX (also #1379, second pass): `game.ts`'s
// `saveGameState` — the SOLE writer of the `gameStates` row, so the one choke
// point every stable position passes through regardless of caller — now
// calls `refreshCounterGatedStatics(state)` itself, immediately before
// persisting. That makes "a persisted state always has freshly-materialized
// conditional statics" an invariant of persistence, not of caller discipline,
// so a hand-size `keyword-grant.condition` (mirroring Kavu Runner's
// board-state gate, issue #1095) now stays live through the ENTIRE window a
// spell sits on the stack, the exact window this clause needs it to. The
// small `id`/`hand` plumbing on `StaticEffectStateView` (`cards/types.ts`,
// `hand` OPTIONAL — no fabricated placeholder value) still lets a hand-size
// predicate be written with the same `condition` signature Kavu Runner uses.
// Once #782 unblocks the cost, both clauses attach with the SAME hand-size
// `condition` closure: `pt-buff` for +2/+2 (mirrors Jihad, `arn/white.ts`)
// and `keyword-grant` for menace (mirrors Kavu Runner, `inv/red.ts`) — see
// `gre/__tests__/keywordGrantHandSizeCondition.test.ts` for the proof,
// including the real-cast-path regression the first pass's suite missed.
// #782 (hybrid mana cost) remains the SOLE blocker on shipping the card
// itself.)
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
