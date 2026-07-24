// SOI (Shadows over Innistrad) — white cards, split by colour per ADR 0043.
// The registry's `import * as soi from "./sets/soi"` resolves through
// soi/index.ts. Cards are classified by the colour identity of their mana
// cost (CR 202.2).

import type { CardDefinition } from "../../types";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";
import { investigateOp } from "../../abilities/tokens/clueToken";

// Thraben Inspector — {W} Creature — Human Soldier, 1/2. "When this creature
// enters, investigate. (Create a Clue token. It's an artifact with '{2},
// Sacrifice this token: Draw a card.')" (CR 603.6a ETB, CR 701.16
// Investigate — Cube FREE wave 3, issue #1531/#1525.) Fully free: exactly the
// Tireless Tracker precedent (`sets/soi/green.ts`) — `investigateOp()` is a
// `createToken` Op with the shared `CLUE_TOKEN_SPEC`, no new capability.
export const thrabenInspector: CardDefinition = {
    id: "d140c3b7-ca78-483d-baeb-307b624fea8b",
    rarity: "common",
    name: "Thraben Inspector",
    oracleText:
        "When this creature enters, investigate. (Create a Clue token. It's an artifact with \"{2}, Sacrifice this token: Draw a card.\")",
    manaCost: { W: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Soldier"],
    power: 1,
    toughness: 2,
    triggeredAbilities: [
        enteredTrigger({
            id: "thraben-inspector-investigate",
            oracleText: "When this creature enters, investigate.",
            scope: "self",
            effects: [investigateOp()],
        }),
    ],
};

export {};
