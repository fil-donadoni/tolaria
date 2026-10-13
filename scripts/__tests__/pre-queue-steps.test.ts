import { describe, expect, it } from "vitest";
import { classifyLane, type RelatedTests } from "../check-lane";
import { runPreQueue } from "../land-ready";
import { EXCLUDED_FROM_PRE_QUEUE, preQueueSteps } from "../lib/pre-queue-steps";

const none: RelatedTests = {
    "node-engine": [],
    "node-tooling": [],
    dom: [],
};
const related = (reach: Partial<RelatedTests>) => () => ({ ...none, ...reach });

describe("preQueueSteps — the lane's own plan, filtered (issue #5554)", () => {
    it("keeps every step the engine lane plans except the not-seconds-cost ones", () => {
        const files = ["convex/gre/foo.ts"];
        const plan = classifyLane(
            files,
            files,
            related({ "node-engine": ["convex/gre/__tests__/foo.test.ts"] })
        );
        const { run } = preQueueSteps(plan, [], files);
        // Derived, not declared: every planned id survives unless excluded.
        const kept = plan.run
            .filter((c) => !(c.id in EXCLUDED_FROM_PRE_QUEUE))
            .map((c) => c.id);
        expect(run.map((c) => c.id)).toEqual(kept);
        expect(run.map((c) => c.id)).toContain("tsc[all]");
        expect(run.map((c) => c.id)).toContain("cr:lint");
    });

    it("drops a vitest run that resolves to a whole project, with a reason", () => {
        const files = ["convex/gre/types.ts"];
        const reach = Array.from({ length: 401 }, (_, i) => `t${i}.test.ts`);
        const plan = classifyLane(
            files,
            files,
            related({ "node-engine": reach })
        );
        const { run, skip } = preQueueSteps(plan, [], files);
        expect(run.map((c) => c.id)).not.toContain("vitest(related)");
        expect(skip.map((s) => s.id)).toContain("vitest(related)");
    });

    it("drops check:pr from a full-lane diff but keeps its cheap guards", () => {
        const files = ["package.json", "src/a.tsx", "convex/b.ts"];
        const plan = classifyLane(files, files, related({}));
        const { run } = preQueueSteps(plan, [], files);
        expect(run.map((c) => c.id)).not.toContain("check:pr");
        expect(run.map((c) => c.id)).toEqual(
            expect.arrayContaining(["tsc[all]", "cr:lint", "format(diff)"])
        );
        expect(run.map((c) => c.id)).toContain("check:gaps");
    });

    it("a NEW scripts test file also runs the docs-lane census", () => {
        const added = ["scripts/__tests__/brand-new.test.ts"];
        const plan = classifyLane(added, added, related({}));
        const { run } = preQueueSteps(plan, added, added);
        const guard = run.find((c) => c.id === "vitest(new-file guards)");
        expect(guard?.command).toContain("scripts/__tests__/docs-lane.test.ts");
    });

    it("a MODIFIED test file does not pull the new-file guards", () => {
        const files = ["scripts/__tests__/old.test.ts"];
        const plan = classifyLane(files, files, related({}));
        const { run } = preQueueSteps(plan, [], files);
        expect(run.map((c) => c.id)).not.toContain("vitest(new-file guards)");
    });

    it("runs a touched test file the lane did not plan (cards diff)", () => {
        const files = ["convex/cards/sets/x.test.ts"];
        const plan = classifyLane(files, files, related({}));
        const { run } = preQueueSteps(plan, [], files);
        expect(run.find((c) => c.id === "vitest(touched)")?.command).toContain(
            "convex/cards/sets/x.test.ts"
        );
    });
});

describe("runPreQueue — red refuses", () => {
    const files = ["convex/gre/foo.ts"];
    const plan = classifyLane(files, files, related({}));
    const run = (failing: string | null) =>
        runPreQueue({
            plan,
            added: [],
            present: files,
            log: () => undefined,
            exec: (command) => ({
                ok: failing === null || !command.includes(failing),
                ms: 1,
            }),
        });

    it("a type error (tsc[all] red) is reported as the failing step", () => {
        expect(run("bun run check:ts").failed).toBe("tsc[all]");
    });

    it("an unclassified new test file (docs-lane census red) is reported", () => {
        const added = ["scripts/__tests__/brand-new.test.ts"];
        const r = runPreQueue({
            plan: classifyLane(added, added, related({})),
            added,
            present: added,
            log: () => undefined,
            exec: (command) => ({
                ok: !command.includes("docs-lane.test.ts"),
                ms: 1,
            }),
        });
        expect(r.failed).toBe("vitest(new-file guards)");
    });

    it("all green → null", () => {
        expect(run(null).failed).toBeNull();
    });
});
