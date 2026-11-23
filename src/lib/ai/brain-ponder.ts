// The Brain Worker's PONDERING scheduler (issue #10472, ADR 0185 Amendment I).
//
// A ponder grows the kept tree while the human decides
// (`convex/gre/ai/ponder.ts`). The search loop is synchronous, and a
// synchronous loop cannot read the Worker's inbox, so pondering runs in TIME
// SLICES: a slice of iterations (about `PONDER_SLICE_MS`), then a yield to the
// event loop, where whatever the page posted is read. ANY message ends the
// ponder before it is handled (`brain.worker.ts` calls `stop` first), so a
// consult never queues behind more than the one slice that was running when
// it arrived — inside the overrun margin the consult timeout is sized with
// (`consult-timeout.ts`, issue #10115).
//
// Pondering stops on:
//   - a consult (or any other message) — `stop("message")`;
//   - a hidden page — the page posts `ponder-stop` on `visibilitychange` →
//     `hidden`, and nothing resumes it until the next ponder the page posts,
//     which follows the next consult;
//   - the NODE CAP — the tree is counted, and pondering ends when it holds
//     `PONDER_NODE_CAP` nodes (lower on a phone, see below);
//   - a tree that is no longer the keeper's (a consult took it), or a
//     ponder that throws — a lost ponder is a lost idle time, never a lost
//     consult.
//
// The clock and the deferral are injected, so a test runs slices of a fixed
// number of iterations and steps the event loop by hand — never wall-clock.

import type { TreeKeeper } from "./brain-request";
import {
    startPonder,
    type BrainPonder,
    type PonderSession,
} from "@convex/gre/ai/ponder";

/** How long one slice searches before it yields. A consult posted mid-slice
 *  waits at most this long (plus one iteration, which can overrun it). */
export const PONDER_SLICE_MS = 50;

/** The most nodes a pondered tree may hold, by device class.
 *
 *  MEASURED (issue #10472, `docs/research/brain-pondering-tree-reuse.md`
 *  § 7): 0.03 to 1.3 nodes per iteration — narrow boards saturate, an
 *  opponent's option-set views add nodes — and up to about 6 KB per node,
 *  the high end including caches a search holds besides the tree. At the
 *  high end 12,000 nodes are about 72 MB, at a typical 1.2 KB about 15 MB.
 *  At the field's Chromium speed the desktop cap binds only after a minute
 *  and a half of thought or more; a phone gets a third of it (about 24 MB
 *  at the high end), on a device whose memory nobody measured yet. */
export const PONDER_NODE_CAP = { desktop: 12_000, mobile: 4_000 } as const;

/** Why a ponder ended. */
export type PonderStopReason =
    | "message"
    | "hidden"
    | "cap"
    | "taken"
    | "nothing"
    | "error";

export type PondererOptions = {
    keeper: TreeKeeper;
    /** Run `task` on a later turn of the event loop. */
    defer: (task: () => void) => void;
    /** A monotonic clock, in milliseconds. */
    now: () => number;
    /** A slice's bound: a wall-clock budget live, a fixed iteration count in
     *  a test. */
    slice: { ms: number } | { iterations: number };
    /** The node cap; omitted, `PONDER_NODE_CAP` by the message's device. */
    nodeCap?: number;
    /** Told once per ponder, when it ends (diagnostics, tests). */
    onStop?: (reason: PonderStopReason) => void;
    /** The engine entry, injectable for a test. */
    begin?: (message: BrainPonder, keeper: TreeKeeper) => PonderSession | null;
};

export type Ponderer = {
    /** Begin pondering `message`, ending any ponder under way. */
    start: (message: BrainPonder) => void;
    /** End the ponder under way, if any. */
    stop: (reason: PonderStopReason) => void;
    /** Whether a ponder is under way. */
    active: () => boolean;
};

/** The nodes one iteration is assumed to open at most when deciding whether
 *  the tree could have reached the cap — one child, and an option-set view
 *  per opponent node it passes; the measured maximum was 1.3. An iteration
 *  past several opponent nodes can open more, so the cap is SOFT: the tree
 *  may overshoot it by a slice's worth before the next count. */
const NODES_PER_ITERATION_BOUND = 2;

export function createPonderer(options: PondererOptions): Ponderer {
    const begin = options.begin ?? startPonder;
    /** The ponder under way: its session, and a token a stale slice
     *  compares against. */
    let current: {
        session: PonderSession;
        cap: number;
        counted: number;
        since: number;
    } | null = null;

    function stop(reason: PonderStopReason): void {
        if (!current) return;
        current = null;
        options.onStop?.(reason);
    }

    function runSlice(token: NonNullable<typeof current>): void {
        if (current !== token) return;
        if (!token.session.live()) {
            stop("taken");
            return;
        }
        try {
            const bound = options.slice;
            let ran: number;
            if ("iterations" in bound) {
                ran = token.session.slice(
                    bound.iterations,
                    undefined,
                    options.now
                );
            } else {
                const until = options.now() + bound.ms;
                ran = token.session.slice(
                    Number.MAX_SAFE_INTEGER,
                    () => options.now() >= until,
                    options.now
                );
            }
            token.since += ran;
            // Counted again only when the tree COULD have reached the cap:
            // a count walks the whole tree.
            if (
                token.counted + NODES_PER_ITERATION_BOUND * token.since >=
                token.cap
            ) {
                token.counted = token.session.nodes();
                token.since = 0;
                if (token.counted >= token.cap) {
                    stop("cap");
                    return;
                }
            }
        } catch {
            stop("error");
            return;
        }
        options.defer(() => runSlice(token));
    }

    return {
        start(message) {
            stop("message");
            let session: PonderSession | null;
            try {
                session = begin(message, options.keeper);
            } catch {
                options.onStop?.("error");
                return;
            }
            if (!session) {
                options.onStop?.("nothing");
                return;
            }
            const cap =
                options.nodeCap ??
                (message.mobile
                    ? PONDER_NODE_CAP.mobile
                    : PONDER_NODE_CAP.desktop);
            const token = { session, cap, counted: session.nodes(), since: 0 };
            if (token.counted >= cap) {
                options.onStop?.("cap");
                return;
            }
            current = token;
            options.defer(() => runSlice(token));
        },
        stop,
        active: () => current !== null,
    };
}
