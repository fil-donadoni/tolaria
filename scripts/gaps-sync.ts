#!/usr/bin/env bun
/**
 * `bun run gaps:sync` — the ONE filer of every computed Gap (ADR 0137, PRD
 * issue #3820, issues #3829, #3974 and #3869). Six kinds, one allowlist
 * (`data/grammar-gaps.json`), one stable-key scheme per kind, idempotent,
 * ranked per Target:
 *
 *   grammar    a missing Grammar Rule — the derived Op census `ops` rows
 *   mechanic   a quarantine class the engine owes a mechanic
 *   scenario   a card-dependent smoke-skip class (ADR 0105 § 7.1)
 *   bot        Bot Gaps (issue #3830 — the sweep is not built; files nothing)
 *   hand-tail  a ranked Target card whose residual gaps ALL sit below the floor
 *   migration  graduates, clustered by the rule that unlocked them
 *
 * Each issue's number is written back — into its `ops` row for `grammar`, into
 * a `claims` row for every other kind. A second run against unchanged inputs
 * writes nothing; see `lib/gap-issues.ts`'s header for the idempotency
 * contract, the scope and the umbrella, and `lib/gap-kinds.ts`'s for the two
 * measures and the rank. It closes nothing: an issue closes through its PR.
 *
 * An open `area:cards` issue naming only cards no registered Target requires
 * is never touched: it is labelled `ready-for-human` with one templated
 * comment, the two exits the owner chose (add a Target row, or `wontfix`).
 *
 * `--dry-run` prints the plan and performs no write of any kind.
 *
 * `land` runs this post-merge, non-gating, from the PRIMARY checkout — like
 * this command run by hand. It commits + pushes the allowlist update
 * straight to the base branch when it wrote one: the write is a single
 * `issue` field per row, at the same trust tier ADR 0137 already grants the
 * issue creation itself ("a deliberate exception to the loop drains the
 * queue, never fills it… these issues come from a computed gate… never a
 * subagent's judgement").
 *
 * ── Why a direct push, not a PR ───────────────────────────────────────────
 *
 * This is the one place in the repo a script commits a TRACKED file straight
 * to the base branch outside `land`'s gated merge. A gitignored ledger (like
 * `.claude/telemetry/board-priority.json`) was rejected: `check-gaps.ts`
 * quotes `row.issue` as "the open issue that closes the gap", so a session
 * picking up an Op gap reads THAT field, and a private cache the committed
 * file never saw would drift from what the allowlist claims. The write is
 * narrow: one `issue` integer per row, never the shrink-only `ops[]`
 * membership `check-gaps.ts` guards — a bad value can only point a reader at
 * the wrong issue, which the next run re-checks against the tracker.
 *
 * The tracker talks to GitHub through `lib/gh.ts`, which strips
 * `GITHUB_TOKEN` so it authenticates as the developer, never as the app's
 * bug-report PAT (same rule `queue:plan` follows). It reads a KIND's filed
 * issues in ONE list call keyed on the kind's title prefix, not one `gh issue
 * view` per row — this runs on every landing.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ALLOWLIST_PATH, parseAllowlist } from "./check-gaps";
import { BASE_BRANCH } from "./lib/branches";
import { gh } from "./lib/gh";
import {
    applyUpdatedIssues,
    buildBotGapFilings,
    buildGrammarGapFilings,
    GAP_TITLE_PREFIX,
    syncGaps,
    type GapFiling,
    type GapTracker,
    type TrackedIssue,
    type TrackedIssueSummary,
} from "./lib/gap-issues";
import {
    buildGraduates,
    compilerGapCards,
    handTailOracleIds,
} from "./lib/coverage-context";
import {
    buildHandTailFilings,
    buildMigrationFilings,
    buildQuarantineFilings,
    orphanCardActions,
    prioritySlices,
    registeredCardIds,
    type KindInputs,
} from "./lib/gap-kinds";
import { LOCKFILE_PATH } from "./check-gaps";
import { parseLockfile } from "./lib/oracle-lockfile";
import {
    claimId,
    gapIndex,
    parseClaimRows,
    readTargetRegistry,
    resolveContext,
    resolveTarget,
    splitClaimId,
    type GapKind,
} from "./lib/targets";

/** Whether a failed `gh issue view` said the issue does not exist. */
export function isIssueNotFound(err: unknown): boolean {
    const e = err as { stderr?: unknown; message?: unknown };
    const text = `${String(e?.stderr ?? "")}\n${String(e?.message ?? "")}`;
    return /Could not resolve to an issue/i.test(text);
}

/** The `gh`-backed `GapTracker` — the one place this module touches the
 *  network. */
export class GhGapTracker implements GapTracker {
    private cache: Map<number, TrackedIssue> | null = null;

