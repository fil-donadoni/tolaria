// vow — red cards (ADR 0043 colour split). Modern Scryfall oracle text is
// authoritative (ADR 0004).

import type { CardDefinition } from "../../types";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";
import { BLOOD_TOKEN_SPEC } from "../../abilities/tokens/bloodToken";

// Voldaren Epicure — {R} Creature — Vampire, 1/1. "When this creature
// enters, it deals 1 damage to each opponent. Create a Blood token. (It's an
// artifact with "{1}, {T}, Discard a card, Sacrifice this token: Draw a
// card.")" (CR 603.6a self-ETB trigger; CR 120.1 damage-to-a-player —
// `dealDamage`/`to: { player: "opponent" }`, the single-opponent shorthand
// this 2-player engine already uses everywhere "each opponent" appears,
// fin/multicolor.ts's Fireball-shaped burn, leg/black.ts, znr/multicolor.ts;
// CR 111/701.7 token creation via the shared `BLOOD_TOKEN_SPEC`.) Unblocked
// by issue #778: `EffectTokenSpec`/`TokenSpec` gained a token-scoped
// `activatedAbilities[]` (#1191), and its cost allow-list now also accepts
// `discardFilter` (#778) so the Blood token's real "{1}, {T}, Discard a
// card, Sacrifice this token: Draw a card." ability ships instead of an
// inert placeholder — the exact gap the earlier stub was blocked on.
export const voldarenEpicure: CardDefinition = {
    id: "ae154e64-f626-45fb-bd52-840c1c27b2d3",
    name: "Voldaren Epicure",
    rarity: "common",
    oracleText:
        'When this creature enters, it deals 1 damage to each opponent. Create a Blood token. (It\'s an artifact with "{1}, {T}, Discard a card, Sacrifice this token: Draw a card.")',
    manaCost: { R: 1 },
    types: ["Creature"],
    subtypes: ["Vampire"],
    power: 1,
    toughness: 1,
    triggeredAbilities: [
        enteredTrigger({
            id: "voldaren-epicure-etb",
            oracleText:
                "When this creature enters, it deals 1 damage to each opponent. Create a Blood token.",
            scope: "self",
            effects: [
                { op: "dealDamage", amount: 1, to: { player: "opponent" } },
                {
                    op: "createToken",
                    token: BLOOD_TOKEN_SPEC,
                    controller: "controller",
                },
            ],
        }),
    ],
};
