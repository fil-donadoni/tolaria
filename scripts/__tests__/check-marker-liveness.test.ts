import { describe, it, expect } from "vitest";
import {
    inScope,
    isStubContext,
    findRottenMarkers,
    findUnresolvedMarkers,
    markersBlockingClosure,
    scanRepoMarkers,
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

    it("excludes markdown — a real marker is always a comment (`//` or `/** */`) in compiled source; .claude/ and docs/ only ever SHOW that syntax as prose", () => {
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

describe("scanRepoMarkers — resolves tracked-by: independent of Guard B's MARKER word (issue #2560 fixup round 1, finding 1)", () => {
    it("finds a per-card bullet paragraph with no marker word — the actual shape of most inv/white.ts stubs", () => {
        const sources = [
            {
                file: "convex/cards/sets/inv/white.ts",
                text: [
                    '// Atalya, Samite Master — "Spend only white mana on X."',
                    "// tracked-by: #1330 (no color-restricted X payment exists).",
                    "export {};",
                ].join("\n"),
            },
        ];
        const hits = scanRepoMarkers(sources);
        expect(hits).toHaveLength(1);
        expect(hits[0]).toMatchObject({
            file: "convex/cards/sets/inv/white.ts",
            tracked: true,
            issueNumbers: [1330],
        });
    });

    it("finds a tracked-by: inside a /** */ JSDoc block — scanText's `//`-only paragraph walk cannot reach these at all", () => {
        const sources = [
            {
                file: "convex/cards/types.ts",
                text: [
                    "/** Describes a field.",
                    " *  Still needs a follow-up (tracked-by: #2497).",
                    " */",
                    "export type Foo = { kind: string };",
                ].join("\n"),
            },
        ];
        const hits = scanRepoMarkers(sources);
        expect(hits).toHaveLength(1);
        expect(hits[0].issueNumbers).toEqual([2497]);
    });

    it("does not pick up a bare tracked-by-shaped string sitting in actual code (not a comment line)", () => {
        const sources = [
            {
                file: "convex/gre/foo.ts",
                text: 'const label = "tracked-by: #999"; // not a real disposition line prefix\n',
            },
        ];
        // The line itself IS a `//`-prefixed... no — this fixture's string
        // literal sits on a CODE line (`const label = …`), which does not
        // start with `//`/`/*`/`*`, so it must not be picked up even though
        // it contains the exact substring.
        expect(scanRepoMarkers(sources)).toEqual([]);
    });

    it("folds a `tracked-by:` that wraps onto the next `//` comment line before matching (issue #2560 fixup round 2, finding: reviewer proved a wrapped CLOSED ref hid from the sweep entirely — cd807cf7's `--umbrella 1086` proof)", () => {
        const sources = [
            {
                file: "convex/cards/sets/inv/multicolor.ts",
                text: [
                    "// trigger does not carry the Jacked Rabbit blink divergence (tracked-by:",
                    "// #2042).",
                    "export {};",
                ].join("\n"),
            },
        ];
        const hits = scanRepoMarkers(sources);
        expect(hits).toHaveLength(1);
        expect(hits[0]).toMatchObject({ line: 1, issueNumbers: [2042] });
    });

    it("folds a `tracked-by:` that wraps onto the next `/** */` JSDoc continuation line", () => {
        const sources = [
            {
                file: "convex/cards/types.ts",
                text: [
                    "/** Describes a field. Still needs a follow-up (tracked-by:",
                    " *  #2497).",
                    " */",
                    "export type Foo = { kind: string };",
                ].join("\n"),
            },
        ];
        const hits = scanRepoMarkers(sources);
        expect(hits).toHaveLength(1);
        expect(hits[0].issueNumbers).toEqual([2497]);
    });

    it("accepts a `tracked-by: <prefix>#NNN` form (`tracked-by: tolaria#1324`) that the plain #NNN shape missed even on one line", () => {
        const sources = [
            {
                file: "convex/cards/sets/woe/colorless.ts",
                text: [
                    "// TODO(tracked-by: tolaria#1324) — ability-copy mechanism unbuilt.",
                    "export {};",
                ].join("\n"),
            },
        ];
        const hits = scanRepoMarkers(sources);
        expect(hits).toHaveLength(1);
        expect(hits[0].issueNumbers).toEqual([1324]);
    });

    it("does NOT fold when the line after a bare `tracked-by:` is not a comment — no phantom cross-boundary match", () => {
        const sources = [
            {
                file: "convex/gre/foo.ts",
                text: [
                    "// some prose ending in tracked-by:",
                    "export const foo = 1; // #4242 is just code, not a fold target",
                ].join("\n"),
            },
        ];
        expect(scanRepoMarkers(sources)).toEqual([]);
    });

    it("still drops a stub-context hit even under the widened scan", () => {
        const sources = [
            {
                file: "convex/cards/sets/xyz/white.ts",
                text: [
                    "// TODO(issue #676 stub — Boast is unbuilt, tracked-by: #676)",
                    "// export const broadsideBombardiers: CardDefinition = {",
                    '//     name: "Broadside Bombardiers",',
                    "// };",
                    "export {};",
                ].join("\n"),
            },
        ];
        expect(scanRepoMarkers(sources)).toEqual([]);
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

    it("does NOT flag a marker whose issue is UNKNOWN (gh could not resolve it) — that is findUnresolvedMarkers's verdict, never rotten (fixup round 1, finding 5)", () => {
        const states = new Map<number, "OPEN" | "CLOSED" | "UNKNOWN">([
            [123, "UNKNOWN"],
        ]);
        expect(findRottenMarkers([marker()], states)).toEqual([]);
    });
});

describe("findUnresolvedMarkers — a broken gh token must not read as rot (issue #2560 fixup round 1, finding 5)", () => {
    it("flags a tracked marker whose issue gh could not resolve", () => {
        const states = new Map<number, "OPEN" | "CLOSED" | "UNKNOWN">([
            [123, "UNKNOWN"],
        ]);
        const unresolved = findUnresolvedMarkers([marker()], states);
        expect(unresolved).toHaveLength(1);
        expect(unresolved[0]).toMatchObject({
            file: "convex/gre/foo.ts",
            line: 10,
            unknownIssues: [123],
        });
    });

    it("does not flag a marker whose issue resolved cleanly, open or closed", () => {
        const openStates = new Map<number, "OPEN" | "CLOSED" | "UNKNOWN">([
            [123, "OPEN"],
        ]);
        expect(findUnresolvedMarkers([marker()], openStates)).toEqual([]);
        const closedStates = new Map<number, "OPEN" | "CLOSED" | "UNKNOWN">([
            [123, "CLOSED"],
        ]);
        expect(findUnresolvedMarkers([marker()], closedStates)).toEqual([]);
    });

    it("reports only the unknown numbers when a marker names several, resolved and unresolved mixed", () => {
        const states = new Map<number, "OPEN" | "CLOSED" | "UNKNOWN">([
            [100, "UNKNOWN"],
            [200, "OPEN"],
        ]);
        const unresolved = findUnresolvedMarkers(
            [marker({ issueNumbers: [100, 200] })],
            states
        );
        expect(unresolved).toHaveLength(1);
        expect(unresolved[0].unknownIssues).toEqual([100]);
    });

    it("ignores an untracked marker even when its number is unknown", () => {
        const states = new Map<number, "OPEN" | "CLOSED" | "UNKNOWN">([
            [123, "UNKNOWN"],
        ]);
        expect(
            findUnresolvedMarkers([marker({ tracked: false })], states)
        ).toEqual([]);
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
