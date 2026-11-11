// FRA — colorless cards, split by colour per ADR 0043. The registry's
// `import * as fra from "./sets/fra/index.cards"` re-exports this module.
// Cards are classified by the colour identity of their mana cost:
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import { defineCard } from "../../types";
import type { ManaCost, PermanentView, TriggerStateView } from "../../types";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";

/** Forests `controllerId` controls on the battlefield, other than
 *  `exceptInstanceId` (the Forest that just entered). Reads the trigger state
 *  view, which carries each permanent's subtypes (CR 205.3i). */
function otherForestsControlled(
    state: TriggerStateView | undefined,
    controllerId: string,
    exceptInstanceId: string
): number {
    if (!state) return 0;
    let count = 0;
    for (const player of state.players)
        for (const card of player.battlefield)
            if (
                card.controllerId === controllerId &&
                card.id !== exceptInstanceId &&
                card.subtypes.includes("Forest")
            )
                count++;
    return count;
}

/** Is the entering permanent a Forest controlled by the source's controller
 *  (CR 603.6a, 109.2)? The event payload carries no subtypes, so it is read
 *  off the battlefield view. */
function enteredForestYouControl(
    state: TriggerStateView | undefined,
    self: PermanentView,
    instanceId: string
): boolean {
    if (!state) return false;
    for (const player of state.players)
        for (const card of player.battlefield)
            if (card.id === instanceId)
                return (
                    card.controllerId === self.controllerId &&
                    card.subtypes.includes("Forest")
                );
    return false;
}

// Roiling Canopy — Land (FRA, issue #8843, modern-metagame). "This land enters
// tapped. Whenever a Forest you control enters, if you control at least five
// other Forests, target creature you control gets +3/+3 until end of turn.
// {T}: Add {G}."
// One Oracle line = one trigger (CR 603.2). The "if" is an intervening-if
// (CR 603.4): checked when the Forest enters AND again on resolution, counting
// Forests other than the one that entered.
// hand-tail: Whenever a Forest you control enters, if you control at least five other Forests, target creature you control gets +3/+3 until end of turn. (#8843)
export const roilingCanopy = defineCard(() => ({
    id: "db61361b-bd12-453e-abc2-bbe09b66e3d9",
    name: "Roiling Canopy",
    rarity: "rare",
    oracleText:
        "This land enters tapped.\nWhenever a Forest you control enters, if you control at least five other Forests, target creature you control gets +3/+3 until end of turn.\n{T}: Add {G}.",
    manaCost: { X: 0 },
    types: ["Land"],
    entersTapped: true,
    activatedAbilities: [
        {
            id: "roiling-canopy-mana",
            oracleText: "{T}: Add {G}.",
            cost: { tap: true },
            useStack: false,
            manaProduced: { G: 1 } as ManaCost,
        },
    ],
    triggeredAbilities: [
        enteredTrigger({
            id: "roiling-canopy-forest-pump",
            oracleText:
                "Whenever a Forest you control enters, if you control at least five other Forests, target creature you control gets +3/+3 until end of turn.",
            scope: "yours",
            // CR 603.4: the trigger only goes on the stack if the "if" holds, so
            // the count gates `matches` too; `interveningIf` is the re-check on
            // resolution.
            condition: (event, self, state) =>
                enteredForestYouControl(state, self, event.instanceId) &&
                otherForestsControlled(
                    state,
                    self.controllerId,
                    event.instanceId
                ) >= 5,
            interveningIf: (event, self, state) =>
                otherForestsControlled(
                    state,
                    self.controllerId,
                    event.instanceId
                ) >= 5,
            targetRequirement: {
                type: "Creature",
                count: 1,
                controller: "you",
            },
            effects: [
                {
                    op: "pump",
                    target: { target: 0 },
                    power: 3,
                    toughness: 3,
                    duration: { phase: "end-of-turn" },
                },
            ],
        }),
    ],
}));
