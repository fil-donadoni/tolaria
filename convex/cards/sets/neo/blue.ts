// NEO — blue cards, split by colour per ADR 0043. The registry's
// `import * as neo from "./sets/neo"` resolves through neo/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
//
// CR 712.8a puts a MODAL double-faced card here by its FRONT face: outside the
// battlefield and the stack it has only that face's characteristics, so Sink
// into Stupor is a `{1}{U}{U}` blue instant everywhere the colour split looks,
// and its land back face never makes it a colourless card.

import type { CardDefinition } from "../../types";
import { modalLandBackFace } from "../../abilities";

// Sink into Stupor // Soporific Springs — {1}{U}{U} Instant, with a Land back
// face (CR 712.3, ADR 0122). "Return target spell or nonland permanent an
// opponent controls to its owner's hand." // "As this land enters, you may pay
// 3 life. If you don't, it enters tapped. {T}: Add {U}."
//
// ONE announced target that may be either object (CR 601.2c), and the script
// is the two shipped primitives in sequence rather than a branch: CR 701.6-
// adjacent `moveSpellFromStack` moves it if it is a spell and skips if it has
// already left the stack (CR 608.2b), then `moveZone` bounces it if it is a
// permanent and skips if the id names none. Exactly one of the two can apply
// to any given target, so the pair IS the "spell or permanent" disjunction —
// no `if`, no new Op.
//
// The back face is the shock clause (CR 614.12) plus a mana ability, declared
// through the shared `modalLandBackFace` factory and registered as the
// `${id}#back` twin (`cards/modalDfc.ts`); CR 712.14b keeps the card in its
// zone if an effect ever tries to put it onto the battlefield, its front face
// being an instant card.
// compiler-gap: "Return target spell or nonland permanent an opponent controls to its owner's hand." (#2693)
// compiler-gap: "As this land enters, you may pay 3 life. If you don't, it enters tapped." (#2693)
export const sinkIntoStupor: CardDefinition = {
    id: "5358b87a-1a29-426d-b165-40c97da2c14d",
    name: "Sink into Stupor",
    rarity: "uncommon",
    oracleText:
        "Return target spell or nonland permanent an opponent controls to its owner's hand.",
    manaCost: { generic: 1, U: 2 },
    types: ["Instant"],
    targetRequirement: {
        type: "spell-or-permanent",
        count: 1,
        controller: "opponent",
        excludeTypes: "Land",
    },
    effects: [
        {
            op: "moveSpellFromStack",
            target: { target: 0 },
            destination: "hand",
        },
        { op: "moveZone", target: { target: 0 }, to: "hand" },
    ],
    backFace: modalLandBackFace({
        name: "Soporific Springs",
        color: "U",
        life: 3,
    }),
};
