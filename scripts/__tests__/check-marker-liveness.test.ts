import { describe, it, expect } from "vitest";
import {
    inScope,
    isStubContext,
    findRottenMarkers,
    findUnresolvedMarkers,
    markersBlockingClosure,
    scanRepoMarkers,
    readSources,
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

    it("does NOT resolve a `tracked-by: <foreign-prefix>#NNN` ref as a local issue (issue #2560 fixup round 3, finding 2: the prefix was a bare `[A-Za-z][\\w.-]*` word, so `tracked-by: otherrepo#12` and `tracked-by: v2#5` used to resolve as LOCAL issues 12 and 5 — confident nonsense about a foreign repo's numbering. The prefix is now anchored to the literal `tolaria`; anything else falls through unmatched. A slash-qualified prefix (`acme/otherrepo#12`) already fell through before this change since `/` sits outside the accepted character class)", () => {
        const sources = [
            {
                file: "convex/gre/foo.ts",
                text: [
                    "// tracked-by: otherrepo#12 and tracked-by: v2#5 and tracked-by: acme/otherrepo#12",
                    "export {};",
                ].join("\n"),
            },
        ];
        expect(scanRepoMarkers(sources)).toEqual([]);
    });

    it("does NOT fold when the line after a bare `tracked-by:` is not a comment — no phantom cross-boundary match (issue #2560 fixup round 3: the prior fixture never reached `COMMENT_LINE.test(lines[i + 1])` at all — its `#4242` sat mid-line on `export const foo = 1; // #4242 …`, so `TRACKED_BY_G` could not match it whether or not the guard ran, and deleting the guard left all 28 tests green. This fixture puts the `#NNN` at the very START of the next, non-comment line — the reviewer's own proof shape: without the guard this folds to `tracked-by: #4242` and matches; with the guard, the fold never happens and nothing matches)", () => {
        const sources = [
            {
                file: "convex/gre/foo.ts",
                text: [
                    "// dangling tracked-by:",
                    "#4242 raw non-comment line",
                ].join("\n"),
            },
        ];
        expect(scanRepoMarkers(sources)).toEqual([]);
    });

    it("KNOWN FALSE POSITIVE (pinned, not fixed — issue #2560 fixup round 3, finding 1): prose ending in the literal words `tracked-by:` folds with an unrelated issue number on the next comment line. `TRACKED_BY_TAIL` cannot distinguish a genuine wrapped reference from a sentence that merely ends in those words, and `COMMENT_LINE.test(lines[i + 1])` only requires the next line to BE a comment, not that it continues the same clause. Zero instances of this shape exist in the repo today (grepped at fixup time), so this is not a live false green — but it is reachable, and the module note above documents it. Do not extend this fixture's shape or 'fix' it without updating the note.", () => {
        const sources = [
            {
                file: "convex/gre/foo.ts",
                text: [
                    "// no live ticket; nothing is tracked-by:",
                    "// #4242 was closed as a duplicate.",
                ].join("\n"),
            },
        ];
        const hits = scanRepoMarkers(sources);
        expect(hits).toHaveLength(1);
        expect(hits[0].issueNumbers).toEqual([4242]);
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

    describe("TODO(issue #NNN) syntax — the second live-ref shape resolved (issue #1841)", () => {
        it("resolves a `TODO(issue #NNN)` ref outside stub context, same as `tracked-by:` — the exact shape that hid dsk/red.ts's and mh3/colorless.ts's stale #691 refs from markers:lint before this fix", () => {
            const sources = [
                {
                    file: "convex/cards/sets/dsk/red.ts",
                    text: [
                        "// TODO(issue #691): Delirium attack trigger — additional combat",
                        "// phase not yet modeled.",
                        "export {};",
                    ].join("\n"),
                },
            ];
            const hits = scanRepoMarkers(sources);
            expect(hits).toHaveLength(1);
            expect(hits[0]).toMatchObject({
                tracked: true,
                issueNumbers: [691],
            });
        });

        it("resolves the `TODO(issue #NNN stub)` spelling too — the word `stub` in the parens does not by itself make this stub CONTEXT (that is `isStubContext`'s job, based on an adjacent commented-out `export const`, not on this word)", () => {
            const sources = [
                {
                    file: "convex/cards/sets/dsk/red.ts",
                    text: [
                        "// Silence — TODO(issue #691 stub): needs a proper implementation.",
                        "export {};",
                    ].join("\n"),
                },
            ];
            const hits = scanRepoMarkers(sources);
            expect(hits).toHaveLength(1);
            expect(hits[0].issueNumbers).toEqual([691]);
        });

        it("still drops a `TODO(issue #NNN stub)` hit sitting in REAL stub context (the same contiguous-comment-run + STUB_ANCHOR test as the tracked-by: shape) — the 26-of-29 majority this widening must not turn into false reds", () => {
            const sources = [
                {
                    file: "convex/cards/sets/mh1/white.ts",
                    text: [
                        "// TODO(issue #676 stub — Overload is unbuilt, no primitive)",
                        "// export const windsOfAbandon: CardDefinition = {",
                        '//     name: "Winds of Abandon",',
                        "// };",
                        "export {};",
                    ].join("\n"),
                },
            ];
            expect(scanRepoMarkers(sources)).toEqual([]);
        });

        it("does not fold a `TODO(issue #NNN` opener across a line break — every real site keeps the number on the same line (see TODO_ISSUE_G's own module comment)", () => {
            const sources = [
                {
                    file: "convex/gre/foo.ts",
                    text: [
                        "// TODO(issue",
                        "// #691): split across lines, not a real site shape.",
                    ].join("\n"),
                },
            ];
            expect(scanRepoMarkers(sources)).toEqual([]);
        });
    });

    describe("real-repo census (issue #1841) — pins the exact split so a future widening cannot quietly swallow the stub majority", () => {
        const TODO_ISSUE_LINE = /\/\/.*TODO\(\s*issue\s*#\d+/i;

        it("every `TODO(issue #NNN)` comment left in tracked, non-test source sits in stub context (26 sites) — none reach scanRepoMarkers as a live ref, because the three that used to (dsk/red.ts x2, mh3/colorless.ts) were converted to canonical `tracked-by:` by this issue's own fix", () => {
            const sources = readSources();
            let rawHits = 0;
            for (const { text } of sources) {
                for (const line of text.split("\n")) {
                    if (TODO_ISSUE_LINE.test(line)) rawHits++;
                }
            }
            expect(rawHits).toBe(26);

            const liveHitsUsingThisSyntax = scanRepoMarkers(sources).filter(
                (m) => TODO_ISSUE_LINE.test(m.text)
            );
            expect(liveHitsUsingThisSyntax).toEqual([]);
        });

        it("dsk/red.ts and mh3/colorless.ts no longer name the closed #691 anywhere — repointed to #2494 (Fear of Missing Out's attack trigger) or #1841 (orphan bucket, no live successor)", () => {
            const hits = scanRepoMarkers(readSources()).filter((m) =>
                /dsk\/red\.ts|mh3\/colorless\.ts/.test(m.file)
            );
            expect(hits.length).toBeGreaterThanOrEqual(3);
            for (const h of hits) {
                expect(h.issueNumbers).not.toContain(691);
            }
            const allNumbers = new Set(hits.flatMap((h) => h.issueNumbers));
            expect(allNumbers.has(2494)).toBe(true);
            expect(allNumbers.has(1841)).toBe(true);
        });
    });
});

describe("end-to-end: TODO(issue #NNN) reds the sweep exactly like tracked-by: (issue #1841)", () => {
    it("a TODO(issue #NNN) marker OUTSIDE stub context naming a CLOSED issue is now caught rotten — the exact gap #1841 closes (dsk/red.ts and mh3/colorless.ts named the closed #691 this way and markers:lint reported clean)", () => {
        const sources = [
            {
                file: "convex/cards/sets/dsk/red.ts",
                text: [
                    "// TODO(issue #691): Delirium attack trigger — additional combat",
                    "// phase not yet modeled.",
                    "export {};",
                ].join("\n"),
            },
        ];
        const markers = scanRepoMarkers(sources);
        const states = new Map<number, "OPEN" | "CLOSED">([[691, "CLOSED"]]);
        expect(findRottenMarkers(markers, states)).toHaveLength(1);
    });

    it("the SAME closed-issue TODO(issue #NNN) note sitting in REAL stub context stays green — check-stub-coverage.ts's domain, not this sweep's", () => {
        const sources = [
            {
                file: "convex/cards/sets/mh1/white.ts",
                text: [
                    "// TODO(issue #691 stub — hypothetically closed, unbuilt)",
                    "// export const someStub: CardDefinition = {",
                    '//     name: "Some Stub",',
                    "// };",
                    "export {};",
                ].join("\n"),
            },
        ];
        const markers = scanRepoMarkers(sources);
        const states = new Map<number, "OPEN" | "CLOSED">([[691, "CLOSED"]]);
        expect(markers).toEqual([]);
        expect(findRottenMarkers(markers, states)).toEqual([]);
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
