/**
 * The hand-merge notification's decision (issue #6188): a `ready-to-land`
 * PR the queue refuses fails the run; a queue-admitted PR or another label
 * does not. Pure — `scripts/owner-merge.ts` is the I/O.
 */
import { describe, expect, it } from "vitest";
import { ownerMergeDecision, ownerMergeSummary } from "../lib/owner-merge";
import type { GatePr } from "../lib/pr-gate";

const REPO = "fil-donadoni/tolaria";
const TRUSTED = ["fil-donadoni"];

const pr = (files: string[], over: Partial<GatePr> = {}): GatePr => ({
    number: 42,
    author: "fil-donadoni",
    body: "",
    headSha: "a".repeat(40),
    headRef: "feat/issue-42",
    headRepo: REPO,
    baseRepo: REPO,
    files,
    ...over,
});

describe("ownerMergeDecision", () => {
    it("notifies for a ready-to-land PR touching .github/ or .mergify.yml", () => {
        for (const file of [".github/workflows/x.yml", ".mergify.yml"]) {
            const d = ownerMergeDecision({
                label: "ready-to-land",
                pr: pr([file]),
                trusted: TRUSTED,
            });
            expect(d.notify, file).toBe(true);
            if (d.notify) expect(d.description).toContain(file);
        }
    });

    it("notifies for an untrusted author", () => {
        const d = ownerMergeDecision({
            label: "ready-to-land",
            pr: pr(["a.ts"], { author: "stranger" }),
            trusted: TRUSTED,
        });
        expect(d.notify).toBe(true);
    });

    it("stays silent for a queue-admitted PR", () => {
        const d = ownerMergeDecision({
            label: "ready-to-land",
            pr: pr(["scripts/a.ts"]),
            trusted: TRUSTED,
        });
        expect(d.notify).toBe(false);
    });

    it("stays silent on another label, even for a protected PR", () => {
        const d = ownerMergeDecision({
            label: "queue:held",
            pr: pr([".github/workflows/x.yml"]),
            trusted: TRUSTED,
        });
        expect(d.notify).toBe(false);
    });
});

describe("ownerMergeSummary", () => {
    it("carries the link, title, reason and checklist; a newline in a title cannot break it", () => {
        const s = ownerMergeSummary({
            prNumber: 42,
            prUrl: "https://github.com/o/r/pull/42",
            title: "a\nb",
            description: "touches .github/x — never queueable",
        });
        expect(s).toContain("[#42 — a b](https://github.com/o/r/pull/42)");
        expect(s).toContain("touches .github/x");
        expect(s).toContain("`base-health`");
    });
});
