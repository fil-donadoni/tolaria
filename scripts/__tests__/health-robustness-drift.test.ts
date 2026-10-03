// Baseline drift in the blade robustness audit is filed, not gated (issue
// #5016): a health batch reds only on a `must` entry failing its own seeds.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
    DRIFT_LABELS,
    fileDriftIssues,
    NO_VERDICT_TITLE,
    parseRobustnessDrift,
    ROBUSTNESS_FINDING_PREFIX,
    ROBUSTNESS_STEP,
    robustnessOutcome,
} from "../lib/health-robustness-drift";
import { BOT_HEALTH_SCRIPTS } from "../lib/health-step";
import {
    ROBUSTNESS_FINDING_PREFIX as BLADE_PREFIX,
    robustnessFindingRecords,
} from "../../convex/gre/ai/blade/robustness";

const ROOT = join(__dirname, "..", "..");
const CTX = { sha: "c43c4b5a3c58", log: "/health/c43c4b5a3c58.log" };

/** A failing shard's output, as vitest prints it: the entry's row and its
 *  finding lines under a `stdout |` header, twice (the summary repeats it). */
function output(
    findings: { kind: string; label: string }[],
    rows: string[] = []
): string {
    const block = [
        "stdout | convex/gre/ai/blade/__tests__/robustness.shard-0.spec.ts > …",
        ...rows.map((r) => `[blade:robustness] ${r}`),
        ...findings.map(
            (f) => `${ROBUSTNESS_FINDING_PREFIX} ${JSON.stringify(f)}`
        ),
        "",
    ];
    return [...block, " FAIL  |blade| …", ...block].join("\n");
}

const PIN = "Sacrifice-for-draw outlet: casts the creature";
const PIN_ROW = `NOISE-PINNED ${PIN} — own 5/5 @200 · default 10/10 [material-tiebreak×10]`;

describe("parseRobustnessDrift", () => {
    it("reads each finding once, with its classification row", () => {
        expect(
            parseRobustnessDrift(
                output([{ kind: "unlisted", label: PIN }], [PIN_ROW])
            )
        ).toEqual([
            {
                kind: "unlisted",
                label: PIN,
                row: `[blade:robustness] ${PIN_ROW}`,
            },
        ]);
    });

    it("ignores a line that is not a finding record", () => {
        expect(
            parseRobustnessDrift(
                [
                    `${ROBUSTNESS_FINDING_PREFIX} not json`,
                    `${ROBUSTNESS_FINDING_PREFIX} {"kind":"other","label":"x"}`,
                    "Tests  3 failed | 199 passed (202)",
                ].join("\n")
            )
        ).toEqual([]);
    });

    it("reads the line the blade module prints", () => {
        expect(ROBUSTNESS_FINDING_PREFIX).toBe(BLADE_PREFIX);
        const records = robustnessFindingRecords({
            unlisted: [PIN],
            wrong: [],
            cleared: ['a "quoted" label'],
            malformed: [],
        });
        const printed = records
            .map((r) => `${BLADE_PREFIX} ${JSON.stringify(r)}`)
            .join("\n");
        expect(
            parseRobustnessDrift(printed).map(({ kind, label }) => ({
                kind,
                label,
            }))
        ).toEqual(records);
    });
});

describe("robustnessOutcome", () => {
    it("a new pin and a cleared row are advisory — one issue each", () => {
        const outcome = robustnessOutcome(
            output(
                [
                    { kind: "unlisted", label: PIN },
                    { kind: "cleared", label: "granted flashback" },
                ],
                [PIN_ROW]
            ),
            CTX
        );
        expect(outcome.verdict).toBe("advisory");
        if (outcome.verdict !== "advisory") return;
        expect(outcome.issues.map((i) => i.title)).toEqual([
            `Blade robustness: "${PIN}" is noise-pinned`,
            'Blade robustness: baseline row "granted flashback" is robust now',
        ]);
        const [pin] = outcome.issues;
        expect(pin!.body).toContain(PIN_ROW);
        expect(pin!.body).toContain(CTX.sha);
        for (const section of [
            "## What to build",
            "## Acceptance criteria",
            "## Target files",
            "## Band",
        ])
            expect(pin!.body).toContain(section);
    });

    it("an entry failing its own seeds is RED, whatever else drifted", () => {
        expect(
            robustnessOutcome(
                output([
                    { kind: "unlisted", label: PIN },
                    { kind: "wrong", label: "charter: blocks" },
                ]),
                CTX
            )
        ).toEqual({ verdict: "red", wrong: ["charter: blocks"] });
    });

    it("a failure with no finding files the no-verdict issue — never silent", () => {
        const outcome = robustnessOutcome("Error: worker crashed", CTX);
        expect(outcome.verdict).toBe("advisory");
        if (outcome.verdict !== "advisory") return;
        expect(outcome.issues.map((i) => i.title)).toEqual([NO_VERDICT_TITLE]);
    });
});

