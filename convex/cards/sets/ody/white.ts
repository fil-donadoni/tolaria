// ody — white cards (ADR 0043 colour split).

import { PERMANENT_TYPES } from "../../types";
import type { CardDefinition, SpellContext } from "../../types";
import {
    causedByOpponent,
    leftTrigger,
} from "../../abilities/triggers/leftTrigger";

// Karmic Justice — {2}{W} Enchantment (Odyssey #26, rare).
// "Whenever a spell or ability an opponent controls destroys a noncreature
//  permanent you control, you may destroy target permanent that opponent
//  controls."
//
// CR 603.10 leave-the-battlefield trigger keyed on the "destroyed" cause
// (issue #1054): `leftTrigger`'s `condition` gates on `event.cause ===
// "destroy"` (never a sacrifice / bounce / mill) AND `causedByOpponent`
// (`event.causerControllerId` set to a player other than this permanent's
// controller — never the controller's own destroy effect). `scope: "yours"`
// plus the `excludeTypes: "Creature"` filter cover "a noncreature permanent
// you control".
//
// TARGETING (CR 603.3d, issue #1193): "target permanent that opponent
// controls" is a REAL target chosen when the trigger is put on the stack —
// declared as a `targetRequirement` on the TriggeredAbility
// (`raiseTriggerTargetSelection` in gre/rules.ts), NOT a resolution-time
// `requestChoice`. That makes the pick subject to hexproof / protection / ward
// and fires "becomes the target of an ability" triggers, which the old
// choice-as-target workaround silently skipped. `type: [...PERMANENT_TYPES]`
// with no supertype/subtype filter = "permanent" (any type); `controller:
// "opponent"` restricts to permanents the chooser's opponent controls (2-player
// engine — the single opponent is the same one whose effect did the destroying);
// `count 0..1` = "you may ... target" (up to one, decline-able). The resolve()
// then only reads the announced target and destroys it (`leftTrigger` still
// requires a `resolve`/`effects`; the destroy leg stays a one-line resolve).
const karmicJusticeTrigger = leftTrigger({
    id: "karmic-justice-destroy",
    oracleText:
        "Whenever a spell or ability an opponent controls destroys a noncreature permanent you control, you may destroy target permanent that opponent controls.",
    scope: "yours",
    filter: { excludeTypes: "Creature" },
    condition: (event, self) =>
        event.cause === "destroy" && causedByOpponent(event, self),
    resolve: (ctx: SpellContext) => {
        // CR 603.3d — the target was locked when this trigger went on the
        // stack. "You may": no pick (declined) / CR 608.2b (target gone or
        // never legal) both surface as an empty target set.
        const target = ctx.targets[0];
        if (!target) return;
        ctx.destroy({ type: "permanent", id: target.id });
    },
});

export const karmicJustice: CardDefinition = {
    id: "c2ffb8e7-7ae3-4846-b3da-ca6b4598eb7c",
    rarity: "rare",
    name: "Karmic Justice",
    oracleText:
        "Whenever a spell or ability an opponent controls destroys a noncreature permanent you control, you may destroy target permanent that opponent controls.",
    manaCost: { X: 2, W: 1 },
    types: ["Enchantment"],
    triggeredAbilities: [
        {
            ...karmicJusticeTrigger,
            // CR 603.3d — "target permanent that opponent controls" chosen at
            // stack placement. `count 0..1` = "you may" (up to one).
            targetRequirement: {
                type: [...PERMANENT_TYPES],
                count: { min: 0, max: 1 },
                controller: "opponent",
            },
        },
    ],
};
