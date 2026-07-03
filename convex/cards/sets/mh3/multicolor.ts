// Modern Horizons 3 (MH3) — multicolor cards, split by colour per ADR 0043. The
// registry's `import * as mh3 from "./sets/mh3"` resolves through mh3/index.ts.
// Modern Scryfall oracle text is authoritative (ADR 0004).
import type { CardDefinition, SpellContext } from "../../types";
import { damageDealtTrigger } from "../../abilities/triggers/damageDealtTrigger";

// Psychic Frog — {U}{B} Creature — Frog 1/2.
// "Whenever this creature deals combat damage to a player, draw a card." (CR
//  510.4 combat damage; CR 121.1 draw — a self-source combat-damage-to-player
//  trigger.)
// "Discard a card: Put a +1/+1 counter on this creature." (CR 122.1 counter.)
// "Exile three cards from your graveyard: This creature gains flying until end
//  of turn." (CR 118.5 exile-from-graveyard cost; CR 611.1b temporary keyword
//  grant via `grantStaticAbility`.)
//
// FLAGGED SIMPLIFICATION (CR 602.1 / 118.3): the cost union has no "discard a
// CHOSEN card" activation cost (only `discardLastDrawn` / `discardAtRandom`), so
// the discard ability is modelled as a stack ability with an empty cost whose
// resolve performs the discard via a `requestChoice` and only adds the counter
// when a card is actually discarded. This mirrors the established Necropolis
// idiom (cost→resolve-time pick) and keeps gameplay faithful; the only deviation
// is that the discard happens on resolution rather than at activation.
// (The engine has no planeswalkers, so the combat-damage trigger fires on
//  damage to a player only; the printed oracle text is preserved.)
export const psychicFrog: CardDefinition = {
    id: "68924203-c3d9-41ce-8ca8-c6dd491eb3ca",
    name: "Psychic Frog",
    rarity: "rare",
    oracleText:
        "Whenever this creature deals combat damage to a player or planeswalker, draw a card.\nDiscard a card: Put a +1/+1 counter on this creature.\nExile three cards from your graveyard: This creature gains flying until end of turn.",
    manaCost: { U: 1, B: 1 },
    types: ["Creature"],
    subtypes: ["Frog"],
    power: 1,
    toughness: 2,
    triggeredAbilities: [
        damageDealtTrigger({
            id: "psychic-frog-combat-draw",
            oracleText:
                "Whenever this creature deals combat damage to a player or planeswalker, draw a card.",
            source: "self",
            isCombat: true,
            target: { kind: "player", player: { relation: "any" } },
            resolve: (ctx: SpellContext) => {
                ctx.drawCards(ctx.controller, 1);
            },
        }),
    ],
    activatedAbilities: [
        {
            id: "psychic-frog-discard-pump",
            oracleText: "Discard a card: Put a +1/+1 counter on this creature.",
            cost: {},
            useStack: true,
            // NOT DSL-migratable (ADR 0045, issue #841): "Discard a card:" is
            // an activation COST (CR 118.3 / 602.1b), so with an empty hand the
            // ability is UNACTIVATABLE — the +1/+1 counter must not land. The
            // engine has no "discard a chosen card" activation cost (the cost
            // union offers only `discardLastDrawn` / `discardAtRandom`), and the
            // choice→discard→counters chain cannot express the cost-gating: on
            // an empty hand the choice/discard clamp to no-ops but a subsequent
            // `counters add` still fires, granting a free counter without paying
            // the discard. The `if` predicate grammar cannot test a choice
            // binding's cardinality (nor count the hand zone), so the counter
            // cannot be gated on the discard having happened. Kept as resolve():
            // the discard is performed via a resolve-time `requestChoice` and
            // the counter is added ONLY when a card is actually discarded (the
            // empty-hand early-return preserves the cost semantics). Mirrors the
            // established cost→resolve-time-pick Necropolis idiom.
            resolve: (ctx: SpellContext) => {
                const handIds = ctx.getHandIds(ctx.controller);
                if (handIds.length === 0) return;
                const picks = ctx.requestChoice({
                    playerId: ctx.controller,
                    choiceId: `psychic-frog-discard-${ctx.sourceInstanceId}`,
                    kind: "choose-hand-card",
                    zone: "hand",
                    count: 1,
                    prompt: "Discard a card to put a +1/+1 counter on Psychic Frog.",
                });
                if (picks === undefined) return; // suspended on the discard choice
                if (picks.length === 0) return;
                ctx.discardCard(ctx.controller, picks[0]);
                ctx.addCounter(
                    { type: "permanent", id: ctx.sourceInstanceId },
                    "+1/+1",
                    1
                );
            },
        },
        {
            id: "psychic-frog-exile-flying",
            oracleText:
                "Exile three cards from your graveyard: This creature gains flying until end of turn.",
            cost: { exileFromGraveyard: { count: 3 } },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                ctx.grantStaticAbility(
                    { type: "permanent", id: ctx.sourceInstanceId },
                    "flying",
                    { phase: "end-of-turn" }
                );
            },
        },
    ],
};
