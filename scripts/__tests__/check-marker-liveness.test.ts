import { describe, it, expect } from "vitest";
import {
    inScope,
    isStubContext,
    findRottenMarkers,
    markersBlockingClosure,
} from "../check-marker-liveness";
import type { MarkerRecord } from "../lib/divergence-markers";

/**
 * `scripts/check-marker-liveness.ts` (issue #2560) — the network-dependent
 * other half of Guard B, deliberately outside `check:all`/`check:guards`
 * (ADR 0098: the gate is offline by contract, same placement as `cr:check`
 * vs `cr:lint`). Per repo convention (`scripts/__tests__/land.test.ts`), the
 * `gh` plumbing (`resolveIssueStates`) stays thin and untested; every
 * DECISION the script makes is a pure function, tested here directly with
 * plain data standing in for what `gh` would have returned — no `gh` mock.
 */

function marker(over: Partial<MarkerRecord> = {}): MarkerRecord {
    return {
        file: "convex/gre/foo.ts",
        line: 10,
        tracked: true,
        text: "// DIVERGENCE (tracked-by: #123): …",
        issueNumbers: [123],
        ...over,
    };
}

describe("inScope — real markers live in compiled TS/JS, never prose (issue #2560)", () => {
    it("includes tracked TS/TSX/JS/MJS/MTS source", () => {
        expect(inScope("convex/gre/foo.ts")).toBe(true);
        expect(inScope("src/lib/bar.tsx")).toBe(true);
        expect(inScope("scripts/build-thing.mjs")).toBe(true);
        expect(inScope("convex/limited/events.mts")).toBe(true);
        expect(inScope("scripts/legacy.js")).toBe(true);
    });

    it("excludes markdown — a real marker is always a `//`-comment in compiled source; .claude/ and docs/ only ever SHOW that syntax as prose", () => {
        expect(inScope(".claude/rules/gre-development.md")).toBe(false);
        expect(inScope("docs/adr/0098-cr-vendored.md")).toBe(false);
    });

    it("excludes test fixtures — __tests__ dirs and *.test.ts files, including Guard B's own regression strings", () => {
        expect(
            inScope("convex/cards/__tests__/divergenceMarkers.test.ts")
        ).toBe(false);
        expect(inScope("convex/gre/__tests__/foo.test.ts")).toBe(false);
        expect(inScope("scripts/__tests__/check-marker-liveness.test.ts")).toBe(
            false
        );
        expect(inScope("src/lib/__tests__/card-utils.test.ts")).toBe(false);
    });

    it("excludes docs/findings/** drafts — exempt per the issue's acceptance criteria", () => {
        expect(inScope("docs/findings/2560-something.ts")).toBe(false);
    });
});

describe("isStubContext — commented-out card stubs are check-stub-coverage.ts's domain, out of scope here (issue #2560)", () => {
    it("flags a marker sitting in the same contiguous comment run as a commented-out card anchor", () => {
        const lines = [
            "// TODO(issue #676 stub — Boast is unbuilt, no primitive)",
            "// export const broadsideBombardiers: CardDefinition = {",
            '//     name: "Broadside Bombardiers",',
            "// };",
            "export {};",
        ];
        expect(isStubContext(lines, 0)).toBe(true);
    });

    it("does not flag a marker on an ACTIVE (non-commented) card — Guard B's actual domain", () => {
        const lines = [
            "// DIVERGENCE (tracked-by: #123): the second clause is unbuilt.",
            "export const foo: CardDefinition = {",
            '    name: "Foo",',
            "};",
        ];
        expect(isStubContext(lines, 0)).toBe(false);
    });

    it("a marker separated from any stub anchor by a non-comment line is not stub context", () => {
        const lines = [
            "// DIVERGENCE (tracked-by: #123): unrelated note.",
            "export const foo = 1;",
            '// export const bar: CardDefinition = { name: "Bar" };',
        ];
        expect(isStubContext(lines, 0)).toBe(false);
    });
});

describe("findRottenMarkers — the liveness verdict (issue #2560)", () => {
    it("flags a tracked marker naming a CLOSED issue", () => {
        const states = new Map<number, "OPEN" | "CLOSED">([[123, "CLOSED"]]);
        const rotten = findRottenMarkers([marker()], states);
        expect(rotten).toHaveLength(1);
        expect(rotten[0]).toMatchObject({
            file: "convex/gre/foo.ts",
            line: 10,
            closedIssues: [123],
        });
    });

    it("does not flag a tracked marker naming an OPEN issue", () => {
        const states = new Map<number, "OPEN" | "CLOSED">([[123, "OPEN"]]);
        expect(findRottenMarkers([marker()], states)).toEqual([]);
    });

    it("ignores an untracked marker even when its number is closed — Guard B's own presence check is a separate concern", () => {
        const states = new Map<number, "OPEN" | "CLOSED">([[123, "CLOSED"]]);
        expect(findRottenMarkers([marker({ tracked: false })], states)).toEqual(
            []
        );
    });

    it("ignores a tracked marker with no issue numbers (an out-of-scope disposition) — nothing to resolve", () => {
        const states = new Map<number, "OPEN" | "CLOSED">();
        expect(
            findRottenMarkers([marker({ issueNumbers: [] })], states)
        ).toEqual([]);
    });

    it("reports only the closed numbers when a marker names several, open and closed mixed", () => {
        const states = new Map<number, "OPEN" | "CLOSED">([
            [100, "CLOSED"],
            [200, "OPEN"],
        ]);
        const rotten = findRottenMarkers(
            [marker({ issueNumbers: [100, 200] })],
            states
        );
        expect(rotten).toHaveLength(1);
        expect(rotten[0].closedIssues).toEqual([100]);
    });
});

describe("markersBlockingClosure — the loop's umbrella-close refusal (issue #2560)", () => {
    it("blocks closure when a tracked marker still names the umbrella", () => {
        const blockers = markersBlockingClosure(
            [marker({ issueNumbers: [2200] })],
            2200
        );
        expect(blockers).toHaveLength(1);
    });

    it("allows closure when no tracked marker names the umbrella", () => {
        expect(
            markersBlockingClosure([marker({ issueNumbers: [999] })], 2200)
        ).toEqual([]);
    });

    it("an untracked marker's mention does not block — only a real disposition counts", () => {
        const blockers = markersBlockingClosure(
            [marker({ tracked: false, issueNumbers: [2200] })],
            2200
        );
        expect(blockers).toEqual([]);
    });
});
