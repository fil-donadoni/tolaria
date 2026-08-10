// HOU — white cards, split by colour per ADR 0043. The registry's
// `import * as hou from "./sets/hou"` resolves through hou/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import type { CardDefinition } from "../../types";
import { phaseTrigger } from "../../abilities/triggers/phaseTrigger";

// Crested Sunmare — {3}{W}{W} Creature — Horse, 5/5. The demo consumer of the
// CR 119.3 per-turn life-gain tally (`GameState.lifeGainedThisTurn`, issue
// #1457):
//
//   "Other Horses you control have indestructible."
//     A CR 611 layer-6 keyword grant, expressed as data (`keyword-grant`
//     staticEffect) — self-excluded ("OTHER Horses") and controller-scoped.
//
//   "At the beginning of each end step, if you gained life this turn, create a
//    5/5 white Horse creature token."
//     A CR 603.4 INTERVENING-IF, not a resolution-time check: the condition is
//     tested when the ability would trigger AND again as it resolves, and the
//     trigger does nothing if it is false either time. `phaseTrigger` wires
//     both halves off the single `interveningIf` callback (it mirrors it into
//     `matches`), so the trigger never even enters the stack on a turn with no
//     life gain. Note the scope is `each` end step (both players'), per the
//     modern Oracle text — but the condition is still about YOU (the ability's
//     controller), hence the `self.controllerId` read rather than the firing
//     step's active player.
//
//     "Gained life" is the tally being > 0, and a gain of 0 (or one fully
//     replaced away, CR 614) never enters the tally — so gaining 0 life
//     correctly does NOT satisfy the condition.
const CRESTED_SUNMARE_ID = "732fa4c9-11da-4bdb-96af-aa37c74be25f";

export const crestedSunmare: CardDefinition = {
    id: CRESTED_SUNMARE_ID,
    name: "Crested Sunmare",
    rarity: "mythic",
    oracleText:
        "Other Horses you control have indestructible.\nAt the beginning of each end step, if you gained life this turn, create a 5/5 white Horse creature token.",
    manaCost: { X: 3, W: 2 },
    types: ["Creature"],
    subtypes: ["Horse"],
    power: 5,
    toughness: 5,
    staticEffects: [
        {
            // CR 611 / 613.1f layer 6 — "OTHER Horses you control have
            // indestructible": every Horse this card's controller controls
            // except the source itself.
            kind: "keyword-grant",
            applies: (target, source) =>
                target.id !== source.id &&
                target.controllerId === source.controllerId &&
                target.subtypes.includes("Horse"),
            keyword: "indestructible",
        },
    ],
    triggeredAbilities: [
        phaseTrigger({
            id: "crested-sunmare-horse",
            oracleText:
                "At the beginning of each end step, if you gained life this turn, create a 5/5 white Horse creature token.",
            phase: "END_STEP",
            scope: "each",
            // CR 603.4 / 603.4 — "if you gained life this turn". Checked at
            // trigger time (mirrored into `matches` by the factory) and again
            // immediately before resolution; a zero/absent tally is false.
            interveningIf: (_event, self, state) =>
                (state?.lifeGainedThisTurn?.[self.controllerId] ?? 0) > 0,
            // CR 111 / 707.1 token creation. The gate is the intervening-if
            // above, so the body is unconditional.
            effects: [
                {
                    op: "createToken",
                    token: {
                        name: "Horse",
                        types: ["Creature"],
                        subtypes: ["Horse"],
                        power: 5,
                        toughness: 5,
                        colors: ["W"],
                    },
                    controller: "controller",
                },
            ],
        }),
    ],
};
