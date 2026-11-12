// emn — Hanweir, the Writhing Township: the combined back face of the meld
// pair Hanweir Garrison + Hanweir Battlements (CR 712.4a). Declared here because
// BOTH halves declare it and CR 701.42b reads the two declarations against each
// other; each half registers it as its own `#meld` twin (ADR 0161).
//
// Art: the FRONT image of the print `imagePrintId` names, because Scryfall
// publishes a combined back face as a card of its own (`cards/meld.ts`).

import type { CardBackFace } from "../../types";

const HANWEIR_ATTACK_TRIGGER_TEXT =
    "Whenever Hanweir attacks, create two 3/2 colorless Eldrazi Horror creature tokens that are tapped and attacking.";

export const hanweirWrithingTownshipFace: CardBackFace = {
    kind: "meld",
    name: "Hanweir, the Writhing Township",
    types: ["Creature"],
    subtypes: ["Eldrazi", "Ooze"],
    supertypes: ["Legendary"],
    power: 7,
    toughness: 4,
    staticAbilities: ["trample", "haste"],
    imagePrintId: "671fe14d-0070-4bc7-8983-707b570f4492",
    triggeredAbilities: [
        {
            id: "hanweir-the-writhing-township-attack",
            oracleText: HANWEIR_ATTACK_TRIGGER_TEXT,
            event: "ATTACKERS_DECLARED",
            matches: (event, self) =>
                event.type === "ATTACKERS_DECLARED" &&
                event.attackerIds.includes(self.id),
            effects: [
                {
                    op: "createToken",
                    token: {
                        name: "Eldrazi Horror",
                        types: ["Creature"],
                        subtypes: ["Eldrazi", "Horror"],
                        power: 3,
                        toughness: 2,
                        entersTapped: true,
                        entersAttacking: true,
                    },
                    controller: "controller",
                    count: 2,
                },
            ],
        },
    ],
};
