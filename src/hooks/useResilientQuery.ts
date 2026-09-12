// A Convex subscription that survives a slow execution (issue #3266).
//
// `useQuery` from `convex/react` RE-THROWS a failed execution during render
// (`client.js`: `if (result instanceof Error) throw result`). Nothing inside
// the board catches it, so the throw walks all the way up to the router's
// `CatchBoundaryImpl` and unmounts `<Board>` / `<VsAiDriver>` — the whole tree,
// with every piece of client-only state on it (the pending-choice buffer, the
// attack sequence, the divide buffer, the minimize toggles) rebuilt from
// scratch. That is a catastrophic response to a query that was merely SLOW:
// Convex enforces a fixed 1s execution ceiling on queries, and under machine
// contention even `getGameTick` — one indexed row lookup — was observed
// exceeding it.
//
// This hook keeps `useQuery`'s call shape and turns the throw into state. It
// is built on `useQueries`, which is the same primitive `useQuery` is built on
// MINUS the throw: the failed execution arrives as an `Error` value instead.
//
//   - a transient failure (`isTransientQueryError`) keeps the last good value
//     on screen and re-subscribes after a backoff. Re-subscribing is what
//     makes the retry a real re-EXECUTION: a failed query result sits in the
//     client until something invalidates it, and a timeout invalidates
//     nothing, so waiting is waiting forever;
//   - consecutive transient failures past `MAX_TRANSIENT_RETRIES`, or any
//     non-transient error, escalate: `error` goes non-null, the subscription
//     stays parked (a genuinely broken query must not spin), and the caller
//     renders its own surface. This hook never throws.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueries } from "convex/react";
import type { OptionalRestArgsOrSkip, RequestForQueries } from "convex/react";
import { getFunctionName, type FunctionReference } from "convex/server";
import type { Value } from "convex/values";
import {
    MAX_TRANSIENT_RETRIES,
    isTransientQueryError,
    retryDelayMs,
} from "~/lib/transient-query-error";

export type ResilientQuery<T> = {
    /** The query's value — or, while a retry is in flight, the last value it
     *  returned for THESE arguments. `undefined` means "nothing known yet":
     *  loading, skipped, or failed before the first success, exactly as
     *  `useQuery` returns `undefined` while loading. */
    data: T | undefined;
    /** Non-null once retries are exhausted or the failure was never worth
     *  retrying. The caller owns the surface it renders for this. */
    error: Error | null;
    /** A retry is scheduled: the subscription is parked and `data` is the last
     *  good value. */
    retrying: boolean;
    /** Manual retry — resets the budget and re-subscribes immediately. This is
     *  what the error surface's "Retry" affordance calls. */
    retry: () => void;
};

type RetryState = {
    /** Subscription parked: waiting out a backoff, or escalated. */
    parked: boolean;
    /** Set once the failure stopped being worth retrying. */
    error: Error | null;
    /** The value carried across the parked window. */
    held: unknown;
    /** Which arguments this whole state belongs to. A board that switches
     *  games (Restart Solo, rematch, Switch Game) re-points the SAME hook
     *  instance: without the key it would be shown the previous game's held
     *  value, and — worse — would stay PARKED on the previous game's
     *  escalation, since only `retry()` ever un-parks. Keying the state makes
     *  an argument change a clean slate by construction, with no effect to
     *  fire and no second source of truth. */
    key: string | null;
};

/** The parked / skipped request: `useQueries` holds no watch at all for it,
 *  which is exactly what `useQuery` does for `"skip"`. */
const NO_REQUEST: RequestForQueries = {};

const IDLE: RetryState = {
    parked: false,
    error: null,
    held: undefined,
    key: null,
};

