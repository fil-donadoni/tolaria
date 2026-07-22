// AFR — white cards, split by colour per ADR 0043. The registry's
// `import * as afr from "./sets/afr"` resolves through afr/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
import { PERMANENT_TYPES } from "../../types";
import type { CardDefinition } from "../../types";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";
import { leftTrigger } from "../../abilities/triggers/leftTrigger";

// Portable Hole — O-Ring-style exile-until-leaves (Banishing Light precedent,
// jou/white.ts), scoped to a nonland permanent an opponent controls with mana
// value 2 or less.
//
// TARGETING (CR 603.3d): "exile target nonland permanent an opponent controls
// with mana value 2 or less" is a REAL target chosen when the ETB trigger is
// put on the stack — declared as a `targetRequirement` on the TriggeredAbility
// (issue #1193 machinery, `raiseTriggerTargetSelection` in gre/rules.ts), NOT
// a resolution-time `requestChoice`. That makes it subject to hexproof /
// protection / ward and fires "becomes the target of an ability" triggers,
// which the old choice-as-target workaround silently skipped. The resolve()
// then only reads the announced target (`ctx.targets[0]`) and exiles it.
const portableHoleHoldsSomething = (
    _event: unknown,
    self: { id: string },
    state?: { exileHeld?: ReadonlyArray<{ sourceId: string }> }
): boolean => !!state?.exileHeld?.some((b) => b.sourceId === self.id);

export const portableHole: CardDefinition = {
    id: "80fca8c0-ae3e-439e-b202-228b9f360e9a",
    rarity: "uncommon",
    name: "Portable Hole",
    oracleText:
        "When this artifact enters, exile target nonland permanent an opponent controls with mana value 2 or less until this artifact leaves the battlefield.",
    manaCost: { W: 1 },
    types: ["Artifact"],
    triggeredAbilities: [
        enteredTrigger({
            id: "portable-hole-exile",
            oracleText:
                "When this artifact enters, exile target nonland permanent an opponent controls with mana value 2 or less until this artifact leaves the battlefield.",
            scope: "self",
            // CR 603.3d — "exile target nonland permanent an opponent controls
            // with mana value 2 or less": a real target chosen when the trigger
            // is put on the stack (not a resolution-time choice), so it is
            // subject to hexproof / protection / ward and fires "becomes the
            // target" triggers. `type: PERMANENT_TYPES minus Land` = "nonland
            // permanent"; `controller: "opponent"` = "an opponent controls";
            // `mvFilter: { max: 2 }` = "mana value 2 or less"; `count: 1` = the
            // single mandatory target.
            targetRequirement: {
                type: [...PERMANENT_TYPES],
                count: 1,
                excludeTypes: "Land",
                controller: "opponent",
                mvFilter: { max: 2 },
            },
            // CR 701.18 — host-only exile (ADR 0028 arms the return keyed to
            // `$source`); the `exileWithAttachments` Op reads the announced
            // target and defaults `includeAttachments`/`returnTapped` to false
            // — the host-only O-Ring shape (ADR 0045 DSL-first).
            effects: [{ op: "exileWithAttachments", target: { target: 0 } }],
        }),
        leftTrigger({
            id: "portable-hole-return",
            oracleText:
                "When this artifact leaves the battlefield, return the exiled card to the battlefield under its owner's control.",
            scope: "self",
            condition: portableHoleHoldsSomething,
            effects: [{ op: "returnExiledForSource" }],
        }),
    ],
};
