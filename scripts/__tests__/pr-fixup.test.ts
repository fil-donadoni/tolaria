import { describe, it, expect } from "vitest";
import { BLADE_INDEX_DRIFT_TEST } from "../lib/blade-card-index";
import { failingFiles } from "../lib/health-evidence";
import {
    CONFLICT_LINE,
    FIXES,
    FIXUP_COMMIT_SUBJECT,
    FIXUP_PUSHED_RE,
    classifyLane,
    classifyRed,
    fixupLimitReached,
    fixupPushedLine,
    fixupRefusal,
    flakeSummary,
    outsideLane,
    parseFixes,
    queuedPrOfDraft,
    readLaneVerdict,
    type PrFacts,
} from "../pr-fixup";

// Issue #5640: a red lane whose only failing step is a regenerable artefact is
// fixed by regeneration; any other red is left alone.

const BLADE = "scripts/__tests__/blade-card-index-drift.bot.test.ts";

function lane(outcomes: object[], ok = false) {
    return { ok, outcomes };
}

describe("classifyLane", () => {
    it("a stale oracle lockfile is the `oracle` fix", () => {
        expect(
            classifyLane(
                lane([
                    { id: "tsc[convex]", status: "pass" },
                    { id: "check:oracle", status: "fail" },
                    { id: "cr:lint", status: "not-run" },
                ])
            )
        ).toEqual(["oracle"]);
    });

    // The lane runs the drift test as its own `blade-index` guard (issue
    // #5940): no related run selects a bot-node file.
    it("the blade card index drift test is the `blade-index` fix", () => {
        expect(
            classifyLane(
                lane([
                    {
                        id: "blade-index",
                        status: "fail",
                        failedFiles: [BLADE],
                    },
                ])
            )
        ).toEqual(["blade-index"]);
    });

    it("a blade-index red naming any other file, or none, is untouched", () => {
        expect(
            classifyLane(
                lane([
                    {
                        id: "blade-index",
                        status: "fail",
                        failedFiles: [
                            BLADE,
                            "convex/gre/__tests__/stack.test.ts",
                        ],
                    },
                ])
            )
        ).toBeNull();
        expect(
            classifyLane(lane([{ id: "blade-index", status: "fail" }]))
        ).toBeNull();
    });

    // A `full` lane runs the drift test inside `check:pr` (issue #5955):
    // the files decide, read from the step's captured output.
    it("a check:pr red whose only failed file is the drift test is the `blade-index` fix", () => {
        expect(
            classifyLane(
                lane([{ id: "check:pr", status: "fail", failedFiles: [BLADE] }])
            )
        ).toEqual(["blade-index"]);
        expect(
            classifyLane(lane([{ id: "check:pr", status: "fail" }]))
        ).toBeNull();
        expect(
            classifyLane(
                lane([
                    {
                        id: "check:pr",
                        status: "fail",
                        failedFiles: [
                            BLADE,
                            "scripts/__tests__/health-ui-walk.test.ts",
                        ],
                    },
                ])
            )
        ).toBeNull();
    });

    it("a vitest(related) red is never the blade-index fix", () => {
        expect(
            classifyLane(
                lane([
                    {
                        id: "vitest(related)",
                        status: "fail",
                        failedFiles: [BLADE],
                    },
                ])
            )
        ).toBeNull();
    });

    it("any other failing step is untouched", () => {
        for (const id of ["tsc[all]", "lint(diff)", "cr:lint", "check:index"]) {
            expect(classifyLane(lane([{ id, status: "fail" }]))).toBeNull();
        }
    });

    it("a green lane, or a lane with no JSON outcomes, has no fix", () => {
        expect(
            classifyLane(lane([{ id: "check:oracle", status: "pass" }], true))
        ).toBeNull();
        expect(classifyLane({ ok: false })).toBeNull();
    });
});

describe("FIXES", () => {
    it("every row's script exists in package.json", async () => {
        const pkg = (await import("../../package.json")).default as {
            scripts: Record<string, string>;
        };
        for (const row of Object.values(FIXES)) {
            expect(pkg.scripts[row.script]).toBeDefined();
        }
    });
});

describe("parseFixes", () => {
    it("selects table rows, sorted and unique", () => {
        expect(parseFixes("format, oracle,format")).toEqual([
            "format",
            "oracle",
        ]);
    });
    it("refuses anything outside the table — an input never carries a command", () => {
        expect(parseFixes("oracle;rm -rf /")).toBeNull();
        expect(parseFixes("")).toBeNull();
    });
});

