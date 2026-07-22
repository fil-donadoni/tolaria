// NCC (Streets of New Capenna Commander) — colourless cards (ADR 0043 colour
// split). Modern Scryfall oracle text is authoritative (ADR 0004). Colourless
// artifacts (no coloured cost) live here per the colour-split convention.

import type { CardDefinition, SpellContext, TokenSpec } from "../../types";
import { discardTrigger } from "../../abilities/triggers/discardTrigger";

const CURRENCY_CONVERTER_ID = "187b6719-e5ed-4615-a00b-3313ceca055b";

// A Treasure token (CR 111.10j) — "colourless Treasure artifact token with
// '{T}, Sacrifice this artifact: Add one mana of any color.'" The mana leg is
// the City of Brass any-colour idiom (an `addMana` default plus `manaChoices`
// for the five colours, CR 106.1); the sacrifice + tap cost matches every other
// artifact-that-sacs-itself-for-mana on the catalogue (Chromatic Star family).
const TREASURE_TOKEN: TokenSpec = {
    name: "Treasure",
    types: ["Artifact"],
    subtypes: ["Treasure"],
    activatedAbilities: [
        {
            id: "treasure-sacrifice-mana",
            oracleText:
                "{T}, Sacrifice this artifact: Add one mana of any color.",
            cost: { tap: true, sacrifice: true },
            useStack: false,
            effect: (ctx) => ctx.addMana({ W: 1 }),
            manaChoices: [{ W: 1 }, { U: 1 }, { B: 1 }, { R: 1 }, { G: 1 }],
        },
    ],
};

// A 2/2 black Rogue creature token (CR 111.2) — a vanilla body, no abilities.
const ROGUE_TOKEN: TokenSpec = {
    name: "Rogue",
    types: ["Creature"],
    subtypes: ["Rogue"],
    power: 2,
    toughness: 2,
    colors: ["B"],
};

