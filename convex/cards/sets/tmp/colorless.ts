// TMP — colorless cards, split by colour per ADR 0043. The registry's
// `import * as tmp from "./sets/tmp"` resolves through tmp/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import type {
    ActivatedAbilityContext,
    CardDefinition,
    SpellContext,
} from "../../types";
import { makeTapForMana } from "../../abilities";

// Ancient Tomb — "{T}: Add {C}{C}. This land deals 2 damage to you."
// (CR 605.1a mana ability, `useStack: false`.) The self-damage rides the
// `dealsDamageToControllerOnTap` rider (issue #675) — the unconditional
// sibling of the painland `dealsDamageToControllerOnColoredTap` rider,
// firing on EVERY tap regardless of the (here, always colorless) mana
// produced. Vintage Cube free tranche (issue #675, ADR 0041).
export const ancientTomb: CardDefinition = {
    id: "30e401e3-282b-4524-87e1-c6cd50cd6d00",
    rarity: "uncommon",
    name: "Ancient Tomb",
    oracleText: "{T}: Add {C}{C}. This land deals 2 damage to you.",
    manaCost: {},
    types: ["Land"],
    activatedAbilities: [
        {
            ...makeTapForMana({
                id: "ancient-tomb-mana",
                oracleText: "{T}: Add {C}{C}.",
                produces: { C: 2 },
            }),
            dealsDamageToControllerOnTap: 2,
        },
    ],
};

// Lotus Petal — "{T}, Sacrifice this artifact: Add one mana of any color."
// (CR 605.1a mana ability, `useStack: false`, CR 701.21 sacrifice cost.) The
// any-color choice follows the established Birds of Paradise / Talisman
// shape. Vintage Cube free tranche (issue #675, ADR 0041).
export const lotusPetal: CardDefinition = {
    id: "6c877da3-68fa-41d0-8a24-8c79fcd8ecc1",
    rarity: "common",
    name: "Lotus Petal",
    oracleText: "{T}, Sacrifice this artifact: Add one mana of any color.",
    manaCost: {},
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "lotus-petal-mana",
            oracleText:
                "{T}, Sacrifice this artifact: Add one mana of any color.",
            cost: { tap: true, sacrifice: true },
            useStack: false,
            effect: (ctx: ActivatedAbilityContext) => {
                ctx.addMana({ W: 1 });
            },
            manaChoices: [{ W: 1 }, { U: 1 }, { B: 1 }, { R: 1 }, { G: 1 }],
        },
    ],
};

// Wasteland — "{T}: Add {C}.\n{T}, Sacrifice this land: Destroy target
// nonbasic land." (CR 701.26 tap mana ability; CR 701.21 sacrifice cost;
// CR 701.8 destroy.) "Nonbasic" needs a NEGATIVE supertype filter — the
// engine only had the positive `supertypeFilter` (Avalanche's "target snow
// lands"); this card motivates a small, general, orthogonal addition
// (`TargetRequirement.excludeSupertypes`, mirroring the existing
// `excludeTypes`/`excludeColors`/`excludeSubtypes` fields) rather than a
// card-shaped workaround.
export const wasteland: CardDefinition = {
    id: "99ff731b-8399-40c8-b539-ba6ba5783771",
    rarity: "uncommon",
    name: "Wasteland",
    oracleText:
        "{T}: Add {C}.\n{T}, Sacrifice this land: Destroy target nonbasic land.",
    types: ["Land"],
    activatedAbilities: [
        {
            id: "wasteland-mana",
            oracleText: "{T}: Add {C}.",
            cost: { tap: true },
            useStack: false,
            effect: (ctx) => ctx.addMana({ C: 1 }),
            manaProduced: { C: 1 },
        },
        {
            id: "wasteland-destroy",
            oracleText:
                "{T}, Sacrifice this land: Destroy target nonbasic land.",
            cost: { tap: true, sacrifice: true },
            useStack: true,
            targetRequirement: {
                type: "Land",
                count: 1,
                excludeSupertypes: "Basic",
            },
            effects: [{ op: "destroy", target: { target: 0 } }],
        },
    ],
};

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
export const cursedScroll: CardDefinition = {
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
};