    /** The title prefixes to prefetch by — one list call each, set by the
     *  kinds this run actually files. */
    private readonly prefixes: readonly string[];

    constructor(prefixes: readonly string[]) {
        this.prefixes = prefixes;
    }

    /** Every issue of every filed kind, open and closed, in one call per kind.
     *  A number the lists miss falls back to a single `view`. */
    private prefetch(): Map<number, TrackedIssue> {
        if (this.cache !== null) return this.cache;
        const rows: { number: number; state: string; body: string }[] = [];
        for (const prefix of this.prefixes) {
            rows.push(...this.listByTitle(prefix));
        }
        this.cache = new Map(
            rows.map((r) => [
                r.number,
                {
                    state: r.state === "CLOSED" ? "CLOSED" : "OPEN",
                    body: r.body,
                },
            ])
        );
        return this.cache;
    }

    private listByTitle(
        prefix: string
    ): { number: number; state: string; body: string }[] {
        const out = gh([
            "issue",
            "list",
            "--search",
            `in:title "${prefix}"`,
            "--state",
            "all",
            "--limit",
            "500",
            "--json",
            "number,state,body",
        ]);
        return JSON.parse(out) as {
            number: number;
            state: string;
            body: string;
        }[];
    }

    getIssue(number: number): TrackedIssue | null {
        const hit = this.prefetch().get(number);
        if (hit !== undefined) return hit;
        try {
            const out = gh([
                "issue",
                "view",
                String(number),
                "--json",
                "state,body",
            ]);
            const parsed = JSON.parse(out) as { state: string; body: string };
            return {
                state: parsed.state === "CLOSED" ? "CLOSED" : "OPEN",
                body: parsed.body,
            };
        } catch (err) {
            // Only "no such issue" means gone. Anything else — network, rate
            // limit, auth — rethrows: read as null it would file a duplicate
            // and orphan the real issue.
            if (isIssueNotFound(err)) return null;
            throw err;
        }
    }

    createIssue(input: {
        title: string;
        body: string;
        labels: readonly string[];
        parent: number;
    }): number {
        const args = [
            "issue",
            "create",
            "--title",
            input.title,
            "--body",
            input.body,
        ];
        for (const label of input.labels) args.push("--label", label);
        const url = gh(args).trim();
        const m = /\/issues\/(\d+)\s*$/.exec(url);
        if (m === null) {
            throw new Error(
                `gh issue create: could not read an issue number back from ${JSON.stringify(url)}`
            );
        }
        const number = Number(m[1]);
        this.setParent(number, input.parent);
        return number;
    }

    updateBody(number: number, body: string): void {
        gh(["issue", "edit", String(number), "--body", body]);
    }

    findSetUmbrella(setCode: string): number | null {
        const out = gh([
            "issue",
            "list",
            "--state",
            "open",
            "--label",
            "prd",
            "--search",
            `"[${setCode}]" in:title`,
            "--json",
            "number,title",
        ]);
        const rows = JSON.parse(out) as { number: number; title: string }[];
        const re = new RegExp(`^\\[${setCode}\\]`, "i");
        return rows.find((r) => re.test(r.title))?.number ?? null;
    }

    listOpen(label: string): readonly TrackedIssueSummary[] {
        const out = gh([
            "issue",
            "list",
            "--state",
            "open",
            "--label",
            label,
            "--limit",
            "500",
            "--json",
            "number,title,labels",
        ]);
        const rows = JSON.parse(out) as {
            number: number;
            title: string;
            labels: { name: string }[];
        }[];
        return rows.map((row) => ({
            number: row.number,
            title: row.title,
            labels: row.labels.map((l) => l.name),
        }));
    }

    addLabel(number: number, label: string): void {
        gh(["issue", "edit", String(number), "--add-label", label]);
    }

    comment(number: number, body: string): void {
        gh(["issue", "comment", String(number), "--body", body]);
    }

    subIssueCount(parent: number): number {
        const out = gh([
            "api",
            `repos/{owner}/{repo}/issues/${parent}`,
            "--jq",
            ".sub_issues_summary.total",
        ]);
        const total = Number(out.trim());
        // Fail closed: a missing field read as 0 would let the cap check pass.
        if (out.trim() === "" || !Number.isInteger(total)) {
            throw new Error(
                `gaps:sync: could not read issue #${parent}'s sub-issue count (got ${JSON.stringify(out.trim())})`
            );
        }
        return total;
    }

    /**
     * `gh issue edit --parent` is unreliable under rapid fire (issue-tracker
     * doc): it can exit non-zero on success or no-op silently. Read the edge
     * back and retry rather than trust the exit code.
     */
    private setParent(child: number, parent: number): void {
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                gh([
                    "issue",
                    "edit",
                    String(child),
                    "--parent",
                    String(parent),
                ]);
            } catch {
                // Read-back below is the real check either way.
            }
            const out = gh([
                "issue",
                "view",
                String(child),
                "--json",
                "parent",
            ]);
            const got = (JSON.parse(out) as { parent?: { number?: number } })
                .parent?.number;
            if (got === parent) return;
        }
        console.error(
            `gaps:sync: could not confirm issue #${child}'s parent is #${parent} after 3 attempts`
        );
    }
}

