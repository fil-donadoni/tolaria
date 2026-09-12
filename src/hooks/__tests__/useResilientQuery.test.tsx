// Issue #3266 — a transient Convex query timeout must not reach the router's
// catch boundary.
//
// The failure this guards is silent from the engine's side: `getGameTick` is
// one indexed row lookup and it still blew Convex's fixed 1s ceiling under
// machine contention, and `useQuery`'s re-throw then unmounted `<Board>` /
// `<VsAiDriver>` whole. So the assertions here are about the SHAPE of the
// recovery — last good value held, a real re-subscribe after a backoff, and an
// escalation that is state rather than a throw.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { FunctionReference } from "convex/server";

// The deployment, controlled per test. A fresh `Error` instance per failed
// execution is what the Convex client itself produces (the watch rebuilds the
// error from each server update), and what the hook's failure effect keys on.
const h = vi.hoisted(() => ({ result: undefined as unknown }));
vi.mock("convex/react", async () => {
    const { mockUseQueries } =
        await import("~/lib/testing/convex-react-query-mock");
    const resolve = () => h.result;
    return { useQuery: resolve, useQueries: mockUseQueries(resolve) };
});

import { useResilientQuery } from "../useResilientQuery";

/** A plain name is a legal function reference to `getFunctionName`, which is
 *  all this hook asks of it. */
const QUERY = "game:getPublicState" as unknown as FunctionReference<"query">;

const timeout = () =>
    new Error(
        "[CONVEX Q(game:getPublicState)] Function execution timed out (maximum duration: 1s)"
    );

beforeEach(() => {
    vi.useFakeTimers();
    h.result = undefined;
});
afterEach(() => {
    vi.useRealTimers();
    h.result = undefined;
});

function mount(args: unknown = { gameId: "g1" }) {
    return renderHook(
        ({ a }) =>
            useResilientQuery(
                QUERY,
                a as Parameters<typeof useResilientQuery>[1]
            ),
        { initialProps: { a: args } }
    );
}

