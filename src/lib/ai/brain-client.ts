// Client-side handle to the Brain Web Worker (ADR 0001, issues #109/#110).
//
// Lazily spawns a single module Worker and exposes `consultBrain(state, botId)`,
// which resolves with the bot's chosen Move (or null when it owes nothing). A
// request-id map matches each reply to its caller so concurrent consults never
// cross. The Worker is a thin shell; enumeration + selection live in the GRE and
// `brain.ts`.
//
// In a non-Worker environment (SSR, tests), `consultBrain` falls back to running
// the same ISMCTS search inline — so the driver never hard-depends on the
// Worker being available.
//
// A Worker FAILURE used to be permanent (issue #3040). `onerror` left the
// singleton installed, so every later consult posted into a dead handle, burned
// the full consult timeout and settled with no move — which the driver's
// fallback turns into a pass on an ordinary priority window. One transient
// failure therefore made the bot pass every real decision for the rest of the
// game: it kept its opening hand, never played a land, never attacked, and
// nothing on screen said the AI was broken. Recovery has two stages, and the
// caller is never handed "no move" while either can still answer:
//
//   1. terminate + clear the singleton, so the next consult constructs a FRESH
//      Worker — bounded by MAX_BRAIN_WORKER_SPAWNS per game, or a permanently
//      broken script would spin;
//   2. once that budget is spent, consults run the SAME handler in-thread at
//      BRAIN_FALLBACK_BUDGET. A weak move beats no move.
//
// And it is loud: a failure nobody is waiting on — the warm-up spawn — still
// lands in the decision ring, so it reaches a bug report instead of vanishing.

import type { PublicGameState } from "@convex/gameProjections";
import type { Move, SearchBudget, DecisionTrace } from "@convex/gre";
import { DEFAULT_BUDGET } from "@convex/gre";
import type { DeckKnowledgeBySeat } from "./state-adapter";
import { handleBrainRequest } from "./brain-request";
import type {
    BrainOutcome,
    BrainRequest,
    BrainResponse,
} from "./brain-request";
import { recordAiDecision } from "./trace-store";

/** The Brain's reply: the chosen move, the read-only DecisionTrace of what it
 *  weighed (null when there was no real decision to explain), and HOW the
 *  consult ended.
 *
 *  `outcome` exists because the three failure paths below — the search threw,
 *  the Worker died, the Worker never answered — all used to resolve the same
 *  bare `move: null` the driver gets when the bot legitimately has nothing to
 *  do. Indistinguishable at the call site, and therefore invisible in a bug
 *  report: a bot failing every consult looks exactly like a bot passing every
 *  window (issue #2450). `via` says whether a Worker was involved at all — and
 *  since issue #3040 a consult can START on the Worker and finish `inline`,
 *  which is what a run of `via: "inline"` in the ring means. */
export type BrainResult = {
    move: Move | null;
    trace: DecisionTrace | null;
    outcome: BrainOutcome;
    via: "worker" | "inline";
    /** The failure text, for the error outcomes only. */
    message?: string;
};

type Pending = (result: BrainResult) => void;

/** An in-flight consult. The REQUEST is kept beside its resolver, not just the
 *  resolver: when a Worker dies with the respawn budget already spent, the
 *  consult is re-run on this thread, and re-running it needs the arguments. */
type InFlight = { resolve: Pending; request: BrainRequest };

/** How long a Worker consult may run before the client gives up on it and
 *  resolves the same "no move" answer `worker.onerror` already resolves
 *  (issue #2284).
 *
 *  Without it a Worker that never replies — a wedged search, a message lost
 *  across a tab suspend — left the driver's in-flight guard set forever, and an
 *  in-flight guard the driver cannot clear is a latch its watchdog cannot walk
 *  past (the watchdog will not interleave a rung into a live submission). The
 *  timeout turns "never replies" into the ordinary `move: null` outcome the
 *  escalation ladder already handles.
 *
 *  It must stay comfortably ABOVE the hardest search budget
 *  (`DIFFICULTY_BUDGETS.hard.timeMs = 3000`, raised from 600 by issue #2682)
 *  and BELOW `BOT_WATCHDOG_MS`, so a wedged consult settles in time for the
 *  watchdog's first deadline to escalate rather than to find a still-in-flight
 *  dispatch. `brain-client-timeout.bot.test.ts` asserts both relations against
 *  the real constants.
 *
 *  Those relations only bound the CONSULT. Since issue #3053 the Worker also
 *  fetches the card catalogue in its own graph before its first answer, and
 *  that is deliberately kept OUT of this budget by {@link warmBrain}, which
 *  `useVsAiDriver` calls on mount. Without it the first consult on a cold
 *  cache would be a ~1.4 MB download plus a 3,000 ms search inside 5,000 ms. */