/** Commit + push the allowlist update straight to `origin/<base>`, from a
 *  clean primary checkout already on that branch. Never throws: `land`
 *  treats this whole script as non-gating — but it prints, so a human
 *  notices the file drifted from the remote. */
export function commitAndPushAllowlist(root: string): void {
    const git = (args: string[]) =>
        spawnSync("git", args, { cwd: root, encoding: "utf8" });
    const add = git(["add", "--", ALLOWLIST_PATH]);
    if (add.status !== 0) {
        console.error(
            `gaps:sync: could not stage ${ALLOWLIST_PATH}: ${add.stderr}`
        );
        return;
    }
    const commit = git([
        "commit",
        "-q",
        "-m",
        "gaps:sync — file per-gap issues, record them in the allowlist",
        // Pathspec, never a bare `git commit`: this runs in the PRIMARY
        // checkout and pushes straight to the base branch, so anything else
        // staged there would ride along (review of PR #3978).
        "--",
        ALLOWLIST_PATH,
    ]);
    if (commit.status !== 0) {
        console.error(
            `gaps:sync: could not commit ${ALLOWLIST_PATH}: ${commit.stderr}`
        );
        return;
    }
    const push = git(["push", "origin", `HEAD:${BASE_BRANCH}`]);
    if (push.status !== 0) {
        console.error(
            `gaps:sync: could not push the allowlist update to ${BASE_BRANCH}: ${push.stderr}`
        );
    }
}

/**
 * Every filing of every kind, in the order they are reported — the ONE place
 * the six kinds of issue #3869 are assembled. `hand-tail` is gated by the
 * registry's `handTailFiling` flag (false until the APC pilot is accepted,
 * issue #3837); the other kinds file from day one.
 */
export function buildAllFilings(
    root: string,
    lock: ReturnType<typeof parseLockfile>,
    allowlist: ReturnType<typeof parseAllowlist>,
    registry: ReturnType<typeof readTargetRegistry>,
    ctx: ReturnType<typeof resolveContext>
): {
    filings: GapFiling[];
    handTailHeld: readonly GapFiling[];
    filed: ReadonlyMap<string, number>;
} {
    const filed = new Map(
        parseClaimRows(allowlist, ALLOWLIST_PATH).map(
            (row) => [claimId(row.kind, row.key), row.issue] as const
        )
    );
    const slices = prioritySlices(registry, ctx);
    // priority ∪ enforced: `check:targets` reds an enforced Target's
    // below-floor card, so it needs a filer even with no priority.
    const ranked = new Set(slices.flatMap((slice) => [...slice.ids]));
    for (const row of registry.targets) {
        if (row.enforced !== true || row.priority !== undefined) continue;
        for (const card of resolveTarget(row, ctx).cards)
            ranked.add(card.oracleId);
    }
    const inputs: KindInputs = {
        lock,
        slices,
        ranked,
        filed,
        floor: registry.handTailFloor,
        handTailFiling: registry.handTailFiling,
        handTail: handTailOracleIds(root, ctx.byName),
        ...gapIndex(lock),
    };
    const handTail = buildHandTailFilings(inputs);
    return {
        filings: [
            ...buildGrammarGapFilings(allowlist),
            ...buildQuarantineFilings(inputs, "mechanic"),
            ...buildQuarantineFilings(inputs, "scenario"),
            ...buildBotGapFilings(),
            ...handTail.filings,
            ...buildMigrationFilings(inputs, buildGraduates(root, ctx)),
        ],
        handTailHeld: handTail.held,
        filed,
    };
}

/**
 * A `claims` row no filing referenced this run: the gap it names is gone, but
 * rows are never pruned (`applyUpdatedIssues`), so its issue is open and no
 * longer updated by anything. Printed, never acted on — closing it is a
 * human's call, and `gaps:sync` closes nothing.
 */
export function staleClaims(
    filed: ReadonlyMap<string, number>,
    filings: readonly GapFiling[]
): Array<{ kind: GapKind; key: string; issue: number }> {
    const live = new Set(filings.map((f) => claimId(f.kind, f.key)));
    const out: Array<{ kind: GapKind; key: string; issue: number }> = [];
    for (const [id, issue] of filed) {
        if (live.has(id)) continue;
        const { kind, key } = splitClaimId(id);
        if (kind === "grammar") continue; // `check:gaps` owns the ops rows.
        out.push({ kind, key, issue });
    }
    return out;
}

