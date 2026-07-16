// EOE — green cards, split by colour per ADR 0043. The registry's
// `import * as eoe from "./sets/eoe"` resolves through eoe/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
import type { CardDefinition } from "../../../../convex/cards/types";
import { phaseTrigger } from "../../abilities/triggers/phaseTrigger";
import { landfallTrigger } from "../../abilities/triggers/landfallTrigger";

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

// Icetill Explorer — {2}{G}{G} Creature — Insect Scout, 2/4 (issue #1190,
// Landfall CAP #694). "You may play an additional land on each of your
// turns. You may play lands from your graveyard. Landfall — Whenever a land
// you control enters, mill a card." Three independent structured
// declarations, no `resolve()`:
//   - `extraLandDrops: 1` (CR 305.2 — Fastbond-style, read live off the
//     battlefield by `getExtraLandDrops`).
//   - `playsLandsFromGraveyard: true` (CR 305.1-analog permission, issue
//     #1190 — read live off the battlefield by `canPlayLandsFromGraveyard`;
//     widens `playCard`'s land-play source resolution to accept a graveyard
//     land while this permanent is in play). Unconditional and player-wide —
//     distinct from the SCOPED once-per-turn permission granted to one
//     specific card (Serra Paragon, issue #1149).
//   - Landfall→mill: the shared `landfallTrigger` factory (a
//     `PERMANENT_ENTERED` trigger gated to lands you control, CR 603.6a /
//     109.2) with a pure DSL `mill` Op on the controller — no target, no
//     choice, so no `resolve` escape hatch is needed.
export const icetillExplorer: CardDefinition = {
    id: "d9482aab-6ddf-48e1-84fa-b13d5ff81e69",
    name: "Icetill Explorer",
    rarity: "rare",
    oracleText:
        "You may play an additional land on each of your turns.\nYou may play lands from your graveyard.\nLandfall — Whenever a land you control enters, mill a card.",
    manaCost: { X: 2, G: 2 },
    types: ["Creature"],
    subtypes: ["Insect", "Scout"],
    power: 2,
    toughness: 4,
    extraLandDrops: 1,
    playsLandsFromGraveyard: true,
    triggeredAbilities: [
        landfallTrigger({
            id: "icetill-explorer-landfall",
            oracleText:
                "Landfall — Whenever a land you control enters, mill a card.",
            effects: [{ op: "mill", player: "controller", count: 1 }],
        }),
    ],
};
