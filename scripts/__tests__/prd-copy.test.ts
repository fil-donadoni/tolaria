/**
 * `prd:copy` (issue #4053) — PRD hygiene by copy, issue #3851 decision 6. A
 * STUB tracker, exactly the `gap-issues.test.ts` / `gaps-sync.test.ts`
 * pattern: no network, every count derivable by hand.
 */

import { describe, expect, it } from "vitest";
import {
    appendCopyPointer,
    buildCopyBody,
    isRefusal,
    planCopy,
    runCopy,
    type PrdChild,
    type PrdIssue,
    type PrdTracker,
} from "../prd-copy";
import type { BoardPriority } from "../lib/board-priority";

function child(number: number, state: "OPEN" | "CLOSED"): PrdChild {
    return { number, state };
}

function prd(overrides: Partial<PrdIssue> = {}): PrdIssue {
    return {
        number: 100,
        title: "[Test] A PRD",
        body: "Original body.",
        state: "OPEN",
        labels: ["prd", "area:workflow"],
        parent: 1,
        children: [],
        ...overrides,
    };
}

class StubTracker implements PrdTracker {
    private nextNumber = 5000;
    readonly issues = new Map<number, PrdIssue>();
    /** child -> parent, confirmed edges only. */
    readonly parents = new Map<number, number>();
    readonly priorities = new Map<number, BoardPriority>();
    readonly closed = new Set<number>();
    createCalls = 0;
    /** Set of children to FAIL to re-parent, simulating an unconfirmed edge. */
    failParentFor = new Set<number>();

    seed(issue: PrdIssue): void {
        this.issues.set(issue.number, issue);
    }

    getIssue(number: number): PrdIssue | null {
        return this.issues.get(number) ?? null;
    }

    createIssue(input: {
        title: string;
        body: string;
        labels: readonly string[];
    }): number {
        this.createCalls += 1;
        const number = this.nextNumber++;
        this.issues.set(number, {
            number,
            title: input.title,
            body: input.body,
            state: "OPEN",
            labels: [...input.labels],
            parent: null,
            children: [],
        });
        return number;
    }

    updateBody(number: number, body: string): void {
        const existing = this.issues.get(number);
        if (existing === undefined) throw new Error(`no issue #${number}`);
        this.issues.set(number, { ...existing, body });
    }

    setParent(childNumber: number, parent: number): boolean {
        if (this.failParentFor.has(childNumber)) return false;
        this.parents.set(childNumber, parent);
        return true;
    }

    closeIssue(number: number): void {
        this.closed.add(number);
        const existing = this.issues.get(number);
        if (existing !== undefined)
            this.issues.set(number, { ...existing, state: "CLOSED" });
    }

    subIssueCount(parent: number): number {
        let n = 0;
        for (const p of this.parents.values()) if (p === parent) n += 1;
        return n;
    }

    getPriority(number: number): BoardPriority | null {
        return this.priorities.get(number) ?? null;
    }

    setPriority(number: number, priority: BoardPriority): void {
        this.priorities.set(number, priority);
    }
}

describe("planCopy — refuses a PRD with no closed children", () => {
    it("refuses when every child is open", () => {
        const issue = prd({ children: [child(1, "OPEN"), child(2, "OPEN")] });
        const plan = planCopy(issue);
        expect(isRefusal(plan)).toBe(true);
        if (!isRefusal(plan)) throw new Error("expected a refusal");
        expect(plan.refused).toMatch(/no closed children/);
    });

    it("refuses when there are no children at all", () => {
        const plan = planCopy(prd({ children: [] }));
        expect(isRefusal(plan)).toBe(true);
    });

    it("plans a split once at least one child is closed", () => {
        const issue = prd({
            children: [child(1, "OPEN"), child(2, "CLOSED"), child(3, "OPEN")],
        });
        const plan = planCopy(issue);
        expect(isRefusal(plan)).toBe(false);
        if (isRefusal(plan)) throw new Error("expected a plan");
        expect(plan.openChildren).toEqual([1, 3]);
        expect(plan.closedChildren).toEqual([2]);
        expect(plan.parent).toBe(1);
        expect(plan.labels).toEqual(["prd", "area:workflow"]);
    });
});

describe("body pointers — bidirectional, original never rewritten beyond the pointer", () => {
    it("the copy's body points back at the original", () => {
        const body = buildCopyBody("Original content.", 100);
        expect(body).toContain("Original content.");
        expect(body).toContain("Continued from issue #100");
    });

    it("the original's body keeps its content and gains a forward pointer", () => {
        const body = appendCopyPointer("Original content.", 5001);
        expect(body).toContain("Original content.");
        expect(body).toContain("Continued in issue #5001");
    });
});

