// eve — white cards (ADR 0043 colour split).

import { PERMANENT_TYPES } from "../../types";
import type { CardDefinition, SpellContext } from "../../types";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";

const FLICKERWISP_ID = "5bb3cb5c-8d66-4f5e-a9a9-917e6045f024";

// Flickerwisp — {1}{W}{W} Creature — Elemental, 3/1, flying (Vintage Cube
// FREE: ETB/dies/attack triggers, issue #679). "When this creature enters,
// exile another target permanent. Return that card to the battlefield under
// its owner's control at the beginning of the next end step."
//
// TARGETING (CR 603.3d): "exile another target permanent" is a REAL target
// chosen when the ETB trigger is put on the stack — declared as a
// `targetRequirement` on the TriggeredAbility (issue #1193 machinery,
// `raiseTriggerTargetSelection` in gre/rules.ts), NOT a resolution-time
// `requestChoice`. That makes it subject to hexproof / protection / ward and
// fires "becomes the target of an ability" triggers, which the old
// choice-as-target workaround silently skipped. `type: PERMANENT_TYPES` =
// "permanent" (any permanent type); `excludeSource` drops Flickerwisp itself
// ("another"); `count: 1` = mandatory single target.
//
// The DSL `moveZone` Op can reanimate a GRAVEYARD card onto the battlefield
// but has no branch for an EXILE-zone object (`resolveObjectRef` is
// battlefield-scoped once a card is exiled, so a captured object ref cannot be
// read back by a later Op — issue #679 audit), so the return leg stays an
// imperative resolve. The resolve() then only composes the flicker, mirroring
// the delayed-reanimation idiom already shipped for Krovikan Vampire / Seraph
// (ice/white.ts): `exile` the announced target, capture its owner, and
// `scheduleDelayedTrigger` a "next-end-step" template that calls
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
            // CR 603.3d — "another target permanent": a real target chosen when
            // the trigger is put on the stack (not a resolution-time choice),
            // so it is subject to hexproof / protection / ward and fires
            // "becomes the target" triggers. `type: PERMANENT_TYPES` = any
            // permanent; `excludeSource` drops Flickerwisp itself ("another");
            // `count: 1` = mandatory single target.
            targetRequirement: {
                type: [...PERMANENT_TYPES],
                count: 1,
                excludeSource: true,
            },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (!target) return; // CR 608.2b — no legal target / target left
                const targetId = target.id;
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
