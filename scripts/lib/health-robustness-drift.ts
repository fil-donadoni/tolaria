/**
 * What a failed `blade:robustness` step means to a health batch (issue #5016).
 *
 * The audit (`convex/gre/ai/blade/robustness.ts`, issue #4875) reds on three
 * things, and only one of them is the tree being wrong:
 *
 *   - `wrong`     — a `must` entry fails its OWN seeds. A real regression:
 *                   the tip is RED, as before.
 *   - `unlisted`  — an entry passes its own seeds but some wide-seed or
 *                   jittered run fails, and no baseline row names it.
 *   - `cleared`   — a baseline row whose entry is robust now.
 *   - `malformed` — a baseline row naming no `must` entry, or twice, or with
 *                   no issue.
 *
 * The last three are DRIFT in the bookkeeping of which entries are
 * noise-pinned: the `must` tier is green on that tree, nothing a player or a
 * release sees is broken. They used to red the tip all the same, and a RED
 * tip stops every landing: four repairs in a week were nothing else (issue
 * #4777, issue #4877, issue #4980, issue #5016), each found only after the
 * refit that moved a near-tie had landed. The audit costs ~15 min, and even
 * its near-tie slice measured ~6 min at `land` — far over the issue-#4963
 * lane budget — so it cannot refuse the PR either.
 *
 * So drift is FILED, not gated: one issue per finding, stamped and
 * `ready-for-agent`, deduplicated by title, and the tip stays green. A failed
 * step that printed no finding at all (a crash, a timeout that was not the
 * machine's) files one "no verdict" issue — an audit silently dead forever is
 * the failure that would otherwise hide here.
 *
 * Pure decision + an injected `gh`; `health-main.ts` runs it. Node builtins
 * and `lib/gh.ts` (builtins only) — `health-main.ts`'s own constraint.
 */
import { gh as defaultGh } from "./gh";

/** The health step this module judges. */
export const ROBUSTNESS_STEP = "blade:robustness";

/** The machine line the shard runner prints per finding — one JSON record
 *  after it. Equal to `ROBUSTNESS_FINDING_PREFIX` in the blade module, pinned
 *  by `health-robustness-drift.test.ts` (this file cannot import `convex/`). */
export const ROBUSTNESS_FINDING_PREFIX = "[blade:robustness:finding]";

const ROW_PREFIX = "[blade:robustness] ";

export type RobustnessDriftKind =
    | "unlisted"
    | "wrong"
    | "cleared"
    | "malformed";

const KINDS: readonly string[] = ["unlisted", "wrong", "cleared", "malformed"];

export interface RobustnessDrift {
    kind: RobustnessDriftKind;
    label: string;
    /** The entry's printed classification line, when the output carries it. */
    row: string | null;
}

