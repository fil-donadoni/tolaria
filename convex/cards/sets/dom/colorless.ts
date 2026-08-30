// DOM — colorless cards, split by colour per ADR 0043. The registry's
// `import * as dom from "./sets/dom"` resolves through dom/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import type { CardDefinition, SpellContext } from "../../types";
import { constructArtifactsYouControlToken } from "../../sharedTokens";

// ─────────────────────────────────────────────────────────────────────────
// Karn, Scion of Urza — {4} Legendary Planeswalker — Karn, starting loyalty 5
// (CR 306.5b). Vintage Cube FREE wave 3 (issue #1570, parent PRD #1525 /
// planeswalker umbrella #1222). All three loyalty abilities (CR 606):
//   • +1 — "Reveal the top two cards of your library. An opponent chooses one
//     of them. Put that card into your hand and exile the other with a silver
//     counter on it." A `lookDistribute` with `chooser: "opponent"` (the
//     chooser≠zone-owner seam `scryReorder`'s fateseal already ships, issue
//     #1532), `reveal: "window"` (public reveal, CR 701.20a), `keepTo: "hand"`,
//     and the NEW `destination: "exile"` + `counters: { silver: 1 }` legs
//     (issue #1570) — the un-kept card is exiled with a silver counter.
//   • −1 — "Put a card you own with a silver counter on it from exile into
//     your hand." The Dauthi Voidwalker retrieval shape (issue #1156): a
//     `choice(zone: "exile")` filtered by `hasCounter: { type: "silver" }`,
//     then a `moveZone { cards, from: "exile", to: "hand" }` (the `from:
//     "exile"` cards-shape source is NEW, issue #1570). CR 122.1e strips the
//     silver counter on leaving exile, exactly as the void counter.
//   • −2 — "Create a 0/0 colorless Construct artifact creature token with
//     'This token gets +1/+1 for each artifact you control.'" The shared CDA
//     Construct factory (`constructArtifactsYouControlToken`, issue #2371) via
//     a `resolve()` closure — the token's P/T is a characteristic-defining
//     ability (CR 604.3, a `compute` closure the JSON-pure DSL token spec has
//     no slot for, ADR 0046). `imagePrintId` pinned by hand (the DOM Construct
//     token print reverse-linked from Karn's own Scryfall `all_parts`), the
//     documented `resolve()`-created-token art blind spot (`ncc/colorless.ts`).
const KARN_CONSTRUCT_TOKEN = constructArtifactsYouControlToken(
    // DOM Karn's OWN printing's Construct token (Scryfall `all_parts` on the
    // DOM print, set `tdom` "Dominaria Tokens").
    "c5eafa38-5333-4ef2-9661-08074c580a32"
);

/** Karn's −2 body. NOT-DSL-migratable — assessed, not merely un-migrated
 *  (the migration classifier reads this marker, `scripts/migration-classifier.mjs`).
 *  DSL-first exception (ADR 0045) — PROTOCOL-LIKE, recorded
 *  justification: the token carries a characteristic-defining P/T
 *  (`pt-cda-artifacts-you-control`), a `compute` closure evaluated at
 *  layer-read time. The DSL token spec (`EffectTokenSpec`) is a JSON-pure
 *  allowlist by construction (ADR 0046) with no `staticEffects` slot.
 *  `TokenSpec.staticEffectKeys` + `SpellContext.createToken` is the shipped
 *  mechanism for exactly this (`mh1/blue.ts` Urza, Lord High Artificer and
 *  `mh2/colorless.ts` Urza's Saga precedents). */
function createKarnConstruct(ctx: SpellContext): void {
    ctx.createToken(KARN_CONSTRUCT_TOKEN, ctx.controller, 1);
}

export const karnScionOfUrza: CardDefinition = {
    id: "07a3d9e8-8597-498b-869c-cff79e0df516",
    name: "Karn, Scion of Urza",
    rarity: "mythic",
    manaCost: { generic: 4 },
    types: ["Planeswalker"],
    subtypes: ["Karn"],
    supertypes: ["Legendary"],
    loyalty: 5,
    oracleText:
        '+1: Reveal the top two cards of your library. An opponent chooses one of them. Put that card into your hand and exile the other with a silver counter on it.\n−1: Put a card you own with a silver counter on it from exile into your hand.\n−2: Create a 0/0 colorless Construct artifact creature token with "This token gets +1/+1 for each artifact you control."',
    activatedAbilities: [
        {
            id: "karn-scion-of-urza-plus1",
            // CR 606.2 / 606.5 — loyalty ability; `+1` adds one counter.
            cost: { loyalty: 1 },
            useStack: true,
            oracleText:
                "+1: Reveal the top two cards of your library. An opponent chooses one of them. Put that card into your hand and exile the other with a silver counter on it.",
            effects: [
                {
                    // CR 701.20a reveal + CR 400.7 (issue #1570) — reveal the top
                    // two, the OPPONENT chooses one to hand (chooser≠zone-owner
                    // seam, issue #1532), the other is exiled with a silver
                    // counter (the new `destination: "exile"` + `counters` legs).
                    op: "lookDistribute",
                    player: "controller",
                    look: 2,
                    take: 1,
                    keepTo: "hand",
                    reveal: "window",
                    chooser: "opponent",
                    destination: "exile",
                    counters: { silver: 1 },
                    prompt: "Choose a card for your opponent to put into their hand; the other is exiled with a silver counter.",
                },
            ],
        },
        {
            id: "karn-scion-of-urza-minus1",
            // CR 606.2 / 606.5 — `-1` removes one counter.
            cost: { loyalty: -1 },
            useStack: true,
            oracleText:
                "−1: Put a card you own with a silver counter on it from exile into your hand.",
            effects: [
                {
                    // CR 122.1 (issue #1570, Dauthi Voidwalker shape issue #1156)
                    // — pick a silver-counter card from the controller's own
                    // exile; `hasCounter` precomputes the candidate allow-list.
                    op: "choice",
                    kind: "choose-exile-card",
                    player: "controller",
                    zone: "exile",
                    filter: { hasCounter: { type: "silver" } },
                    count: 1,
                    prompt: "Choose a card with a silver counter on it from exile to put into your hand.",
                    bind: "$picked",
                },
                {
                    // CR 400.7 / 122.1e (issue #1570) — move the picked card to
                    // hand from exile; leaving exile strips the silver counter
                    // (the same strip the void counter uses).
                    op: "moveZone",
                    cards: { ref: "$picked" },
                    player: "controller",
                    from: "exile",
                    to: "hand",
                },
            ],
        },
        {
            id: "karn-scion-of-urza-minus2",
            // CR 606.2 / 606.5 — `-2` removes two counters.
            cost: { loyalty: -2 },
            useStack: true,
            oracleText:
                '−2: Create a 0/0 colorless Construct artifact creature token with "This token gets +1/+1 for each artifact you control."',
            resolve: createKarnConstruct,
            // aiEffects (PRD #1423, issue #1431/#1519) — this ability is a bare
            // `resolve()` (the CDA-carrying token), so the bot's value model has
            // nothing to walk without a shadow script. A representative 2/2
            // stands in ("itself + one other artifact", the common early-game
            // count) — the SAME convention Urza, Lord High Artificer's Construct
            // trigger documents (`sets/mh1/blue.ts`).
            aiEffects: [
                {
                    op: "createToken",
                    token: {
                        name: "Construct",
                        types: ["Artifact", "Creature"],
                        subtypes: ["Construct"],
                        power: 2,
                        toughness: 2,
                    },
                    controller: "controller",
                },
            ],
        },
    ],
};
