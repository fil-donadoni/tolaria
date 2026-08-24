// ELD — red cards, split by colour per ADR 0043. The registry's
// `import * as eld from "./sets/eld"` resolves through eld/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import type { CardDefinition, SpellContext } from "../../types";

// Robber of the Rich — {1}{R} Creature — Human Archer Rogue, 2/2, reach,
// haste (Vintage Cube FREE: ETB/dies/attack triggers, issue #679). "Reach,
// haste. Whenever this creature attacks, if defending player has more cards
// in hand than you, exile the top card of their library. During any turn you
// attacked with a Rogue, you may cast that card and you may spend mana as
// though it were mana of any color to cast that spell."
//
// PROTOCOL (impulse-draw off an opponent's library — no Op skin, precedent:
// Elkin Bottle / Ice Cauldron, ice/colorless.ts): composes `peekLibraryTop` +
// `exileFaceDown` + `grantCastFromExile`, same idiom, sourced from the
// defending player's library instead of the caster's own.
//
// SIMPLIFICATIONS (flagged, stacked on the above):
//   - "During any turn you attacked with a Rogue" — matching every other
//     shipped impulse card, the cast-permission window is not auto-revoked
//     on a timer (no such primitive exists); the permission persists while
//     the card remains in exile instead of being turn-gated.
//
// DIVERGENCE (tracked-by: #1872) — "you may spend mana as though it were mana
// of any color" is not implemented: the exiled card is castable only for its
// normal, unfixed mana cost, so an off-colour exile can be uncastable when the
// Oracle text says it should not be. There is no cast-time mana-fixing seam in
// the engine to reach for — the only mana-substitution shape is the fixed
// `{from,to}` pair a battlefield static effect carries (`ManaSubstitution`,
// gre/state.ts) — and building one is a shared-primitive job spanning
// `castRawManaCost`, the exile-cast permission record and every reader of it
// (server, bot valuation, client affordability). Written up with the full
// call-site evidence in `docs/findings/1872-cast-time-mana-color-fixing.md`.
// The golden path (exile the defending player's top card, then cast it) is
// faithful.
export const robberOfTheRich: CardDefinition = {
    id: "0ecbe097-ba51-42e5-957c-382eb66c08f0",
    name: "Robber of the Rich",
    rarity: "mythic",
    oracleText:
        "Reach, haste\nWhenever this creature attacks, if defending player has more cards in hand than you, exile the top card of their library. During any turn you attacked with a Rogue, you may cast that card and you may spend mana as though it were mana of any color to cast that spell.",
    manaCost: { X: 1, R: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Archer", "Rogue"],
    power: 2,
    toughness: 2,
    staticAbilities: ["reach", "haste"],
    triggeredAbilities: [
        {
            id: "robber-of-the-rich-attack",
            oracleText:
                "Whenever this creature attacks, if defending player has more cards in hand than you, exile the top card of their library. During any turn you attacked with a Rogue, you may cast that card and you may spend mana as though it were mana of any color to cast that spell.",
            event: "ATTACKERS_DECLARED",
            matches: (event, self) =>
                event.type === "ATTACKERS_DECLARED" &&
                event.attackerIds.includes(self.id),
            resolve: (ctx: SpellContext) => {
                const defenderId = ctx.allPlayerIds.find(
                    (p) => p !== ctx.controller
                );
                if (!defenderId) return;
                if (
                    ctx.getHandSize(defenderId) <=
                    ctx.getHandSize(ctx.controller)
                ) {
                    return; // CR 603.4 — intervening condition not met
                }
                const top = ctx.peekLibraryTop(defenderId, 1);
                if (top.length === 0) return; // empty library
                const cardId = top[0];
                // CR 406.3 — exiled hidden to the opponent, known to controller.
                ctx.exileFaceDown(
                    defenderId,
                    cardId,
                    "library",
                    ctx.controller
                );
                // Cross-player grant (issue #679 fix): the card is owned by
                // (and stays exiled in) the DEFENDING player's zone, CR
                // 400.7, but the ATTACKING player is granted cast permission.
                // CR 305.9 (issue #1689) — oracle says "you may CAST that
                // card" (not "play"): `includesLand` is deliberately omitted
                // (defaults false) — an exiled LAND under this grant is
                // simply unusable, never a legal land drop.
                ctx.grantCastFromExile(cardId, ctx.controller, defenderId);
            },
        },
    ],
};
