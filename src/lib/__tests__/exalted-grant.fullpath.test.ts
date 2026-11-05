// Granted exalted end to end (CR 702.83a): the GRE puts the recipient's trigger on
// the stack, it crosses the projection, and the client's own stack-row reader finds
// its text on the granting card's template, which a compiled card's client also holds.
import { describe, expect, it } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "@convex/cards/__tests__/setup.helper";
import { getCardByName } from "@convex/cards";
import { withTemporaryDefinition } from "@convex/cards/registry";
import type { CardDefinition } from "@convex/cards/types";
import { projectPublicState } from "@convex/gameProjections";
import { markAttacking } from "@convex/gre/combat";
import { emitAttackersDeclaredEvents } from "@convex/gre/phases";
import { beginApplyingStaticEffects } from "@convex/gre/state";
import { getStackAbilityOracleText } from "../card-utils";

const GRANTER: CardDefinition = {
    id: "exalted-grant-fullpath-granter",
    name: "Exalted Grant Full Path",
    rarity: "common",
    manaCost: { W: 1 },
    types: ["Enchantment"],
    staticEffects: [
        {
            kind: "keyword-grant",
            applies: (target, source) =>
                target.controllerId === source.controllerId &&
                target.id !== source.id,
            keyword: "exalted",
        },
    ],
};

describe("granted exalted: GRE → wire → stack row (CR 702.83a)", () => {
    it("the recipient's trigger reads its rules text on the client", () => {
        withTemporaryDefinition(GRANTER, () => {
            const granter = makeInstance(GRANTER.id, {
                id: "g",
                controllerId: "p1",
                ownerId: "p1",
            });
            const bears = makeInstance(getCardByName("Grizzly Bears").id, {
                id: "b",
                controllerId: "p1",
                ownerId: "p1",
            });
            const state = makeState({
                activePlayerId: "p1",
                priorityPlayerId: "p1",
                phase: "DECLARE_ATTACKERS",
                players: [
                    makePlayer("p1", { battlefield: [granter, bears] }),
                    makePlayer("p2"),
                ],
            });
            beginApplyingStaticEffects(state, granter);
            state.combat = {
                attackerIds: [bears.id],
                confirmed: true,
                blockerAssignments: {},
                blockersConfirmed: false,
            };
            markAttacking(state, bears);
            emitAttackersDeclaredEvents(state);

            const wire = projectPublicState(state, 1, "p1");
            expect(wire.stack).toHaveLength(1);
            expect(
                getStackAbilityOracleText(
                    wire.stack[0] as Parameters<
                        typeof getStackAbilityOracleText
                    >[0]
                )
            ).toMatch(/attacks alone/);
        });
    });
});