/** Every finding the step's output carries, once each, in order. */
export function parseRobustnessDrift(output: string): RobustnessDrift[] {
    const lines = output.split("\n");
    const seen = new Set<string>();
    const drift: RobustnessDrift[] = [];
    for (const line of lines) {
        const at = line.indexOf(ROBUSTNESS_FINDING_PREFIX);
        if (at === -1) continue;
        let record: { kind?: unknown; label?: unknown };
        try {
            record = JSON.parse(
                line.slice(at + ROBUSTNESS_FINDING_PREFIX.length)
            ) as { kind?: unknown; label?: unknown };
        } catch {
            continue;
        }
        if (
            typeof record.kind !== "string" ||
            !KINDS.includes(record.kind) ||
            typeof record.label !== "string"
        )
            continue;
        const key = `${record.kind}\u0000${record.label}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const label = record.label;
        const row = lines.find(
            (l) => l.includes(ROW_PREFIX) && l.includes(` ${label} — `)
        );
        drift.push({
            kind: record.kind as RobustnessDriftKind,
            label,
            row: row ? row.slice(row.indexOf(ROW_PREFIX)).trim() : null,
        });
    }
    return drift;
}

export interface DriftIssue {
    title: string;
    body: string;
}

export const DRIFT_LABELS: readonly string[] = [
    "bug",
    "area:game-bot",
    "ready-for-agent",
];

/** Title of the issue a failed step with NO finding files. */
export const NO_VERDICT_TITLE = "Blade robustness audit reached no verdict";

const BASELINE = "convex/gre/ai/blade/robustnessBaseline.ts";
const REGISTRY = "convex/gre/ai/blade/registry.ts";

function driftTitle(d: RobustnessDrift): string {
    if (d.kind === "unlisted")
        return `Blade robustness: "${d.label}" is noise-pinned`;
    if (d.kind === "cleared")
        return `Blade robustness: baseline row "${d.label}" is robust now`;
    return `Blade robustness: malformed baseline row — ${d.label}`;
}

function driftBody(
    d: RobustnessDrift,
    ctx: { sha: string; log: string }
): string {
    const audit = `BLADE_ROBUSTNESS=1 bunx vitest run --config vitest.blade.config.ts robustness.shard -t "${d.label}"`;
    const what =
        d.kind === "unlisted"
            ? `The blade \`must\` entry passes its own seeds but fails a wide-seed or jittered-weight run of the robustness audit: it is green by rollout order, and the next refit can flip it and red the tip. Rewrite the entry so the expected move wins on mean reward (the usual shapes: issue #4777, issue #4877, issue #5016), or — only when the rewrite needs its own design — add a baseline row in \`${BASELINE}\` naming this issue.`
            : d.kind === "cleared"
              ? `The entry's row in \`${BASELINE}\` is stale: the audit now finds the entry robust. Delete the row (the baseline only shrinks).`
              : `A row of \`${BASELINE}\` is malformed (${d.label}). Fix or delete it.`;
    const accept =
        d.kind === "unlisted"
            ? "- [ ] The audit prints `ROBUST` for the entry, or a baseline row names this issue."
            : "- [ ] The audit is clean for the row.";
    return [
        "## What to build",
        "",
        what,
        "",
        `Filed by the health batch on \`${ctx.sha}\` (\`${ctx.log}\`) — drift in the robustness baseline is filed, never a RED tip (issue #5016).`,
        ...(d.row ? ["", "```", d.row, "```"] : []),
        "",
        "## Acceptance criteria",
        "",
        accept,
        `- [ ] Checked with \`${audit}\`.`,
        "",
        "## Target files",
        "",
        ...(d.kind === "unlisted" ? [REGISTRY, BASELINE] : [BASELINE]),
        "",
        "## Band",
        "",
        d.kind === "unlisted"
            ? "P1 — a noise-pinned `must` entry flips at the next refit and reds the base tip"
            : "P2 — a stale robustness baseline row; every Bot health batch re-finds it",
        "",
    ].join("\n");
}

function noVerdictIssue(ctx: { sha: string; log: string }): DriftIssue {
    return {
        title: NO_VERDICT_TITLE,
        body: [
            "## What to build",
            "",
            `\`bun run ${ROBUSTNESS_STEP}\` failed in the health batch on \`${ctx.sha}\` and printed no finding: a crash, or a timeout that was not the machine's. The step is advisory (issue #5016), so the tip stayed green — but an audit that reaches no verdict audits nothing. Read \`${ctx.log}\`, reproduce the step, repair it.`,
            "",
            "## Acceptance criteria",
            "",
            `- [ ] \`bun run ${ROBUSTNESS_STEP}\` runs to a verdict on the base tip.`,
            "",
            "## Target files",
            "",
            "convex/gre/ai/blade/robustness.ts",
            "convex/gre/ai/blade/__tests__/robustnessShardRunner.helper.ts",
            "",
            "## Band",
            "",
            "P1 — the robustness audit is not running",
            "",
        ].join("\n"),
    };
}

export type RobustnessOutcome =
    | { verdict: "red"; wrong: string[] }
    | { verdict: "advisory"; issues: DriftIssue[] };

/**
 * What a FAILED `blade:robustness` step is: RED when a `must` entry fails its
 * own seeds, else advisory — the issues to file, never empty.
 */
export function robustnessOutcome(
    output: string,
    ctx: { sha: string; log: string }
): RobustnessOutcome {
    const drift = parseRobustnessDrift(output);
    const wrong = drift.filter((d) => d.kind === "wrong").map((d) => d.label);
    if (wrong.length > 0) return { verdict: "red", wrong };
    if (drift.length === 0)
        return { verdict: "advisory", issues: [noVerdictIssue(ctx)] };
    return {
        verdict: "advisory",
        issues: drift.map((d) => ({
            title: driftTitle(d),
            body: driftBody(d, ctx),
        })),
    };
}

/**
 * File each issue unless an OPEN one already carries its exact title. Never
 * throws: a `gh` failure is a line in the result, and the next Bot batch finds
 * the same drift and files it then. Returns one report line per issue.
 */
export function fileDriftIssues(
    issues: readonly DriftIssue[],
    gh: (args: string[]) => string = defaultGh
): string[] {
    return issues.map(({ title, body }) => {
        try {
            const open = JSON.parse(
                gh([
                    "issue",
                    "list",
                    "--state",
                    "open",
                    "--search",
                    `in:title "${title.replace(/"/g, "")}"`,
                    "--limit",
                    "100",
                    "--json",
                    "number,title",
                ])
            ) as { number: number; title: string }[];
            const hit = open.find((i) => i.title === title);
            if (hit) return `already filed as issue #${hit.number}: ${title}`;
            const args = ["issue", "create", "--title", title, "--body", body];
            for (const label of DRIFT_LABELS) args.push("--label", label);
            return `filed ${gh(args).trim()}: ${title}`;
        } catch (err) {
            return `NOT filed (${String(err).split("\n")[0]}): ${title}`;
        }
    });
}