describe("useResilientQuery (issue #3266)", () => {
    it("passes a settled value straight through, including null", () => {
        h.result = null;
        const { result } = mount();
        // `null` is a VALUE — `getGameTick` returns it for a game with no tick
        // row, and the vs-AI driver fails OPEN on exactly that reading.
        expect(result.current.data).toBe(null);
        expect(result.current.error).toBe(null);
        expect(result.current.retrying).toBe(false);
    });

    it("holds the last good value through a transient failure instead of throwing", () => {
        h.result = { seq: 1 };
        const { result, rerender } = mount();
        expect(result.current.data).toEqual({ seq: 1 });

        h.result = timeout();
        act(() => rerender({ a: { gameId: "g1" } }));

        // The board keeps rendering the state it had: no throw, no undefined
        // that would collapse `<Board>` into its loading branch and dispose
        // the Brain worker on the way.
        expect(result.current.data).toEqual({ seq: 1 });
        expect(result.current.error).toBe(null);
        expect(result.current.retrying).toBe(true);
    });

    it("re-subscribes after the backoff and recovers", () => {
        h.result = { seq: 1 };
        const { result, rerender } = mount();
        h.result = timeout();
        act(() => rerender({ a: { gameId: "g1" } }));
        expect(result.current.retrying).toBe(true);

        h.result = { seq: 2 };
        act(() => vi.advanceTimersByTime(250));
        expect(result.current.retrying).toBe(false);
        expect(result.current.error).toBe(null);
        expect(result.current.data).toEqual({ seq: 2 });
    });

    it("escalates once the retry budget is spent", () => {
        h.result = { seq: 1 };
        const { result, rerender } = mount();
        // MAX_TRANSIENT_RETRIES is 4: four backoffs, and the fifth consecutive
        // failure is the one that gives up.
        for (let i = 0; i < 5; i++) {
            h.result = timeout();
            act(() => rerender({ a: { gameId: "g1" } }));
            act(() => vi.advanceTimersByTime(2000));
        }
        expect(result.current.error).toBeInstanceOf(Error);
        expect(result.current.retrying).toBe(false);
    });

    it("escalates a non-transient error on the first failure", () => {
        h.result = { seq: 1 };
        const { result, rerender } = mount();
        h.result = new Error(
            "[CONVEX Q(game:getPublicState)] Uncaught ConvexError: not your game"
        );
        act(() => rerender({ a: { gameId: "g1" } }));
        // No backoff ladder for a verdict that cannot change.
        expect(result.current.error).toBeInstanceOf(Error);
        expect(result.current.retrying).toBe(false);
    });

    it("a successful execution resets the budget", () => {
        h.result = { seq: 1 };
        const { result, rerender } = mount();
        // Four failures, each cleared by a success: consecutive is the word in
        // the policy, so this must never reach the escalation the test above
        // reaches in five.
        for (let i = 0; i < 4; i++) {
            h.result = timeout();
            act(() => rerender({ a: { gameId: "g1" } }));
            h.result = { seq: 2 + i };
            act(() => vi.advanceTimersByTime(2000));
        }
        h.result = timeout();
        act(() => rerender({ a: { gameId: "g1" } }));
        expect(result.current.error).toBe(null);
        expect(result.current.retrying).toBe(true);
    });

    it("retry() clears the escalation and re-subscribes immediately", () => {
        h.result = new Error("Uncaught ConvexError: boom");
        const { result, rerender } = mount();
        act(() => rerender({ a: { gameId: "g1" } }));
        expect(result.current.error).toBeInstanceOf(Error);

        h.result = { seq: 7 };
        act(() => result.current.retry());
        expect(result.current.error).toBe(null);
        expect(result.current.data).toEqual({ seq: 7 });
    });

    it("never serves another game's held value after the arguments change", () => {
        h.result = { seq: 1, game: "g1" };
        const { result, rerender } = mount({ gameId: "g1" });
        h.result = timeout();
        act(() => rerender({ a: { gameId: "g1" } }));
        expect(result.current.data).toEqual({ seq: 1, game: "g1" });

        // Restart Solo / rematch / Switch Game re-points the SAME hook at
        // another game. Showing the previous game's board would be worse than
        // showing none.
        h.result = undefined;
        act(() => rerender({ a: { gameId: "g2" } }));
        expect(result.current.data).toBe(undefined);
    });

    it("an argument change clears a standing escalation", () => {
        // The board re-points the SAME hook instance at another game (Restart
        // Solo, rematch, Switch Game). Only `retry()` ever un-parks, so a
        // state that outlived its arguments would leave the next game parked
        // on the previous game's verdict, with nothing on screen able to
        // un-stick it.
        h.result = new Error("Uncaught ConvexError: boom");
        const { result, rerender } = mount({ gameId: "g1" });
        act(() => rerender({ a: { gameId: "g1" } }));
        expect(result.current.error).toBeInstanceOf(Error);

        h.result = { seq: 1, game: "g2" };
        act(() => rerender({ a: { gameId: "g2" } }));
        expect(result.current.error).toBe(null);
        expect(result.current.data).toEqual({ seq: 1, game: "g2" });
    });

    it("keeps the last good value across a manual retry", () => {
        h.result = { seq: 1 };
        const { result, rerender } = mount({ gameId: "g1" });
        h.result = new Error("Uncaught ConvexError: boom");
        act(() => rerender({ a: { gameId: "g1" } }));
        expect(result.current.error).toBeInstanceOf(Error);

        // The re-subscribe is a round trip: blanking the board for it is the
        // teardown this hook exists to avoid, in miniature.
        h.result = undefined;
        act(() => result.current.retry());
        expect(result.current.data).toEqual({ seq: 1 });
    });

    it("drops the held value when the caller skips", () => {
        h.result = { seq: 1 };
        const { result, rerender } = mount({ gameId: "g1" });
        act(() => rerender({ a: "skip" }));
        // `"skip"` is the caller saying it does not want this data at all (the
        // tab went hidden) — the stale value must not leak back out.
        expect(result.current.data).toBe(undefined);
    });
});
