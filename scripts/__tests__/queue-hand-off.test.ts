/**
 * The hand-off's decisions (issue #5952): who merges a `ready-to-land` PR,
 * the closing ref GitHub needs, and the label moves. Moved from the retired
 * land-runner's tests when the runner was deleted (issue #5654).
 */
import { describe, expect, it } from "vitest";
import { FAILED_LABEL, MANUAL_LABEL, READY_LABEL } from "../lib/land-labels";
import {
    bodyWithClosingRef,
    handsToQueue,
    labelArgs,
} from "../lib/queue-hand-off";

describe("label moves", () => {
    it("ready to the owner adds ready-to-land and merge:manual, drops land-failed (issues #5952, #6213)", () => {
        expect(labelArgs.ready(5, { manual: true })).toEqual([
            "pr",
            "edit",
            "5",
            "--add-label",
            READY_LABEL,
            "--add-label",
            MANUAL_LABEL,
            "--remove-label",
            FAILED_LABEL,
        ]);
    });

    it("ready to the queue adds ready-to-land only and drops land-failed and any merge:manual (a repair re-queues with one verb; no PR is left with no merger)", () => {
        expect(labelArgs.ready(5, { manual: false })).toEqual([
            "pr",
            "edit",
            "5",
            "--add-label",
            READY_LABEL,
            "--remove-label",
            FAILED_LABEL,
            "--remove-label",
            MANUAL_LABEL,
        ]);
    });

    it("failed swaps ready-to-land for land-failed", () => {
        expect(labelArgs.failed(5)).toEqual([
            "pr",
            "edit",
            "5",
            "--remove-label",
            READY_LABEL,
            "--add-label",
            FAILED_LABEL,
        ]);
    });
});

describe("handsToQueue — who lands a handed-off PR (issue #5952)", () => {
    it("the queue, when pr-gate's trusted-author verdict is green", () => {
        expect(handsToQueue({ trustedAuthor: "success" })).toBe(true);
    });

    it("the owner, when the queue would refuse it — never a PR with no merger", () => {
        expect(handsToQueue({ trustedAuthor: "failure" })).toBe(false);
        expect(handsToQueue({ trustedAuthor: "pending" })).toBe(false);
    });
});

describe("bodyWithClosingRef — GitHub closes the issue at merge, whoever merges (issue #5952)", () => {
    it("appends a bare Closes #N when GitHub links no closing ref to the issue", () => {
        expect(bodyWithClosingRef("Summary.\n\n", 12, [])).toBe(
            "Summary.\n\nCloses #12\n"
        );
        // Another issue's closing ref is not this one's.
        expect(bodyWithClosingRef("Fixes #7", 12, [7])).toBe(
            "Fixes #7\n\nCloses #12\n"
        );
    });

    it("leaves a body GitHub already links as closing the issue", () => {
        expect(bodyWithClosingRef("Closes #12", 12, [12])).toBeNull();
    });
});