export const BRAIN_CONSULT_TIMEOUT_MS = 5000;

/** How many CONSECUTIVE Worker failures give up on the Worker and hand the rest
 *  of the game to the in-thread fallback (issue #3040).
 *
 *  The respawn has to be bounded — a script that cannot load would otherwise be
 *  re-spawned on every consult for the rest of the game — and the bound is
 *  deliberately tight, because the alternative to spawning again is not
 *  "nothing": it is the in-thread fallback, which answers.
 *
 *  Two means ONE retry, sized against the real sequence: `useVsAiDriver` calls
 *  {@link warmBrain} on mount, so the warm-up spawn is the first failure. A game
 *  whose Worker script cannot load therefore hits the second (and last) failure
 *  on the bot's FIRST real consult and reaches the in-thread fallback inside
 *  that same consult — it plays its land instead of passing the window. A larger
 *  cap buys nothing but repetitions of an identical failure, each paid for with
 *  a window the bot passes.
 *
 *  CONSECUTIVE is the load-bearing word: any successful reply resets the count,
 *  because it proves the script loads and the Worker answers. A lifetime count
 *  would let two unrelated transient crashes hours apart in one long game pin
 *  every later decision to the 120-iteration in-thread search, permanently and
 *  invisibly. Each failure costs exactly one construction — the failed handle is
 *  replaced once — so the cap is also the ceiling on Workers a broken script can
 *  build. {@link disposeBrain} resets it too, which is what makes it per GAME. */
export const MAX_BRAIN_WORKER_FAILURES = 2;

/** The budget the in-thread FALLBACK searches at, once the Worker is out of
 *  respawns (issue #3040).
 *
 *  This path runs on the main thread, so its cost is paid in dropped frames — a
 *  full `hard` budget (3,000 ms) would freeze the tab for three seconds per
 *  decision. It is deliberately a fraction of the weakest real think, and it is
 *  a CEILING rather than a replacement: a caller already asking for less
 *  (`easy`) keeps its own smaller numbers. Weak, but a weak move beats the
 *  `move: null` this whole file exists to stop turning into a silent pass. */
export const BRAIN_FALLBACK_BUDGET: SearchBudget = {
    iterations: 120,
    timeMs: 400,
};

/** Named in the failure text of a script-load failure, which carries no
 *  filename of its own. NOT built with `new URL(..., import.meta.url)`: that
 *  expression is what Vite's worker plugin pattern-matches inside the
 *  `new Worker(...)` call below, and a second copy of it outside one is an
 *  asset reference this message has no use for. */
const BRAIN_WORKER_SCRIPT = "brain.worker.ts";

/** The explicit marker for the one failure whose event says nothing at all.
 *
 *  Every throw INSIDE the Worker is caught and posted back as a structured
 *  error (`search-error`), and a runtime crash that escapes reaches `onerror`
 *  as an `ErrorEvent` carrying `message`. An event with NO `message` property
 *  is what the spec fires when a module Worker's SCRIPT FAILS TO LOAD — and
 *  reporting that as the bare fallback string `"worker error"` is why issue
 *  #3040's report named neither the script nor the position. */
export const WORKER_SCRIPT_LOAD_FAILURE = "worker script failed to load";

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, InFlight>();
/** Worker failures since the last successful reply — see
 *  {@link MAX_BRAIN_WORKER_FAILURES}. */
let failures = 0;
/** Set once the spawn budget is spent: every later consult goes in-thread. */
let exhausted = false;

