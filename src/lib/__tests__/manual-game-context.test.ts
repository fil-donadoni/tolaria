// Issue #2346 — `makeManualGameContext` is the seam Manual Mode already owns
// for handing the board's presentational subtree a well-formed `GameContext`
// (ADR 0080, issue #2169). This pins the one field added for #2346: an
// explicit `isManualGame` discriminator, so downstream readers (the card
// preview builder) never have to sniff "the definition failed to resolve" to
// tell a Manual Game from a GRE one.
import { describe, it, expect } from "vitest";
import { makeManualGameContext } from "~/lib/manual-game-context";
import type { Id } from "@convex/_generated/dataModel";

describe("makeManualGameContext — isManualGame discriminator (issue #2346)", () => {
    it("always flags the returned context as a Manual Game", () => {
        const ctx = makeManualGameContext({
            gameId: "g1" as Id<"games">,
            viewerId: "p1",
            state: { players: [], stack: [], turn: 1, activePlayerId: "p1" },
            allPlayers: [],
            onSwitchGame: () => {},
        });

        expect(ctx.isManualGame).toBe(true);
    });
});

describe("stack in the manual context (issue #2351)", () => {
    it("carries the projected stack so the landscape strip can draw it", () => {
        const ctx = makeManualGameContext({
            gameId: "g1" as Id<"games">,
            viewerId: "p1",
            state: {
                players: [],
                stack: [
                    {
                        id: "s1",
                        card: { id: "x" },
                        zone: "stack",
                        controllerId: "p2",
                        ownerId: "p2",
                        isTapped: false,
                    },
                ],
                turn: 1,
                activePlayerId: "p1",
            },
            allPlayers: [],
            onSwitchGame: () => {},
        });
        expect(ctx.stackCount).toBe(1);
        expect(ctx.stackItems[0].castById).toBe("p2");
    });
});
