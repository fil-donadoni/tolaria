// TLA — red cards, split by colour per ADR 0043. The registry's
// `import * as tla from "./sets/tla"` resolves through tla/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import type { CardDefinition, EffectTokenSpec } from "../../types";
import { colorChoiceModes } from "../../abilities/chooseColor";

// ─────────────────────────────────────────────────────────────────────────
// The Legend of Roku // Avatar Roku (issue #3235, Scryfall tla #145)
// ─────────────────────────────────────────────────────────────────────────
//
// {2}{R}{R} Enchantment — Saga, transforming into a 4/4 Legendary Creature —
// Avatar. The first card in the catalogue to carry FIREBENDING (CR 702.189),
// and the reason that keyword and its mana lifetime exist.
//
// Three chapters, three already-shipped seams plus one earned Op:
//
//   I   — "Exile the top three cards of your library. Until the end of your
//         next turn, you may play those cards." The exile half is the new
//         `exileTopOfLibrary` Op (CR 701.13 Exile / CR 406.3). It is a
//         sibling of the mill Op rather than a destination parameter on it,
//         since CR 701.17a defines milling as going to the GRAVEYARD.
//         It composes the same
//         `peekLibraryTop` + per-card `moveCardById` pair `lookDistribute`'s
//         exile leg already runs — no new primitive.
//
//         The play half is the shipped `grantCastFromExile` with a THIRD
//         window, `"until-end-of-your-next-turn"` (CR 514.2 / 608.2g). The two
//         windows that shipped are both too short: `"this-turn"` dies at this
//         turn's cleanup, and `"until-next-end-step"` is a different boundary
//         with a different early-return (its own helper's doc says why the two
//         must not be merged). `includesLand: true` because the Oracle says
//         "PLAY those cards", not "cast" — CR 305.9 / 116.2a, and without the
//         flag a land under the grant would expose no action at all.
//
//         The two Ops are joined by `linkToSource` + `{ exiledWithSource:
//         true }` (CR 607 / 406.6), NOT by a `bindAll` picks binding: the
//         grant's picks shape reads the FIRST pick only, so a binding would
//         silently make two of the three cards unplayable. The link is also
//         the CR's own answer to "which exiled cards".
//
//   II  — "Add one mana of any color." No new Op and, despite the issue
//         brief's premise, no dependency on issue #1368: that issue is about
//         an "any colour" choice inside a MANA ABILITY, which resolves outside
//         the stack (CR 605.1b/605.4) and so cannot raise a choice at all. A
//         Saga chapter is an ordinary triggered ability ON the stack, so the
//         shipped `optionChoice` composition applies unchanged — five modes,
//         one per colour (CR 105.1), each a single `addMana` Op. That is the
//         same `colorChoiceModes` builder every "becomes the colour of your
//         choice" card uses, with a different mode body.
//
//   III — "Exile this Saga, then return it to the battlefield transformed
//         under your control." — `exileAndReturnTransformed` (CR 712.14a)
//         with `controller: "controller"`, byte-identical to Fable of the
//         Mirror-Breaker's own chapter III (neo/red.ts).
//
// CR 714.4's sacrifice SBA never fires here, for the reason Fable's note
// spells out: chapter III is on the stack when the lore count reaches the
// final chapter, and by the time it has left the Saga is a NEW object (CR
// 400.7) showing a back face with no chapter abilities.
//
// Back face — Avatar Roku is a Legendary Creature with no mana cost, so its
// colour comes from its printed colour indicator: red (CR 712.2). It carries
// `firebending 4` as a bare `staticAbilities` string; `expandFirebending`
// (cards/abilities/firebending.ts) injects the CR 702.189a attack trigger at
// the `getDefinition` seam, so the keyword can never be printed with nothing
// enforcing it.
//
const THE_LEGEND_OF_ROKU_ID = "95f2f5af-d405-4534-8683-5a9001f997b4";

/** Avatar Roku's {8} token (CR 111.1 / 707.2): "a 4/4 red Dragon creature
 *  token with flying and firebending 4."
 *
 *  The keyword rides the token's own `staticAbilities`, which is what makes
 *  "firebending is grantable to a token" true by CONSTRUCTION rather than
 *  through a second code path: `tokenDefinitionId` hashes `staticAbilities`
 *  into the token id, and `getDefinition` runs the synthesized definition
 *  through the very same `expandFirebending` a printed card goes through.
 *
 *  Card-local rather than a `sharedTokens.ts` entry: Avatar Roku is its only
 *  producer in the pool. Real printed token art (ttla, the TLA token set) —
 *  CR 114/111, a missing image renders a placeholder silently. */
