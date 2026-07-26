// eve — white cards (ADR 0043 colour split).

import { PERMANENT_TYPES } from "../../types";
import type { CardDefinition } from "../../types";
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
// Migrated to the DSL "blink" idiom (issue #1401 / #1403): `exile` the
// announced target with a `bind`, then a `delayedTrigger` captures that
// bound ref and the delayed body's `moveZone` resolves it back via
// `resolveObjectRef`'s exile-zone fallback, returning the card under its
// OWNER's control by default (no explicit `controller` — matches "under its
// owner's control"). `from: "exile"` pins the #1469 RETURN-A-DEPARTED-OBJECT
// recovery path explicitly.
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
            effects: [
                { op: "exile", target: { target: 0 }, bind: "$c" },
                {
                    op: "delayedTrigger",
                    timing: "next-end-step",
                    oracleText:
                        "Return that card to the battlefield under its owner's control at the beginning of the next end step.",
                    capture: { $c: { ref: "$c" } },
                    effects: [
                        {
                            op: "moveZone",
                            target: { ref: "$c" },
                            from: "exile",
                            to: "battlefield",
                        },
                    ],
                },
            ],
        }),
    ],
};
