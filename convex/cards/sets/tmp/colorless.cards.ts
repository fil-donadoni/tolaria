// TMP — colorless cards, split by colour per ADR 0043. The registry's
// `import * as tmp from "./sets/tmp/index.cards"` re-exports this module.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import { defineCard, type SpellContext } from "../../types";
import {} from "../../abilities";

// Cursed Scroll — {1} Artifact. "{3}, {T}: Choose a card name, then reveal a
// card at random from your hand. If that card has the chosen name, this
// artifact deals 2 damage to any target." (CR 201.3 name-a-card, CR 701.20a
// random reveal, CR 119 damage.) With a one-card hand the random reveal is
// forced, so the ability reliably deals 2; with more cards the outcome is
// probabilistic per the random pick.
//
// PROTOCOL CARD — resolve() justified (DSL-first exception, ADR 0045): the
// effect chains an open name-a-card choice (`requestNameCard`; the DSL
// `nameCard` Op is only `planned`), a RANDOM reveal from hand
// (`revealRandomHandCard`), and a RUNTIME name comparison
// (`getCardName === named`) that gates the damage. Reading a randomly-revealed
// card's name back into a conditional is not expressible with the current Op
// vocabulary (mirrors Petra Sphinx, which stays resolve() for the same
// name-choice-then-compare reason). The random reveal draws from the seeded
// PRNG exactly once, in this final non-suspending segment (after the
// requestNameCard suspension), so it is replay-safe.
export const cursedScroll = defineCard(() => ({
    id: "31415b9b-fb30-4132-a9a3-795b4573a901",
    rarity: "rare",
    name: "Cursed Scroll",
    oracleText:
        "{3}, {T}: Choose a card name, then reveal a card at random from your hand. If that card has the chosen name, this artifact deals 2 damage to any target.",
    manaCost: { X: 1 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "cursed-scroll-ping",
            oracleText:
                "{3}, {T}: Choose a card name, then reveal a card at random from your hand. If that card has the chosen name, this artifact deals 2 damage to any target.",
            cost: { tap: true, mana: { X: 3 } },
            useStack: true,
            targetRequirement: { type: "any", count: 1 },
            // AI shadow (issue #4142, never executed): the 2 damage to the
            // announced target. The name-and-reveal gate (a 1-in-hand-size hit)
            // has no Op, so the sketch prices the payoff, not the odds.
            aiEffects: [{ op: "dealDamage", amount: 2, to: { target: 0 } }],
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                // CR 201.3 — the controller names a card. Suspends until the
                // name is submitted via `submitNameCard`; the closure re-runs
                // from the top on resume with the stored name.
                const named = ctx.requestNameCard({
                    playerId: ctx.controller,
                    choiceId: "cursed-scroll-name",
                    prompt: "Choose a card name.",
                });
                if (named === undefined) return; // suspended on the name choice
                // CR 701.20a — reveal a card at random from your hand. Drawn
                // once here, after the suspension, so it is not re-rolled on
                // the replayed step. Empty hand → nothing revealed (CR 608.2b).
                const revealedId = ctx.revealRandomHandCard(ctx.controller);
                if (revealedId === undefined) return;
                // CR 201.2 — exact name match (registry-canonical casing).
                if (ctx.getCardName(revealedId) === named && target) {
                    // CR 119 — 2 damage to the announced any-target.
                    ctx.dealDamage(target, 2);
                }
            },
        },
    ],
}));

// Grindstone — {1} Artifact. "{3}, {T}: Target player mills two cards. If two
// cards that share a color were milled this way, repeat this process." (CR
// 701.17 mill.) Effect Script (ADR 0045): the repeat is the `mill` Op's
// `repeatWhile: "sharedColor"` (issue #7204), tested over the cards each pass
// genuinely milled.
// hand-tail: If two cards that share a color were milled this way, repeat this process (#7236)
export const grindstone = defineCard(() => ({
    id: "f4459187-de64-456f-bb66-56dea40d5c3e",
    rarity: "rare",
    name: "Grindstone",
    oracleText:
        "{3}, {T}: Target player mills two cards. If two cards that share a color were milled this way, repeat this process.",
    manaCost: { X: 1 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "grindstone-mill",
            oracleText:
                "{3}, {T}: Target player mills two cards. If two cards that share a color were milled this way, repeat this process.",
            cost: { tap: true, mana: { X: 3 } },
            useStack: true,
            targetRequirement: { type: "player", count: 1 },
            effects: [
                {
                    op: "mill",
                    player: { target: 0 },
                    count: 2,
                    repeatWhile: "sharedColor",
                },
            ],
        },
    ],
}));
