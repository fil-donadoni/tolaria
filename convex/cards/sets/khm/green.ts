// KHM — green cards, split by colour per ADR 0043. The registry's
// `import * as khm from "./sets/khm"` resolves through khm/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import type { CardDefinition } from "../../types";
import { PERMANENT_TYPES } from "../../types";
import { makeVehicle } from "../../abilities/vehicle";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";
import { attacksTrigger } from "../../abilities/triggers/attacksTrigger";
import { CAT_TOKEN } from "../../sharedTokens";

// Esika's Chariot — {3}{G} Legendary Artifact — Vehicle, 4/4 (KHM, issue
// #3229). "When Esika's Chariot enters, create two 2/2 green Cat creature
// tokens.\nWhenever Esika's Chariot attacks, create a token that's a copy of
// target token you control.\nCrew 4"
//
// Filed under GREEN, not colorless: ADR 0043 splits a set by the COLOUR
// IDENTITY of the mana cost (CR 202.2), and {3}{G} is green — the colourless
// module holds only artifacts with no coloured pip (Smuggler's Copter's {2}).
//
// Built by `makeVehicle` (`cards/abilities/vehicle.ts`), which emits both the
// board-visible "crew 4" keyword string and its enforcing CR 702.122a activated
// ability, so the printed keyword can never enforce nothing. `supertypes:
// ["Legendary"]` rides through the builder onto the definition; the crew
// animation uses the PRINTED 4/4 (CR 301.7b).
//
// ETB: two Cats through ONE `createToken` Op with `count: 2` (CR 707.1 — one
// effect creating two tokens), on the shared `CAT_TOKEN` spec
// (`cards/sharedTokens.ts`) so every future Cat producer hashes to the same
// synthesized `tokenDefinitionId`. Art is resolved per producer from
// `generated/token-prints.json` — Esika's Chariot's own KHM printing
// reverse-links to the TKHM 2/2 green Cat (CR 111 / 114).
//
// ATTACK trigger: "create a token that's a copy of target token you control."
//   * "target token you control" is an ANNOUNCED target chosen as the trigger
//     goes on the stack (CR 603.3d), declared as `targetRequirement` with
//     `isToken: true` (CR 111.5's token-ness filter, issue #1195 — "true keeps
//     ONLY tokens") and `controller: "you"`. `type: [...PERMANENT_TYPES]` because
//     a token can be any permanent type — the Oracle text restricts token-ness
//     and controller, nothing else. A token that has left the battlefield before
//     the trigger resolves makes it fizzle for want of a legal target
//     (CR 608.2b); with no token at all the trigger never reaches the stack
//     (CR 603.3d — a required choice with no legal option removes it).
//   * the body is the `createTokenCopy` Op (CR 707.2, issue #1459) reading the
//     announced slot, the same `createTokenCopyOf` → `applyCopy` path Dance of
//     Many and Phantasmal Image use. A token created by a token-creating effect
//     IS a token (CR 111.1), so on a LATER attack the Chariot can copy the copy
//     — nothing special is needed for that, it falls out of `isToken` reading
//     the live instance.
// compiler-gap: "When Esika's Chariot enters, create two 2/2 green Cat creature tokens." (#2693)
// compiler-gap: "Whenever Esika's Chariot attacks, create a token that's a copy of target token you control." (#2693)
// compiler-gap: "Crew 4" (#2693)
export const esikasChariot: CardDefinition = makeVehicle({
    id: "a87606cc-fbf0-4e2c-9798-f1c935d0573d",
    name: "Esika's Chariot",
    rarity: "rare",
    manaCost: { X: 3, G: 1 },
    oracleText:
        "When Esika's Chariot enters, create two 2/2 green Cat creature tokens.\nWhenever Esika's Chariot attacks, create a token that's a copy of target token you control.\nCrew 4 (Tap any number of creatures you control with total power 4 or more: This Vehicle becomes an artifact creature until end of turn.)",
    power: 4,
    toughness: 4,
    crew: 4,
    supertypes: ["Legendary"],
    triggeredAbilities: [
        enteredTrigger({
            id: "esikas-chariot-etb-cats",
            oracleText:
                "When Esika's Chariot enters, create two 2/2 green Cat creature tokens.",
            scope: "self",
            effects: [
                {
                    op: "createToken",
                    token: CAT_TOKEN,
                    controller: "controller",
                    count: 2,
                },
            ],
        }),
        attacksTrigger({
            id: "esikas-chariot-attack-copy",
            oracleText:
                "Whenever Esika's Chariot attacks, create a token that's a copy of target token you control.",
            scope: "self",
            // CR 603.3d — chosen as the trigger is put on the stack.
            targetRequirement: {
                type: [...PERMANENT_TYPES],
                count: 1,
                isToken: true,
                controller: "you",
            },
            effects: [
                {
                    op: "createTokenCopy",
                    source: { target: 0 },
                    controller: "controller",
                },
            ],
        }),
    ],
});