function getWorker(): Worker | null {
    if (typeof Worker === "undefined") return null;
    // Out of respawns: the in-thread fallback owns the rest of this game. Fall
    // through to `consultBrain`'s `!w` branch rather than handing back a handle
    // known to die (issue #3040) — that is what made every later consult pay
    // the full consult timeout for nothing.
    if (exhausted) return null;
    if (worker) return worker;
    // Held in a local as well as in the module singleton, so both handlers can
    // ask "am I still the installed Worker?" — see `onerror` below.
    const spawned = new Worker(new URL("./brain.worker.ts", import.meta.url), {
        type: "module",
    });
    worker = spawned;
    spawned.onmessage = (e: MessageEvent<BrainResponse>) => {
        // A reply — even one carrying a search `error` — proves the script
        // loaded and this Worker answers, so the failure count starts over.
        failures = 0;
        const entry = pending.get(e.data.id);
        if (entry) {
            pending.delete(e.data.id);
            entry.resolve(fromResponse(e.data, "worker"));
        }
    };
    spawned.onerror = (e) => {
        // A STALE event must not tear down the healthy Worker that replaced
        // this one. Two ways it happens: a runtime `error` does not terminate a
        // Worker (the spec only fires the event), so a crashed-but-alive handle
        // can fire again after it has been replaced; and React StrictMode's
        // mount → cleanup → mount makes "the handle that fires is not the
        // handle that is installed" ordinary rather than exotic. Without this
        // the late event would null the singleton, terminate the LIVE Worker,
        // spend a failure and record a breadcrumb for a Worker nobody is using.
        if (worker !== spawned) return;
        handleWorkerFailure(e);
    };
    return spawned;
}

/** A Worker `error` event: the handle is dead, and before issue #3040 it stayed
 *  installed forever.
 *
 *  Terminate and clear it so the next `getWorker()` constructs a fresh one, and
 *  never leave the caller with a bare "no move" while another stage can still
 *  answer: with the spawn budget spent, the in-flight consults are re-run on
 *  this thread instead of being reported as a dead end. */
function handleWorkerFailure(e: unknown): void {
    const reason = describeWorkerFailure(e);

    const dead = worker;
    worker = null;
    // Terminate AFTER dropping the reference: a throw from `terminate()` must
    // not leave the dead singleton installed. `onerror` is detached first so a
    // handle that fires again on its way out cannot re-enter here.
    try {
        if (dead) dead.onerror = null;
        dead?.terminate();
    } catch {
        // A handle that cannot even be terminated is still gone from here.
    }
    failures += 1;
    if (failures >= MAX_BRAIN_WORKER_FAILURES) exhausted = true;

    const inFlight = [...pending.values()];
    pending.clear();

    // Who reports the failure? An in-flight consult settling as `worker-error`
    // already carries it to the driver's breadcrumb ring. The two cases where
    // nobody would are exactly where the failure used to vanish: the warm-up
    // spawn (no consult pending at all) and the exhausting failure (whose
    // consults now report the INLINE outcome instead). Record it here for
    // those, so it reaches a bug report either way (issue #3040).
    if (exhausted || inFlight.length === 0) {
        recordWorkerFailure(
            exhausted
                ? `${reason} — out of respawns, falling back to the in-thread search`
                : reason
        );
    }

    for (const entry of inFlight) {
        if (exhausted) {
            entry.resolve(
                runInline({
                    ...entry.request,
                    budget: clampToFallback(
                        entry.request.budget ?? DEFAULT_BUDGET
                    ),
                })
            );
        } else {
            entry.resolve({
                move: null,
                trace: null,
                outcome: "worker-error",
                via: "worker",
                message: reason,
            });
        }
    }
}

/** Write a Worker failure into the decision ring a bug report carries.
 *
 *  It has no owed-input window, no phase and no seq — the warm-up spawn fails
 *  before the game is resting on the bot at all — and the record is left
 *  honestly incomplete rather than padded with a plausible-looking default: a
 *  breadcrumb whose `seq` names a version the failure never saw cannot be lined
 *  up against the board snapshot beside it, which is the whole job of those
 *  fields (`trace-store.ts`). */
