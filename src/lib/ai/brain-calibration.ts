// The calibration message of the Brain channel (issue #10451): the page asks
// the Worker to time the fixed calibration search
// (`convex/gre/ai/calibration.ts`) and gets back what the machine made of it.
//
// A message of its own, never a consult: it carries no game state, decides
// nothing, and its answer is one reading. The Worker serves it in arrival
// order behind whatever is in flight, so a consult posted after it waits for
// it: at most the reading's time budget plus one of its units on that device
// (`CALIBRATION_BUDGET_MS`, `convex/gre/ai/calibration.ts`).
//
// Worker only. There is no in-thread calibration: on the main thread it would
// time the UI's thread, not the Brain's, and cost a frame doing it.

import {
    runCalibration,
    type CalibrationReading,
} from "@convex/gre/ai/calibration";

export type { CalibrationReading };

/** The page's request. */
export type BrainCalibrate = { kind: "calibrate"; id: number };

/** The Worker's answer: the reading, or `null` when the calibration measured
 *  nothing. */
export type BrainCalibration = {
    kind: "calibration";
    id: number;
    reading: CalibrationReading | null;
};

/** A reading as it may be trusted off the wire: a positive time per unit and
 *  a positive whole number of units. Anything else is no reading. */
export function validReading(value: unknown): CalibrationReading | null {
    const reading = value as Partial<CalibrationReading> | null | undefined;
    const ms = reading?.msPerUnit;
    const units = reading?.units;
    return typeof ms === "number" &&
        Number.isFinite(ms) &&
        ms > 0 &&
        typeof units === "number" &&
        Number.isInteger(units) &&
        units > 0
        ? { msPerUnit: ms, units }
        : null;
}

export function isBrainCalibrate(message: unknown): message is BrainCalibrate {
    return (message as { kind?: unknown } | null)?.kind === "calibrate";
}

export function isBrainCalibration(
    message: unknown
): message is BrainCalibration {
    return (message as { kind?: unknown } | null)?.kind === "calibration";
}

/** Serve one calibration request. Never throws: the caller is the Worker's
 *  message pump. `run` is the calibration, injectable for a test. */
export function handleCalibration(
    request: BrainCalibrate,
    run: typeof runCalibration = runCalibration
): BrainCalibration {
    let reading: CalibrationReading | null = null;
    try {
        reading = validReading(run());
    } catch {
        // No reading.
    }
    return { kind: "calibration", id: request.id, reading };
}
