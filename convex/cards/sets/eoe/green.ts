// EOE — green cards, split by colour per ADR 0043. The registry's
// `import * as eoe from "./sets/eoe"` resolves through eoe/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
import type { CardDefinition } from "../../../../convex/cards/types";
import { phaseTrigger } from "../../abilities/triggers/phaseTrigger";

// Ouroboroid — {2}{G}{G} Creature — Plant Wurm, 1/3 (issue #681, Cube FREE
// +1/+1 counters). "At the beginning of combat on your turn, put X +1/+1
// counters on each creature you control, where X is this creature's power."
// (CR 603.6a combat-begin trigger via `phaseTrigger`; CR 122 counter
// placement; CR 608.2i — X is determined once, from `$source.power` read at
// the moment the trigger begins resolving, then applied uniformly.) Pure DSL:
// `forEach` over the controller's battlefield creatures (a frozen SET, not a
// player choice), so no trigger-targeting bridge is needed (contrast
// Luminarch Aspirant in `sets/znr/white.ts`).
export const ouroboroid: CardDefinition = {
    id: "209c591a-4ab2-4e89-9523-a7b766cf4e51",
    name: "Ouroboroid",
    rarity: "mythic",
    oracleText:
        "At the beginning of combat on your turn, put X +1/+1 counters on each creature you control, where X is this creature's power.",
    manaCost: { X: 2, G: 2 },
    types: ["Creature"],
    subtypes: ["Plant", "Wurm"],
    power: 1,
    toughness: 3,
    triggeredAbilities: [
        phaseTrigger({
            id: "ouroboroid-counters",
            oracleText:
                "At the beginning of combat on your turn, put X +1/+1 counters on each creature you control, where X is this creature's power.",
            phase: "BEGINNING_OF_COMBAT",
            scope: "your",
            effects: [
                {
                    op: "forEach",
                    select: {
                        set: "permanents",
                        zone: "battlefield",
                        controller: "controller",
                        filter: { type: "Creature" },
                    },
                    effects: [
                        {
                            op: "counters",
                            action: "add",
                            counter: "+1/+1",
                            target: { ref: "$each" },
                            count: { ref: "$source.power" },
                        },
                    ],
                },
            ],
        }),
    ],
};

// STOP-AND-ISSUE (tracked-by: #1190) — Icetill Explorer: "You may play an
// additional land on each of your turns. You may play lands from your
// graveyard. Landfall — Whenever a land you control enters, mill a card." The
// `extraLandDrops: 1` static and the Landfall→`mill` trigger (shared
// `landfallTrigger` factory, #694) are both expressible today, but "You may
// play lands from your graveyard" is an unconditional player-wide
// play-from-graveyard permission with no primitive (distinct from the scoped
// Serra Paragon variant #1149). Landfall CAP (#694). Whole card left as one
// stub until #1190 lands.
// export const icetillExplorer: CardDefinition = {
//     id: "d9482aab-6ddf-48e1-84fa-b13d5ff81e69",
//     name: "Icetill Explorer",
//     rarity: "rare",
//     manaCost: { X: 2, G: 2 },
//     types: ["Creature"],
//     subtypes: ["Insect", "Scout"],
//     power: 2,
//     toughness: 4,
//     extraLandDrops: 1,
// };
