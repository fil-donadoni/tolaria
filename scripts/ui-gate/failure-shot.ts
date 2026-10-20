/**
 * Failure shots (issue #6145): a cell is screenshotted only when it FAILED,
 * and the shot outlines what failed.
 *
 * WHY. Every cell used to be shot, pass or fail — a full-DPR viewport PNG
 * (median 1.8 MB) taken before the assertions, ~20% of all cell time — into a
 * folder that died with the worktree, and nobody ever looked at one. A
 * passing cell's picture answers no question; a failing cell's answers the
 * first one a reader has, provided it shows WHERE: the probe now reports a box
 * for every Floor it breaks (`probe.js` `offenders`), axe its targets, and the
 * shot outlines them (`overlay.js`).
 *
 * WHEN. The broken Floors are known the moment probe and axe return, so a cell
 * with one is shot THEN — before the Named Assertions, which scroll elements
 * into view and would move what was measured. A cell whose Floors hold but
 * whose assertion fails is shot after the assertions, with the failure on the
 * banner. Never twice: one failing cell, one shot.
 *
 * Pure: the page work (overlay, screenshot, assertions) is injected, so the
 * decision is testable without a browser (`ui-gate-failure-shot.test.ts`).
 */
import type { AssertResult } from "./assertions.ts";
import {
    brokenFloors,
    readingsOf,
    type AxeCount,
    type Floor,
    type Offender,
    type ProbeResult,
} from "./floors.ts";

/** What `overlay.js`'s `__tolariaOutline` draws: boxes in viewport CSS
 *  pixels, and banner lines for what has no box. */
export interface OutlineSpec {
    boxes: { x: number; y: number; w: number; h: number; label: string }[];
    banner: string[];
}

/** One failing cell's account, as the publish step reads it. */
export interface FailedCell {
    surface: string;
    viewport: string;
    floors: { floor: Floor; reading: number }[];
    /** The Named Assertions that failed, label only — the detail is on the
     *  cell's ASSERT FAIL line. */
    asserts: string[];
    /** The shot's file name inside the run's screenshot directory. */
    file: string;
}

/** The PNG a cell's failure shot is written to, inside the run's directory. */
export function shotFileName(surface: string, viewport: string): string {
    return `${surface}__${viewport}.png`;
}

/** The overlay for a cell: every offender of a broken Floor, labelled with
 *  that Floor, and a banner naming each broken Floor's reading and each
 *  failed assertion. */
export function outlineSpec(
    probe: ProbeResult,
    axe: AxeCount,
    broken: readonly { floor: Floor; reading: number }[],
    failedAsserts: readonly AssertResult[]
): OutlineSpec {
    const floors = new Set(broken.map((b) => b.floor));
    const offenders = [...probe.offenders, ...axe.offenders].filter((o) =>
        floors.has(o.floor)
    );
    const label = (o: Offender) =>
        `${o.floor} ${o.t || o.sel}` + (o.why ? ` — ${o.why}` : "");
    // An unlocated offender (`w` -1) is named on the banner: a box drawn at
    // the origin would read as a real location.
    const boxes = offenders
        .filter((o) => o.w >= 0)
        .map((o) => ({ x: o.x, y: o.y, w: o.w, h: o.h, label: label(o) }));
    return {
        boxes,
        banner: [
            ...broken.map((b) => `${b.floor} ${b.reading}`),
            ...offenders
                .filter((o) => o.w < 0)
                .map((o) => `${label(o)} (not located)`),
            ...failedAsserts.map((a) => `ASSERT FAIL ${a.label} — ${a.detail}`),
        ],
    };
}

/**
 * The tail of one cell attempt, after probe and axe: shoot if a Floor broke,
 * run the assertions, shoot if only an assertion failed. Returns the
 * assertions and whether the cell was shot (exactly once, or never).
 */
export async function assertAndShoot(step: {
    probe: ProbeResult;
    axe: AxeCount;
    shoot: (spec: OutlineSpec) => Promise<void>;
    assertions: () => Promise<readonly AssertResult[]>;
}): Promise<{ asserts: readonly AssertResult[]; shot: boolean }> {
    const broken = brokenFloors(readingsOf(step.probe, step.axe));
    let shot = false;
    if (broken.length > 0) {
        await step.shoot(outlineSpec(step.probe, step.axe, broken, []));
        shot = true;
    }
    const asserts = await step.assertions();
    const failed = asserts.filter((a) => !a.ok);
    if (!shot && failed.length > 0) {
        await step.shoot(outlineSpec(step.probe, step.axe, [], failed));
        shot = true;
    }
    return { asserts, shot };
}
