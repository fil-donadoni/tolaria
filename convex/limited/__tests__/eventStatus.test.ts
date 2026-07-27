// Limited Event lifecycle predicates (PRD #1628, ADR 0076, issue #1640).
//
// The point of `eventStatus.ts` is that NO consumer compares the status
// literally: with four lifecycle members a raw `=== "started"` is a latent bug
// that only fires once an event reaches the play phase. These tests pin the
// per-status answers, and — the load-bearing one — pin the two properties the
// whole design rests on: a Pool is never un-dealt, and exactly one status is
// terminal.
import { describe, it, expect } from "vitest";
import {
    LIMITED_EVENT_STATUSES,
    arePoolsDealt,
    areDraftPicksLegal,
    areRoundsRunning,
    isEventConcluded,
    isSeatingOpen,
    type LimitedEventStatus,
} from "../eventStatus";

describe("LIMITED_EVENT_STATUSES (PRD #1628, ADR 0076)", () => {
    it("is the four-phase lifecycle, in order", () => {
        expect([...LIMITED_EVENT_STATUSES]).toEqual([
            "open",
            "started",
            "playing",
            "finished",
        ]);
    });

    it("has no duplicate members", () => {
        expect(new Set(LIMITED_EVENT_STATUSES).size).toBe(
            LIMITED_EVENT_STATUSES.length
        );
    });
});

describe("Limited Event phase predicates (ADR 0076)", () => {
    // One row per status: the complete answer set. A new status with no row
    // here fails the exhaustiveness test below — the runtime twin of the
    // `satisfies Record<LimitedEventStatus, …>` guard in the module itself.
    const EXPECTED: Record<
        LimitedEventStatus,
        {
            seatingOpen: boolean;
            poolsDealt: boolean;
            draftPicksLegal: boolean;
            roundsRunning: boolean;
            concluded: boolean;
        }
    > = {
        open: {
            seatingOpen: true,
            poolsDealt: false,
            draftPicksLegal: false,
            roundsRunning: false,
            concluded: false,
        },
        started: {
            seatingOpen: false,
            poolsDealt: true,
            draftPicksLegal: true,
            roundsRunning: false,
            concluded: false,
        },
        playing: {
            seatingOpen: false,
            poolsDealt: true,
            draftPicksLegal: false,
            roundsRunning: true,
            concluded: false,
        },
        finished: {
            seatingOpen: false,
            poolsDealt: true,
            draftPicksLegal: false,
            roundsRunning: false,
            concluded: true,
        },
    };

    it.each(LIMITED_EVENT_STATUSES)("answers every question for %s", (s) => {
        expect({
            seatingOpen: isSeatingOpen(s),
            poolsDealt: arePoolsDealt(s),
            draftPicksLegal: areDraftPicksLegal(s),
            roundsRunning: areRoundsRunning(s),
            concluded: isEventConcluded(s),
        }).toEqual(EXPECTED[s]);
    });

    it("covers every declared status (a new member must be answered here too)", () => {
        expect(Object.keys(EXPECTED).sort()).toEqual(
            [...LIMITED_EVENT_STATUSES].sort()
        );
    });
});

// The invariants the rest of the system leans on — asserted as PROPERTIES
// across the whole union, not as one-off cases, so a future status can't
// quietly violate them.
describe("lifecycle invariants (ADR 0076)", () => {
    it("a Pool is never un-dealt: only 'open' has no Pools", () => {
        const withoutPools = LIMITED_EVENT_STATUSES.filter(
            (s) => !arePoolsDealt(s)
        );
        expect(withoutPools).toEqual(["open"]);
    });

    it("draft Picks are legal in exactly one phase, and Pools exist there", () => {
        const picking = LIMITED_EVENT_STATUSES.filter(areDraftPicksLegal);
        expect(picking).toEqual(["started"]);
        expect(arePoolsDealt(picking[0])).toBe(true);
    });

    it("seating is open in exactly one phase, and no Pools exist there", () => {
        const seating = LIMITED_EVENT_STATUSES.filter(isSeatingOpen);
        expect(seating).toEqual(["open"]);
        expect(arePoolsDealt(seating[0])).toBe(false);
    });

    it("rounds run in exactly one phase, and it is not the terminal one", () => {
        const running = LIMITED_EVENT_STATUSES.filter(areRoundsRunning);
        expect(running).toEqual(["playing"]);
        expect(isEventConcluded(running[0])).toBe(false);
    });

    it("exactly one status is terminal, and its rounds are no longer running", () => {
        const terminal = LIMITED_EVENT_STATUSES.filter(isEventConcluded);
        expect(terminal).toEqual(["finished"]);
        expect(areRoundsRunning(terminal[0])).toBe(false);
    });

    it("no status both accepts seats and legalises Picks", () => {
        for (const s of LIMITED_EVENT_STATUSES) {
            expect(isSeatingOpen(s) && areDraftPicksLegal(s)).toBe(false);
        }
    });
});