describe("fileDriftIssues", () => {
    const issue = {
        title: `Blade robustness: "${PIN}" is noise-pinned`,
        body: "b",
    };

    it("creates a stamped, ready-for-agent issue", () => {
        const calls: string[][] = [];
        const lines = fileDriftIssues([issue], (args) => {
            calls.push(args);
            return args[1] === "list"
                ? "[]"
                : "https://github.com/o/r/issues/5020\n";
        });
        expect(lines).toEqual([
            `filed https://github.com/o/r/issues/5020: ${issue.title}`,
        ]);
        const create = calls.find((c) => c[1] === "create")!;
        expect(create).toEqual(
            expect.arrayContaining(["--title", issue.title, "--body", "b"])
        );
        for (const label of DRIFT_LABELS)
            expect(create.join(" ")).toContain(`--label ${label}`);
        expect(DRIFT_LABELS).toEqual(
            expect.arrayContaining(["bug", "area:game-bot", "ready-for-agent"])
        );
    });

    it("files nothing when an open issue carries the exact title", () => {
        const calls: string[][] = [];
        const lines = fileDriftIssues([issue], (args) => {
            calls.push(args);
            return JSON.stringify([
                { number: 7, title: `${issue.title} (old wording)` },
                { number: 5020, title: issue.title },
            ]);
        });
        expect(lines).toEqual([`already filed as issue #5020: ${issue.title}`]);
        expect(calls.some((c) => c[1] === "create")).toBe(false);
        expect(calls[0]).toEqual(expect.arrayContaining(["--state", "open"]));
    });

    it("a near-miss title does not suppress the filing", () => {
        const calls: string[][] = [];
        fileDriftIssues([issue], (args) => {
            calls.push(args);
            return args[1] === "list"
                ? JSON.stringify([{ number: 7, title: `${issue.title} too` }])
                : "https://github.com/o/r/issues/5021\n";
        });
        expect(calls.some((c) => c[1] === "create")).toBe(true);
    });

    it("never throws: a gh failure is a report line", () => {
        const lines = fileDriftIssues([issue], () => {
            throw new Error("gh: rate limited\nstack…");
        });
        expect(lines).toEqual([
            `NOT filed (Error: gh: rate limited): ${issue.title}`,
        ]);
    });
});

describe("health-main wiring (issue #5016)", () => {
    const src = readFileSync(join(ROOT, "scripts/health-main.ts"), "utf8");

    it("judges the step health actually runs", () => {
        expect(BOT_HEALTH_SCRIPTS).toContain(ROBUSTNESS_STEP);
    });

    it("an advisory outcome files and moves on; the machine's excuse is read first", () => {
        const infra = src.indexOf("failedCause = infraCause(");
        const judged = src.indexOf("robustnessOutcome(r.output");
        const filed = src.indexOf("fileDriftIssues(outcome.issues)");
        const red = src.indexOf("failedStep = step.name;", infra);
        expect(infra).toBeGreaterThan(-1);
        expect(judged).toBeGreaterThan(infra);
        expect(filed).toBeGreaterThan(judged);
        // RED is only assigned after the advisory branch had its `continue`.
        expect(red).toBeGreaterThan(filed);
        expect(src.slice(filed, red)).toContain("continue;");
        expect(src).toContain(
            "failedCause === null && step.name === ROBUSTNESS_STEP"
        );
    });
});
