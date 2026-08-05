import { describe, it, expect } from "vitest";
import { execFileSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

/**
 * Project-skill residency guard.
 *
 * `/process-gh-issues` is the loop that implements this repo's issues, and it
 * used to live in the USER-level skill directory (`~/.claude/skills/`), outside
 * any git repository. Three consequences, all of which this repo paid for:
 *
 *   1. **No PR can carry a change to it.** Four slices of PRD #2180 were
 *      classified HITL purely because an autonomous agent would implement the
 *      change and then fail at `git push` — the file it edited was in no repo.
 *   2. **No review, no history, no revert.** The loop's own rules — the ones
 *      that decide what gets merged into `main` — were the only part of the
 *      system with no version control.
 *   3. **Nothing could test it.** The repo's guards cover application code
 *      exhaustively; the file that drives the guards was invisible to them.
 *
 * It now lives in the repo. These tests are what keeps it there: a skill that
 * silently drifts back to the user level would take its history with it, and
 * the failure is invisible — everything keeps working, on one machine.
 */

const REPO_ROOT = path.resolve(__dirname, "..", "..");

/** Skills whose residency is load-bearing. Add a row when a workflow skill
 *  becomes part of this project rather than the machine. */
const IN_REPO_SKILLS = ["process-gh-issues"];

function isTracked(relPath: string): boolean {
    try {
        execFileSync("git", ["ls-files", "--error-unmatch", relPath], {
            cwd: REPO_ROOT,
            stdio: "pipe",
        });
        return true;
    } catch {
        return false;
    }
}

describe("project skills live in the repo (PRD #2180)", () => {
    for (const skill of IN_REPO_SKILLS) {
        const rel = path.join(".claude", "skills", skill, "SKILL.md");

        it(`${skill}: SKILL.md is tracked in git`, () => {
            // Untracked is the whole failure mode — the file can exist on disk
            // and still be invisible to every PR, review and revert.
            expect(isTracked(rel)).toBe(true);
        });

        it(`${skill}: declares a frontmatter name matching its directory`, () => {
            const body = fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");
            const frontmatter = /^---\n([\s\S]*?)\n---/.exec(body);
            expect(frontmatter).not.toBeNull();
            expect(frontmatter![1]).toMatch(
                new RegExp(`^name:\\s*${skill}\\s*$`, "m")
            );
        });

        it(`${skill}: is not ALSO present at the user level, where it would shadow and drift`, () => {
            // Two copies is worse than the original problem: the user-level one
            // wins for other projects, both are edited over time, and the
            // divergence is silent because each looks correct on its own.
            const userCopy = path.join(
                os.homedir(),
                ".claude",
                "skills",
                skill,
                "SKILL.md"
            );
            expect(
                fs.existsSync(userCopy),
                `${userCopy} still exists — delete it; the repo copy is now authoritative`
            ).toBe(false);
        });
    }
});

describe("process-gh-issues consumes the planner (issue #2184)", () => {
    const rel = path.join(".claude", "skills", "process-gh-issues", "SKILL.md");
    const body = (): string =>
        fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");

    it("tells the loop to run the planner, and the script it names exists", () => {
        expect(body()).toMatch(/bun run queue:plan/);

        // A prose reference to a script that was renamed away is worse than no
        // reference: the loop tries it, the capability probe reports "no
        // planner", and it silently drops to the reduced serial fallback
        // FOREVER — with no error, because a missing planner is a supported
        // state. Tie the prose to the actual package.json entry.
        const pkg = JSON.parse(
            fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8")
        ) as { scripts: Record<string, string> };
        expect(pkg.scripts["queue:plan"]).toBeTruthy();
    });

    it("acts on every field the plan carries", () => {
        // A field the plan emits but the prose never mentions is silently
        // dropped — the planner would compute a stale-claim sweep or a skip
        // action that nothing ever performs.
        for (const field of ["staleClaims", "skipped", "deferred", "batch"]) {
            expect(
                body(),
                `plan field \`${field}\` is never acted on`
            ).toContain(field);
        }
        for (const action of ["relabel-human", "strip-ready", "needs-info"]) {
            expect(
                body(),
                `skip action \`${action}\` is emitted by the planner but never carried out`
            ).toContain(action);
        }
    });

    it("does not carry a second, hand-rolled copy of the selection logic", () => {
        // The reason to delete rather than keep-as-documentation: two copies of
        // an invariant drift, and the stale copy reads as authoritative while
        // describing behaviour that no longer exists. These are the exact
        // fragments the planner replaced.
        const forbidden: [RegExp, string][] = [
            [/sort_by\(\.bug/, "the hand-rolled jq sort — the planner owns it"],
            [
                /gh issue list --label ready-for-agent/,
                "the verbatim Stage-1 query — the planner makes this call",
            ],
            [
                /index\("bug"\)/,
                "the jq index() trap note — it belongs with the code it warns about",
            ],
        ];
        const found = forbidden
            .filter(([re]) => re.test(body()))
            .map(([, why]) => why);
        expect(
            found,
            `superseded prose is back in ${rel}:\n${found.join("\n")}`
        ).toEqual([]);
    });
});

describe("process-gh-issues reads receipts from artifacts (issue #2186)", () => {
    const rel = path.join(".claude", "skills", "process-gh-issues", "SKILL.md");
    // The whole skill — frame PLUS references. #2190 moved the subagent brief
    // and the reviewer mandate out of SKILL.md, and these assertions are about
    // whether the LOOP still asks for a thing, not about which file says so.
    // Reading only the frame would have turned the decomposition into a false
    // red, and reading only the frame AFTER a rule was accidentally dropped
    // from a reference would be a false green.
    const body = (): string => {
        const dir = path.join(REPO_ROOT, path.dirname(rel));
        const refs = path.join(dir, "references");
        const files = [path.join(dir, "SKILL.md")].concat(
            fs.existsSync(refs)
                ? fs
                      .readdirSync(refs)
                      .filter((f) => f.endsWith(".md"))
                      .map((f) => path.join(refs, f))
                : []
        );
        return files.map((f) => fs.readFileSync(f, "utf8")).join("\n");
    };

    it("tells the loop to compute the merge order, and the script it names exists", () => {
        expect(body()).toMatch(/bun run queue:train/);
        // Same failure shape as the planner probe: a renamed script leaves the
        // loop ordering the train by priority alone, which is a VALID-looking
        // order — no error, no red, just the restructuring PR landing second.
        const pkg = JSON.parse(
            fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8")
        ) as { scripts: Record<string, string> };
        expect(pkg.scripts["queue:train"]).toBeTruthy();
    });

    it("tells the subagent to WRITE the receipt, not to narrate it", () => {
        // The whole point of #2182/#2186: a receipt that exists only as prose
        // in the orchestrator's context dies with the context.
        expect(body()).toMatch(/writeReceipt/);
        expect(body()).toMatch(/\.claude\/receipts\//);
        expect(body(), "BATCH_ID is never passed to the subagent").toMatch(
            /BATCH_ID/
        );
    });

    it("acts on every field the train plan carries", () => {
        for (const field of [
            "order",
            "cycles",
            "edges",
            "entries",
            "blocked",
            "missing",
        ]) {
            expect(
                body(),
                `train plan field \`${field}\` is never acted on`
            ).toContain(field);
        }
    });

    it("keeps the receipt fields the downstream consumers read", () => {
        // `restructures` is the one a subagent will skip if the prose does not
        // ask for it — and without it every train order collapses to priority,
        // silently and plausibly.
        for (const field of [
            "targetFiles",
            "restructures",
            "proofOfFailure",
            "scenario",
        ]) {
            expect(
                body(),
                `receipt field \`${field}\` is never requested from the subagent`
            ).toContain(field);
        }
    });

    it("can resume an interrupted train", () => {
        expect(
            body(),
            "nothing tells the loop how to tell an already-merged PR from an unmerged one"
        ).toMatch(/MERGED/);
    });

    it("does not keep the superseded receipt-in-context flow alongside", () => {
        const forbidden: [RegExp, string][] = [
            [
                /Collect all receipts before moving to the integrate stage/,
                "the collect-in-context instruction — receipts are read from disk now",
            ],
            [
                /in batch priority order \(bugs first, then FIFO\):/,
                "the hand-ordered train — queue:train computes the order",
            ],
            [
                /land the PR that restructures the shared file first/,
                "the prose topological sort — it is a function now",
            ],
        ];
        const found = forbidden
            .filter(([re]) => re.test(body()))
            .map(([, why]) => why);
        expect(
            found,
            `superseded prose is back in ${rel}:\n${found.join("\n")}`
        ).toEqual([]);
    });
});

describe("process-gh-issues is a frame plus on-demand references (issue #2190)", () => {
    const SKILL_DIR = path.join(
        REPO_ROOT,
        ".claude",
        "skills",
        "process-gh-issues"
    );
    const REFS = path.join(SKILL_DIR, "references");
    const frame = (): string =>
        fs.readFileSync(path.join(SKILL_DIR, "SKILL.md"), "utf8");
    const refFiles = (): string[] =>
        fs.readdirSync(REFS).filter((f) => f.endsWith(".md"));

    it("every reference file is reachable from the frame", () => {
        // An unreferenced reference is worse than no reference: the content is
        // gone from the frame and nothing ever opens it, so the rule simply
        // stops applying — silently, with every test green.
        const orphans = refFiles().filter(
            (f) => !frame().includes(`references/${f}`)
        );
        expect(
            orphans,
            `unreachable reference(s) — nothing in the frame opens them:\n${orphans.join("\n")}`
        ).toEqual([]);
    });

    it("every reference the frame links to exists", () => {
        const linked = Array.from(
            frame().matchAll(/references\/([a-z0-9-]+\.md)/g)
        ).map((m) => m[1]);
        expect(linked.length).toBeGreaterThan(0);
        const missing = Array.from(new Set(linked)).filter(
            (f) => !fs.existsSync(path.join(REFS, f))
        );
        expect(
            missing,
            `the frame points at reference(s) that do not exist:\n${missing.join("\n")}`
        ).toEqual([]);
    });

    it("each reference carries an entry condition in the frame's index", () => {
        // A pointer with no "open when" is a pointer nobody follows at the
        // right moment — which is the same as not having the content.
        const index =
            frame().split("## References")[1]?.split("\n## ")[0] ?? "";
        for (const f of refFiles()) {
            expect(
                index,
                `${f} is not listed in the frame's reference index with an entry condition`
            ).toContain(`references/${f}`);
        }
    });

    it("the frame stays a frame", () => {
        // Not a style budget: the frame is what the orchestrator pays for on
        // EVERY pass. #2190 cut it from 68k to ~43k chars; this fails long
        // before it creeps back, so re-inlining a reference is a red test
        // rather than a slow regression nobody measures.
        expect(frame().length).toBeLessThan(50_000);
    });

    it("does not duplicate reference content back into the frame", () => {
        // One sentence per rule. Two copies drift, and the stale copy reads as
        // authoritative while describing behaviour that no longer exists.
        const markers: [string, string][] = [
            ["**Subagent task (runs entirely", "subagent-brief.md"],
            ["Reviewer prompt mandate (strict)", "reviewer-brief.md"],
            ["**Lane A — required CI checks exist", "merge-train.md"],
            [
                "**Expect the emitted spec to be wrong",
                "scenario-registration.md",
            ],
            ["#### 0b. Red-baseline triage", "red-baseline.md"],
        ];
        const leaked = markers
            .filter(([text]) => frame().includes(text))
            .map(([text, file]) => `"${text}…" belongs in ${file}`);
        expect(
            leaked,
            `duplicated back into the frame:\n${leaked.join("\n")}`
        ).toEqual([]);
    });
});