describe("fixupRefusal", () => {
    const ok: PrFacts = {
        state: "OPEN",
        author: "owner",
        headRefName: "feat/issue-1",
        isCrossRepository: false,
        files: ["convex/x.ts"],
        subjects: ["Add x"],
    };
    it("lets a trusted same-repo PR through", () => {
        expect(fixupRefusal(ok, ["owner"])).toBeNull();
    });
    it("refuses a closed PR, a fork, an untrusted or an unconfigured author", () => {
        expect(fixupRefusal({ ...ok, state: "MERGED" }, ["owner"])).toMatch(
            /MERGED/
        );
        expect(
            fixupRefusal({ ...ok, isCrossRepository: true }, ["owner"])
        ).toMatch(/fork/);
        expect(fixupRefusal(ok, ["someone"])).toMatch(/TRUSTED_AUTHORS/);
        expect(fixupRefusal(ok, [])).toMatch(/TRUSTED_AUTHORS/);
    });
    it("refuses a PR that touches what gates it (ADR 0156 §8.4)", () => {
        expect(
            fixupRefusal({ ...ok, files: [".github/workflows/x.yml"] }, [
                "owner",
            ])
        ).toMatch(/\.github/);
        expect(
            fixupRefusal({ ...ok, files: [".mergify.yml"] }, ["owner"])
        ).toMatch(/mergify/);
    });
    it("stops after two fixup commits in a row", () => {
        const two = [FIXUP_COMMIT_SUBJECT, FIXUP_COMMIT_SUBJECT];
        expect(
            fixupRefusal({ ...ok, subjects: ["Add x", ...two] }, ["owner"])
        ).toMatch(/two fixup/);
        expect(
            fixupRefusal(
                {
                    ...ok,
                    subjects: [
                        FIXUP_COMMIT_SUBJECT,
                        "Add x",
                        FIXUP_COMMIT_SUBJECT,
                    ],
                },
                ["owner"]
            )
        ).toBeNull();
    });
});

describe("flakeSummary", () => {
    it("names each flake's step, cause and files; empty when none", () => {
        expect(
            flakeSummary({ outcomes: [{ id: "dom", flake: undefined }] })
        ).toBe("");
        const text = flakeSummary({
            outcomes: [
                {
                    id: "vitest(related)",
                    flake: {
                        projects: ["dom"],
                        files: ["a.test.tsx"],
                        cause: "timeout",
                    },
                },
            ],
        });
        expect(text).toContain("`vitest(related)` (timeout): a.test.tsx");
    });
});

// Issue #5955: ONE decision on a red — regenerable (fixed up, no pass), infra
// (re-queued), needs-pass (a repair pick). The two landing logs the issue
// names are replayed: PR #5863 (blade-index drift inside `check:pr`, sat
// `land-failed` 7 h) and PR #5932 (a real test red whose log quotes a mocked
// outage).

/** The tail of PR #5863's landing log (2026-10-18), ANSI stripped. */
const LOG_5863 = [
    "lane: ran",
    "$ (bun run format:check || …) && bun run check:oracle && …",
    " ❯ bot-node scripts/__tests__/blade-card-index-drift.bot.test.ts (2 tests | 2 failed) 52ms",
    " FAIL  bot-node scripts/__tests__/blade-card-index-drift.bot.test.ts > data/blade-card-index.json > is exactly what the registry builds today — run `bun run blade:card-index` if this fails",
    " Test Files  1 failed | 340 passed (341)",
    "      Tests  2 failed | 3926 passed | 4 skipped (3932)",
    'error: script "check:guards" exited with code 1',
    'error: script "check:pr" exited with code 1',
    "  ✗ check:pr            398.3s",
    "FAIL  398.3s total",
    'error: script "check:lane" exited with code 1',
].join("\n");

/** PR #5932's landing log: `health-ui-walk.test.ts` red for real; a mocked
 *  outage (`health-pivot.test.ts`) and `gh-retry.test.ts`'s 504 lines are
 *  test stderr INSIDE the lane. */
const LOG_5932 = [
    "lane: ran",
    "stderr | scripts/__tests__/health-pivot.test.ts > repair issues on the pivot > an unreachable store reads as no issues, never a throw",
    "health pivot: the repair issues could not be read — gh api graphql failed (exit 1): down",
    "gh: transient error on `gh issue list` (HTTP 504: 504 Gateway Timeout (https://api.github.com/graphql)) — retry 1/3 in 2s",
    " FAIL  node-tooling scripts/__tests__/health-ui-walk.test.ts > health runs the full check:ui walk (issue #4913) > is the LAST health step",
    "AssertionError: expected 'check:game-download' to be 'check:ui --all'",
    'error: script "check:pr" exited with code 1',
    "FAIL  512.0s total",
    'error: script "check:lane" exited with code 1',
].join("\n");

