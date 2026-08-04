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
