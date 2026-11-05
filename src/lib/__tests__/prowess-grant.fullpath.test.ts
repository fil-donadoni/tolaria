// Granted prowess end to end (CR 702.108a): the GRE puts the recipient's trigger on
// the stack, it crosses the projection, and the client's own stack-row reader finds
// its text on the granting card's template, which a compiled card's client also holds.
import { describe, expect, it } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "@convex/cards/__tests__/setup.helper";
import { getCardByName } from "@convex/cards";
import { withTemporaryDefinition } from "@convex/cards/registry";
import type { CardDefinition } from "@convex/cards/types";
import { projectPublicState } from "@convex/gameProjections";
import {
    beginApplyingStaticEffects,
    emitSpellCastEvent,
    processPendingActionTriggers,
} from "@convex/gre/state";
import { getStackAbilityOracleText } from "../card-utils";

const GRANTER: CardDefinition = {
    id: "prowess-grant-fullpath-granter",
    name: "Prowess Grant Full Path",
    rarity: "common",
    manaCost: { U: 1 },
    types: ["Enchantment"],
    staticEffects: [
        {
            kind: "keyword-grant",
            applies: (target, source) =>
                target.controllerId === source.controllerId &&
                target.id !== source.id,
            keyword: "prowess",
        },
    ],
};

describe("granted prowess: GRE → wire → stack row (CR 702.108a)", () => {
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
                players: [
                    makePlayer("p1", { battlefield: [granter, bears] }),
                    makePlayer("p2"),
                ],
            });
            beginApplyingStaticEffects(state, granter);
            emitSpellCastEvent(
                state,
                pushSpell(state, getCardByName("Dark Ritual").id, "p1")
            );
            processPendingActionTriggers(state);

            const wire = projectPublicState(state, 1, "p1");
            const trigger = wire.stack.find(
                (item) => item.triggeredAbilityId === "prowess-granted"
            );
            expect(trigger).toBeDefined();
            expect(
                getStackAbilityOracleText(
                    trigger as Parameters<typeof getStackAbilityOracleText>[0]
                )
            ).toMatch(/noncreature spell/);
        });
    });
});
