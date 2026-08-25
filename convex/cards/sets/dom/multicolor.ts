// DOM — multicolor cards, split by colour per ADR 0043. The registry's
// `import * as dom from "./sets/dom"` resolves through dom/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import type { CardDefinition } from "../../types";
import { PERMANENT_TYPES } from "../../types";
import { TEFERI_HERO_OF_DOMINARIA_EMBLEM_ID } from "../../emblems";

// Teferi, Hero of Dominaria — {3}{W}{U} Legendary Planeswalker — Teferi,
// loyalty 4 (DOM, CR 306). All three loyalty abilities use the shipped
// loyalty framework (ADR 0058, #700); ships with the moveZone positional
// library insert (issue #1726):
//   +1: "Draw a card. At the beginning of the next end step, untap up to two
//       lands." — draw Op + a `delayedTrigger` (`next-end-step`, ADR 0048)
//       whose body raises a live `choose-permanents` pick (min 0 / max 2,
//       suspends and resumes through the standard Pending Choice pipeline)
//       and untaps each pick via `forEach` + `tapUntap`.
//   −3: "Put target nonland permanent into its owner's library third from the
//       top." — the moveZone `target` shape's positional library insert
//       (`to: "library"`, `position: 3`, issue #1726): the same LTB funnel as
//       a bounce, splice-clamped to the bottom for a library with two or
//       fewer cards (the official ruling).
//   −8: emblem "Whenever you draw a card, exile target permanent an opponent
//       controls." → emblem Op + the targeted-trigger EmblemDefinition
//       (#1221 / #1726 — same seam as Chandra, Torch of Defiance's).
export const teferiHeroOfDominaria: CardDefinition = {
    id: "5d10b752-d9cb-419d-a5c4-d4ee1acb655e",
    name: "Teferi, Hero of Dominaria",
    rarity: "mythic",
    oracleText:
        '+1: Draw a card. At the beginning of the next end step, untap up to two lands.\n−3: Put target nonland permanent into its owner\'s library third from the top.\n−8: You get an emblem with "Whenever you draw a card, exile target permanent an opponent controls."',
    manaCost: { X: 3, W: 1, U: 1 },
    types: ["Planeswalker"],
    supertypes: ["Legendary"],
    subtypes: ["Teferi"],
    loyalty: 4,
    activatedAbilities: [
        {
            id: "teferi-hero-of-dominaria-plus1",
            cost: { loyalty: 1 },
            useStack: true,
            oracleText:
                "+1: Draw a card. At the beginning of the next end step, untap up to two lands.",
            effects: [
                { op: "draw", player: "controller", count: 1 },
                {
                    op: "delayedTrigger",
                    timing: "next-end-step",
                    oracleText:
                        "At the beginning of the next end step, untap up to two lands.",
                    // CR 603.7a — "untap up to two lands" carries no "target",
                    // so the lands are chosen when the delayed trigger
                    // RESOLVES (a live battlefield pick, not an announced
                    // target); the body's `choice` suspends/resumes through
                    // the standard Pending Choice pipeline.
                    //
                    // DIVERGENCE: the pick is restricted to the controller's (tracked-by: #2785)
                    // OWN lands — the `choice` Op picks from one player's
                    // zone, and a cross-battlefield permanent pick is not yet
                    // expressible (CR text allows ANY lands). Overwhelmingly
                    // the dominant gameplay case (untapping your own lands);
                    // tracked-by: #1727.
                    effects: [
                        {
                            op: "choice",
                            kind: "choose-permanents",
                            player: "controller",
                            zone: "battlefield",
                            filter: { type: "Land" },
                            count: { min: 0, max: 2 },
                            prompt: "Untap up to two lands",
                            bind: "$lands",
                        },
                        {
                            op: "forEach",
                            select: { set: "bound", ref: "$lands" },
                            effects: [
                                {
                                    op: "tapUntap",
                                    action: "untap",
                                    target: { ref: "$each" },
                                },
                            ],
                        },
                    ],
                },
            ],
        },
        {
            id: "teferi-hero-of-dominaria-minus3",
            cost: { loyalty: -3 },
            useStack: true,
            oracleText:
                "−3: Put target nonland permanent into its owner's library third from the top.",
            // CR 115.1c — "target nonland permanent" (any controller's).
            targetRequirement: {
                type: [...PERMANENT_TYPES],
                excludeTypes: "Land",
                count: 1,
            },
            // issue #1726 — the positional library insert (1-based from the
            // top; a library with two or fewer cards puts it on the bottom,
            // per the official ruling).
            effects: [
                {
                    op: "moveZone",
                    target: { target: 0 },
                    to: "library",
                    position: 3,
                },
            ],
        },
        {
            id: "teferi-hero-of-dominaria-minus8",
            cost: { loyalty: -8 },
            useStack: true,
            oracleText:
                '−8: You get an emblem with "Whenever you draw a card, exile target permanent an opponent controls."',
            effects: [
                {
                    op: "emblem",
                    emblem: TEFERI_HERO_OF_DOMINARIA_EMBLEM_ID,
                },
            ],
        },
    ],
};