const HEALTH_UI = "scripts/__tests__/health-ui-walk.test.ts";

describe("classifyRed — one decision for every red (issue #5955)", () => {
    it("PR #5863's landing: blade-index drift inside check:pr is regenerable", () => {
        // The link the runner relies on: `check:lane` records the failed
        // step's files from its captured output (`failingFiles`), and the
        // row cures `check:pr` on exactly that file.
        expect(BLADE).toBe(BLADE_INDEX_DRIFT_TEST);
        const failedFiles = failingFiles(LOG_5863);
        expect(failedFiles).toEqual([BLADE]);
        expect(
            classifyRed({
                lane: lane([{ id: "check:pr", status: "fail", failedFiles }]),
                subjects: ["fix: exile-held pile opens (issue #5515)"],
                output: LOG_5863,
            })
        ).toEqual({ kind: "regenerable", fixes: ["blade-index"] });
    });

    it("PR #5932's outage-looking lines are the lane's: with no lane JSON they are cut, not read", () => {
        // The lane died before its receipt (no JSON); its output still
        // carries the mocked outage and 504 lines. Nothing outside names one.
        const cls = classifyRed({
            lane: null,
            subjects: [],
            output: `${LOG_5932}\nerror: land exited 1`,
        });
        expect(cls).toEqual({
            kind: "needs-pass",
            reason: "red outside the lane, naming no outage",
        });
    });

    it("a rebase that stopped is needs-pass even when the commit subject reads like an outage", () => {
        const cls = classifyRed({
            lane: null,
            subjects: [],
            output: [
                "Rebasing (3/4)",
                "CONFLICT (content): Merge conflict in scripts/lib/gh.ts",
                "error: could not apply 1a2b3c4d5... fix: retry on HTTP 503 Service Unavailable",
                "Could not apply 1a2b3c4d5... fix: retry on HTTP 503 Service Unavailable",
            ].join("\n"),
        });
        expect(cls.kind).toBe("needs-pass");
        if (cls.kind === "needs-pass")
            expect(cls.reason).toMatch(/^the rebase stopped: CONFLICT/);
        expect(CONFLICT_LINE.test("Could not apply 1a2b3c4... x")).toBe(true);
    });

    it("PR #5932's landing: a real test red is needs-pass, its mocked outage lines notwithstanding", () => {
        const cls = classifyRed({
            lane: lane([
                { id: "check:pr", status: "fail", failedFiles: [HEALTH_UI] },
            ]),
            subjects: ["Guard: a game's card-data download is bounded"],
            output: LOG_5932,
        });
        expect(cls.kind).toBe("needs-pass");
        if (cls.kind === "needs-pass")
            expect(cls.reason).toContain("health-ui-walk.test.ts");
    });

    it("the bound: a regenerable red on a head already ending in two fixup commits is needs-pass", () => {
        const cls = classifyRed({
            lane: lane([{ id: "check:oracle", status: "fail" }]),
            subjects: ["feat", FIXUP_COMMIT_SUBJECT, FIXUP_COMMIT_SUBJECT],
            output: "",
        });
        expect(cls.kind).toBe("needs-pass");
        if (cls.kind === "needs-pass")
            expect(cls.reason).toMatch(/two fixup commits/);
        expect(fixupLimitReached([FIXUP_COMMIT_SUBJECT, "feat"])).toBe(false);
        expect(
            fixupLimitReached([FIXUP_COMMIT_SUBJECT, FIXUP_COMMIT_SUBJECT])
        ).toBe(true);
    });

    it("no lane red and git or gh naming the network is infra", () => {
        for (const line of [
            "fatal: unable to access 'https://github.com/x/y.git/': Could not resolve host: github.com",
            "HTTP 502: Bad Gateway (https://api.github.com/graphql)",
            "GraphQL: Something went wrong while executing your query. (timedout)",
            "ssh: connect to host github.com port 22: Network is unreachable",
        ]) {
            const cls = classifyRed({
                lane: null,
                subjects: [],
                output: `lane: skipped (gated a against b)\n${line}\nerror: land exited 1`,
            });
            expect(cls, line).toEqual({
                kind: "infra",
                reason: line.slice(0, 200),
            });
        }
    });

    it("a green lane followed by a merge refused on a gateway error is infra; by a real refusal, needs-pass", () => {
        const noise = [
            "lane: ran",
            "gh: transient error on `gh issue list` (HTTP 504: 504 Gateway Timeout) — retry 1/3 in 2s",
            "PASS  120.0s total",
        ].join("\n");
        const green = lane([{ id: "check:ts", status: "pass" }], true);
        expect(
            classifyRed({
                lane: green,
                subjects: [],
                output: `${noise}\nHTTP 502: Bad Gateway (https://api.github.com/graphql)`,
            }).kind
        ).toBe("infra");
        const real = classifyRed({
            lane: green,
            subjects: [],
            output: `${noise}\nland: refusing — the base moved by two commits`,
        });
        expect(real.kind).toBe("needs-pass");
    });

    it("a lane red the table does not cover is never read for an outage", () => {
        // The failed step has no row; the 504 lines are the lane's own.
        const cls = classifyRed({
            lane: lane([{ id: "tsc[all]", status: "fail" }]),
            subjects: [],
            output: "lane: ran\nHTTP 504: Gateway Timeout\nFAIL  1.0s total",
        });
        expect(cls).toEqual({
            kind: "needs-pass",
            reason: "lane step tsc[all] failed with no fixup row",
        });
    });

    it("no lane, no outage: needs-pass", () => {
        expect(
            classifyRed({ lane: null, subjects: [], output: "x\ny" }).kind
        ).toBe("needs-pass");
    });
});

