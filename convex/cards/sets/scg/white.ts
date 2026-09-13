// SCG (Scourge) — white cards, split by colour per ADR 0043. The registry's
// `import * as scg from "./sets/scg"` resolves here via scg/index.ts.
import type { CardDefinition } from "../../types";
import { cyclingAbility, cycledTrigger } from "../../abilities/cycling";
import { tokenPrintIdFor } from "../../tokenPrintLookup";

const DECREE_OF_JUSTICE_ID = "5e8a7e5c-f252-4de8-94d7-e7327210bf26";

// Decree of Justice — "{X}{X}{2}{W}{W} Sorcery. Create X 4/4 white Angel
// creature tokens with flying. Cycling {2}{W}. When you cycle this card, you
// may pay {X}. If you do, create X 1/1 white Soldier creature tokens."
// (CR 107.3a the CAST X, 702.29a-c cycling + its cycled trigger, 107.3f the
// CYCLED trigger's X, 111 / 707.2 tokens.)
//
// Two DIFFERENT X's, and that is the whole point of the card. The cast half's
// X is announced as the spell goes on the stack (CR 107.3a) and paid through
// the mana cost — `xFactor: 2` because the printed cost spends it twice — so
// the body reads it back with the ordinary `{ X: true }` value. The CYCLED
// trigger's X is not defined by the ability's text and the card was never
// cast, so CR 107.3f governs it instead: the controller chooses the value AS
// THE ABILITY RESOLVES and then pays it. That is `payVariableMana` (issue
// #1701), whose bound amount the `createToken` count reads — not `{ X: true }`,
// which would read the cast-time announcement this card never made.
//
// compiler-gap: "Create X 4/4 white Angel creature tokens with flying." (#2693)
// compiler-gap: "When you cycle this card, you may pay {X}. If you do, create X 1/1 white Soldier creature tokens." (#2693)
export const decreeOfJustice: CardDefinition = {
    id: DECREE_OF_JUSTICE_ID,
    name: "Decree of Justice",
    rarity: "rare",
    oracleText:
        "Create X 4/4 white Angel creature tokens with flying.\nCycling {2}{W} ({2}{W}, Discard this card: Draw a card.)\nWhen you cycle this card, you may pay {X}. If you do, create X 1/1 white Soldier creature tokens.",
    manaCost: { X: "X", xFactor: 2, generic: 2, W: 2 },
    types: ["Sorcery"],
    effects: [
        {
            op: "createToken",
            token: {
                name: "Angel",
                types: ["Creature"],
                subtypes: ["Angel"],
                power: 4,
                toughness: 4,
                colors: ["W"],
                staticAbilities: ["flying"],
                imagePrintId: tokenPrintIdFor(DECREE_OF_JUSTICE_ID, "Angel"),
            },
            controller: "controller",
            count: { X: true },
        },
    ],
    activatedAbilities: [cyclingAbility({ generic: 2, W: 1 })],
    triggeredAbilities: [
        cycledTrigger({
            id: "decree-of-justice-cycled",
            oracleText:
                "When you cycle this card, you may pay {X}. If you do, create X 1/1 white Soldier creature tokens.",
            // CR 107.3f — the nomination and the payment are ONE decision, and
            // nominating 0 IS "if you do not" (creating 0 tokens and declining
            // are the same game state), so there is no separate may-pay gate
            // and no `if` on a boolean: the count simply reads the amount paid.
            effects: [
                {
                    op: "payVariableMana",
                    player: "controller",
                    prompt: "Pay {X} to create X 1/1 white Soldier tokens (Decree of Justice)",
                    bind: "$paid",
                },
                {
                    op: "createToken",
                    token: {
                        name: "Soldier",
                        types: ["Creature"],
                        subtypes: ["Soldier"],
                        power: 1,
                        toughness: 1,
                        colors: ["W"],
                        imagePrintId: tokenPrintIdFor(
                            DECREE_OF_JUSTICE_ID,
                            "Soldier"
                        ),
                    },
                    controller: "controller",
                    count: { ref: "$paid" },
                },
            ],
        }),
    ],
};
