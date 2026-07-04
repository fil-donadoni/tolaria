// Streets of New Capenna Commander (VOC) — blue cards, split by colour per
// ADR 0043. The registry's `import * as voc from "./sets/voc"` resolves through
// voc/index.ts. Modern Scryfall oracle text is authoritative (ADR 0004).
import type { CardDefinition, CardType, SpellContext } from "../../types";

// Occult Epiphany — {X}{U} Instant. "Draw X cards, then discard X cards. Create
// a 1/1 white Spirit creature token with flying for each card type among cards
// discarded this way." (CR 107.3 X read via getX(); CR 121.1 draw; CR 701.8
// discard; CR 111 / 707.2 token creation.) Stepped resolution: draw X first
// (irreversible), then the discard pick — the discarded cards' types are read
// from the hand BEFORE they move, and one flying Spirit is made per distinct
// card type among them.
export const occultEpiphany: CardDefinition = {
    id: "6920c895-bc98-4871-a53f-219fa27a74e5",
    name: "Occult Epiphany",
    rarity: "rare",
    oracleText:
        "Draw X cards, then discard X cards. Create a 1/1 white Spirit creature token with flying for each card type among cards discarded this way.",
    manaCost: { X: "X", U: 1 },
    types: ["Instant"],
    // NOT DSL-migratable (ADR 0045, #852): the discard count is min(X, hand
    // size) (choice `count` is a literal, not an EffectValue) and the token
    // count is the number of DISTINCT CARD TYPES among the discarded cards — a
    // runtime read over the picks, not a `count` construct. Classifier
    // over-count (folds draw + discardCard + createToken + getX, blind to both
    // the choice-count arithmetic and the distinct-types tally). Blocked on
    // choice-count + a distinct-types count, not on X alone.
    resolveSteps: [
        (ctx: SpellContext) => {
            ctx.drawCards(ctx.controller, ctx.getX());
        },
        (ctx: SpellContext) => {
            const me = ctx.controller;
            const x = ctx.getX();
            const handCount = ctx.getHandIds(me).length;
            const discard = Math.min(x, handCount);
            if (discard === 0) return;
            const picks = ctx.requestChoice({
                playerId: me,
                choiceId: `occult-epiphany-discard-${ctx.sourceInstanceId}`,
                kind: "choose-hand-card",
                zone: "hand",
                count: discard,
                prompt: "Discard X cards (Occult Epiphany).",
            });
            if (picks === undefined) return; // suspended on the discard choice
            // Read the discarded cards' types from the hand BEFORE they move.
            const handCards = ctx.getHandCards(me);
            const pickSet = new Set(picks);
            const distinctTypes = new Set<CardType>();
            for (const card of handCards) {
                if (pickSet.has(card.id)) {
                    for (const t of card.types) distinctTypes.add(t);
                }
            }
            for (const id of picks) ctx.discardCard(me, id);
            if (distinctTypes.size > 0) {
                ctx.createToken(
                    {
                        name: "Spirit",
                        types: ["Creature"],
                        subtypes: ["Spirit"],
                        colors: ["W"],
                        power: 1,
                        toughness: 1,
                        staticAbilities: ["flying"],
                    },
                    me,
                    distinctTypes.size,
                    ctx.sourceInstanceId
                );
            }
        },
    ],
};