function recordWorkerFailure(message: string): void {
    try {
        recordAiDecision({ outcome: "worker-error", via: "worker", message });
    } catch {
        // An unrecordable breadcrumb is a lost diagnostic, never a lost move: a
        // throwing store subscriber must not escape `onerror` and take the
        // recovery above with it.
    }
}

/** The failure text for a Worker `error` event, and the one place that tells a
 *  script that never LOADED from one that crashed at RUNTIME (issue #3040).
 *
 *  A runtime crash arrives as an `ErrorEvent`: `message` is set, and
 *  `filename`/`lineno`/`colno` usually are too — the position, which the old
 *  one-line reason dropped on the floor. A script-load failure arrives as a
 *  plain `Event` with no `message` property at all, and used to be reported as
 *  the literal string `"worker error"`, which names nothing. */
function describeWorkerFailure(e: unknown): string {
    const ev = (typeof e === "object" && e !== null ? e : {}) as {
        message?: unknown;
        filename?: unknown;
        lineno?: unknown;
        colno?: unknown;
    };
    const at =
        typeof ev.filename === "string" && ev.filename
            ? ` (${ev.filename}${
                  typeof ev.lineno === "number" ? `:${ev.lineno}` : ""
              }${typeof ev.colno === "number" ? `:${ev.colno}` : ""})`
            : "";
    const message =
        ev.message === undefined || ev.message === null
            ? ""
            : String(ev.message);
    return message
        ? `${message}${at}`
        : `${WORKER_SCRIPT_LOAD_FAILURE}: ${BRAIN_WORKER_SCRIPT}${at}`;
}

/** Run one consult on THIS thread — the same handler the Worker runs, so the
 *  two paths fail identically (a throw comes back as `search-error`, never
 *  propagates). Used both where `Worker` is undefined (SSR, tests) and as the
 *  fallback once the Worker is out of respawns. */
function runInline(request: BrainRequest): BrainResult {
    return fromResponse(handleBrainRequest(request), "inline");
}

/** Clamp a requested budget down to {@link BRAIN_FALLBACK_BUDGET} for the
 *  in-thread fallback: a ceiling, per field, so a caller already asking for
 *  less keeps its own smaller numbers.
 *
 *  Built field by field rather than by spreading `requested`, because
 *  `SearchBudget` has two more fields and both would defeat the ceiling: a
 *  `minIterations` above the clamp overrides it outright (the early-stop floor,
 *  issue #2685 — unset is what the settle rule wants anyway), and an injected
 *  `now` is a deterministic test clock that has no business on a real UI
 *  thread. A ceiling that a spread can carry past is not a ceiling. */
function clampToFallback(requested: SearchBudget): SearchBudget {
    return {
        iterations: Math.min(
            requested.iterations ?? BRAIN_FALLBACK_BUDGET.iterations!,
            BRAIN_FALLBACK_BUDGET.iterations!
        ),
        timeMs: Math.min(
            requested.timeMs ?? BRAIN_FALLBACK_BUDGET.timeMs!,
            BRAIN_FALLBACK_BUDGET.timeMs!
        ),
    };
}

/**
 * Spawn the Worker now, so its own catalogue hydration is NOT charged to the
 * first consult (issue #3053).
 *
 * Since ADR 0113 §3 the Worker fetches the card catalogue in its own module
 * graph before it answers anything. `getWorker()` is lazy and was first
 * called from inside `consultBrain`, which put that fetch inside
 * {@link BRAIN_CONSULT_TIMEOUT_MS} together with the hardest search budget
 * (3,000 ms) — a cold HTTP cache would spend the first consult on the
 * download and settle it as `outcome: "timeout"`, i.e. the bot passing its
 * first window, while the constant's own comment still claimed it sat
 * "comfortably ABOVE the hardest search budget".
 *
 * Called on mount by `useVsAiDriver` whenever there is a bot seat, so the
 * Worker's fetch overlaps the game's own setup — and normally hits the
 * browser cache the main thread's gate already filled from the same
 * `immutable` URL. Idempotent; safe where `Worker` is undefined.
 *
 * It is also the FIRST of the game's {@link MAX_BRAIN_WORKER_SPAWNS}: a script
 * that cannot load fails here, with no consult pending, which is why that
 * failure has to be recorded rather than resolved (issue #3040).
 */
