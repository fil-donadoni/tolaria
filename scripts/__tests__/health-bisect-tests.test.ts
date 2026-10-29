import { describe, expect, it } from "vitest";
import {
    bisectCulprits,
    bisectTests,
    culpritLines,
    failedTests,
    LADDER_MARK,
    testKey,
    vitestCommands,
    type TestProbe,
    type VitestCommand,
} from "../lib/health-bisect";
import {
    buildEvidence,
    evidenceTests,
    failLines,
    type FailingTest,
} from "../lib/health-evidence";
import { parseCulprits } from "../lib/health-ladder";

/**
 * The RED ladder's bisect judges the RED's failing TESTS, not their files
 * (issue #7339): a blade entry goes to a shard file by its index in the
 * tier's list, so the file a RED saw it fail in holds other entries at an
 * earlier commit — a probe of that file read green, and the bisect blamed
 * the commit that only moved the entry back into it (RED @ `8aca6581`
 * named PR #7320, a revert, for PR #7299's failure).
 */

const DIR = "convex/gre/ai/blade/__tests__";
const SHARDS = 4;
const shardFile = (s: number) => `${DIR}/blade.shard-${s}.spec.ts`;
const suite = (s: number) =>
    `blade suite — must tier — shard ${s + 1}/${SHARDS}`;

const LAND_TYPE =
    "land-type change: Reef Shaman makes a Mountain for the Lightning Bolt in hand";
const DISENCHANT =
    "symmetric life engine: Disenchant takes the Karma burning the bot's Swamps, not the 2-MV artifact (issue #5574)";