const ROKU_DRAGON_TOKEN: EffectTokenSpec = {
    name: "Dragon",
    types: ["Creature"],
    subtypes: ["Dragon"],
    power: 4,
    toughness: 4,
    colors: ["R"],
    staticAbilities: ["flying", "firebending 4"],
    imagePrintId: "cddc0746-6d3e-441f-866f-28587bf54801",
};

// The Oracle compiler reads no chapter line at all today — Saga chapters are
// declared as `chapterAbilities[]` data and the grammar has no slot for the
// "I — …" template — so all three chapters are declared gaps (PRD #2693).
// compiler-gap: "I — Exile the top three cards of your library. Until the end of your next turn, you may play those cards." (#2693)
// compiler-gap: "II — Add one mana of any color." (#2693)
// compiler-gap: "III — Exile this Saga, then return it to the battlefield transformed under your control." (#2693)
export const theLegendOfRoku: CardDefinition = {
    id: THE_LEGEND_OF_ROKU_ID,
    name: "The Legend of Roku",
    rarity: "mythic",
    oracleText:
        "(As this Saga enters and after your draw step, add a lore counter.)\nI — Exile the top three cards of your library. Until the end of your next turn, you may play those cards.\nII — Add one mana of any color.\nIII — Exile this Saga, then return it to the battlefield transformed under your control.",
    manaCost: { X: 2, R: 2 },
    types: ["Enchantment"],
    subtypes: ["Saga"],
    chapterAbilities: [
        {
            chapters: [1],
            oracleText:
                "I — Exile the top three cards of your library. Until the end of your next turn, you may play those cards.",
            effects: [
                {
                    op: "exileTopOfLibrary",
                    player: "controller",
                    count: 3,
                    // CR 607 / 406.6 — link all three to the Saga so the grant
                    // below reaches EVERY exiled card. A `bindAll` picks
                    // binding would reach only the first (see the header).
                    linkToSource: true,
                },
                {
                    op: "grantCastFromExile",
                    card: { exiledWithSource: true },
                    player: "controller",
                    window: "until-end-of-your-next-turn",
                    // CR 305.9 / 116.2a — "PLAY those cards", so a land among
                    // the three is a legal land drop, not a dead card.
                    includesLand: true,
                },
            ],
        },
        {
            chapters: [2],
            oracleText: "II — Add one mana of any color.",
            effects: [
                {
                    op: "optionChoice",
                    prompt: "Choose a color to add one mana of.",
                    // CR 105.1 — the five colours; "any color" never offers
                    // colourless. One shared builder with every other
                    // choose-a-colour card, a different mode body.
                    modes: colorChoiceModes((color) => [
                        { op: "addMana", mana: { [color]: 1 } },
                    ]),
                },
            ],
        },
        {
            chapters: [3],
            oracleText:
                "III — Exile this Saga, then return it to the battlefield transformed under your control.",
            effects: [
                {
                    op: "exileAndReturnTransformed",
                    target: { ref: "$source" },
                    // "under YOUR control" — the chapter ability's controller,
                    // not the card's owner (CR 712.14a fixes only that it
                    // enters with its back face up).
                    controller: "controller",
                },
            ],
        },
    ],
    backFace: {
        name: "Avatar Roku",
        types: ["Creature"],
        supertypes: ["Legendary"],
        subtypes: ["Avatar"],
        power: 4,
        toughness: 4,
        // CR 712.2 — a back face with no mana cost takes its colour from its
        // printed colour indicator: red.
        colors: ["R"],
        // CR 702.189a — the keyword string is the WHOLE declaration; the
        // trigger is injected by `expandFirebending` at the `getDefinition`
        // seam, so the printed line and the enforcement cannot drift.
        staticAbilities: ["firebending 4"],
        oracleText:
            "Firebending 4 (Whenever this creature attacks, add {R}{R}{R}{R}. This mana lasts until end of combat.)\n{8}: Create a 4/4 red Dragon creature token with flying and firebending 4.",
        // A real double-faced Scryfall print shares ONE id across both faces;
        // `backFaceAsTokenSpec` stamps `imagePrintFace: "back"` so the image
        // layer requests the back-face CDN path.
        imagePrintId: THE_LEGEND_OF_ROKU_ID,
        activatedAbilities: [
            {
                id: "avatar-roku-dragon",
                oracleText:
                    "{8}: Create a 4/4 red Dragon creature token with flying and firebending 4.",
                cost: { mana: { X: 8 } },
                useStack: true,
                effects: [
                    {
                        op: "createToken",
                        token: ROKU_DRAGON_TOKEN,
                        controller: "controller",
                    },
                ],
            },
        ],
    },
};
