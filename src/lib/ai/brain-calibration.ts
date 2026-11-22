// The calibration message of the Brain channel (issue #10451): the page asks
// the Worker to time the fixed calibration search
// (`convex/gre/ai/calibration.ts`) and gets back what the machine made of it.
//
// A message of its own, never a consult: it carries no game state, decides
// nothing, and its answer is one number. The Worker serves it in arrival
// order behind whatever is in flight, so a consult posted after it waits at
// most one calibration (`CALIBRATION_CAP_MS`).
//
// Worker only. There is no in-thread calibration: on the main thread it would
// time the UI's thread, not the Brain's, and cost a frame doing it.

import { runCalibration } from "@convex/gre/ai/calibration";

/** The page's request. */
export type BrainCalibrate = { kind: "calibrate"; id: number };

/** The Worker's answer: the reading in milliseconds per iteration, or `null`
 *  when the search measured nothing. */
export type BrainCalibration = {
    kind: "calibration";
    id: number;
    msPerIteration: number | null;
};

export function isBrainCalibrate(message: unknown): message is BrainCalibrate {
    return (message as { kind?: unknown } | null)?.kind === "calibrate";
}

export function isBrainCalibration(
    message: unknown
): message is BrainCalibration {
    return (message as { kind?: unknown } | null)?.kind === "calibration";
}

/** Serve one calibration request. Never throws: the caller is the Worker's
 *  message pump. `run` is the search, injectable for a test. */
export function handleCalibration(
    request: BrainCalibrate,
    run: typeof runCalibration = runCalibration
): BrainCalibration {
    let msPerIteration: number | null = null;
    try {
        msPerIteration = run()?.msPerIteration ?? null;
    } catch {
        // No reading.
    }
    return { kind: "calibration", id: request.id, msPerIteration };
}