/** A FAIL line as vitest prints it under a colour-forcing environment. */
function colouredFail(file: string, ...names: string[]): string {
    return `\u001b[41m\u001b[1m FAIL \u001b[22m\u001b[49m \u001b[30m\u001b[42m blade \u001b[49m\u001b[39m ${file}${names.map((n) => `\u001b[2m > \u001b[22m${n}`).join("")}`;
}

describe("the failing tests a vitest run names (issue #7339)", () => {
    it("reads the file and the full test name off a blade shard line, either label form", () => {
        expect(
            failLines(colouredFail(shardFile(0), suite(0), LAND_TYPE))
        ).toEqual([
            {
                project: "blade",
                file: shardFile(0),
                name: `${suite(0)} > ${LAND_TYPE}`,
            },
        ]);
        expect(
            failLines(
                ` FAIL  |node-engine| scripts/__tests__/x.test.ts > a suite > a test\n`
            )
        ).toEqual([
            {
                project: "node-engine",
                file: "scripts/__tests__/x.test.ts",
                name: "a suite > a test",
            },
        ]);
    });
    it("names no test on a whole-file FAIL line", () => {
        expect(
            failLines(
                " FAIL  |node-engine| scripts/__tests__/x.test.ts [ scripts/__tests__/x.test.ts ]\n"
            )
        ).toEqual([
            { project: "node-engine", file: "scripts/__tests__/x.test.ts" },
        ]);
    });
    it("takes the RED's tests off its evidence: the named ones, a file no line names as a whole", () => {
        const ev = buildEvidence({
            sha: "a".repeat(40),
            step: "test",
            machine: "huawei",
            logPath: "/tmp/x.log",
            output: [
                colouredFail(shardFile(0), suite(0), LAND_TYPE),
                colouredFail(shardFile(2), suite(2), DISENCHANT),
                colouredFail(shardFile(0), suite(0), LAND_TYPE),
                " FAIL  |node-engine| scripts/__tests__/broken.test.ts [ scripts/__tests__/broken.test.ts ]",
            ].join("\n"),
            status: 1,
            signal: null,
            at: "2026-10-28T00:00:00Z",
        });
        expect(evidenceTests(ev.body)).toEqual([
            { file: shardFile(0), name: `${suite(0)} > ${LAND_TYPE}` },
            { file: shardFile(2), name: `${suite(2)} > ${DISENCHANT}` },
            { file: "scripts/__tests__/broken.test.ts" },
        ]);
        expect(bisectTests(null, ["a.test.ts"])).toEqual([
            { file: "a.test.ts" },
        ]);
    });
});

describe("a blade probe selects the entry by label, never one shard file", () => {
    const entry: FailingTest = {
        file: shardFile(0),
        name: `${suite(0)} > casts Bolt`,
    };
    const [cmd] = vitestCommands([entry]);

    it("runs the whole shard family under the blade's config, by name", () => {
        expect(cmd.args).toEqual([
            "vitest",
            "run",
            "--config",
            "vitest.blade.config.ts",
            `${DIR}/blade.shard-`,
            "-t",
            expect.any(String),
        ]);
        expect(cmd.args).not.toContain(shardFile(0));
        expect(cmd.env).toEqual({ BLADE_TIER: "must" });
    });
    it("its name pattern matches the entry in any shard, and no other entry", () => {
        const pattern = new RegExp(cmd.args.at(-1)!);
        // vitest's full name: the suites and the test's own, space-joined.
        for (let s = 0; s < SHARDS; s++)
            expect(pattern.test(`${suite(s)} casts Bolt`)).toBe(true);
        expect(pattern.test(`${suite(1)} never casts Bolt`)).toBe(false);
        expect(pattern.test(`${suite(1)} casts Bolt twice`)).toBe(false);
    });
    it("one entry is one key, whichever shard file a run saw it in", () => {
        expect(
            testKey({ file: shardFile(3), name: `${suite(3)} > casts Bolt` })
        ).toBe(testKey(entry));
    });
    it("whole files and named tests never share a command", () => {
        const cmds = vitestCommands([
            { file: "scripts/__tests__/a.test.ts" },
            { file: "scripts/__tests__/b.test.ts", name: "s > t" },
        ]);
        expect(cmds.map((c) => c.args)).toEqual([
            ["vitest", "run", "scripts/__tests__/a.test.ts"],
            [
                "vitest",
                "run",
                "scripts/__tests__/b.test.ts",
                "-t",
                "(?:(?:^| )s t$)",
            ],
        ]);
    });
    it("a whole shard file runs as its family in a probe, as itself in the fresh run", () => {
        expect(vitestCommands([{ file: shardFile(2) }])[0].args).toEqual([
            "vitest",
            "run",
            "--config",
            "vitest.blade.config.ts",
            `${DIR}/blade.shard-`,
        ]);
        expect(
            vitestCommands([{ file: shardFile(2) }], { exactFiles: true })[0]
                .args
        ).toEqual([
            "vitest",
            "run",
            "--config",
            "vitest.blade.config.ts",
            shardFile(2),
        ]);
    });
    it("a failed run naming none of its tests fails them all; an exit 0 none", () => {
        expect(failedTests(cmd, { status: 1, output: "Killed\n" })).toEqual([
            entry,
        ]);
        expect(failedTests(cmd, { status: 0, output: "" })).toEqual([]);
        expect(
            failedTests(
                {
                    tests: [
                        entry,
                        { file: shardFile(1), name: `${suite(1)} > other` },
                    ],
                },
                {
                    status: 1,
                    output: colouredFail(shardFile(2), suite(2), "casts Bolt"),
                }
            )
        ).toEqual([entry]);
        // Another test the name filter caught failed: not a crash.
        expect(
            failedTests(cmd, {
                status: 1,
                output: colouredFail(
                    shardFile(1),
                    suite(1),
                    "never casts Bolt"
                ),
            })
        ).toEqual([]);
    });
});

/**
 * A fake base history, one blade registry per commit, sharded by index modulo
 * the shard count as `bladeShardOf` does; a fake vitest runs a command
 * against it the way the real one would — file filters as substrings, `-t`
 * against the space-joined full name — and prints a FAIL line per failing
 * entry it ran.
 */
type Registry = { label: string; ok: boolean }[];

function fakeVitest(registry: Registry, cmd: VitestCommand) {
    const t = cmd.args.indexOf("-t");
    const pattern = t === -1 ? null : new RegExp(cmd.args[t + 1]);
    const filters = cmd.args
        .slice(2, t === -1 ? undefined : t)
        .filter((a) => a !== "--config" && a !== "vitest.blade.config.ts");
    const fails: string[] = [];
    registry.forEach((e, index) => {
        const s = index % SHARDS;
        if (!filters.some((f) => shardFile(s).includes(f))) return;
        if (pattern && !pattern.test(`${suite(s)} ${e.label}`)) return;
        if (!e.ok)
            fails.push(
                ` FAIL  |blade| ${shardFile(s)} > ${suite(s)} > ${e.label}`
            );
    });
    return { status: fails.length > 0 ? 1 : 0, output: fails.join("\n") };
}

function probeOf(history: Record<string, Registry>) {
    return (sha: string, tests: readonly FailingTest[]): TestProbe =>
        vitestCommands(tests).flatMap((c) =>
            failedTests(c, fakeVitest(history[sha], c))
        );
}

const filler = (n: number, from = 0): Registry =>
    Array.from({ length: n }, (_, i) => ({
        label: `filler ${from + i}`,
        ok: true,
    }));

/** The RED's failing test, as the RED's own run named it at `sha`. */
function redTest(registry: Registry, label: string): FailingTest {
    const s = registry.findIndex((e) => e.label === label) % SHARDS;
    return { file: shardFile(s), name: `${suite(s)} > ${label}` };
}

describe("the bisect names the commit that broke an entry, not the one that moved it (issue #7339)", () => {
    it("an entry that changed shard files between the GREEN and the RED", () => {
        // GREEN: the entry at index 4 (shard 0). c1 adds an entry before it
        // (index 5, shard 1); c2 breaks it; c3 reverts c1, moving it back to
        // shard 0, where the RED sees it fail.
        const history: Record<string, Registry> = {
            c1: [...filler(5), { label: LAND_TYPE, ok: true }, ...filler(3, 5)],
            c2: [
                ...filler(5),
                { label: LAND_TYPE, ok: false },
                ...filler(3, 5),
            ],
            c3: [
                ...filler(4),
                { label: LAND_TYPE, ok: false },
                ...filler(3, 5),
            ],
            c4: [
                ...filler(4),
                { label: LAND_TYPE, ok: false },
                ...filler(4, 5),
            ],
        };
        const failing = redTest(history.c4, LAND_TYPE);
        expect(failing.file).toBe(shardFile(0));
        const report = bisectCulprits(
            ["c1", "c2", "c3", "c4"],
            [failing],
            probeOf(history)
        );
        expect(report.found.map((f) => f.culprit)).toEqual(["c2"]);
        expect(report.unexplained).toBeNull();
    });
    it("an entry the commit does not have yet is green there", () => {
        const history: Record<string, Registry> = {
            c1: filler(6),
            c2: [...filler(6), { label: LAND_TYPE, ok: false }],
            c3: [...filler(6), { label: LAND_TYPE, ok: false }],
        };
        const report = bisectCulprits(
            ["c1", "c2", "c3"],
            [redTest(history.c3, LAND_TYPE)],
            probeOf(history)
        );
        expect(report.found.map((f) => f.culprit)).toEqual(["c2"]);
    });
    it("a name that selects nothing blames no commit, the tip included", () => {
        // A suite's hook fails: its FAIL line names the suite, which no
        // test's full name ends with.
        const history: Record<string, Registry> = {
            c1: filler(6),
            c2: filler(6),
            c3: filler(6),
        };
        const suiteOnly = { file: shardFile(0), name: suite(0) };
        const report = bisectCulprits(
            ["c1", "c2", "c3"],
            [suiteOnly],
            probeOf(history)
        );
        expect(report.found).toEqual([]);
        expect(report.unexplained?.tests).toEqual([suiteOnly]);
        expect(report.unexplained?.reason).toMatch(/no probe reproduced it/);
        expect(report.probes.at(-1)).toEqual({ sha: "c3", outcome: "green" });
    });
});

describe("two failures two commits caused: both culprits named (issue #7339)", () => {
    // RED @ e28d716d6: a Disenchant entry (PR #7296) and the land-type
    // entry (PR #7299), one bisect.
    const history: Record<string, Registry> = {
        c1c1c1c1: [
            ...filler(6),
            { label: DISENCHANT, ok: true },
            { label: LAND_TYPE, ok: true },
        ],
        c2c2c2c2: [
            ...filler(6),
            { label: DISENCHANT, ok: false },
            { label: LAND_TYPE, ok: true },
        ],
        c3c3c3c3: [
            ...filler(6),
            { label: DISENCHANT, ok: false },
            { label: LAND_TYPE, ok: true },
        ],
        c4c4c4c4: [
            ...filler(6),
            { label: DISENCHANT, ok: false },
            { label: LAND_TYPE, ok: false },
        ],
        c5c5c5c5: [
            ...filler(6),
            { label: DISENCHANT, ok: false },
            { label: LAND_TYPE, ok: false },
        ],
    };
    const commits = [
        "c1c1c1c1",
        "c2c2c2c2",
        "c3c3c3c3",
        "c4c4c4c4",
        "c5c5c5c5",
    ];
    const failing = [
        redTest(history.c5c5c5c5, DISENCHANT),
        redTest(history.c5c5c5c5, LAND_TYPE),
    ];
    const subjects: Record<string, string> = {
        c2c2c2c2: "Disenchant change (#7296)",
        c4c4c4c4: "land-type change (#7299)",
    };

    it("names each culprit with the tests it explains, oldest first", () => {
        const report = bisectCulprits(commits, failing, probeOf(history));
        expect(report.found).toEqual([
            { culprit: "c2c2c2c2", tests: [failing[0]] },
            { culprit: "c4c4c4c4", tests: [failing[1]] },
        ]);
        expect(report.unexplained).toBeNull();
        const lines = culpritLines({
            report,
            total: 2,
            good: "c0c0c0c0",
            commits: commits.length,
            subjectOf: (sha) => subjects[sha],
        });
        expect(lines).toHaveLength(2);
        expect(lines[0]).toMatch(
            /^- \*\*culprit:\*\* PR #7296 · `c2c2c2c2`.* explains 1 of 2 failing test\(s\): `symmetric life engine/
        );
        expect(lines[1]).toMatch(
            /^- \*\*culprit:\*\* PR #7299 · `c4c4c4c4`.* explains 1 of 2 failing test\(s\): `land-type change/
        );
        // The revert rung reads every one, the oldest first (issue #7446).
        expect(parseCulprits(lines.join("\n"))).toEqual([
            { sha: "c2c2c2c2", pr: 7296 },
            { sha: "c4c4c4c4", pr: 7299 },
        ]);
    });
    it("names the failures it could not explain — never drops them", () => {
        const probe = probeOf(history);
        const report = bisectCulprits(commits, failing, (sha, tests) =>
            sha === "c4c4c4c4" ? "infra" : probe(sha, tests)
        );
        expect(report.found.map((f) => f.culprit)).toEqual(["c2c2c2c2"]);
        expect(report.unexplained?.tests).toEqual([failing[1]]);
        const lines = culpritLines({
            report,
            total: 2,
            good: "c0c0c0c0",
            commits: commits.length,
            subjectOf: (sha) => subjects[sha],
        });
        expect(lines.at(-1)).toMatch(
            new RegExp(
                `^${LADDER_MARK.replace(/[*]/g, "\\*")}not named for 1 of 2 failing test\\(s\\) \\(\`land-type change.*could not run`
            )
        );
    });
    it("one culprit explaining every failure keeps the one-line form", () => {
        const report = bisectCulprits(
            ["c1c1c1c1", "c2c2c2c2"],
            [failing[0]],
            probeOf(history)
        );
        const lines = culpritLines({
            report,
            total: 1,
            good: "c0c0c0c0",
            commits: 2,
            subjectOf: (sha) => subjects[sha],
        });
        expect(lines).toEqual([
            "- **culprit:** PR #7296 · `c2c2c2c2` — bisected from GREEN `c0c0c0c0` over 2 commit(s), 2 probe(s)",
        ]);
    });
});
