// mh2 — multicolor cards (ADR 0043 colour split).
import type { CardDefinition } from "../../types";

// Master of Death — {1}{U}{B} Creature — Zombie Wizard, 3/1. "When this
// creature enters, surveil 2.\nAt the beginning of your upkeep, if this card
// is in your graveyard, you may pay 1 life. If you do, return it to your
// hand." Authored DSL-first as an Effect Script (ADR 0045), both abilities
// reusing already-shipped Ops:
//   - ETB surveil 2 (CR 701.25): the `scryReorder` Op with `destination:
//     "graveyard"` and `count: 2`, the same shape as the MKM surveil-land
//     cycle (mkm/colorless.ts) and Consider (mid/blue.ts).
//   - Graveyard-zone upkeep recursion (CR 603.6e — `zone: "graveyard"`
//     triggered ability, Squee, Goblin Nabob's shape in mmq/red.ts, CR 117.3a
//     optional cost): `mayPay(cost: { life: 1 })` gates the `moveZone`
//     graveyard → hand self-return on the "if you do" clause. The "if this
//     card is in your graveyard" intervening-if is carried by the graveyard
//     zone scan itself.
export const masterOfDeath: CardDefinition = {
    id: "b9775175-6763-4826-afc8-dc520a235c36",
    name: "Master of Death",
    rarity: "rare",
    oracleText:
        "When this creature enters, surveil 2. (Look at the top two cards of your library, then put any number of them into your graveyard and the rest on top of your library in any order.)\nAt the beginning of your upkeep, if this card is in your graveyard, you may pay 1 life. If you do, return it to your hand.",
    manaCost: { X: 1, U: 1, B: 1 },
    types: ["Creature"],
    subtypes: ["Zombie", "Wizard"],
    power: 3,
    toughness: 1,
    triggeredAbilities: [
        {
            id: "master-of-death-etb-surveil",
            oracleText: "When this creature enters, surveil 2.",
            event: "PERMANENT_ENTERED",
            matches: (event, self) =>
                event.type === "PERMANENT_ENTERED" &&
                event.instanceId === self.id,
            effects: [
                {
                    op: "scryReorder",
                    player: "controller",
                    count: 2,
                    destination: "graveyard",
                    prompt: "Surveil 2 — keep cards on top or put them into your graveyard.",
                },
            ],
        },
        {
            id: "master-of-death-upkeep-return",
            oracleText:
                "At the beginning of your upkeep, if this card is in your graveyard, you may pay 1 life. If you do, return it to your hand.",
            event: "PHASE_BEGIN",
            zone: "graveyard",
            matches: (event, self) =>
                event.type === "PHASE_BEGIN" &&
                event.phase === "UPKEEP" &&
                event.activePlayerId === self.controllerId,
            effects: [
                {
                    op: "mayPay",
                    player: "controller",
                    cost: { life: 1 },
                    prompt: "Pay 1 life to return Master of Death to your hand?",
                    bind: "$return",
                },
                {
                    op: "if",
                    predicate: { binding: "$return" },
                    then: [
                        {
                            op: "moveZone",
                            target: { ref: "$source" },
                            to: "hand",
                        },
                    ],
                },
            ],
        },
    ],
};
