// Match Format on the event page (PRD #1628 stories 1-4, ADR 0076, issue
// #1640): a participant must be able to see what kind of event they are in
// BEFORE they draft.
//
// Every assertion here drives the badge with the OUTPUT of the real projection
// (`projectLimitedEvent`), never a hand-built view — per the project's
// frontend wiring discipline. A hand-built `{ matchFormat: "bo3" }` would pass
// even if the projection dropped the field entirely, which is precisely the
// bug class this file exists to catch.
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import {
    projectLimitedEvent,
    type LimitedEventRow,
} from "@convex/limited/eventProjection";
import LimitedMatchFormatBadge from "../limited-match-format-badge";

function row(overrides: Partial<LimitedEventRow> = {}): LimitedEventRow {
    return {
        _id: "event1",
        createdBy: "user1",
        type: "draft",
        status: "started",
        seatCount: 2,
        packSlots: ["lea", "lea", "lea"],
        seats: [
            { seatIndex: 0, userId: "user1", nickname: "Alice" },
            { seatIndex: 1, userId: "user2", nickname: "Bob" },
        ],
        createdAt: 0,
        updatedAt: 0,
        ...overrides,
    };
}

/** Render the badge from a stored event row, THROUGH the real projection. */
function renderFromRow(overrides: Partial<LimitedEventRow> = {}) {
    const view = projectLimitedEvent(row(overrides), "user1");
    return render(<LimitedMatchFormatBadge event={view} />);
}

describe("LimitedMatchFormatBadge (PRD #1628, issue #1640)", () => {
    it("shows Best of 3 for an event created with the Bo3 default", () => {
        renderFromRow({ matchFormat: "bo3" });
        expect(screen.getByText("Best of 3")).toBeTruthy();
    });

    it("shows Best of 1 for a Bo1 event", () => {
        renderFromRow({ matchFormat: "bo1" });
        expect(screen.getByText("Best of 1")).toBeTruthy();
    });

    it("shows Best of 3 for a pre-play-phase event that stored no format", () => {
        // The projection resolves the default — the component never
        // re-implements it, so an old event still reads correctly.
        renderFromRow();
        expect(screen.getByText("Best of 3")).toBeTruthy();
    });

    it("appends the round deadline when the creator configured one", () => {
        renderFromRow({ matchFormat: "bo3", roundDeadlineMinutes: 50 });
        expect(screen.getByText("Best of 3 · 50 min rounds")).toBeTruthy();
    });

    it("shows the format alone when the event has no deadline", () => {
        renderFromRow({ matchFormat: "bo1" });
        expect(screen.queryByText(/min rounds/)).toBe(null);
    });

    it("keeps reading correctly once the event reaches the play phase", () => {
        renderFromRow({
            matchFormat: "bo1",
            status: "playing",
            currentRound: 1,
            roundDeadlineMinutes: 30,
            rounds: [
                { roundNumber: 1, startedAt: 0, pairings: [{ seatA: 0, seatB: 1 }] },
            ],
        });
        expect(screen.getByText("Best of 1 · 30 min rounds")).toBeTruthy();
    });
});
