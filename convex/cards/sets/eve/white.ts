// eve — white cards (ADR 0043 colour split).

import type { CardDefinition, SpellContext } from "../../types";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";

const FLICKERWISP_ID = "5bb3cb5c-8d66-4f5e-a9a9-917e6045f024";

// Flickerwisp — {1}{W}{W} Creature — Elemental, 3/1, flying (Vintage Cube
// FREE: ETB/dies/attack triggers, issue #679). "When this creature enters,
// exile another target permanent. Return that card to the battlefield under
// its owner's control at the beginning of the next end step."
//
// PROTOCOL (flicker idiom — no Op skin): the DSL `moveZone` Op can reanimate
// a GRAVEYARD card onto the battlefield but has no branch for an EXILE-zone
// object (`resolveObjectRef` is battlefield-scoped once a card is exiled, so
// a captured object ref cannot be read back by a later Op — issue #679
// audit). The ETB composes shipped SpellContext primitives directly,
// mirroring the delayed-reanimation idiom already shipped for Krovikan
// Vampire / Seraph (ice/white.ts): `exile` the chosen permanent, capture its
// owner, and `scheduleDelayedTrigger` a "next-end-step" template that calls
// `returnToBattlefield(owner, id, "exile")` (CR 603.7a).
export const flickerwisp: CardDefinition = {
    id: FLICKERWISP_ID,
    name: "Flickerwisp",
    rarity: "uncommon",
    oracleText:
        "Flying\nWhen this creature enters, exile another target permanent. Return that card to the battlefield under its owner's control at the beginning of the next end step.",
    manaCost: { X: 1, W: 2 },
    types: ["Creature"],
    subtypes: ["Elemental"],
    power: 3,
    toughness: 1,
    staticAbilities: ["flying"],
    triggeredAbilities: [
        enteredTrigger({
            id: "flickerwisp-etb",
            oracleText:
                "When this creature enters, exile another target permanent. Return that card to the battlefield under its owner's control at the beginning of the next end step.",
            scope: "self",
            resolve: (ctx: SpellContext) => {
                const candidateIds = ctx.allPlayerIds
                    .flatMap((p) => ctx.getBattlefieldIds(p))
                    .filter((id) => id !== ctx.sourceInstanceId);
                if (candidateIds.length === 0) return; // CR 608.2b — no legal target
                const picks = ctx.requestChoice({
                    playerId: ctx.controller,
                    choiceId: `flickerwisp-etb-${ctx.sourceInstanceId}`,
                    kind: "choose-permanents",
                    zone: "battlefield",
                    allControllers: true,
                    candidateIds,
                    count: { min: 0, max: 1 },
                    prompt: "Flickerwisp: exile another target permanent.",
                });
                if (picks === undefined) return; // suspended for the choice
                const targetId = picks[0];
                if (!targetId) return;
                const ownerId = ctx.getOwnerId(targetId);
                if (ownerId === undefined) return; // CR 608.2b — target left
                ctx.exile({ type: "permanent", id: targetId });
                ctx.scheduleDelayedTrigger(
                    FLICKERWISP_ID,
                    "flickerwisp-return",
                    "next-end-step",
                    { cardId: targetId, ownerId }
                );
            },
        }),
    ],
    delayedTriggers: [
        {
            id: "flickerwisp-return",
            oracleText:
                "Return that card to the battlefield under its owner's control at the beginning of the next end step.",
            timing: "next-end-step",
            resolve: (ctx, payload) => {
                if (!payload.cardId || !payload.ownerId) return;
                ctx.returnToBattlefield(
                    payload.ownerId,
                    payload.cardId,
                    "exile"
                );
            },
        },
    ],
};