export function warmBrain(): void {
    getWorker();
}

/** Ask the Brain to choose a move for `botId` from its projected `state`. The
 *  optional `budget` scales the search by the chosen difficulty (issue #114);
 *  omitted, it falls back to the default preset. `deckKnowledge` names which
 *  seats (if any) the search may know the real deck contents of (issue #2788);
 *  omitted, every seat is blind. */
export function consultBrain(
    state: PublicGameState,
    botId: string,
    budget: SearchBudget = DEFAULT_BUDGET,
    deckKnowledge?: DeckKnowledgeBySeat
): Promise<BrainResult> {
    const w = getWorker();
    if (!w) {
        // No Worker: the SAME handler, on this thread. It reports a throw as
        // `error` rather than propagating, so the inline path and the Worker
        // path fail identically. Two ways to get here, and they differ only in
        // the budget — a native non-Worker environment (SSR, tests) keeps the
        // caller's, while the issue #3040 FALLBACK clamps it, because there it
        // is the game's UI thread paying for the search.
        const id = nextId++;
        return Promise.resolve(
            runInline({
                id,
                state,
                botId,
                budget: exhausted ? clampToFallback(budget) : budget,
                deckKnowledge,
            })
        );
    }

    const id = nextId++;
    const request: BrainRequest = { id, state, botId, budget, deckKnowledge };
    return new Promise<BrainResult>((resolve) => {
        // A consult ALWAYS settles (issue #2284) — see
        // `BRAIN_CONSULT_TIMEOUT_MS`. A reply that arrives afterwards finds no
        // pending entry and is dropped.
        const timer = setTimeout(() => {
            if (pending.delete(id))
                resolve({
                    move: null,
                    trace: null,
                    outcome: "timeout",
                    via: "worker",
                });
        }, BRAIN_CONSULT_TIMEOUT_MS);
        pending.set(id, {
            request,
            resolve: (result) => {
                clearTimeout(timer);
                resolve(result);
            },
        });
        w.postMessage(request);
    });
}

/** Classify a Brain response into the result the driver records. The search
 *  itself never distinguishes "chose nothing" from "failed" — the response's
 *  `error` field does, and it is the whole point of the breadcrumb. */
function fromResponse(
    res: BrainResponse,
    via: "worker" | "inline"
): BrainResult {
    if (res.error) {
        return {
            move: null,
            trace: null,
            outcome: "search-error",
            via,
            message: res.error.message,
        };
    }
    return {
        move: res.move,
        trace: res.trace,
        outcome: res.move ? "move" : "no-move",
        via,
    };
}

/** Tear the Brain down (e.g. on leaving a game). Tests may call this too.
 *
 *  Also resets the respawn budget, which is what makes
 *  {@link MAX_BRAIN_WORKER_SPAWNS} a per-GAME cap rather than a per-tab one: a
 *  game that exhausted its Worker must not hand the next game in the same tab
 *  an already-dead Brain. */
export function disposeBrain(): void {
    if (worker) {
        worker.onerror = null;
        worker.terminate();
        worker = null;
    }
    // SETTLE what was in flight, do not just forget it. `pending.clear()` alone
    // leaves the consult's own timeout unable to fire (`pending.delete(id)`
    // returns false), so its promise never settles at all — and this file's
    // standing invariant is that a consult ALWAYS settles (issue #2284). That
    // was unreachable while `disposeBrain` had no caller in the app; wiring it
    // to the driver's effect cleanup makes a dispose DURING a live consult an
    // ordinary event (a rematch swaps the game on the same hook instance), and
    // a promise that never settles there is a latch on the driver's in-flight
    // guard and a stray mutation aimed at the game the player just left.
    const inFlight = [...pending.values()];
    pending.clear();
    for (const entry of inFlight) {
        entry.resolve({
            move: null,
            trace: null,
            outcome: "worker-error",
            via: "worker",
            message: "Brain disposed — the game was left or swapped",
        });
    }
    failures = 0;
    exhausted = false;
}