describe("outsideLane — land's own lines, never the lane's", () => {
    it("cuts from `lane: ran` to the receipt's total line", () => {
        expect(
            outsideLane(
                "a\nlane: ran\nHTTP 504 inside\nFAIL  3.0s total\nland: after"
            )
        ).toEqual(["a", "land: after"]);
    });

    it("a lane that died before its receipt is cut to the end", () => {
        expect(outsideLane("a\nlane: ran\nHTTP 504 inside")).toEqual(["a"]);
    });

    it("no lane marker: every line is land's", () => {
        expect(outsideLane("a\nb")).toEqual(["a", "b"]);
    });
});

describe("queuedPrOfDraft — the PR behind a Mergify draft", () => {
    it("reads the PR and the base from the draft's title", () => {
        expect(
            queuedPrOfDraft("merge queue: checking #5854 on staging (5173278)")
        ).toEqual({ pr: 5854, base: "staging" });
    });

    it("null on any other title", () => {
        expect(queuedPrOfDraft("feat: a thing (#5854)")).toBeNull();
        expect(queuedPrOfDraft("")).toBeNull();
    });
});

describe("FIXUP_PUSHED_RE — what the land-runner reads back", () => {
    it("matches the line `run` prints and nothing less", () => {
        expect(FIXUP_PUSHED_RE.test(fixupPushedLine(7, ["oracle"]))).toBe(true);
        expect(
            FIXUP_PUSHED_RE.test(
                fixupPushedLine("12", ["blade-index", "format"])
            )
        ).toBe(true);
        expect(
            FIXUP_PUSHED_RE.test(
                "pr:fixup: PR #7 — nothing to regenerate, nothing pushed"
            )
        ).toBe(false);
        expect(FIXUP_PUSHED_RE.test("pr:fixup: PR #7 untouched — a fork")).toBe(
            false
        );
    });
});

describe("readLaneVerdict — a refusal is reported, never a parse error (issue #6003)", () => {
    const moved =
        "check:lane: the tree moved under the lane — a lint-staged stash or a concurrent commit; re-run on a quiet tree (HEAD abc1234 → def5678)";

    it("reads the JSON a lane that ran wrote", () => {
        expect(readLaneVerdict('{"ok":false,"outcomes":[]}', "")).toEqual({
            lane: { ok: false, outcomes: [] },
        });
    });

    it("names the refusal from the lane's stderr when its JSON is empty", () => {
        const v = readLaneVerdict(
            "",
            `$ bun scripts/check-lane.ts\n${moved}\n`
        );
        expect(v).toEqual({
            refused: moved.slice("check:lane: ".length),
        });
    });

    it("a truncated blob is no verdict either", () => {
        expect(readLaneVerdict('{"ok":fa', moved)).toHaveProperty("refused");
    });

    it("with no log it still refuses by name, pointing at the step log", () => {
        const v = readLaneVerdict("", "");
        expect("refused" in v && v.refused).toMatch(/no JSON verdict/);
    });
});
