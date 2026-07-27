// Round panel tests (PRD #1628 stories 6-7/21/26, issue #1644).
//
// Every `event` prop here is produced by the REAL reducer —
// `projectLimitedEvent` (`convex/limited/eventProjection.ts`), the same seam
// the wire-format query returns — never a hand-built view. That is the whole
// point: this project's most recurring bug class is a projection dropping a
// field the UI reads, and a hand-built view masks it exactly (CLAUDE.md §
// Frontend wiring analysis).
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import {
    projectLimitedEvent,
    type LimitedEventRow,
} from "@convex/limited/eventProjection";
import type { LimitedEventView } from "~/hooks/useLimitedEvent";
import LimitedRoundPanel from "../limited-round-panel";

afterEach(() => {
    cleanup();
});

type Pairings = NonNullable<LimitedEventRow["rounds"]>[number]["pairings"];

/** A 4-seat table in the play phase: seats 0/1 human (Alice/Bob), 2/3 bots. */
function projectedEvent(
    pairings: Pairings,
    overrides: Partial<LimitedEventRow> = {},
    viewerUserId: string | null = "user1"
): LimitedEventView {
    const row: LimitedEventRow = {
        _id: "event-1644",
        createdBy: "user1",
        type: "draft",
        status: "playing",
        seatCount: 4,
        packSlots: ["lea"],
        matchFormat: "bo3",
        currentRound: 1,
        rounds: [{ roundNumber: 1, startedAt: 1000, pairings }],
        seats: [
            { seatIndex: 0, userId: "user1", nickname: "Alice" },
            { seatIndex: 1, userId: "user2", nickname: "Bob" },
            { seatIndex: 2, nickname: "Bot 3", isBot: true },
            { seatIndex: 3, nickname: "Bot 4", isBot: true },
        ],
        createdAt: 0,
        updatedAt: 0,
        ...overrides,
    };
    return projectLimitedEvent(
        row,
        viewerUserId
    ) as unknown as LimitedEventView;
}

describe("LimitedRoundPanel — the current round (PRD story 6)", () => {
    it("names the round and the total the table's size implies", () => {
        render(
            <LimitedRoundPanel
                event={projectedEvent([
                    { seatA: 0, seatB: 2 },
                    { seatA: 1, seatB: 3 },
                ])}
            />
        );

        // 4 seats -> 2 Swiss rounds (`roundsForSeatCount`).
        expect(screen.getByText("Round 1 of 2")).toBeTruthy();
    });

    it("renders nothing before the play phase has opened a round", () => {
        const event = projectedEvent([], {
            status: "started",
            currentRound: undefined,
            rounds: undefined,
        });
        const { container } = render(<LimitedRoundPanel event={event} />);

        expect(container.firstChild).toBeNull();
    });
});

describe("LimitedRoundPanel — the viewer's pairing (PRD story 7)", () => {
    it("names the opponent and flags a bot seat as a bot", () => {
        render(
            <LimitedRoundPanel
                event={projectedEvent([
                    { seatA: 0, seatB: 2 },
                    { seatA: 1, seatB: 3 },
                ])}
            />
        );

        expect(screen.getByTestId("round-pairing")).toBeTruthy();
        expect(screen.getByText("Bot 3")).toBeTruthy();
        expect(screen.getByTestId("round-opponent-kind").textContent).toBe(
            "Bot"
        );
    });

    it("flags a human opponent as human", () => {
        render(
            <LimitedRoundPanel
                event={projectedEvent([
                    { seatA: 0, seatB: 1 },
                    { seatA: 2, seatB: 3 },
                ])}
            />
        );

        expect(screen.getByText("Bob")).toBeTruthy();
        expect(screen.getByTestId("round-opponent-kind").textContent).toBe(
            "Human"
        );
    });

    it("says a pending pairing has not been played yet", () => {
        render(
            <LimitedRoundPanel
                event={projectedEvent([
                    { seatA: 0, seatB: 2 },
                    { seatA: 1, seatB: 3 },
                ])}
            />
        );

        expect(
            screen.getByTestId("round-pairing-status").textContent
        ).toContain("not played yet");
    });
});

describe("LimitedRoundPanel — already decided (PRD story 26)", () => {
    it("shows a win with the score from the VIEWER's side and how it was decided", () => {
        render(
            <LimitedRoundPanel
                event={projectedEvent([
                    // The viewer is seat B here — the raw result reads 1-2 and
                    // must render as the viewer's 2-1 win.
                    {
                        seatA: 2,
                        seatB: 0,
                        result: { winsA: 1, winsB: 2, source: "played" },
                    },
                    {
                        seatA: 1,
                        seatB: 3,
                        result: { winsA: 2, winsB: 0, source: "played" },
                    },
                ])}
            />
        );

        const status = screen.getByTestId("round-pairing-status");
        expect(status.textContent).toContain("Win");
        expect(status.textContent).toContain("2-1");
        expect(status.textContent).toContain("Played");
    });

    it("labels a simulated loss as simulated", () => {
        render(
            <LimitedRoundPanel
                event={projectedEvent([
                    {
                        seatA: 0,
                        seatB: 2,
                        result: { winsA: 0, winsB: 2, source: "simulated" },
                    },
                    { seatA: 1, seatB: 3 },
                ])}
            />
        );

        const status = screen.getByTestId("round-pairing-status");
        expect(status.textContent).toContain("Loss");
        expect(status.textContent).toContain("0-2");
        expect(status.textContent).toContain("Simulated");
    });

    it("says the round is still waiting on another seat (PRD story 21)", () => {
        render(
            <LimitedRoundPanel
                event={projectedEvent([
                    {
                        seatA: 0,
                        seatB: 2,
                        result: { winsA: 2, winsB: 0, source: "played" },
                    },
                    { seatA: 1, seatB: 3 },
                ])}
            />
        );

        expect(screen.getByTestId("round-waiting")).toBeTruthy();
    });

    it("does NOT say it is waiting once every pairing is decided", () => {
        render(
            <LimitedRoundPanel
                event={projectedEvent([
                    {
                        seatA: 0,
                        seatB: 2,
                        result: { winsA: 2, winsB: 0, source: "played" },
                    },
                    {
                        seatA: 1,
                        seatB: 3,
                        result: { winsA: 0, winsB: 2, source: "played" },
                    },
                ])}
            />
        );

        expect(screen.queryByTestId("round-waiting")).toBeNull();
    });
});

describe("LimitedRoundPanel — the bye and the seatless viewer", () => {
    it("tells the viewer they have a bye, worth the format's games", () => {
        render(
            <LimitedRoundPanel
                event={projectedEvent([
                    { seatA: 0, result: { winsA: 2, winsB: 0, source: "bye" } },
                    { seatA: 1, seatB: 2 },
                    { seatA: 3 },
                ])}
            />
        );

        const bye = screen.getByTestId("round-pairing-bye");
        expect(bye.textContent).toContain("bye this round");
        expect(bye.textContent).toContain("2-0");
        expect(screen.queryByTestId("round-pairing")).toBeNull();
    });

    it("tells a viewer with no seat that they are only watching", () => {
        render(
            <LimitedRoundPanel
                event={projectedEvent(
                    [
                        { seatA: 0, seatB: 2 },
                        { seatA: 1, seatB: 3 },
                    ],
                    {},
                    "outsider"
                )}
            />
        );

        expect(screen.getByTestId("round-no-seat")).toBeTruthy();
        expect(screen.getByText("Round 1 of 2")).toBeTruthy();
    });
});
