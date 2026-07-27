// Limited Event challenge — pure validation + viewer-scoped projection (issue
// #1577). Drives the EXACT exported functions `convex/game.ts`'s
// `challengeLimitedSeat`/`joinGame` and `convex/limitedEvents.ts`'s event
// projection call, in the same order — the project has no convex-test harness
// (see `convex/__tests__/limitedDeckbuild.test.ts`).
import { describe, it, expect } from "vitest";
import {
    assertChallengeableSeat,
    assertSameEventDeck,
    projectViewerChallenges,
    type ChallengeGame,
} from "../challenge";
import type { SeatLookup } from "../poolResolution";

const seats: SeatLookup[] = [
    { seatIndex: 0, userId: "alice", nickname: "Alice", isBot: false },
    { seatIndex: 1, userId: "bob", nickname: "Bob", isBot: false },
    { seatIndex: 2, isBot: true, nickname: "Bot 3" },
    { seatIndex: 3, isBot: false }, // empty human seat (no occupant yet)
];
const event = { seats };

describe("assertChallengeableSeat (issue #1577)", () => {
    it("returns the target seat for a seated human opponent", () => {
        const seat = assertChallengeableSeat(event, 1, "alice");
        expect(seat.userId).toBe("bob");
    });

    it("rejects a missing seat", () => {
        expect(() => assertChallengeableSeat(event, 9, "alice")).toThrow(
            /seated human opponent/
        );
    });

    it("rejects a bot seat", () => {
        expect(() => assertChallengeableSeat(event, 2, "alice")).toThrow(
            /seated human opponent/
        );
    });

    it("rejects an empty (unoccupied) seat", () => {
        expect(() => assertChallengeableSeat(event, 3, "alice")).toThrow(
            /seated human opponent/
        );
    });

    it("rejects challenging your own seat", () => {
        expect(() => assertChallengeableSeat(event, 0, "alice")).toThrow(
            /your own seat/
        );
    });

    it("rejects a missing event", () => {
        expect(() => assertChallengeableSeat(null, 1, "alice")).toThrow(
            /not found/
        );
    });
});

describe("assertSameEventDeck (issue #1577 — reject cross-event pairing)", () => {
    it("passes when the deck belongs to the expected event", () => {
        expect(() => assertSameEventDeck("event-1", "event-1")).not.toThrow();
    });

    it("rejects a deck from a DIFFERENT event", () => {
        expect(() => assertSameEventDeck("event-2", "event-1")).toThrow(
            /same Limited Event/
        );
    });

    it("rejects a non-Limited deck (no event id)", () => {
        expect(() => assertSameEventDeck(undefined, "event-1")).toThrow(
            /same Limited Event/
        );
    });
});

describe("projectViewerChallenges — viewer-scoped privacy (issue #1577)", () => {
    // Alice challenged Bob; Carol challenged Bob too; Dave challenged Alice.
    const challenges: ChallengeGame[] = [
        {
            gameId: "g-ab",
            matchId: "m-ab",
            challengerUserId: "alice",
            challengerSeatIndex: 0,
            challengedUserId: "bob",
            challengedSeatIndex: 1,
        },
        {
            gameId: "g-cb",
            matchId: "m-cb",
            challengerUserId: "carol",
            challengerSeatIndex: 2,
            challengedUserId: "bob",
            challengedSeatIndex: 1,
        },
        {
            gameId: "g-da",
            matchId: "m-da",
            challengerUserId: "dave",
            challengerSeatIndex: 3,
            challengedUserId: "alice",
            challengedSeatIndex: 0,
        },
    ];

    it("shows Bob every challenge addressed TO him, and no outgoing", () => {
        const view = projectViewerChallenges(challenges, "bob");
        expect(view.incoming.map((c) => c.gameId).sort()).toEqual([
            "g-ab",
            "g-cb",
        ]);
        expect(view.outgoing).toBeNull();
    });

    it("shows Alice her OWN outgoing challenge and Dave's incoming one", () => {
        const view = projectViewerChallenges(challenges, "alice");
        expect(view.outgoing).toEqual({
            gameId: "g-ab",
            challengedSeatIndex: 1,
        });
        expect(view.incoming).toEqual([
            { gameId: "g-da", matchId: "m-da", challengerSeatIndex: 3 },
        ]);
    });

    it("never leaks a pairing between two OTHER seats", () => {
        // Carol sees only her own outgoing challenge to Bob — never Alice→Bob
        // or Dave→Alice.
        const view = projectViewerChallenges(challenges, "carol");
        expect(view.incoming).toEqual([]);
        expect(view.outgoing).toEqual({
            gameId: "g-cb",
            challengedSeatIndex: 1,
        });
    });

    it("carries each incoming challenge's owning MATCH id (issue #1645 review)", () => {
        // The round-pairing affordance disambiguates its own Match from a
        // stale FREE challenge sent by the same seat by comparing `matchId` to
        // the pairing's — `challengerSeatIndex` alone cannot tell them apart.
        const view = projectViewerChallenges(challenges, "bob");
        expect(view.incoming.map((c) => c.matchId).sort()).toEqual([
            "m-ab",
            "m-cb",
        ]);
    });

    it("returns nothing for an anonymous viewer", () => {
        expect(projectViewerChallenges(challenges, null)).toEqual({
            incoming: [],
            outgoing: null,
        });
    });
});
