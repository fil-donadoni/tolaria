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
 *   bot        a Bot Gap key a ranked card carries (issue #4061)
 *   hand-tail  a ranked Target card whose residual gaps ALL sit below the floor
 *   migration  graduates, clustered by the rule that unlocked them
 *
 * Each issue's number is written back — into its `ops` row for `grammar`, into
 * a `claims` row for every other kind. A second run against unchanged inputs
 * writes nothing; see `lib/gap-issues.ts`'s header for the idempotency
 * contract, the scope and the umbrella, and `lib/gap-kinds.ts`'s for the two
 * measures and the rank. It closes nothing: an issue closes through its PR.
 *
 * It parents three kinds by BAND (issue #4056): `grammar` under the Grammar
 * Rules umbrellas, `mechanic` under the Ops umbrellas, `bot` under the Bot
 * Gaps umbrellas, one per band — the band being `backlog:triage`'s cards
 * source over the cards the gap reaches (`lib/gap-issues.ts` § Parent). An
 * open issue whose band is recomputed is MOVED; residue is listed and keeps
 * its parent.
 *
 * It also wires the ONE dependency a gap can have that is not computed from the
 * corpus: an engine issue declares, in a `## Unlocks` section of its own body,
 * the gap keys it unblocks, and this writes both halves of that edge — the
 * native `blocked by` relationship the board draws, and the `## Blocked by`
 * body section `queue:plan` defers a pick on (issue #4052,
 * `lib/gap-issues.ts` § `## Unlocks`). A declared key matching no filed gap is
 * reported as residue, never dropped.
 *
 * An open `area:cards` issue naming only cards no registered Target requires
 * is never touched: it is labelled `ready-for-human` with one templated
 * comment, the two exits the owner chose (add a Target row, or `wontfix`).
 *
 * `--dry-run` prints the plan and performs no write of any kind.
 *
 * `--band <P0|P1|P2|P3>` is the ORIGIN band of the work that triggered the run
 * (issue #4158): `P0` files every partitioned gap it creates — and every
 * homeless one — under its family's P0 umbrella, the one place nothing computed
 * can reach (`lib/gap-issues.ts` § The ORIGIN band). Any other value changes
 * nothing. `land` derives it from the issue the landed branch names and passes
 * it; a P0 session running this by hand passes it itself.
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
import {
    gh,
    setIssueParent,
    subIssueCount as sharedSubIssueCount,
} from "./lib/gh";
import { cardBandIndex, strongestCardBand } from "./lib/backlog-triage";
import {
    applyUpdatedIssues,
    bandUmbrellaOf,
    buildGrammarGapFilings,
    GAP_TITLE_PREFIX,
    originUmbrellaOf,
    PARTITIONED_KINDS,
    partitionCardIndex,
    RETIRED_UMBRELLAS,
    planUnlockEdges,
    syncGaps,
    syncUnlockEdges,
    withPartitionBands,
    withUnlockBlockers,
    type GapFiling,
    type GapTracker,
    type TrackedIssue,
    type TrackedIssueSummary,
    type UmbrellaBand,
    type UnlockSource,
} from "./lib/gap-issues";
import {
    buildGraduates,
    compilerGapCards,
    handTailOracleIds,
    opUserOracleIds,
} from "./lib/coverage-context";
import {
    buildBotGapFilings,
    buildHandTailFilings,
    buildMigrationFilings,
    buildQuarantineFilings,
    orphanCardActions,
    prioritySlices,
    rankedCardIds,
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

/** One issue as `gh issue list/view --json …,parent` returns it. */
interface GhIssueRow {
    readonly number: number;
    readonly state: string;
    readonly body: string;
    readonly parent?: { readonly number?: number } | null;
}

function trackedIssue(row: Omit<GhIssueRow, "number">): TrackedIssue {
    return {
        state: row.state === "CLOSED" ? "CLOSED" : "OPEN",
        body: row.body,
        parent: row.parent?.number ?? null,
    };
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
        const rows: GhIssueRow[] = [];
        for (const prefix of this.prefixes) {
            rows.push(...this.listByTitle(prefix));
        }
        this.cache = new Map(rows.map((r) => [r.number, trackedIssue(r)]));
        return this.cache;
    }

    private listByTitle(prefix: string): GhIssueRow[] {
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
            "number,state,body,parent",
        ]);
        return JSON.parse(out) as GhIssueRow[];
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
                "state,body,parent",
            ]);
            return trackedIssue(JSON.parse(out) as Omit<GhIssueRow, "number">);
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

    /** One search call, not one read per open issue: the `## Unlocks` section
     *  is rare and the queue is hundreds of issues deep. Search tokenizes, so
     *  this over-fetches (any body saying "unlocks") and `parseUnlocks`
     *  decides — the other direction, a missed declaration, would silently
     *  drop an edge. */
    listUnlockSources(): readonly UnlockSource[] {
        const limit = 1000;
        const out = gh([
            "issue",
            "list",
            "--search",
            '"## Unlocks" in:body',
            "--state",
            "open",
            "--limit",
            String(limit),
            "--json",
            "number,body",
        ]);
        const rows = JSON.parse(out) as UnlockSource[];
        // FAIL CLOSED on a full page, like `subIssueCount`. This list is the
        // sole authority on what unlocks what, and the `## Blocked by` section
        // is composed INTO each gap body — so a TRUNCATED answer is not "fewer
        // edges", it is `syncGaps` stripping the section from every gap whose
        // declaration fell off the page while the native edge stays, leaving
        // the two halves out of parity and a body edit owed on every run.
        if (rows.length >= limit) {
            throw new Error(
                `gaps:sync: the \`## Unlocks\` search returned ${rows.length} issue(s), which is the whole page — raise the limit or paginate; a truncated list would strip the section from the gaps it missed`
            );
        }
        return rows;
    }

    /** Paginated: this is both the idempotency check and `addBlockedBy`'s only
     *  proof that the write took, and `gh api` pages at 30 — past that a
     *  freshly written edge falls off page one and the write reads as failed. */
    blockedBy(issue: number): readonly number[] {
        // One number per line, every page: `--slurp` is refused beside `--jq`,
        // and the concatenated per-page output of a scalar filter is the shape
        // `gh` does give across pages.
        const out = gh([
            "api",
            "--paginate",
            `repos/{owner}/{repo}/issues/${issue}/dependencies/blocked_by`,
            "--jq",
            ".[].number",
        ]);
        return out
            .split("\n")
            .map((line) => line.trim())
            .filter((line) => line !== "")
            .map(Number);
    }

    /**
     * `gh issue edit --add-blocked-by` exits non-zero with `failed to update 1
     * issue` when SOME of the listed edges already exist, and the REST layer
     * answers `Target issue has already been taken` — so the exit code says
     * nothing in either direction and the read-back is the only check
     * (`/to-tickets`' own rule).
     *
     * A native edge cannot target a PR (`Could not resolve to an Issue`); every
     * blocker here comes from `gh issue list`, which never returns one.
     */
    addBlockedBy(issue: number, blocker: number): void {
        try {
            gh([
                "issue",
                "edit",
                String(issue),
                "--add-blocked-by",
                String(blocker),
            ]);
        } catch {
            // Read-back below is the real check either way.
        }
        if (!this.blockedBy(issue).includes(blocker)) {
            throw new Error(
                `gaps:sync: could not wire issue #${issue} blocked by issue #${blocker}`
            );
        }
    }

    subIssueCount(parent: number): number {
        // Fail closed: a missing field read as 0 would let the cap check pass.
        try {
            return sharedSubIssueCount(parent);
        } catch (err) {
            throw new Error(`gaps:sync: ${(err as Error).message}`);
        }
    }

    setParent(child: number, parent: number): void {
        if (!setIssueParent(child, parent)) {
            console.error(
                `gaps:sync: could not confirm issue #${child}'s parent is #${parent} after 3 attempts`
            );
        }
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
    const ranked = rankedCardIds(registry, ctx, slices);
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
    // The band partition (issue #4056): the triage's own cards source, over
    // EVERY registered Target — the same index `backlog:triage` builds.
    const index = cardBandIndex(
        registry.targets.map((row) => ({
            id: row.id,
            ids: resolveTarget(row, ctx).cards.map((c) => c.oracleId),
        }))
    );
    const reached = partitionCardIndex(lock, opUserOracleIds(ctx.byName));
    const filings = withPartitionBands(
        [
            ...buildGrammarGapFilings(allowlist),
            ...buildQuarantineFilings(inputs, "mechanic"),
            ...buildQuarantineFilings(inputs, "scenario"),
            ...buildBotGapFilings(inputs),
            ...handTail.filings,
            ...buildMigrationFilings(inputs, buildGraduates(root, ctx)),
        ],
        (filing) =>
            strongestCardBand(
                reached.get(claimId(filing.kind, filing.key)) ?? [],
                index
            )?.band ?? null
    );
    return { filings, handTailHeld: handTail.held, filed };
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

/** The bands `--band` accepts — the board's whole `Priority` axis. */
const ORIGIN_BANDS: readonly UmbrellaBand[] = ["P0", "P1", "P2", "P3"];

/**
 * `--band <B>` / `--band=<B>` from `argv`, or `undefined` when absent. An
 * unknown value THROWS: the flag is the only channel that puts a gap into a
 * hand-set P0 umbrella, and a typo read as "no band" would file it one band
 * too low without a word (the failure this flag exists to end).
 */
export function parseOriginBand(
    argv: readonly string[]
): UmbrellaBand | undefined {
    const at = argv.findIndex((a) => a === "--band" || a.startsWith("--band="));
    if (at === -1) return undefined;
    const arg = argv[at]!;
    const value = arg.includes("=")
        ? arg.slice(arg.indexOf("=") + 1)
        : argv[at + 1];
    if (!ORIGIN_BANDS.includes(value as UmbrellaBand))
        throw new Error(
            `gaps:sync: --band takes one of ${ORIGIN_BANDS.join(", ")}, got ${value === undefined ? "nothing" : `"${value}"`}`
        );
    return value as UmbrellaBand;
}

function main(): void {
    const root = resolve(".");
    const dryRun = process.argv.includes("--dry-run");
    let originBand: UmbrellaBand | undefined;
    try {
        originBand = parseOriginBand(process.argv.slice(2));
    } catch (err) {
        console.error((err as Error).message);
        process.exit(2);
    }
    if (originBand !== undefined)
        console.log(
            originBand === "P0"
                ? "origin     band P0 — every gap created (or homeless) in this run files under its family's P0 umbrella"
                : `origin     band ${originBand} — no effect: only P0 overrides the computed band`
        );
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

    // Residue of the band partition: no ranked Target among the cards it
    // reaches. Listed, never swept into a band — it keeps its parent.
    const bandResidue = filings.filter(
        (f) =>
            PARTITIONED_KINDS[f.kind] !== undefined &&
            bandUmbrellaOf(f) === null
    );
    for (const f of bandResidue) {
        const at =
            f.currentIssue === null ? "unfiled" : `issue #${f.currentIssue}`;
        console.log(
            `residue    ${f.kind} \`${f.key}\` (${at}) — no ranked Target among the cards it reaches; no band umbrella: it keeps its parent (none, or a retired one: it moves to its family's P3 umbrella)`
        );
    }

    if (dryRun) {
        for (const filing of filings) {
            const at =
                filing.currentIssue === null
                    ? "would CREATE"
                    : `would reconcile issue #${filing.currentIssue}`;
            const origin = originUmbrellaOf(filing, originBand);
            const umbrella = bandUmbrellaOf(filing);
            const band =
                origin !== null && filing.currentIssue === null
                    ? ` [origin P0 -> #${origin}]`
                    : umbrella === null
                      ? ""
                      : ` [${filing.band} -> #${umbrella}]`;
            console.log(
                `${filing.kind.padEnd(10)} ${at}${band}: ${filing.title}`
            );
        }
        console.log(
            "unlocks    skipped — reading the `## Unlocks` declarations is a network call, and --dry-run makes none"
        );
        console.log(
            `gaps:sync --dry-run: ${filings.length} filing(s), 0 writes`
        );
        return;
    }

    const prefixes = [...new Set(filings.map((f) => GAP_TITLE_PREFIX[f.kind]))];
    const tracker = new GhGapTracker(prefixes);

    // The `## Unlocks` pass reads BEFORE anything is written, and a failed read
    // throws rather than degrading to "nothing unlocks anything": the blockers
    // compose the `## Blocked by` section INTO each body, so an empty map read
    // as authoritative would have `syncGaps` strip every section it wrote last
    // run — one body edit per run, forever (`lib/gap-issues.ts` § `## Unlocks`).
    const { blockers, residue } = planUnlockEdges(
        tracker.listUnlockSources(),
        new Set(filings.map((f) => claimId(f.kind, f.key)))
    );
    for (const row of residue) {
        const why =
            row.reason === "unreadable"
                ? "no gap key could be read from it — a declaration is a key, never prose"
                : "matches no filed gap — check the key against `data/grammar-gaps.json`";
        console.log(
            `unlocks    residue issue #${row.issue}: \`${row.line}\` — ${why}`
        );
    }

    const result = syncGaps(
        withUnlockBlockers(filings, blockers),
        tracker,
        originBand
    );

    const counts = new Map<string, number>();
    for (const action of result.actions) {
        counts.set(action.action, (counts.get(action.action) ?? 0) + 1);
        if (action.action !== "noop") {
            console.log(
                `${action.kind.padEnd(10)} ${action.action.padEnd(11)} ${action.key} -> issue #${action.issue}`
            );
        }
    }
    for (const move of result.moves) {
        console.log(
            `${move.kind.padEnd(10)} move        ${move.key} -> issue #${move.issue}: parent ${move.from === null ? "none" : `#${move.from}`} -> #${move.to}`
        );
    }
    console.log(
        `gaps:sync: ${[...counts].map(([k, n]) => `${n} ${k}`).join(", ") || "no gaps"}; ` +
            `${result.moves.length} re-parented (${result.moves.filter((m) => m.from !== null && RETIRED_UMBRELLAS.has(m.from)).length} out of a retired umbrella), ${bandResidue.length} partition residue`
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

    // The NATIVE half of every `## Unlocks` edge, after the write-back: the
    // body half rode in on the filing above, and a gap created moments ago has
    // its number only now. Its own try/catch, like the orphan pass — every
    // filing is already recorded, and an unwired edge is re-tried next run.
    try {
        const issueOf = new Map(
            result.actions
                .filter((a) => a.action !== "skip-closed")
                .map((a) => [claimId(a.kind, a.key), a.issue] as const)
        );
        const edges = syncUnlockEdges(blockers, issueOf, tracker);
        const count = (action: string) =>
            edges.filter((e) => e.action === action).length;
        for (const edge of edges) {
            if (edge.action === "link") {
                console.log(
                    `unlocks    link        issue #${edge.blocked} blocked by issue #${edge.blocker}`
                );
            } else if (edge.action === "skip-self") {
                console.log(
                    `unlocks    skip-self   issue #${edge.blocked} declares the gap it IS — no edge, an issue cannot block itself`
                );
            }
        }
        console.log(
            `gaps:sync: unlocks pass — ${count("link")} edge(s) wired, ` +
                `${count("noop")} already there, ${count("skip-self")} self-declared, ${residue.length} residue`
        );
    } catch (err) {
        console.error(
            `gaps:sync: the \`## Unlocks\` edge pass failed (${(err as Error).message}) — every filing above is already recorded`
        );
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
