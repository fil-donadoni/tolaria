// The divergence marker's rendering (issue #1613 mandatory component
// coverage: "component tests for ... the divergence marker"). ADR 0074's
// sharpest requirement is that the surface never quietly keeps rendering
// past a divergence without saying so — these tests assert both the
// no-divergence and the diverged banner text appear.
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import DraftLabReplayDivergenceBanner from "../draft-lab-replay-divergence-banner";
import type {
    ReplayPickEntry,
    ReplayResult,
} from "@/lib/limited/draftReplayEngine";

afterEach(cleanup);

function pick(overrides: Partial<ReplayPickEntry>): ReplayPickEntry {
    return {
        pickIndex: 1,
        seatIndex: 0,
        seatPickNumber: 1,
        isBot: true,
        pack: [],
        historicalCardId: "card-a",
        recomputedCardId: "card-a",
        diverged: false,
        ...overrides,
    };
}

describe("DraftLabReplayDivergenceBanner (issue #1613)", () => {
    it("reports no divergence when every pick matches", () => {
        const result: ReplayResult = {
            picks: [pick({ pickIndex: 1 }), pick({ pickIndex: 2 })],
            firstDivergedPickIndex: null,
            complete: true,
            stopReason: null,
            stoppedAtSeat: null,
        };
        render(<DraftLabReplayDivergenceBanner result={result} />);
        expect(screen.getByText(/No divergence/)).not.toBeNull();
        expect(
            screen.getByText(/all 2 reconstructed picks match/)
        ).not.toBeNull();
    });

    it("marks the divergence point and how many picks moved", () => {
        const result: ReplayResult = {
            picks: [
                pick({ pickIndex: 1, diverged: false }),
                pick({
                    pickIndex: 2,
                    diverged: true,
                    historicalCardId: "card-a",
                    recomputedCardId: "card-b",
                }),
                pick({ pickIndex: 3, diverged: false }),
            ],
            firstDivergedPickIndex: 2,
            complete: true,
            stopReason: null,
            stoppedAtSeat: null,
        };
        render(<DraftLabReplayDivergenceBanner result={result} />);
        expect(screen.getByText(/Faithful through pick 1 of 3/)).not.toBeNull();
        expect(screen.getByText(/pick 2 on/)).not.toBeNull();
        expect(screen.getByText(/1 of 3.*pick\(s\) moved/)).not.toBeNull();
    });
});
