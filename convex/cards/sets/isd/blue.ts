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
            // CR 603.3d — "target instant or sorcery card in your graveyard" is a
            // REAL target chosen when the ETB trigger is put on the stack (not a
            // resolution-time `requestChoice`), declared as a `targetRequirement`
            // on the TriggeredAbility (issue #1193 machinery,
            // `raiseTriggerTargetSelection` in gre/rules.ts). `zone: "graveyard"`
            // + `controller: "you"` filters to instant/sorcery cards in the
            // controller's own graveyard (CR 400.7); `count: 1` is the single
            // mandatory target (auto-selected when only one is legal, CR 603.3c
            // no-op when none).
            targetRequirement: {
                type: ["Instant", "Sorcery"],
                count: 1,
                zone: "graveyard",
                controller: "you",
            },
            // The resolve only grants flashback: the flashback KEYWORD-CAST
            // permission (CR 702.34) is stamped on a NON-battlefield card until
            // end of turn — a keyword grant the battlefield-oriented layer system
            // (`grantAbility` Op) cannot express, so this stays imperative
            // (no Op exists; inventing one is forbidden).
            resolve: (ctx: SpellContext) => {
                // CR 603.3d — the announced target is a graveyard-card slot; the
                // engine already locked it as the trigger went on the stack.
                const target = ctx.targets[0];
                if (!target || target.type !== "graveyard-card") return;
                // CR 702.34 — grant flashback with cost = the card's mana cost
                // (grantFlashback defaults to the card's own printed cost).
                ctx.grantFlashback({
                    type: "graveyard-card",
                    id: target.id,
                    playerId: target.playerId ?? ctx.controller,
                });
            },
        }),
    ],
};
