// SOI (Shadows over Innistrad) — green cards, split by colour per ADR 0043.
// The registry's `import * as soi from "./sets/soi"` resolves through
// soi/index.ts. Cards are classified by the colour identity of their mana cost
// (CR 202.2).

import type { CardDefinition } from "../../types";
import { landfallTrigger } from "../../abilities/triggers/landfallTrigger";
import {
    leftTrigger,
    wasSacrificed,
} from "../../abilities/triggers/leftTrigger";
import { investigateOp } from "../../abilities/tokens/clueToken";

// Tireless Tracker — "Landfall — Whenever a land you control enters,
// investigate. (Create a Clue token. It's an artifact with '{2}, Sacrifice
// this token: Draw a card.') Whenever you sacrifice a Clue, put a +1/+1
// counter on this creature." Unblocked by issue #1191 — a Clue is exactly a
// `createToken` Op (CR 111 / 701.7) with a token-scoped `activatedAbilities[]`
// (a new capability of `EffectTokenSpec`/`TokenSpec`, no new Op) plus a
// "whenever you sacrifice a <subtype>" `leftTrigger` (`cause: "sacrifice"` +
// a real `filter.subtypes` match, both newly threaded through
// `PermanentLeftEvent`). Both halves reuse shared factories: `landfallTrigger`
// (#694) for the ETB half, `leftTrigger` + `wasSacrificed` for the sac half.
export const tirelessTracker: CardDefinition = {
    id: "ee8e9928-d9b2-4570-adb8-44b34115decd",
    name: "Tireless Tracker",
    rarity: "rare",
    manaCost: { X: 2, G: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Scout"],
    power: 3,
    toughness: 2,
    triggeredAbilities: [
        landfallTrigger({
            id: "landfall-investigate",
            oracleText:
                "Landfall — Whenever a land you control enters, investigate.",
            effects: [investigateOp()],
        }),
        // CR 701.16 / 205.3 — "whenever you sacrifice a Clue" is scoped to
        // THIS controller (`scope: "yours"`), the Clue's departure must land
        // in a graveyard (`toZone: "graveyard"` — CR 701.16a's sacrifice
        // destination), match the "Clue" subtype (`filter.subtypes`, now
        // carried by `PermanentLeftEvent`), and be a genuine sacrifice, not a
        // destroy/bounce/mill (`wasSacrificed`).
        leftTrigger({
            id: "sac-clue-counter",
            oracleText:
                "Whenever you sacrifice a Clue, put a +1/+1 counter on this creature.",
            scope: "yours",
            toZone: "graveyard",
            filter: { subtypes: "Clue" },
            condition: (event) => wasSacrificed(event),
            effects: [
                {
                    op: "counters",
                    action: "add",
                    counter: "+1/+1",
                    target: { ref: "$source" },
                    count: 1,
                },
            ],
        }),
    ],
};
