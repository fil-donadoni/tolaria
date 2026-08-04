import { describe, it, expect } from "vitest";
import { execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

/**
 * Action-space residency guard (issue #2189).
 *
 * Every agent type, plugin skill and MCP tool name offered to a model sits in
 * the RESIDENT prompt: it is re-read on every single request for the life of
 * the session, and it is also one more wrong option to pick from. Pruning it is
 * a measured lever, but the pruning lives in `~/.claude/`, outside any git
 * repository — so nothing here can assert what is installed on a given machine.
 *
 * What this file CAN guard is the half that lives in the repo: the names this
 * project's own prose tells an agent to spawn. Those went stale the moment the
 * duplicate hand-installed `~/.claude/agents/cavecrew-*.md` copies were removed
 * in favour of the caveman plugin's, and a stale spawn name fails in the worst
 * possible way — the `Agent` call errors or silently falls through, mid-run,
 * inside a subagent nobody is watching.
 */

const REPO_ROOT = path.resolve(__dirname, "..", "..");

/** Directories whose markdown is instructions TO an agent, not documentation
 *  about one. A stale agent name here is executed, not merely read. */
const AGENT_FACING = [".claude", "docs/agents", "CLAUDE.md"];

/**
 * The cavecrew agents ship with the `caveman` PLUGIN, so their only valid
 * spawn name is plugin-qualified. A bare `cavecrew-investigator` used to work
 * because a duplicate copy sat at user level — that duplicate is what #2189
 * removed, and relying on it again would resurrect the duplication.
 *
 * Matches a concrete agent name only. `cavecrew-*` (a wildcard in prose) and
 * `cavecrew-builder.md` (a filename in a historical record) are not spawn
 * instructions and are deliberately not matched.
 */
const BARE_CAVECREW =
    /(?<!caveman:)\bcavecrew-(investigator|builder|reviewer)\b(?!\.md)/g;

/**
 * Tracked files PLUS untracked-but-not-ignored ones (`--others
 * --exclude-standard`).
 *
 * Tracked-only was the first version, and it had a blind spot that bit
 * immediately: a NEW agent-facing doc is untracked while you are writing it, so
 * the guard scanned a corpus that excluded the very file being added and
 * reported green. It went red in CI a commit later, once the file was tracked —
 * a local-vs-CI split with no local signal, which is precisely the shape this
 * repo's gate exists to prevent.
 */
function trackedMarkdown(): string[] {
    const args = [
        "ls-files",
        "-z",
        "--cached",
        "--others",
        "--exclude-standard",
    ];
    const out = execFileSync("git", [...args, ...AGENT_FACING], {
        cwd: REPO_ROOT,
        encoding: "utf8",
        maxBuffer: 32 * 1024 * 1024,
    });
    return Array.from(
        new Set(out.split("\0").filter((f) => f.endsWith(".md")))
    ).sort();
}

describe("action space (issue #2189)", () => {
    it("agent-facing prose spawns cavecrew agents by their plugin-qualified name", () => {
        const offenders: string[] = [];

        for (const rel of trackedMarkdown()) {
            const body = fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");
            const lines = body.split("\n");
            lines.forEach((line, i) => {
                BARE_CAVECREW.lastIndex = 0;
                if (BARE_CAVECREW.test(line)) {
                    offenders.push(
                        `${rel}:${i + 1}: ${line.trim().slice(0, 120)}`
                    );
                }
            });
        }

        expect(
            offenders,
            "spawn cavecrew agents as `caveman:cavecrew-<role>` — the bare name " +
                "only resolved via the duplicate user-level copy removed in #2189:\n" +
                offenders.join("\n")
        ).toEqual([]);
    });

    it("scans a non-empty set of files (the guard cannot pass by finding nothing)", () => {
        // A guard whose corpus silently empties — a renamed directory, a glob
        // that stops matching — reports green forever. Assert the corpus first.
        const files = trackedMarkdown();
        expect(files.length).toBeGreaterThan(5);
        expect(files).toContain("CLAUDE.md");
        expect(files.some((f) => f.startsWith(".claude/skills/"))).toBe(true);
    });
});
