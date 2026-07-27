// Stop-notice rendering (issue #1613 fixup, non-blocking finding 2: this
// component had no dedicated test, unlike the divergence banner and pick
// list). Covers both `ReplayStopReason`s and the seat-label consistency fix
// (non-blocking finding 3): the notice must label the stopped-at seat the
// SAME way `draft-lab-replay-pick-list.tsx` does (nickname, else 1-based
// "Seat N"), never a raw 0-based `seatIndex`.
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import DraftLabReplayStopNotice from "../draft-lab-replay-stop-notice";
import type { ReplayResult } from "@/lib/limited/draftReplayEngine";
import type { LimitedEventSeatView } from "@/hooks/useLimitedEvent";

afterEach(cleanup);

const seats = [
    { seatIndex: 0, nickname: "Alice" },
    { seatIndex: 1, nickname: "Bob" },
] as unknown as LimitedEventSeatView[];

function baseResult(overrides: Partial<ReplayResult>): ReplayResult {
    return {
        picks: [],
        firstDivergedPickIndex: null,
        complete: false,
        stopReason: null,
        stoppedAtSeat: null,
        ...overrides,
    };
}

describe("DraftLabReplayStopNotice (issue #1613 fixup)", () => {
    it("renders nothing when the reconstruction completed", () => {
        const result = baseResult({ complete: true });
        const { container } = render(
            <DraftLabReplayStopNotice result={result} seats={seats} />
        );
        expect(container.textContent).toBe("");
    });

    it("explains the 'hidden-pool' stop reason and labels the seat by nickname", () => {
        const result = baseResult({
            complete: false,
            stopReason: "hidden-pool",
            stoppedAtSeat: 1,
        });
        render(<DraftLabReplayStopNotice result={result} seats={seats} />);
        expect(screen.getByText(/Stopped at Bob/)).not.toBeNull();
        expect(
            screen.getByText(/can't see this seat's stored Pool/)
        ).not.toBeNull();
    });

    it("explains the 'pool-mismatch' stop reason", () => {
        const result = baseResult({
            complete: false,
            stopReason: "pool-mismatch",
            stoppedAtSeat: 0,
        });
        render(<DraftLabReplayStopNotice result={result} seats={seats} />);
        expect(screen.getByText(/Stopped at Alice/)).not.toBeNull();
        expect(
            screen.getByText(/doesn't match any card in the regenerated pack/)
        ).not.toBeNull();
    });

    it("falls back to a 1-based 'Seat N' label when no nickname is known — never a raw 0-based index", () => {
        const result = baseResult({
            complete: false,
            stopReason: "hidden-pool",
            stoppedAtSeat: 2,
        });
        render(<DraftLabReplayStopNotice result={result} seats={seats} />);
        // seatIndex 2 has no entry in `seats` — falls back to 1-based "Seat 3",
        // the SAME fallback `draft-lab-replay-pick-list.tsx` uses, never the
        // raw 0-based "seat 2".
        expect(screen.getByText(/Stopped at Seat 3/)).not.toBeNull();
        expect(screen.queryByText(/Stopped at seat 2\b/)).toBeNull();
    });
});
