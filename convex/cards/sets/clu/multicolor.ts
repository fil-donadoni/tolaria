// clu — multicolor cards (ADR 0043 colour split). Modern Scryfall oracle
// text is authoritative (ADR 0004).

import type {
    CardDefinition,
    PermanentView,
    StaticEffectStateView,
} from "../../types";
import { EFFECT_AFFECTS_SELF } from "../../types";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";
import { investigateOp } from "../../abilities/tokens/clueToken";

/** "As long as you have `max` or fewer cards in hand" (CR 611.2c) — a
 *  continuous static effect whose gate reads NON-battlefield player state.
 *  Finds "you" (the effect's own controller) inside `StaticEffectStateView`
 *  by `id` rather than by array position.
 *
 *  `hand` is OPTIONAL on `StaticEffectStateView` (issue #1379): not every
 *  call site building that view has real hand data (`gre/constants.ts`'s
 *  `manaLayerView`, a mana ability's battlefields-only P/T read, has none).
 *  An unavailable hand must NOT satisfy a "≤ N cards in hand" claim the
 *  engine cannot verify, so the conservative answer is `false` — never a
 *  fabricated `0`, which is ≤ N for every N ≥ 0 and would silently read as
 *  SATISFIED. Freshness across the whole window a spell sits on the stack is
 *  an invariant of persistence itself: `saveGameState` (`convex/game.ts`)
 *  re-runs `refreshCounterGatedStatics` immediately before every write
 *  (issue #1379), so a hand shrinking via `announceCast` re-materializes this
 *  gate before either client sees the position. Proof:
 *  `gre/__tests__/keywordGrantHandSizeCondition.test.ts`. */
function controllerHandSizeAtMost(max: number) {
    return (source: PermanentView, state: StaticEffectStateView): boolean => {
        const controller = state.players.find(
            (p) => p.id === source.controllerId
        );
        if (!controller || controller.hand === undefined) return false;
        return controller.hand.length <= max;
    };
}

// Carnage Interpreter — {1}{B/R}{B/R} Creature — Devil Detective, 3/3 (CLU
// 26, Vintage Cube FREE residue tranche, issue #1309, parent PRD #620).
// "When this creature enters, discard your hand, then investigate four
// times. As long as you have one or fewer cards in hand, this creature gets
// +2/+2 and has menace."
//
// COST: two GUILD-HYBRID {B/R} pips (CR 202.1a / 107.4e) declared through
// `ManaCost.hybrid` and payable with mana of either colour (PRD #1736,
// #1738/#1739) — that cost gap, not either ability clause, is what kept this
// card a stub through the entire Vintage Cube residue tranche.
//
// ETB (DSL-first, ADR 0045): `discard` with `cards` omitted is the bulk
// WHOLE-HAND shape (CR 701.8a — the Wheel of Fortune template, issue #1279),
// then `investigateOp(controller, 4)`. "Investigate four times" is CR
// 701.16a's N separate Clue creations, expressed as ONE `createToken` with
// `count: 4` over the shared `CLUE_TOKEN_SPEC` (primitive reuse); the Clue
// art resolves through this card's own `generated/token-prints.json` row.
// Both Ops are already exercised by shipped cards (Wheel of Fortune, Thraben
// Inspector), so the per-Op regime applies — no hand-written per-card test.
//
// STATIC CLAUSE: one Oracle sentence granting TWO characteristics, so two
// `staticEffects[]` entries sharing the SAME CR 611.2c gate — `pt-buff` for
// +2/+2 (layer 7c, the Jihad shape, `arn/white.ts`) and `keyword-grant` for
// menace (the Kavu Runner shape, `inv/red.ts`).
export const carnageInterpreter: CardDefinition = {
    id: "f6fb576e-a4a4-496b-b553-3f81cc651210", // CLU 26
    name: "Carnage Interpreter",
    rarity: "rare",
    oracleText:
        "When this creature enters, discard your hand, then investigate four times.\nAs long as you have one or fewer cards in hand, this creature gets +2/+2 and has menace.",
    manaCost: {
        generic: 1,
        hybrid: [
            ["B", "R"],
            ["B", "R"],
        ],
    },
    types: ["Creature"],
    subtypes: ["Devil", "Detective"],
    power: 3,
    toughness: 3,
    triggeredAbilities: [
        enteredTrigger({
            id: "carnage-interpreter-etb",
            oracleText:
                "When this creature enters, discard your hand, then investigate four times.",
            scope: "self",
            effects: [
                { op: "discard", player: "controller" },
                investigateOp("controller", 4),
            ],
        }),
    ],
    staticEffects: [
        {
            kind: "pt-buff",
            applies: EFFECT_AFFECTS_SELF,
            condition: controllerHandSizeAtMost(1),
            power: 2,
            toughness: 2,
        },
        {
            kind: "keyword-grant",
            applies: EFFECT_AFFECTS_SELF,
            condition: controllerHandSizeAtMost(1),
            keyword: "menace",
        },
    ],
};
