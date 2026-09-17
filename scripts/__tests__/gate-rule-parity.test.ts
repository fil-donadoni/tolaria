import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

/**
 * ONE rule for running a gate, in TWO files (issue #3698).
 *
 * The bug this closes is not a typo. `.claude/hooks/deny-guard.sh` § 3b denied
 * a backgrounded gate — correctly — while `.claude/skills/next-issue/SKILL.md`
 * told the pass, in its context-hygiene section, to "start it with
 * `run_in_background` and answer the notification". A pass that followed
 * either file to the letter violated the other, and the one that followed the
 * guard died anyway: its foreground gate outran the Bash tool's 600s cap, the
 * tool promoted it to the background over the pass's head, and the pass ended
 * its turn — which under `claude -p` is the end of the process, and of the
 * gate.
 *
 * Two copies of a rule that CAN disagree will disagree, so the text is
 * delimited by markers in both files and compared here. This is a prose guard:
 * it is registered in `DOC_GATE_TESTS`, because the docs lane is what merges a
 * change to either copy.
 */

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const DENY_GUARD = path.join(REPO_ROOT, ".claude", "hooks", "deny-guard.sh");
const SKILL = path.join(
    REPO_ROOT,
    ".claude",
    "skills",
    "next-issue",
    "SKILL.md"
);

/**
 * The rule as TEXT: the two copies live in different host syntaxes (a `sh`
 * comment block, a Markdown paragraph), so leading comment markers are
 * stripped and whitespace collapsed before comparing. Anything else about the
 * two files is free to differ; the sentences are not.
 */
const extractRule = (file: string): string => {
    const src = fs.readFileSync(file, "utf8");
    const start = src.indexOf("<<<GATE-RULE>>>");
    const end = src.indexOf("<<<END GATE-RULE>>>");
    expect(start, `${file} carries no <<<GATE-RULE>>> marker`).toBeGreaterThan(
        -1
    );
    expect(
        end,
        `${file} carries no <<<END GATE-RULE>>> marker`
    ).toBeGreaterThan(start);
    return src
        .slice(src.indexOf("\n", start) + 1, end)
        .split("\n")
        .map((l) =>
            l
                .replace(/^\s*#\s?/, "")
                .replace(/^<!--\s*$/, "")
                .trim()
        )
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
};

describe("the gate rule is ONE rule (#3698)", () => {
    it("deny-guard.sh § 3b and the /next-issue skill carry the identical text", () => {
        const guard = extractRule(DENY_GUARD);
        const skill = extractRule(SKILL);
        expect(guard.length).toBeGreaterThan(200);
        expect(skill).toBe(guard);
    });

    it("the rule names gate:run, the foreground, and answers the attended question", () => {
        const rule = extractRule(SKILL);
        expect(rule).toContain("gate:run");
        expect(rule).toContain("FOREGROUND");
        // The AC allows a deliberate attended/unattended difference provided
        // both files name it. There is none here, and saying so IS the answer
        // — an unstated "obviously the attended case is different" is how the
        // two files drifted the first time.
        expect(rule).toMatch(/same attended and unattended/);
    });

    it("the skill's own gate commands go through gate:run", () => {
        // A rule stated and then contradicted two sections later by the
        // command the session actually copies is not a rule.
        const skill = fs.readFileSync(SKILL, "utf8");
        expect(skill).toMatch(/bun run gate:run land <PR#>/);
        // The hygiene section's own "start it with `run_in_background`" line
        // is what a pass read before it backgrounded its gate. It survives —
        // backgrounding a subagent or a long search is still right — but it
        // is no longer unqualified.
        expect(skill).toMatch(/Background work that is NOT a gate/);
    });

    it("gate:run is a real package script", () => {
        // Same reason the planner reference is tied to package.json: prose
        // naming a script that does not exist is worse than no prose.
        const pkg = JSON.parse(
            fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8")
        ) as { scripts: Record<string, string> };
        expect(pkg.scripts["gate:run"]).toBeTruthy();
        expect(
            fs.existsSync(path.join(REPO_ROOT, "scripts", "gate-run.sh"))
        ).toBe(true);
    });
});