export function useResilientQuery<Query extends FunctionReference<"query">>(
    query: Query,
    ...args: OptionalRestArgsOrSkip<Query>
): ResilientQuery<Query["_returnType"]> {
    type Result = Query["_returnType"];
    const [state, setState] = useState<RetryState>(IDLE);
    // Refs, never read during render (`react-hooks/refs`): the failure effect
    // is the only reader, and it runs after the render that produced the
    // failure — so what it reads is exactly the state of the subscription just
    // before it broke.
    const lastGood = useRef<{ value: Result | undefined; key: string } | null>(
        null
    );
    // Consecutive failures, scoped to the arguments they were counted under —
    // a switch to another game starts its own ladder.
    const failures = useRef<{ count: number; key: string | null }>({
        count: 0,
        key: null,
    });
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const callerArgs = args[0];
    const skipped = callerArgs === "skip";
    const argsKey = useMemo(
        () => `${getFunctionName(query)}:${JSON.stringify(callerArgs ?? {})}`,
        [query, callerArgs]
    );

    // Everything the retry state says applies to the arguments it was recorded
    // under, and to nothing else.
    const current = state.key === argsKey;
    const parked = current && state.parked;

    // Parking is expressed as an empty request, which is what `useQuery` does
    // for `"skip"`: the watch is dropped, and mounting it again on the next
    // render issues a fresh execution.
    const request: RequestForQueries = useMemo(
        () =>
            skipped || parked
                ? NO_REQUEST
                : {
                      query: {
                          query,
                          args: (callerArgs ?? {}) as Record<string, Value>,
                      },
                  },
        // `argsKey` stands in for `query` + `callerArgs`: the generated `api`
        // proxy hands back a fresh reference on every property access, and an
        // inline args object is new on every render, so identity deps would
        // re-subscribe on every render. Same reasoning (and the same
        // stringify) as `useQuery`'s own memo.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [argsKey, skipped, parked]
    );
    const raw = useQueries(request).query as Result | Error | undefined;
    const failure = raw instanceof Error ? raw : null;
    const value = failure ? undefined : raw;

    useEffect(() => {
        if (skipped || failure) return;
        // A settled execution: `undefined` is still loading, anything else
        // (including `null`, which `getGameTick` returns before the first
        // save) is a value worth carrying across the next failure.
        if (value === undefined) return;
        lastGood.current = { value, key: argsKey };
        failures.current = { count: 0, key: argsKey };
    }, [value, failure, skipped, argsKey]);

    useEffect(() => {
        if (!failure) return;
        const held =
            lastGood.current?.key === argsKey
                ? lastGood.current.value
                : undefined;
        const count =
            failures.current.key === argsKey ? failures.current.count + 1 : 1;
        failures.current = { count, key: argsKey };
        if (!isTransientQueryError(failure) || count > MAX_TRANSIENT_RETRIES) {
            setState({ parked: true, error: failure, held, key: argsKey });
            return;
        }
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(
            () =>
                setState({
                    parked: false,
                    error: null,
                    held,
                    key: argsKey,
                }),
            retryDelayMs(count - 1)
        );
        setState({ parked: true, error: null, held, key: argsKey });
    }, [failure, argsKey]);

    useEffect(
        () => () => {
            if (timer.current) clearTimeout(timer.current);
        },
        []
    );

    const retry = useCallback(() => {
        if (timer.current) clearTimeout(timer.current);
        failures.current = { count: 0, key: null };
        // Keeps the last good value through the manual re-subscribe, the same
        // way an automatic retry does — reading a ref from an event handler is
        // not a render read. Dropping it here would blank the board for the
        // round-trip the player just asked for.
        const good = lastGood.current;
        setState({
            parked: false,
            error: null,
            held: good?.value,
            key: good ? good.key : null,
        });
    }, []);

    // The held value survives only until a fresh one arrives — and only for
    // the arguments it was captured under.
    const carried = current ? (state.held as Result | undefined) : undefined;
    return {
        // `!== undefined`, never `??`: `null` is a VALUE here — `getGameTick`
        // returns it for a game whose tick row predates the feature, and the
        // driver fails OPEN on exactly that (`useVsAiDriver`). Coalescing it
        // into the carried value turns a settled "no row" into "still
        // loading" and the bot never moves.
        data: skipped ? undefined : value !== undefined ? value : carried,
        error: current ? state.error : null,
        retrying: parked && state.error === null,
        retry,
    };
}
