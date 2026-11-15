// A player's keyword until end of turn end to end (CR 611.2a / 702.11d): the
// `grantPlayerKeyword` Op resolves in the GRE, the keyword crosses the public
// projection on the player, the client's nameplate predicate greys the player
// for an opponent's blue spell, and the server's accepted set refuses the
// same pick.
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
import { applyOneTargetSelection } from "@convex/game";
import { projectPublicState } from "@convex/gameProjections";
import { resolveTopOfStack, type PendingTarget } from "@convex/gre/state";
import type { Player, StackItem } from "~/types/game";
import { isLegalPlayerTarget } from "../target-candidates";

const GRANT: CardDefinition = {
    id: "player-keyword-fullpath-grant",
    name: "Player Keyword Full Path",
    rarity: "common",
    manaCost: { G: 1 },
    types: ["Instant"],
    effects: [
        {
            op: "grantPlayerKeyword",
            player: "controller",
            keyword: "hexproof from blue",
        },
    ],
};

describe("player hexproof from blue: GRE → wire → nameplate gate (CR 702.11d)", () => {
    it("an opponent's blue spell cannot pick the player on either side", () => {
        withTemporaryDefinition(GRANT, () => {
            const recall = makeInstance(getCardByName("Ancestral Recall").id, {
                id: "recall",
                controllerId: "p2",
                ownerId: "p2",
                zone: "hand",
            });
            const state = makeState({
                activePlayerId: "p1",
                priorityPlayerId: "p1",
                players: [
                    makePlayer("p1"),
                    makePlayer("p2", { hand: [recall] }),
                ],
            });
            pushSpell(state, GRANT.id, "p1");
            resolveTopOfStack(state);

            const pendingTarget: PendingTarget = {
                playerId: "p2",
                cardInstanceId: recall.id,
                kind: "cast",
                targetType: "player",
                count: 1,
                selected: [],
            };
            state.pendingTarget = pendingTarget;
            const wire = projectPublicState(state, 1, "p2");
            const players = wire.players as unknown as Player[];
            const env = {
                viewerId: "p2",
                activePlayerId: "p1",
                allPlayers: players,
                stackItems: wire.stack as unknown as StackItem[],
            };
            const byId = (id: string) => players.find((p) => p.id === id)!;
            expect(isLegalPlayerTarget(byId("p1"), pendingTarget, env)).toBe(
                false
            );
            expect(isLegalPlayerTarget(byId("p2"), pendingTarget, env)).toBe(
                true
            );
            expect(() =>
                applyOneTargetSelection(state, "p2", {
                    targetType: "player",
                    targetId: "p1",
                })
            ).toThrow("Target can't be the target of spells or abilities");
        });
    });
});