describe("runCopy — against the stubbed tracker", () => {
    it("the copy carries only the open children; subIssueCount equals that count; closed children stay under the original", () => {
        const tracker = new StubTracker();
        const original = prd({
            number: 100,
            parent: 1,
            children: [
                child(10, "OPEN"),
                child(11, "CLOSED"),
                child(12, "OPEN"),
                child(13, "CLOSED"),
            ],
        });
        tracker.seed(original);
        tracker.seed(prd({ number: 10, children: [] }));
        tracker.seed(prd({ number: 12, children: [] }));
        tracker.seed(prd({ number: 11, children: [] }));
        tracker.seed(prd({ number: 13, children: [] }));

        const plan = planCopy(original);
        if (isRefusal(plan)) throw new Error("expected a plan");
        const result = runCopy(tracker, plan, original.body);

        expect(tracker.subIssueCount(result.copy)).toBe(2);
        expect(tracker.parents.get(10)).toBe(result.copy);
        expect(tracker.parents.get(12)).toBe(result.copy);
        // Closed children were never touched — no parent edge written for them.
        expect(tracker.parents.has(11)).toBe(false);
        expect(tracker.parents.has(13)).toBe(false);
    });

    it("the copy inherits parent, labels and board Priority; the original is closed and points at the copy", () => {
        const tracker = new StubTracker();
        const original = prd({
            number: 100,
            parent: 7,
            labels: ["prd", "area:cards"],
            children: [child(20, "OPEN"), child(21, "CLOSED")],
        });
        tracker.seed(original);
        tracker.priorities.set(100, "P1");

        const plan = planCopy(original);
        if (isRefusal(plan)) throw new Error("expected a plan");
        const result = runCopy(tracker, plan, original.body);

        expect(tracker.parents.get(result.copy)).toBe(7);
        expect(tracker.issues.get(result.copy)?.labels).toEqual([
            "prd",
            "area:cards",
        ]);
        expect(tracker.priorities.get(result.copy)).toBe("P1");
        expect(tracker.closed.has(100)).toBe(true);
        expect(tracker.issues.get(100)?.body).toContain(
            `Continued in issue #${result.copy}`
        );
        expect(tracker.issues.get(result.copy)?.body).toContain(
            "Continued from issue #100"
        );
    });

    it("a PRD with no parent leaves the copy unparented", () => {
        const tracker = new StubTracker();
        const original = prd({
            number: 100,
            parent: null,
            children: [child(30, "OPEN"), child(31, "CLOSED")],
        });
        tracker.seed(original);

        const plan = planCopy(original);
        if (isRefusal(plan)) throw new Error("expected a plan");
        const result = runCopy(tracker, plan, original.body);

        expect(tracker.parents.has(result.copy)).toBe(false);
    });

    it("throws and does not close the original when the copy's parent edge cannot be confirmed", () => {
        const tracker = new StubTracker();
        const original = prd({
            number: 100,
            parent: 1,
            children: [child(40, "OPEN"), child(41, "CLOSED")],
        });
        tracker.seed(original);
        // Fail the NEXT createIssue's number's re-parent — stub tracker
        // reveals it deterministically since createIssue is called once
        // before setParent.
        const nextCopyNumber = 5000;
        tracker.failParentFor.add(nextCopyNumber);

        const plan = planCopy(original);
        if (isRefusal(plan)) throw new Error("expected a plan");
        expect(() => runCopy(tracker, plan, original.body)).toThrow(
            /could not confirm/
        );
        expect(tracker.closed.has(100)).toBe(false);
    });

    it("throws and does not close the original when a child's re-parent cannot be confirmed", () => {
        const tracker = new StubTracker();
        const original = prd({
            number: 100,
            parent: 1,
            children: [child(50, "OPEN"), child(51, "CLOSED")],
        });
        tracker.seed(original);
        tracker.failParentFor.add(50);

        const plan = planCopy(original);
        if (isRefusal(plan)) throw new Error("expected a plan");
        expect(() => runCopy(tracker, plan, original.body)).toThrow(
            /could not confirm/
        );
        expect(tracker.closed.has(100)).toBe(false);
    });

    it("a dry run (planCopy alone) performs no write at all", () => {
        const tracker = new StubTracker();
        const original = prd({
            number: 100,
            children: [child(60, "OPEN"), child(61, "CLOSED")],
        });
        tracker.seed(original);

        planCopy(original);

        expect(tracker.createCalls).toBe(0);
        expect(tracker.closed.size).toBe(0);
        expect(tracker.parents.size).toBe(0);
    });
});
