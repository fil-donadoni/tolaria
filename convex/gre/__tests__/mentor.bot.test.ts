// CR 702.134a — the Bot's seam on Mentor: the target prompt is a search decision
// whose candidates are the legal targets only, through the one filter authority.
import { describe, expect, it } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { withTemporaryDefinition } from "../../cards/registry";
import type { CardDefinition } from "../../cards/types";
import { enumerateRaisedTargetMoves } from "../moves";
import { raiseTriggerTargetSelection } from "../rules";
import { collectTriggers, placeTriggersOnStack } from "../triggers";

const creature = (
    id: string,
    power: number,
    staticAbilities: string[] = []
): CardDefinition => ({
    id,
    name: `Mentor Bot ${id}`,
    rarity: "common",
    manaCost: { X: 1 },
    types: ["Creature"],
    power,
    toughness: 5,
    staticAbilities,
});

const MENTOR = creature("mentor-bot-source", 3, ["mentor"]);
const SMALL = creature("mentor-bot-small", 2);
const SMALLER = creature("mentor-bot-smaller", 1);
const EQUAL = creature("mentor-bot-equal", 3);

describe("Mentor (CR 702.134a), Bot target surface", () => {
    it("enumerates the attacking creatures with lesser power, and no other", () => {
        withTemporaryDefinition(MENTOR, () =>
            withTemporaryDefinition(SMALL, () =>
                withTemporaryDefinition(SMALLER, () =>
                    withTemporaryDefinition(EQUAL, () => {
                        const attackers = [
                            [MENTOR, "src"],
                            [SMALL, "small"],
                            [SMALLER, "smaller"],
                            [EQUAL, "equal"],
                        ].map(([def, id]) =>
                            makeInstance((def as CardDefinition).id, {
                                id: id as string,
                                controllerId: "p1",
                                ownerId: "p1",
                                zone: "battlefield",
                                isAttacking: true,
                            })
                        );
                        const state = makeState({
                            players: [
                                makePlayer("p1", { battlefield: attackers }),
                                makePlayer("p2"),
                            ],
                            phase: "DECLARE_ATTACKERS",
                            activePlayerId: "p1",
                            priorityPlayerId: "p1",
                            combat: {
                                attackerIds: attackers.map((a) => a.id),
                                confirmed: true,
                                blockerAssignments: {},
                                blockersConfirmed: false,
                            },
                        });
                        placeTriggersOnStack(
                            state,
                            collectTriggers(state, [
                                {
                                    type: "ATTACKERS_DECLARED",
                                    attackingPlayerId: "p1",
                                    attackerIds: attackers.map((a) => a.id),
                                },
                            ])
                        );
                        expect(raiseTriggerTargetSelection(state)).toBe(true);
                        const targets = enumerateRaisedTargetMoves(
                            state,
                            "p1"
                        ).flatMap((m) =>
                            m.kind === "submit-target"
                                ? m.targets.map((t) => t.id)
                                : []
                        );
                        expect(targets.sort()).toEqual(["small", "smaller"]);
                    })
                )
            )
        );
    });
});
