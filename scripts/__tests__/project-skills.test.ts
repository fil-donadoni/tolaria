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
const IN_REPO_SKILLS = ["next-issue", "grammar-rule", "new-card"];

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
        // `gate:run land` since issue #3698 — `land` is a gate, and a gate
        // that can outrun the Bash tool's 600s cap is driven so that no
        // single call can be promoted out from under the pass. The `land`
        // part is what this guard is about and is still pinned.
        expect(body()).toMatch(/bun run gate:run land <PR#>/);
        expect(body()).toMatch(/wt:new/);
        expect(body()).not.toMatch(/git worktree add/);
        expect(body()).not.toMatch(/health:main/);
    });

    it("§3's cards short path is keyed on the LANE, not on how simple the card reads (ADR 0136 §8, issue #3781)", () => {
        // The failure this guards: a session deciding by eye that a card is
        // "simple enough" to skip its test. The lane is the only thing that
        // knows what really rode along in the diff — a `data/**` artefact, a
        // file under `convex/gre/`. So §3 must name the classifier, and the
        // command it names must accept the flag it is invoked with.
        const text = body();
        const impl = text.indexOf("## 3. Implement");
        const review = text.indexOf("## 4. Review");
        expect(impl).toBeGreaterThan(-1);
        expect(review).toBeGreaterThan(impl);
        const section = text.slice(impl, review);

        expect(section).toMatch(/bun run check:lane --plan/);
        expect(section).toMatch(/`cards`/);
        expect(section).toMatch(/keyed on the LANE/);
        // …and the short path's three exemptions are stated, not implied.
        expect(section).toMatch(
            /No hand-written test, no proof-of-failure, no bot or frontend seam walk/
        );
        // The tripwire: a test on a cards diff means an unexercised Op.
        expect(section).toMatch(/unexercised Op/);
        expect(section).toMatch(/\/new-op/);

        const pkg = JSON.parse(
            fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8")
        ) as { scripts: Record<string, string> };
        expect(pkg.scripts["check:lane"]).toBeTruthy();
        const laneSrc = fs.readFileSync(
            path.join(REPO_ROOT, "scripts", "check-lane.ts"),
            "utf8"
        );
        expect(laneSrc).toContain('"--plan"');
    });

    it("§6 reports `land`'s lane receipt line (ADR 0136 §2, issue #3781)", () => {
        // Which lane paid for the landed tree — and whether it was paid at
        // all — is the one line of the flow a reader cannot reconstruct
        // afterwards. `land` prints it; §6 has to carry it out of the log.
        const text = body();
        const report = text.indexOf("## 6. Report");
        expect(report).toBeGreaterThan(-1);
        const section = text.slice(report);
        expect(section).toMatch(/lane: ran/);
        expect(section).toMatch(/lane: skipped/);

        const landSrc = fs.readFileSync(
            path.join(REPO_ROOT, "scripts", "land.ts"),
            "utf8"
        );
        expect(landSrc).toContain("lane: ran");
        expect(landSrc).toContain("lane: skipped");
    });

    it("§5 runs no lane gate before the PR — `land` pays it once (ADR 0136 §1, issue #3779)", () => {
        // The pre-PR `check:lane` certified a tree that never landed: at
        // 2.5 PR/h the base moved during it, and `land` paid the lane again
        // on the rebased tip anyway. A §5 that names `check:lane` ahead of
        // the PR step is that gate coming back.
        const text = body();
        const land = text.indexOf("## 5. Land");
        const report = text.indexOf("## 6. Report");
        expect(land).toBeGreaterThan(-1);
        expect(report).toBeGreaterThan(land);
        const section = text.slice(land, report);
        const prStep = section.indexOf("- PR body:");
        expect(prStep, "§5 no longer has its PR body step").toBeGreaterThan(-1);
        expect(section.slice(0, prStep)).not.toMatch(/check:lane/);
        expect(section).toMatch(/No pre-PR gate/);
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

describe("/grammar-rule names only commands that exist (issue #3834)", () => {
    const rel = path.join(".claude", "skills", "grammar-rule", "SKILL.md");
    const body = () => fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");
    const pkg = () =>
        JSON.parse(
            fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8")
        ) as { scripts: Record<string, string> };

    it("every `bun run <script>` it tells a session to run is a package.json script", () => {
        const named = [...body().matchAll(/bun run ([a-z][\w:-]*)/g)].map(
            (m) => m[1]!
        );
        expect(named.length).toBeGreaterThan(0);
        const scripts = pkg().scripts;
        expect(named.filter((s) => !(s in scripts))).toEqual([]);
    });

    it("reads the gap through `oracle:report --gap`, and the report accepts that flag", () => {
        expect(body()).toMatch(/oracle:report --gap/);
        const src = fs.readFileSync(
            path.join(REPO_ROOT, "scripts", "oracle-report.ts"),
            "utf8"
        );
        expect(src).toContain('flag("--gap")');
    });

    it("forbids `gaps:sync` from the worktree — it pushes HEAD onto the base branch", () => {
        expect(body()).toMatch(
            /Never run `bun run gaps:sync` from the worktree/
        );
        const src = fs.readFileSync(
            path.join(REPO_ROOT, "scripts", "gaps-sync.ts"),
            "utf8"
        );
        expect(src).toContain("`HEAD:${BASE_BRANCH}`");
    });

    it("states the three anti-Forge guards (ADR 0137)", () => {
        expect(body()).toMatch(/No structural construct/);
        expect(body()).toMatch(/No Op named for a line/);
        expect(body()).toMatch(/No leniency/);
    });
});

describe("/new-set v2 is compile-first (ADR 0137, issue #3835)", () => {
    const rel = path.join(".claude", "skills", "new-set", "SKILL.md");
    const body = () => fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");
    const src = (...p: string[]) =>
        fs.readFileSync(path.join(REPO_ROOT, ...p), "utf8");

    it("every `bun run <script>` it tells a session to run is a package.json script", () => {
        // Same failure as `/grammar-rule`'s: a prose command that was renamed
        // away is worse than none — the session tries it, gets nothing, and
        // improvises the step it was supposed to follow.
        const named = [...body().matchAll(/bun run ([a-z][\w:-]*)/g)].map(
            (m) => m[1]!
        );
        expect(named.length).toBeGreaterThan(0);
        const pkg = JSON.parse(src("package.json")) as {
            scripts: Record<string, string>;
        };
        expect(named.filter((s) => !(s in pkg.scripts))).toEqual([]);
    });

    it("scopes the rollout through `oracle:report`, and every Target flag it names exists", () => {
        // A flag the skill teaches but the report does not parse is the worst
        // shape of drift here: `flag()` returns undefined, `readTarget` falls
        // through to the corpus, and the session ranks all of Magic believing
        // it ranked its set (issue #3835 review).
        const text = body();
        const report = src("scripts", "oracle-report.ts");
        for (const f of ["--set", "--pool", "--target"]) {
            expect(text, `the skill never names ${f}`).toContain(f);
            expect(report, `oracle-report.ts does not parse ${f}`).toContain(
                `flag("${f}")`
            );
        }
        expect(text).toMatch(/oracle:report --set/);
        expect(text).toMatch(/`--target <id>`/);
        // `--targets` (the coverage report) is a DIFFERENT flag, parsed
        // positionally — the skill uses both and must not conflate them.
        expect(text).toMatch(/oracle:report --targets/);
        expect(report).toContain('process.argv.indexOf("--targets")');
    });

    it("the closure invariant is the computed coverage states, not a hand tally", () => {
        // v1 asserted `done+staged+free+capability+OOS == total` over buckets a
        // human assigned. v2's partition is computed, so the skill must name
        // the states `targets.ts` actually produces — a renamed state that the
        // prose still teaches sends a rollout looking for a section that the
        // report no longer prints.
        const text = body();
        const states = [
            "ready",
            "quarantine",
            "gap-pending",
            "hand-tail",
            "unclaimed",
        ];
        const targets = src("scripts", "lib", "targets.ts");
        for (const state of states) {
            expect(text).toContain(`\`${state}\``);
            expect(targets).toContain(`"${state}"`);
        }
        expect(text).toMatch(/`unclaimed == 0`/);
    });

    it("the hand-authoring axis is gone — no import, no scaffold, no free tranche", () => {
        // The whole point of v2 (ADR 0137): hand-writing survives only as the
        // Guard C residue. A skill that still tells a session to scaffold
        // colour modules re-opens the axis the ADR closed.
        const text = body();
        expect(text).toMatch(/runs no[\s\S]{0,4}`json-to-cards\.mjs`/);
        expect(text).toMatch(/creates no `sets\/<code>\/` directory/);
        expect(text).toMatch(/emits no\s*\n?\s*commented stubs/);
        // v1's own words for the axis, so a copy-back is caught verbatim.
        for (const v1 of [
            "free tranche per colour module",
            "Triage every card into five buckets",
            "walking skeleton",
            "bun scripts/json-to-cards.mjs",
        ]) {
            expect(text.toLowerCase()).not.toContain(v1.toLowerCase());
        }
    });

    it("its gap tickets do not collide with the ones `gaps:sync` files", () => {
        // Two backlogs, two prefixes: the bounded Op-census rows `gaps:sync`
        // owns (`Grammar Gap: <key>`) and the unbounded per-fragment backlog
        // `oracle:report --gaps` ranks, which is this skill's. One prefix for
        // both would make every rollout double-file its own set.
        const text = body();
        expect(text).toMatch(
            /`\[Grammar\] <slot>: <form> — N <set> \/ M corpus`/
        );
        expect(text).toMatch(/deliberately NOT `gaps:sync`'s/);
        expect(src("scripts", "lib", "gap-issues.ts")).toContain(
            'grammar: "Grammar Gap:"'
        );
    });

    it("pins the umbrella title to the shape `gaps:sync` parents by", () => {
        // `findSetUmbrella` matches `^\[<CODE>\]` over open `prd` issues; a
        // title that does not match silently sends every computed gap of the
        // set to PRD #3820 instead, and nothing reds.
        expect(body()).toMatch(/title MUST start `\[<CODE>\]`/);
        expect(src("scripts", "gaps-sync.ts")).toContain("findSetUmbrella");
    });

    it("forbids `gaps:sync` from the worktree — it pushes HEAD onto the base branch", () => {
        expect(body()).toMatch(
            /Never run it from\s*\n?a worktree|Never run `bun run gaps:sync` from a worktree/
        );
        expect(src("scripts", "gaps-sync.ts")).toContain(
            "`HEAD:${BASE_BRANCH}`"
        );
    });

    it("states the three anti-Forge guards (ADR 0137), like `/grammar-rule`", () => {
        const text = body();
        expect(text).toMatch(/no structural construct/i);
        expect(text).toMatch(/no Op named for a line/i);
        expect(text).toMatch(/no leniency/i);
    });
});

describe("/new-card compiles first, hand-writes last (ADR 0137, issue #3836)", () => {
    const rel = path.join(".claude", "skills", "new-card", "SKILL.md");
    /** The body WITHOUT frontmatter: `allowed-tools` carries permission globs
     *  (`bun run cr:*`), which are not commands a session runs. */
    const body = (): string =>
        fs
            .readFileSync(path.join(REPO_ROOT, rel), "utf8")
            .replace(/^---\n[\s\S]*?\n---\n/, "");

    it("every `bun run <script>` it tells a session to run is a package.json script", () => {
        // A prose reference to a renamed script is worse than none: the
        // session runs it, gets nothing, and falls back to authoring by hand —
        // which is the exact behaviour this rewrite removed.
        const named = [...body().matchAll(/bun run ([a-z][\w:-]*)/g)].map(
            (m) => m[1]!
        );
        expect(named.length).toBeGreaterThan(0);
        const pkg = JSON.parse(
            fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8")
        ) as { scripts: Record<string, string> };
        expect(named.filter((s) => !(s in pkg.scripts))).toEqual([]);
    });

    it("reads the compile state BEFORE any authoring step", () => {
        // The branch order is the whole point. A skill whose authoring section
        // comes first is the pre-ADR-0137 skill again, with the compiler as an
        // afterthought. Headings, not mentions: the intro may name the
        // authoring branch while promising to reach it last.
        const text = body();
        const lockfile = text.indexOf("data/oracle-compiled.json");
        const authoring = text.search(/^#+ .*Write the definition/m);
        expect(lockfile).toBeGreaterThan(-1);
        expect(authoring).toBeGreaterThan(lockfile);
        // …and the lockfile it reads is the one the gates read.
        expect(
            fs.existsSync(path.join(REPO_ROOT, "data/oracle-compiled.json"))
        ).toBe(true);
    });

    it("names all four compile-state branches, keyed on the floor", () => {
        const text = body();
        for (const needle of [
            "`ready`",
            "`quarantine`",
            "`unparsed`",
            "handTailFloor",
        ])
            expect(text).toContain(needle);
        // The floor is configuration, not a literal in prose: the skill must
        // point at the file that carries it.
        expect(text).toContain("data/targets.json");
        const registry = JSON.parse(
            fs.readFileSync(path.join(REPO_ROOT, "data/targets.json"), "utf8")
        ) as { handTailFloor: number };
        expect(Number.isInteger(registry.handTailFloor)).toBe(true);
    });

    it("gives Guard C both markers, each with the shape its scanner accepts", () => {
        // `compiler-gap:` claims the grammar still owes the rule; `hand-tail:`
        // says it never will. Below the floor the first is a false claim, and
        // `check:targets` reds on it — so the skill has to name both and say
        // which goes where.
        const text = body();
        expect(text).toMatch(/hand-tail: <the exact Oracle fragment> \(#/);
        expect(text).toMatch(/compiler-gap: <the exact Oracle fragment> \(#/);
        const scanner = fs.readFileSync(
            path.join(REPO_ROOT, "scripts", "lib", "compiler-gap-markers.ts"),
            "utf8"
        );
        for (const marker of ["compiler-gap", "hand-tail"])
            expect(scanner).toContain(`${marker}:`);
    });

    it("compares the floor against the GAP's leverage, not a fragment's own count", () => {
        // The defect this guards, found in review of issue #3836: the lockfile
        // row prints `fragments[].cards`, the cards printing that fragment's
        // exact literal text — while `coverageVerdict` and
        // `buildHandTailFilings` compare the floor against `gapIndex().leverage`,
        // the cards carrying the shape-folded GAP, counted once each. 11,436 of
        // today's fragments are below the floor on the first number and at or
        // above it on the second, so a skill that conflates them files
        // `hand-tail:` markers on cards that owe a Grammar Rule.
        const text = body();
        expect(text).toMatch(/leverage/);
        // `(?![\w-])` and not a bare substring: `--gapp` contains `--gap`, so
        // a loose match passes on a flag the report does not accept — which is
        // how this very guard first went green on a broken skill.
        expect(text).toMatch(/oracle:report --gap(?![\w-])/);
        // …and it says which of the report's two figures is the one compared.
        expect(text).toMatch(/refuse\*\* is the leverage|`R` is the leverage/);
        const src = fs.readFileSync(
            path.join(REPO_ROOT, "scripts", "lib", "targets.ts"),
            "utf8"
        );
        expect(src).toContain("export function gapIndex");
        const reportSrc = fs.readFileSync(
            path.join(REPO_ROOT, "scripts", "oracle-report.ts"),
            "utf8"
        );
        expect(reportSrc).toContain('flag("--gap")');
    });

    it("states the three anti-Forge guards (ADR 0137)", () => {
        expect(body()).toMatch(/Add a structural construct/);
        expect(body()).toMatch(/Name an Op after a card/);
        expect(body()).toMatch(/Buy coverage with leniency/);
    });
});
