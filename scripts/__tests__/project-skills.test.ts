import { describe, it, expect } from "vitest";
import { execFileSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

/**
 * Project-skill residency guard.
 *
 * `/next-issue` is the pipeline that implements this repo's issues (ADR 0110;
 * its fan-out predecessor `/process-gh-issues` is retired). The predecessor
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
const IN_REPO_SKILLS = ["next-issue"];

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

describe("next-issue consumes the planner (issue #2184, re-homed by ADR 0110)", () => {
    const rel = path.join(".claude", "skills", "next-issue", "SKILL.md");
    const body = (): string =>
        fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");

    it("tells the session to run the planner, and the script it names exists", () => {
        expect(body()).toMatch(/bun run queue:plan/);
        // A prose reference to a script that was renamed away is worse than
        // no reference: the session tries it, gets nothing, and picks by
        // hand. Tie the prose to the actual package.json entry.
        const pkg = JSON.parse(
            fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8")
        ) as { scripts: Record<string, string> };
        expect(pkg.scripts["queue:plan"]).toBeTruthy();
    });

    it("lands through `land` and creates worktrees through `wt:new` — never by hand", () => {
        expect(body()).toMatch(/bun run land <PR#>/);
        expect(body()).toMatch(/wt:new/);
        expect(body()).not.toMatch(/git worktree add/);
        expect(body()).not.toMatch(/health:main/);
    });
});

describe("every skill is discoverable on a case-sensitive filesystem", () => {
    it("tracks each skill's manifest as `SKILL.md`, never `skill.md`", () => {
        // macOS is case-INSENSITIVE, so a manifest committed as `skill.md`
        // works perfectly on this machine and is invisible everywhere else:
        // Claude Code looks for `SKILL.md`, so on Linux the skill simply does
        // not exist — no error, no warning, the slash command is just absent.
        // Four were in that state (gre-test, mtg-rules-check, new-card,
        // new-set) and it surfaced only because a CI-only test corpus came back
        // smaller than the local one.
        const tracked = execFileSync("git", ["ls-files", ".claude/skills/"], {
            cwd: REPO_ROOT,
            encoding: "utf8",
        })
            .split("\n")
            .filter((f) => /skill\.md$/i.test(f));

        expect(tracked.length).toBeGreaterThan(4);
        const miscased = tracked.filter((f) => !f.endsWith("/SKILL.md"));
        expect(
            miscased,
            `manifest(s) git tracks under the wrong case — invisible on a case-sensitive filesystem:\n${miscased.join("\n")}`
        ).toEqual([]);
    });
});

describe("every queue-facing skill instructs `Target files`", () => {
    const SKILLS = path.join(REPO_ROOT, ".claude", "skills");

    /**
     * Derived from CONTENT, not a hard-coded list: any skill that talks about
     * the `ready-for-agent` queue or about opening a GitHub issue is one whose
     * output the planner has to schedule. A hard-coded list stops covering
     * whatever is written after it — the failure the hook-registration and
     * ADR-index guards both had before they were re-keyed.
     */
    const queueFacing = (): string[] =>
        fs
            .readdirSync(SKILLS)
            .filter((name) => {
                const file = path.join(SKILLS, name, "SKILL.md");
                if (!fs.existsSync(file)) return false;
                return /ready-for-agent|open a github issue/i.test(
                    fs.readFileSync(file, "utf8")
                );
            })
            .sort();

    it("finds a real corpus", () => {
        expect(queueFacing().length).toBeGreaterThanOrEqual(4);
    });

    it("names the section in each of them", () => {
        // An issue with no `Target files` gets an UNKNOWN blast radius, so the
        // planner refuses to guess and runs it solo — closing the batch around
        // it. Measured on the live queue: one such issue at the head deferred
        // 162 others and collapsed a BATCH_CAP=4 fan-out to one. The cost is
        // invisible from the issue itself, which is why it needs a guard.
        const silent = queueFacing().filter(
            (name) =>
                !/target files/i.test(
                    fs.readFileSync(path.join(SKILLS, name, "SKILL.md"), "utf8")
                )
        );
        expect(
            silent,
            `queue-facing skill(s) that never mention \`Target files\`:\n${silent.join("\n")}`
        ).toEqual([]);
    });
});
