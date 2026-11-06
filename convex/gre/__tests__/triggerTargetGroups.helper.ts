// CR 603.3d (issue #8475) — fixture shared by the GRE, Bot and full-path suites:
// a card whose ETB trigger announces independent target groups, its effect
// reading them positionally ({ target: 0 }, { target: 1 }).
import type { CardDefinition, TargetRequirement } from "../../cards/types";
import { enteredTrigger } from "../../cards/abilities/triggers/enteredTrigger";
import { grizzlyBears } from "../../cards/sets/lea/green.cards";
import type { StackItem } from "../state";

export const GROUPS_CARD_ID = "test-trigger-target-groups";
export const GROUPS_ABILITY_ID = "test-trigger-target-groups-etb";

/** "Target opponent". */
export const OPPONENT_GROUP: TargetRequirement = {
    type: "player",
    count: 1,
    controller: "opponent",
};

/** "Up to one target creature". */
export const UP_TO_ONE_CREATURE: TargetRequirement = {
    type: "Creature",
    count: { min: 0, max: 1 },
};

export function groupsCard(
    primary: TargetRequirement,
    additional: TargetRequirement[]
): CardDefinition {
    return {
        ...grizzlyBears(),
        id: GROUPS_CARD_ID,
        triggeredAbilities: [
            enteredTrigger({
                id: GROUPS_ABILITY_ID,
                oracleText:
                    "When this creature enters, it deals 1 damage to the first target. Destroy the second target.",
                scope: "self",
                targetRequirement: primary,
                additionalTargetRequirements: additional,
                effects: [
                    { op: "dealDamage", amount: 1, to: { target: 0 } },
                    { op: "destroy", target: { target: 1 } },
                ],
            }),
        ],
    };
}

/** The trigger as `collectTriggers`/`buildTriggerItem` builds it: un-announced,
 *  with no `targets` yet. */
export function groupsTrigger(id = "t1", controllerId = "p1"): StackItem {
    return {
        id,
        card: { id: GROUPS_CARD_ID },
        controllerId,
        ownerId: controllerId,
        castById: controllerId,
        zone: "stack",
        types: [],
        subtypes: [],
        staticAbilities: [],
        isTapped: false,
        triggeredAbilityId: GROUPS_ABILITY_ID,
        triggerSourceId: "source",
        triggerEvent: {
            type: "PERMANENT_ENTERED",
            instanceId: "source",
            controllerId,
            types: ["Creature"],
        } as StackItem["triggerEvent"],
    } as StackItem;
}
