// usg — green cards (ADR 0043 colour split).

import { defineCard } from "../../types";
import { tappedTrigger } from "../../abilities/triggers/tappedTrigger";
import { colorChoiceModes } from "../../abilities/chooseColor";

// Fertile Ground — {1}{G} Enchantment — Aura, enchant land. "Whenever
// enchanted land is tapped for mana, its controller adds an additional one
// mana of any color." (CR 303.4 aura attachment, CR 603.2 PERMANENT_TAPPED
// trigger, CR 605 mana ability.)
//
// Twin of Wild Growth (`lea/green.cards.ts`): "its controller" is the
// ENCHANTED LAND's controller, read off the firing PERMANENT_TAPPED event
// (`$event.controllerId`) — who can differ from the Aura's own controller (no
// controller filter on the target). That player also makes the colour pick, as
// the trigger resolves (CR 605.4a): one `optionChoice` mode per colour
// (`colorChoiceModes`), each an `addMana` of that colour.
//
// Home set = earliest paper printing (ADR 0041) = Urza's Saga; it was first
// implemented against the INV reprint, which filed it under the
// wrong home set and rendered the wrong art. That printing now rides along
// as a `CardPrint` in `inv/green.cards.ts`.
export const fertileGround = defineCard(() => ({
    id: "091dda35-59e5-456d-8804-61513a610aed", // USG 252
    rarity: "common",
    name: "Fertile Ground",
    oracleText:
        "Enchant land\nWhenever enchanted land is tapped for mana, its controller adds an additional one mana of any color.",
    manaCost: { X: 1, G: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Land", count: 1 },
    triggeredAbilities: [
        tappedTrigger({
            id: "fertile-ground-extra-mana",
            oracleText:
                "Whenever enchanted land is tapped for mana, its controller adds an additional one mana of any color.",
            scope: "any",
            forMana: true,
            manaAbility: true, // CR 605.1b / 605.4 — resolves without the stack
            // CR 605.4 — predictive extra-mana descriptor: the enchanted land
            // yields one additional mana of any colour (chosen at resolve). The
            // castability gate models it as fully flexible; the auto-tap solver
            // treats it as generic (it can't pre-encode the colour choice).
            manaBonusForPotential: {
                appliesTo: "host",
                amount: { kind: "anyColor", count: 1 },
            },
            condition: (event, self) =>
                !!self.attachedTo && event.permanentId === self.attachedTo,
            effects: [
                {
                    op: "optionChoice",
                    player: { ref: "$event.controllerId" },
                    prompt: "Fertile Ground: add one mana of which color?",
                    modes: colorChoiceModes((color) => [
                        {
                            op: "addMana",
                            mana: { [color]: 1 },
                            player: { ref: "$event.controllerId" },
                        },
                    ]),
                },
            ],
        }),
    ],
}));

// Carpet of Flowers — {G} Enchantment. "At the beginning of each of your main
// phases, if you haven't added mana with this ability this turn, you may add X
// mana of any one color, where X is the number of Islands target opponent
// controls." (CR 603.2 phase-begin trigger over BOTH main phases — one Oracle
// line, one ability; CR 603.3d the opponent is targeted as the trigger goes on
// the stack; CR 106.1 + CR 500.5 the mana is added to the controller's pool.)
//
// The colour is one `optionChoice` mode per colour (`colorChoiceModes`), each
// an `addMana` whose amount is a `count` of the targeted opponent's Islands read
// at resolution. "Haven't added mana with this ability this turn" is
// `maxTriggersPerTurn: 1` (a per-source tally), made exact by the `matches`
// gate: the ability only triggers while the opponent has an Island, so a
// zero-Island main phase adds nothing and does not spend the turn's one use.
// The "you may" is not offered: unspent mana has no cost, so adding is never
// worse than declining, and a decline would spend the use for nothing.
export const carpetOfFlowers = defineCard(() => ({
    id: "93abb48a-85f2-432d-8602-0a1d17fbb409",
    rarity: "uncommon",
    name: "Carpet of Flowers",
    oracleText:
        "At the beginning of each of your main phases, if you haven't added mana with this ability this turn, you may add X mana of any one color, where X is the number of Islands target opponent controls.",
    manaCost: { G: 1 },
    types: ["Enchantment"],
    triggeredAbilities: [
        {
            id: "carpet-of-flowers-main-phase",
            oracleText:
                "At the beginning of each of your main phases, if you haven't added mana with this ability this turn, you may add X mana of any one color, where X is the number of Islands target opponent controls.",
            event: "PHASE_BEGIN",
            targetRequirement: {
                type: "player",
                count: 1,
                controller: "opponent",
            },
            maxTriggersPerTurn: 1,
            matches: (event, self, state) =>
                event.type === "PHASE_BEGIN" &&
                (event.phase === "PRECOMBAT_MAIN" ||
                    event.phase === "POSTCOMBAT_MAIN") &&
                event.activePlayerId === self.controllerId &&
                !!state?.players.some(
                    (p) =>
                        p.id !== self.controllerId &&
                        p.battlefield.some((c) => c.subtypes.includes("Island"))
                ),
            effects: [
                {
                    op: "optionChoice",
                    prompt: "Carpet of Flowers: add mana of which color?",
                    modes: colorChoiceModes((color) => [
                        {
                            op: "addMana",
                            mana: {
                                [color]: {
                                    count: {
                                        zone: "battlefield",
                                        controller: { target: 0 },
                                        filter: { subtype: "Island" },
                                    },
                                },
                            },
                        },
                    ]),
                },
            ],
        },
    ],
}));