function main(): void {
    const root = resolve(".");
    const dryRun = process.argv.includes("--dry-run");
    if (!existsSync(join(root, LOCKFILE_PATH))) {
        console.error(`${LOCKFILE_PATH} missing — run: bun run oracle:compile`);
        process.exit(1);
    }
    const lock = parseLockfile(readFileSync(join(root, LOCKFILE_PATH), "utf8"));
    const allowlist = parseAllowlist(
        readFileSync(join(root, ALLOWLIST_PATH), "utf8")
    );
    const registry = readTargetRegistry(root);
    const ctx = resolveContext(root, lock);

    const { filings, handTailHeld, filed } = buildAllFilings(
        root,
        lock,
        allowlist,
        registry,
        ctx
    );

    // Reported whether or not filing is on — but a SUMMARY, plus one line per
    // card that is actually news: a hand-WRITTEN card whose `compiler-gap:`
    // names a gap that has since fallen below the floor. Its marker claims a
    // debt the grammar no longer has; the closing PR flips it to `hand-tail:`.
    if (handTailHeld.length > 0) {
        console.log(
            `hand-tail  ${handTailHeld.length} ranked card(s) below the floor of ${registry.handTailFloor}; not filed ` +
                "(data/targets.json `handTailFiling`: false, issue #3837)"
        );
        const marked = compilerGapCards(root);
        for (const held of handTailHeld.filter((f) => marked.has(f.key))) {
            console.log(
                `hand-tail  ${held.key} — its \`compiler-gap:\` marker names a gap now below the floor; flip it to \`hand-tail:\``
            );
        }
    }
    for (const stale of staleClaims(filed, filings)) {
        console.log(
            `stale      ${stale.kind} claim \`${stale.key}\` -> issue #${stale.issue} — the gap is gone; the row stays, the issue is nobody's now`
        );
    }

    if (dryRun) {
        for (const filing of filings) {
            const at =
                filing.currentIssue === null
                    ? "would CREATE"
                    : `would reconcile issue #${filing.currentIssue}`;
            console.log(`${filing.kind.padEnd(10)} ${at}: ${filing.title}`);
        }
        console.log(
            `gaps:sync --dry-run: ${filings.length} filing(s), 0 writes`
        );
        return;
    }

    const prefixes = [...new Set(filings.map((f) => GAP_TITLE_PREFIX[f.kind]))];
    const tracker = new GhGapTracker(prefixes);
    const result = syncGaps(filings, tracker);

    const counts = new Map<string, number>();
    for (const action of result.actions) {
        counts.set(action.action, (counts.get(action.action) ?? 0) + 1);
        if (action.action !== "noop") {
            console.log(
                `${action.kind.padEnd(10)} ${action.action.padEnd(11)} ${action.key} -> issue #${action.issue}`
            );
        }
    }
    console.log(
        `gaps:sync: ${[...counts].map(([k, n]) => `${n} ${k}`).join(", ") || "no gaps"}`
    );

    // The write-back comes FIRST, before any further network step: `syncGaps`
    // may have created issues, and a throw between the create and the write
    // leaves the tracker holding issues the allowlist never recorded — the
    // next run would file every one of them again (review of PR #3978).
    if (result.updatedRows.size > 0) {
        const updated = applyUpdatedIssues(allowlist, result.updatedRows);
        writeFileSync(
            join(root, ALLOWLIST_PATH),
            `${JSON.stringify(updated, null, 4)}\n`
        );
        console.log(
            `gaps:sync: ${result.updatedRows.size} allowlist row(s) updated in ${ALLOWLIST_PATH}`
        );
        commitAndPushAllowlist(root);
    }

    // Orphan card issues — the two exits the owner chose (issue #3869). Its
    // own try/catch: it labels and comments, it records nothing, so a failure
    // here must not look like a failed filing pass.
    try {
        const registered = registeredCardIds(registry, ctx);
        const open = tracker.listOpen("area:cards");
        const actions = orphanCardActions(
            open,
            (name) => ctx.byName.get(name)?.oracleId,
            registered
        );
        for (const orphan of actions) {
            tracker.addLabel(orphan.issue, "ready-for-human");
            tracker.comment(orphan.issue, orphan.comment);
            console.log(
                `orphan     ready-for-human issue #${orphan.issue} — ${orphan.cards.join(", ")} is required by no registered Target`
            );
        }
        console.log(
            `gaps:sync: orphan pass — ${open.length} open \`area:cards\` issue(s), ${actions.length} handed to ready-for-human ` +
                `(${registered.size} oracle ids are required by some registered Target)`
        );
    } catch (err) {
        console.error(
            `gaps:sync: the orphan-card pass failed (${(err as Error).message}) — every filing above is already recorded`
        );
    }
}

if (import.meta.main) main();
