// isd — blue cards (ADR 0043 colour split).
import type { CardDefinition, SpellContext } from "../../types";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";

// Snapcaster Mage — {1}{U} 2/1 Human Wizard with Flash. "When this creature
// enters, target instant or sorcery card in your graveyard gains flashback
// until end of turn. The flashback cost is equal to its mana cost." (CR 702.34
// — the granted card becomes castable from the graveyard for its own mana cost,
// then exiled.) The grant is an instance-level flashback (`grantedFlashback`),
// stamped by `SpellContext.grantFlashback` and expiring at cleanup (CR 514.2).
export const snapcasterMage: CardDefinition = {
    id: "9e5b279e-4670-4a1e-87d0-3cab7e4f9e58",
    rarity: "rare",
    name: "Snapcaster Mage",
    oracleText:
        "Flash\nWhen this creature enters, target instant or sorcery card in your graveyard gains flashback until end of turn. The flashback cost is equal to its mana cost. (You may cast that card from your graveyard for its flashback cost. Then exile it.)",
    manaCost: { X: 1, U: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Wizard"],
    power: 2,
    toughness: 1,
    staticAbilities: ["flash"],
    triggeredAbilities: [
        enteredTrigger({
            id: "snapcaster-mage-etb-flashback",
            oracleText:
                "When this creature enters, target instant or sorcery card in your graveyard gains flashback until end of turn. The flashback cost is equal to its mana cost.",
            scope: "self",
            // protocol clause: grants the flashback KEYWORD-CAST permission to a
            // card in a graveyard until end of turn (CR 702.34) — a keyword grant
            // to a NON-battlefield card, which the battlefield-oriented layer
            // system (`grantAbility` Op) cannot express, so there is no Op for
            // it (invented Op forbidden). The "target instant/sorcery in your
            // graveyard" pick uses the engine's established triggered-choice
            // convention (`requestChoice` / `choose-graveyard-card`, as in
            // Regrowth-style triggers), not an announcement-time target.
            resolve: (ctx: SpellContext) => {
                const candidates = ctx
                    .getGraveyardCards(ctx.controller)
                    .filter(
                        (c) =>
                            c.types.includes("Instant") ||
                            c.types.includes("Sorcery")
                    )
                    .map((c) => c.id);
                // CR 603.3c — no legal instant/sorcery card: the ability does
                // nothing (no card to give flashback to).
                if (candidates.length === 0) return;
                const picks = ctx.requestChoice({
                    playerId: ctx.controller,
                    choiceId: `snapcaster-flashback-${ctx.sourceInstanceId}`,
                    kind: "choose-graveyard-card",
                    zone: "graveyard",
                    filter: { types: ["Instant", "Sorcery"] },
                    candidateIds: candidates,
                    count: 1,
                    prompt: "Give an instant or sorcery card in your graveyard flashback until end of turn (its flashback cost equals its mana cost).",
                });
                if (picks === undefined) return; // suspended on the choice
                const id = picks[0];
                if (!id) return;
                // CR 702.34 — grant flashback with cost = the card's mana cost
                // (grantFlashback defaults to the card's own printed cost).
                ctx.grantFlashback({
                    type: "graveyard-card",
                    id,
                    playerId: ctx.controller,
                });
            },
        }),
    ],
};