// Currency Converter (#791 — the concrete vehicle for the per-source exile
// linkage capability) — {1} Artifact. Modern Scryfall oracle:
//   "Whenever you discard a card, you may exile that card from your graveyard.
//    {2}, {T}: Draw a card, then discard a card.
//    {T}: Put a card exiled with this artifact into its owner's graveyard. If
//    it's a land card, create a Treasure token. If it's a nonland card, create
//    a 2/2 black Rogue creature token."
//
// PROTOCOL (composition of SpellContext primitives, precedent: Necropotence /
// Robber of the Rich / Chrome Mox — resolve() cards that compose exile/choice
// primitives). Each leg is a shipped primitive plus the one capability this
// issue adds — the per-source exile linkage (`linkExileToSource` /
// `getCardsExiledWith`, CR 111):
//   1. CR 701.8 / 603 discard trigger via the `discardTrigger` factory
//      (CARD_DISCARDED). "you may" → an empty-cost `requestMayPay` yes/no; on
//      accept, the discarded card (already in the graveyard when the event
//      fires) moves graveyard → exile and is STAMPED with this artifact as its
//      source, so ability 3 can find it later.
//      NOT DSL-migratable (ADR 0045): the accept branch calls
//      `ctx.linkExileToSource` to stamp the exiled card's provenance —
//      there is no registered Op wrapping `linkExileToSource` /
//      `getCardsExiledWith` (checked EFFECT_OP_REGISTRY,
//      convex/cards/mechanicsRegistry.ts). Blocked on: missing Op for the
//      per-source exile-linkage primitive (shipped as a raw SpellContext
//      primitive by issue #791, never given an Op wrapper). Planned-migratable
//      if that Op is ever added.
//   2. CR 121.6 draw + CR 701.8 discard — migrated to `effects[]`
//      (`draw` → `choice` kind `choose-hand-card` → `discard`), the same
//      shape as Jalum Tome (`atq/colorless.ts`). The interpreter suspends at
//      the `choice` Op exactly like the old `resolveSteps` split did, so the
//      draw never re-runs on resume (Bazaar of Baghdad precedent preserved).
//      The discard emits CARD_DISCARDED, which re-fires ability 1 — the
//      intended engine loop.
//   3. CR 111 retrieval — enumerate the cards exiled with this artifact
//      (`getCardsExiledWith`), let the controller pick one (`choose-exile-card`,
//      Dauthi Voidwalker precedent), move it exile → its OWNER's graveyard (CR
//      400.7), then branch on land/nonland to make a Treasure or Rogue token.
//      NOT DSL-migratable (ADR 0045): reads `getCardsExiledWith` (no
//      registered Op) to build the candidate set, and the token-creation
//      branch depends on land/nonland type of the CHOSEN exiled card read out
//      of that same closure-local lookup, not an announced target or a
//      declaratively-selected `forEach` set. Blocked on: missing Op for
//      per-source exile-linkage retrieval. Planned-migratable if that Op is
//      ever added.
export const currencyConverter: CardDefinition = {
    id: CURRENCY_CONVERTER_ID,
    name: "Currency Converter",
    rarity: "rare",
    oracleText:
        "Whenever you discard a card, you may exile that card from your graveyard.\n{2}, {T}: Draw a card, then discard a card.\n{T}: Put a card exiled with this artifact into its owner's graveyard. If it's a land card, create a Treasure token. If it's a nonland card, create a 2/2 black Rogue creature token.",
    manaCost: { X: 1 },
    types: ["Artifact"],
    triggeredAbilities: [
        // 1. CR 701.8 / 603 — "Whenever you discard a card, you may exile that
        //    card from your graveyard." (Stamped to this artifact for retrieval.)
        discardTrigger({
            id: "currency-converter-discard-exile",
            oracleText:
                "Whenever you discard a card, you may exile that card from your graveyard.",
            scope: "your",
            // NOT DSL-migratable (ADR 0045): stamps `ctx.linkExileToSource` —
            // no registered Op wraps this per-source provenance primitive.
            // Blocked on: missing Op. See file-header note above.
            resolve: (ctx, _event, discardingPlayerId, discardedId) => {
                // CR 117.3a — "you may": a cost-less yes/no decision.
                const accept = ctx.requestMayPay({
                    playerId: discardingPlayerId,
                    choiceId: `currency-converter-exile-${ctx.sourceInstanceId}-${discardedId}`,
                    prompt: "Currency Converter: exile the discarded card from your graveyard?",
                });
                if (accept === undefined) return; // suspended for the choice
                if (!accept) return;
                // CR 400.7 — move the discarded card graveyard → exile, then
                // stamp the per-source link (no-op if it already left the
                // graveyard).
                ctx.moveCardById(
                    discardingPlayerId,
                    discardedId,
                    "graveyard",
                    "exile"
                );
                ctx.linkExileToSource(discardedId, ctx.sourceInstanceId);
            },
        }),
    ],
    activatedAbilities: [
        // 2. CR 121.6 / 701.8 — "{2}, {T}: Draw a card, then discard a card."
        {
            id: "currency-converter-draw-discard",
            oracleText: "{2}, {T}: Draw a card, then discard a card.",
            cost: { mana: { X: 2 }, tap: true },
            useStack: true,
            // CR 121.6 draw, then CR 701.8 discard — draw → choice → discard,
            // same shape as Jalum Tome (atq/colorless.ts). The interpreter
            // suspends at the `choice` Op, so the draw never re-runs on resume
            // (Bazaar of Baghdad precedent preserved).
            effects: [
                { op: "draw", player: "controller", count: 1 },
                {
                    op: "choice",
                    kind: "choose-hand-card",
                    player: "controller",
                    zone: "hand",
                    count: 1,
                    prompt: "Currency Converter: discard a card.",
                    bind: "$discard",
                },
                {
                    op: "discard",
                    player: "controller",
                    cards: { ref: "$discard" },
                },
            ],
        },
        // 3. CR 111 / 400.7 — "{T}: Put a card exiled with this artifact into its
        //    owner's graveyard. If it's a land card, create a Treasure token. If
        //    it's a nonland card, create a 2/2 black Rogue creature token."
        {
            id: "currency-converter-retrieve",
            oracleText:
                "{T}: Put a card exiled with this artifact into its owner's graveyard. If it's a land card, create a Treasure token. If it's a nonland card, create a 2/2 black Rogue creature token.",
            cost: { tap: true },
            useStack: true,
            // NOT DSL-migratable (ADR 0045): reads `ctx.getCardsExiledWith`
            // (no registered Op) to build the candidate set, then branches the
            // token choice on the CHOSEN card's land/nonland type read out of
            // that closure-local lookup. Blocked on: missing Op. See
            // file-header note above.
            resolve: (ctx: SpellContext) => {
                const linked = ctx.getCardsExiledWith(ctx.sourceInstanceId);
                if (linked.length === 0) return; // nothing exiled with it
                const picks = ctx.requestChoice({
                    playerId: ctx.controller,
                    choiceId: `currency-converter-retrieve-${ctx.sourceInstanceId}`,
                    kind: "choose-exile-card",
                    zone: "exile",
                    zoneOwnerId: ctx.controller,
                    candidateIds: linked.map((c) => c.id),
                    count: 1,
                    prompt: "Currency Converter: put a card exiled with this artifact into its owner's graveyard.",
                });
                if (picks === undefined) return; // suspended for the choice
                const chosenId = picks[0];
                if (chosenId === undefined) return;
                const chosen = linked.find((c) => c.id === chosenId);
                if (chosen === undefined) return;
                // CR 400.7 — the card returns to ITS owner's graveyard.
                ctx.moveCardById(
                    chosen.ownerId,
                    chosenId,
                    "exile",
                    "graveyard"
                );
                // CR 111 — Treasure for a land, a 2/2 black Rogue otherwise.
                if (chosen.types.includes("Land")) {
                    ctx.createToken(TREASURE_TOKEN, ctx.controller, 1);
                } else {
                    ctx.createToken(ROGUE_TOKEN, ctx.controller, 1);
                }
            },
        },
    ],
};
