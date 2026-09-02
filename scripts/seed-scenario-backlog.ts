// `bun run seed:backlog [--limit N] [--apply] [--since <PR#>]` — sweep merged
// PRs for preset-scenario blocks that were never registered (ADR 0044).
//
// The one-off half of closing the seeding gap. `seed-scenario.ts` wired into
// `land` stops the backlog GROWING; this recovers the ~2 years of specs that
// accumulated while the job was assigned to an orchestrator ADR 0110 had
// already retired.
//
// DRY RUN BY DEFAULT. The corpus is hand-written prose spanning many months:
// some specs name cards that have since been renamed, some use the `owner:
// "p1"` spelling that silently loads onto the wrong side of the board, and
// some were superseded by a later PR. A blind bulk insert would fill the
// debug panel with scenarios that load a board nobody meant. So the default
// prints a report and writes nothing; `--apply` writes, and re-running is
// harmless because `seedScenarioDirect` upserts by label.
//
// The REJECTS are the interesting half of the output, not the successes: they
// are the authoring errors the missing gate never caught.

import { spawnSync } from "node:child_process";
import {
    classifyScenarioSection,
    owesScenario,
    type ScenarioCandidate,
} from "./lib/scenario-block";
import { seedScenario } from "./lib/seed-scenario-run";
import { primaryCheckout } from "./lib/primary-checkout";

interface PullRequest {
    number: number;
    title: string;
    body: string | null;
}

export interface BacklogRow {
    pr: number;
    title: string;
    kind: "spec" | "malformed" | "absent" | "none";
    label?: string;
    problems?: string[];
}

export interface BacklogReport {
    seedable: Array<BacklogRow & { candidate: ScenarioCandidate }>;
    malformed: BacklogRow[];
    /** Merged with no scenario and no explicit decline. Reported but never
     *  acted on — a PR that already merged cannot be sent back for one. */
    silent: BacklogRow[];
    declined: number;
}

/**
 * Classify a batch of merged PRs. Pure over the fetched list so the whole
 * report can be tested without `gh` — the corpus shapes it has to survive are
 * in `scripts/__tests__/scenario-block.test.ts`.
 *
 * `owesScenario` is NOT consulted for the seedable set: a PR that shipped a
 * spec gets it registered whatever its diff touched. It only decides whether a
 * PR with NO block is worth reporting as silent, so a docs PR does not show up
 * in a list of things somebody skipped.
 */
export function classifyBacklog(
    prs: PullRequest[],
    changedPathsFor: (pr: number) => string[]
): BacklogReport {
    const report: BacklogReport = {
        seedable: [],
        malformed: [],
        silent: [],
        declined: 0,
    };
    for (const pr of prs) {
        const verdict = classifyScenarioSection(pr.body ?? "");
        const base = { pr: pr.number, title: pr.title };
        if (verdict.kind === "spec") {
            report.seedable.push({
                ...base,
                kind: "spec",
                label: verdict.candidate!.label,
                candidate: verdict.candidate!,
            });
        } else if (verdict.kind === "malformed") {
            report.malformed.push({
                ...base,
                kind: "malformed",
                problems: verdict.problems,
            });
        } else if (verdict.kind === "none") {
            report.declined++;
        } else if (owesScenario(changedPathsFor(pr.number))) {
            report.silent.push({ ...base, kind: "absent" });
        }
    }
    return report;
}

// ─────────────────────────────────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────────────────────────────────

function gh(args: string[]): string {
    const res = spawnSync("gh", args, {
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
    });
    if (res.status !== 0) {
        throw new Error(
            `gh ${args.join(" ")} failed: ${(res.stderr ?? "").trim()}`
        );
    }
    return (res.stdout ?? "").trim();
}

export function parseArgs(argv: string[]): {
    limit: number;
    apply: boolean;
    since: number;
} {
    const read = (flag: string, fallback: number): number => {
        const i = argv.indexOf(flag);
        if (i === -1) return fallback;
        const n = Number(argv[i + 1]);
        return Number.isFinite(n) ? n : fallback;
    };
    return {
        limit: read("--limit", 300),
        apply: argv.includes("--apply"),
        since: read("--since", 0),
    };
}

/** Files a merged PR touched. Cheap enough per PR at this scale, and only
 *  asked for when a PR carries NO block — the seedable set never needs it. */
function changedPathsFor(pr: number): string[] {
    try {
        const raw = gh(["pr", "view", String(pr), "--json", "files"]);
        const parsed = JSON.parse(raw) as { files?: Array<{ path: string }> };
        return (parsed.files ?? []).map((f) => f.path);
    } catch {
        return [];
    }
}

function main(): void {
    const { limit, apply, since } = parseArgs(process.argv.slice(2));

    const prs = (
        JSON.parse(
            gh([
                "pr",
                "list",
                "--state",
                "merged",
                "--limit",
                String(limit),
                "--json",
                "number,title,body",
            ])
        ) as PullRequest[]
    ).filter((p) => p.number >= since);

    console.log(
        `seed:backlog: scanning ${prs.length} merged PRs${since ? ` (>= #${since})` : ""}\n`
    );

    const report = classifyBacklog(prs, changedPathsFor);

    console.log(`seedable   : ${report.seedable.length}`);
    console.log(`malformed  : ${report.malformed.length}`);
    console.log(`declined   : ${report.declined} (said none was owed)`);
    console.log(
        `silent     : ${report.silent.length} (gameplay diff, no block, no decline)\n`
    );

    if (report.malformed.length > 0) {
        console.log("── malformed blocks (never registered, and why) ──");
        for (const row of report.malformed) {
            console.log(`  PR #${row.pr} ${row.title.slice(0, 58)}`);
            for (const p of row.problems ?? []) console.log(`      · ${p}`);
        }
        console.log("");
    }

    if (report.silent.length > 0) {
        console.log("── merged with a gameplay diff and no scenario block ──");
        for (const row of report.silent) {
            console.log(`  PR #${row.pr} ${row.title.slice(0, 66)}`);
        }
        console.log("");
    }

    if (!apply) {
        console.log("── seedable (dry run — pass --apply to write) ──");
        for (const row of report.seedable) {
            console.log(`  PR #${row.pr}  "${row.label}"`);
        }
        console.log(
            `\nseed:backlog: dry run, nothing written. ${report.seedable.length} would be registered.`
        );
        return;
    }

    const cwd = primaryCheckout(process.cwd());
    let ok = 0;
    const failed: Array<{ pr: number; label: string; error: string }> = [];
    for (const row of report.seedable) {
        const outcome = seedScenario(row.candidate, cwd);
        if (outcome.ok) {
            ok++;
            console.log(
                `  ✓ PR #${row.pr}  ${outcome.action ?? "written"}  "${row.label}"`
            );
        } else {
            failed.push({
                pr: row.pr,
                label: row.label!,
                error: outcome.error ?? "unknown",
            });
            console.log(`  ✗ PR #${row.pr}  "${row.label}" — ${outcome.error}`);
        }
    }
    console.log(
        `\nseed:backlog: ${ok} registered, ${failed.length} rejected by the deployment.`
    );
    if (failed.length > 0) {
        console.log(
            "Rejections are almost always an unresolved card name — the spec names a card the catalogue does not have (renamed, or never shipped)."
        );
    }
}

if (import.meta.main) {
    main();
}
