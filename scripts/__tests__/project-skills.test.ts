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
            "blade",
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

describe("reviewer-brief mandates the receipt CLI, not a hand-authored shape (issue #2285)", () => {
    // subagent-brief.md naming `writeReceipt` in prose was enough for
    // implement/fixup subagents (4/4 valid receipts) because they are already
    // writing TypeScript. reviewer-brief.md ALSO named the shape in prose
    // (never `writeReceipt` itself) and 4/4 review receipts in the same batch
    // were malformed. The fix is not "say writeReceipt here too" — a sentence
    // is not a validator regardless of which module it names — it is a
    // callable entry point the reviewer runs instead of transcribing a field
    // list. These tests keep the brief pointed at that entry point rather
    // than drifting back to a description of the shape.
    const rel = path.join(
        ".claude",
        "skills",
        "process-gh-issues",
        "references",
        "reviewer-brief.md"
    );
    const body = (): string =>
        fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");

    it("points at the CLI script, and the script + package.json entry exist", () => {
        expect(body()).toMatch(/bun run review:receipt/);
        expect(body()).toMatch(/write-review-receipt\.ts/);

        const scriptPath = path.join(
            REPO_ROOT,
            "scripts",
            "write-review-receipt.ts"
        );
        expect(
            fs.existsSync(scriptPath),
            "reviewer-brief.md names scripts/write-review-receipt.ts but it does not exist"
        ).toBe(true);

        const pkg = JSON.parse(
            fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8")
        ) as { scripts: Record<string, string> };
        expect(
            pkg.scripts["review:receipt"],
            "reviewer-brief.md names `bun run review:receipt` but package.json has no such script"
        ).toBeTruthy();
    });

    it("tells the reviewer to STOP hand-authoring the receipt JSON", () => {
        // The brief must say, in terms an agent following it verbatim would
        // act on, that hand-writing the file is the wrong path — not just
        // that a writer function exists somewhere.
        expect(body()).toMatch(/never by hand-authoring|stop hand-authoring/i);
        expect(body()).toMatch(/writeReceipt/);
    });

    it("does not re-describe the receipt shape as a field list without the CLI", () => {
        // The exact failure shape this issue reported: a paragraph that names
        // `role`, `outcome`, `pr`, `findings[]` as prose fields to reproduce,
        // rather than an invocation to run. If this text comes back without
        // the CLI pointer alongside it, the brief has regressed to the
        // version that produced 4/4 malformed receipts.
        const forbidden =
            /written to the same batch directory\*\* as `<issue>-review\.json` \(`role: "review"`/;
        expect(
            forbidden.test(body()),
            "reviewer-brief.md has regressed to describing the receipt shape in prose instead of pointing at the CLI"
        ).toBe(false);
    });

    it("still keeps the round mechanism for re-review documented", () => {
        expect(body()).toMatch(/--round/);
        expect(body()).toMatch(/refuses to overwrite/);
    });
});
