// A DEV-only seam that fills the AI decision ring with a CONSTANT trace.
//
// WHY IT EXISTS. `check:ui`'s `game-debug-sheet-ai` surface measures the debug
// sheet with its AI trace box open and NON-EMPTY (ADR 0132 §4, issue #3652).
// The ring is a client-only store (`trace-store.ts`), written by the vs-AI
// driver when the Brain answers a window — so a headless walk has exactly two
// ways to see a populated ring: let the Bot actually decide, or push a
// decision itself.
//
// A REAL DECISION CANNOT BE MEASURED TWICE. Its candidate list is a function
// of the board that happened to be dealt and of a wall-clock-bounded search,
// which is the nondeterminism this surface was already fighting: two runs of
// one unchanged tree read `ctrls n13 small12` and `ctrls n21 small19`
// (issue #3492). Letting the Bot move once and then loading the declared
// position would fix the BOARD and leave the ring a function of the position
// the Bot moved on — the reading that flapped. So the lane pushes a FIXED
// trace instead, through `pushAiTrace`: the same function `useVsAiDriver`
// calls, so the box renders a seeded decision exactly as it renders a real
// one, and the Bot never needs priority for the ring to be there.
//
// DEV ONLY. `import.meta.env.DEV` gates the install, and the lane owns its own
// Vite dev server (`scripts/ui-gate/index.ts`), so the seam is there for the
// walk and for a developer driving CDP by hand. A production bundle installs
// nothing and defines no window property.
//
// Client-only and off the authoritative path (ADR 0074), like the store it
// writes to: nothing here reaches a Move, a mutation or the search.

import type { CandidateTrace, DecisionTrace, EvalTerms } from "@convex/gre";
import {
    clearAiDecisions,
    clearAiEscalations,
    clearAiTraces,
    pushAiTrace,
} from "./trace-store";

/** The global the walk calls, named like the lane's other page seams
 *  (`window.__tolariaNet` in `settle.ts`, `window.__tolariaProbe` in
 *  `probe.js`). Spelled out in the interface rather than shared with a const:
 *  a computed key would hide the one name `surfaces.ts` types by hand into a
 *  `page.evaluate` source string, and that string is not type-checked. */
declare global {
    interface Window {
        __tolariaAiTrace?: {
            /** Empty every section of the box, then push
             *  {@link AI_TRACE_SEAM_RECORDS} fixed decisions into the ring.
             *  Returns how many the ring holds afterwards. */
            seed(): number;
            /** Empty every section again. */
            clear(): void;
        };
    }
}

/** Every term at zero: the seam's subject is the BOX, not the evaluation, and
 *  a zero term is one `AiCandidateRow` prints nothing for (`termLine` filters
 *  them), which keeps the rendered row a function of this file alone. */
const ZERO_TERMS: EvalTerms = {
    life: 0,
    hand: 0,
    creatures: 0,
    permanents: 0,
    mana: 0,
    finiteManaUses: 0,
    manaDevelopment: 0,
    colorCoverage: 0,
    flexibility: 0,
    library: 0,
    graveyard: 0,
    graveyardReach: 0,
};

/** One candidate. `move` is never rendered — `AiDecisionSummary` and
 *  `AiCandidateRow` read the LABEL and the numbers — so every candidate here
 *  carries the one Move kind that needs no board to be well-formed. */
function candidate(label: string, visits: number): CandidateTrace {
    return {
        label,
        move: { kind: "pass" },
        visits,
        meanReward: 0.5,
        meanMargin: 0,
        avail: visits,
        eval: {
            self: ZERO_TERMS,
            opp: ZERO_TERMS,
            margin: 0,
            danger: 0,
            total: 0,
        },
    };
}

/** How many decisions {@link installAiTraceSeam}'s `seed()` leaves in the ring.
 *
 *  THREE, not one: the surface measures an open body with its own `max-h` and
 *  scroll port, and a single row is a box, not a list. Three makes the ring a
 *  list — with the newest-first order and the per-decision disclosure a reader
 *  actually meets — while staying a constant every run reproduces exactly. */
export const AI_TRACE_SEAM_RECORDS = 3;

/** The seeded decisions, oldest first, exported so the guarding test asserts
 *  the same constant the lane renders rather than a second copy of it. */
export const AI_TRACE_SEAM_TRACES: readonly DecisionTrace[] = [
    {
        botId: "seam-bot",
        chosen: "Play Island",
        iterationsCompleted: 400,
        iterationsRequested: 400,
        elapsedMs: 120,
        stoppedBy: "iterations",
        mechanism: "mean-reward",
        candidates: [candidate("Play Island", 300), candidate("Pass", 100)],
    },
    {
        botId: "seam-bot",
        chosen: "Cast Grizzly Bears",
        iterationsCompleted: 400,
        iterationsRequested: 400,
        elapsedMs: 130,
        stoppedBy: "iterations",
        mechanism: "material-tiebreak",
        candidates: [
            candidate("Cast Grizzly Bears", 260),
            candidate("Cast Savannah Lions", 90),
            candidate("Pass", 50),
        ],
    },
    {
        botId: "seam-bot",
        chosen: "Pass",
        iterationsCompleted: 400,
        iterationsRequested: 400,
        elapsedMs: 110,
        stoppedBy: "iterations",
        mechanism: "mean-reward",
        candidates: [candidate("Pass", 320), candidate("Attack", 80)],
    },
];

/** Empty every section the measured box renders, not just the ring — see
 *  `seed()` below for why the other two matter. */
function clearAllSections(): void {
    clearAiTraces();
    clearAiEscalations();
    clearAiDecisions();
}

/** Install the seam, once, in a dev build. A no-op in production and on a
 *  second call — the box that hosts it re-mounts whenever the sheet is
 *  reopened, and a second install would replace a live object for nothing. */
export function installAiTraceSeam(): void {
    if (!import.meta.env.DEV) return;
    if (typeof window === "undefined") return;
    if (window.__tolariaAiTrace) return;
    window.__tolariaAiTrace = {
        seed() {
            // CLEARS ALL THREE SECTIONS FIRST (PR #3697 review). Two reasons,
            // and the second is the one the first draft missed:
            //
            //  - IDEMPOTENCE: the lane retries an Infra Verdict by re-walking
            //    the surface (`index.ts`), and a seed that appended would
            //    measure a different ring on the retry than on the first try.
            //  - THE SIBLINGS SHARE THE MEASURED BOX. `[data-ai-trace-body]`
            //    holds the ring, the escalation log AND the outcome log
            //    (`ai-decision-trace-box.tsx`), and each of the latter two
            //    renders a header, a count, a `Clear` button and a row list as
            //    soon as its own store is non-empty. The Bot fills the outcome
            //    log on EVERY walk, through a window the declared position
            //    cannot reach: the pregame mulligan is a real decision it
            //    answers directly (`useVsAiDriver` → `recordAiDecision`), and
            //    no scenario may be loaded during it at all (CR 103.5 —
            //    `assertLiveGameCanContinue` refuses the MULLIGAN phase).
            //    Neither store is cleared on a game swap either; only the ring
            //    is. So those rows would ride into the shape readings, moving
            //    with whether the deal happened to need a mulligan.
            //
            // The click-loop this seam replaced pressed every `Clear` in the
            // sheet, which covered all three indiscriminately. Clearing all
            // three here is what keeps that guarantee.
            clearAllSections();
            for (const trace of AI_TRACE_SEAM_TRACES) {
                pushAiTrace(trace, "worker");
            }
            return AI_TRACE_SEAM_TRACES.length;
        },
        clear: clearAllSections,
    };
}
