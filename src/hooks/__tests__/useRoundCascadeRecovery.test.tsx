// Client-side round-cascade recovery (`useRoundCascadeRecovery`): a seat
// looking at an event whose latest round is decided but which never advanced
// is the retry that gets it moving again.
//
// The hook is driven through a real render (not called directly) because what
// it promises is about EFFECT behaviour across re-renders — fires once per
// observed round state, never loops — and a direct call cannot observe that.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import type { LimitedEventView } from "~/hooks/useLimitedEvent";
import type { Id } from "@convex/_generated/dataModel";

const nudge = vi.fn(async () => true);

vi.mock("convex/react", () => ({
    useMutation: () => nudge,
}));

vi.mock("@convex/_generated/api", () => {
    const apiProxy: unknown = new Proxy({}, { get: () => apiProxy });
    return { api: apiProxy };
});

import { useRoundCascadeRecovery } from "../useRoundCascadeRecovery";

const EVENT_ID = "ev_1" as Id<"limitedEvents">;

/** The minimum of the event view this hook reads. Cast rather than fully
 *  built: every other field of `LimitedEventView` is irrelevant here, and
 *  spelling out a whole projection would only hide which fields actually
 *  drive the decision. */
function view(options: {
    status: string;
    currentRound?: number;
    /** One entry per round; `true` = every pairing decided. */
    roundsComplete?: boolean[];
}): LimitedEventView {
    return {
        status: options.status,
        currentRound: options.currentRound,
        rounds: (options.roundsComplete ?? []).map((complete, index) => ({
            roundNumber: index + 1,
            startedAt: 0,
            pairings: [
                {
                    seatA: 0,
                    seatB: 1,
                    ...(complete
                        ? { result: { winsA: 2, winsB: 0, source: "played" } }
                        : {}),
                },
            ],
        })),
    } as unknown as LimitedEventView;
}

function Harness({
    event,
    enabled = true,
}: {
    event: LimitedEventView | null | undefined;
    enabled?: boolean;
}) {
    useRoundCascadeRecovery({ eventId: EVENT_ID, event, enabled });
    return null;
}

beforeEach(() => {
    cleanup();
    nudge.mockClear();
});

describe("useRoundCascadeRecovery", () => {
    it("nudges when the latest round is complete but the event is still playing", () => {
        render(
            <Harness
                event={view({
                    status: "playing",
                    currentRound: 1,
                    roundsComplete: [true],
                })}
            />
        );
        expect(nudge).toHaveBeenCalledWith({ eventId: EVENT_ID });
    });

    it("does not nudge while the current round is still being played", () => {
        render(
            <Harness
                event={view({
                    status: "playing",
                    currentRound: 1,
                    roundsComplete: [false],
                })}
            />
        );
        expect(nudge).not.toHaveBeenCalled();
    });

    it("does not nudge a viewer with no Seat (the server would reject it)", () => {
        render(
            <Harness
                enabled={false}
                event={view({
                    status: "playing",
                    currentRound: 1,
                    roundsComplete: [true],
                })}
            />
        );
        expect(nudge).not.toHaveBeenCalled();
    });

    it("does not nudge an event whose rounds are not running", () => {
        render(
            <Harness
                event={view({
                    status: "finished",
                    currentRound: 3,
                    roundsComplete: [true, true, true],
                })}
            />
        );
        expect(nudge).not.toHaveBeenCalled();
    });

    it("does not nudge before the event has loaded", () => {
        render(<Harness event={undefined} />);
        render(<Harness event={null} />);
        expect(nudge).not.toHaveBeenCalled();
    });

    // The one case a dependency array alone cannot cover: the event query
    // re-suspends (a write elsewhere in the table invalidates it), the hook's
    // `stuck` flag goes true -> false -> true, and the effect legitimately
    // re-runs against the SAME unadvanced round. Only the attempted-key ref
    // stops that from re-firing the mutation on every refetch.
    it("does not re-nudge the same state after the event reloads", () => {
        const stuck = view({
            status: "playing",
            currentRound: 1,
            roundsComplete: [true],
        });
        const { rerender } = render(<Harness event={stuck} />);
        expect(nudge).toHaveBeenCalledTimes(1);
        rerender(<Harness event={undefined} />);
        rerender(<Harness event={stuck} />);
        expect(nudge).toHaveBeenCalledTimes(1);
    });

    it("fires once per round state, not once per render", () => {
        const stuck = view({
            status: "playing",
            currentRound: 1,
            roundsComplete: [true],
        });
        const { rerender } = render(<Harness event={stuck} />);
        rerender(<Harness event={stuck} />);
        rerender(<Harness event={stuck} />);
        expect(nudge).toHaveBeenCalledTimes(1);
    });

    it("nudges again once the event reaches a NEW stuck round state", () => {
        const { rerender } = render(
            <Harness
                event={view({
                    status: "playing",
                    currentRound: 1,
                    roundsComplete: [true],
                })}
            />
        );
        expect(nudge).toHaveBeenCalledTimes(1);
        // The nudge landed: round 2 opened and is being played — no call.
        rerender(
            <Harness
                event={view({
                    status: "playing",
                    currentRound: 2,
                    roundsComplete: [true, false],
                })}
            />
        );
        expect(nudge).toHaveBeenCalledTimes(1);
        // Round 2 is now decided and the event STILL hasn't advanced — a new
        // stuck state, so a new attempt.
        rerender(
            <Harness
                event={view({
                    status: "playing",
                    currentRound: 2,
                    roundsComplete: [true, true],
                })}
            />
        );
        expect(nudge).toHaveBeenCalledTimes(2);
    });

    it("does not retry the same state after a failed nudge", async () => {
        nudge.mockRejectedValueOnce(new Error("boom"));
        const stuck = view({
            status: "playing",
            currentRound: 1,
            roundsComplete: [true],
        });
        const { rerender } = render(<Harness event={stuck} />);
        await Promise.resolve();
        rerender(<Harness event={stuck} />);
        expect(nudge).toHaveBeenCalledTimes(1);
    });
});
