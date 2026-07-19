// BRO (The Brothers' War) — white cards, split by colour per ADR 0043. The
// registry's `import * as bro from "./sets/bro"` resolves through bro/index.ts.
// Modern Scryfall oracle text is authoritative (ADR 0004).

import type { CardDefinition, SpellContext } from "../../types";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";

// Loran of the Third Path — {2}{W} Legendary Creature 2/1 with vigilance.
// "When Loran enters, destroy up to one target artifact or enchantment.
//  {T}: You and target opponent each draw a card."
// CR 603.6a ETB triggered ability whose "up to one target artifact or
// enchantment" is a REAL target chosen when the trigger is put on the stack
// (CR 603.3d, issue #1193) — declared as a `targetRequirement` on the
// TriggeredAbility and locked by `raiseTriggerTargetSelection` (gre/rules.ts),
// NOT a resolution-time `requestChoice`. That makes it subject to hexproof /
// protection / ward and fires "becomes the target of an ability" triggers,
// which the old choice-as-target workaround silently skipped. The {T} ability
// draws for the controller and the chosen opponent (CR 605 activated ability,
// CR 121.1 draw).
export const loranOfTheThirdPath: CardDefinition = {
    id: "59faa45d-868b-4bc7-934c-0e077642e129",
    rarity: "rare",
    name: "Loran of the Third Path",
    oracleText:
        "Vigilance\nWhen Loran enters, destroy up to one target artifact or enchantment.\n{T}: You and target opponent each draw a card.",
    manaCost: { X: 2, W: 1 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Human", "Artificer"],
    power: 2,
    toughness: 1,
    staticAbilities: ["vigilance"],
    triggeredAbilities: [
        enteredTrigger({
            id: "loran-etb-destroy",
            oracleText:
                "When Loran enters, destroy up to one target artifact or enchantment.",
            scope: "self",
            // CR 603.3d — "up to one target artifact or enchantment": a real
            // target chosen when the trigger is put on the stack (not a
            // resolution-time choice), so it is subject to hexproof /
            // protection / ward and fires "becomes the target" triggers.
            // `type: ["Artifact","Enchantment"]` is the OR type filter; any
            // controller's permanent is eligible (no controller restriction in
            // the text); `count 0..1` = "up to one".
            targetRequirement: {
                type: ["Artifact", "Enchantment"],
                count: { min: 0, max: 1 },
            },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (!target) return; // "up to one": none chosen / CR 608.2b none legal
                ctx.destroy({ type: "permanent", id: target.id });
            },
        }),
    ],
    activatedAbilities: [
        {
            id: "loran-draw",
            oracleText: "{T}: You and target opponent each draw a card.",
            cost: { tap: true },
            useStack: true,
            targetRequirement: {
                type: "player",
                count: 1,
                controller: "opponent",
            },
            // CR 605 activated ability, CR 121.1 draw. Two `draw` Ops: the
            // controller and the announced opponent slot each draw one. A
            // non-player slot resolves to undefined and its Op skips
            // (CR 608.2b) — mirrors the old `t?.type === "player"` guard.
            effects: [
                { op: "draw", player: "controller", count: 1 },
                { op: "draw", player: { target: 0 }, count: 1 },
            ],
        },
    ],
};
