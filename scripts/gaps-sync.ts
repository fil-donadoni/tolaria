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
 * measures and the rank.
 *
 * It CLOSES the claim issues whose work is done (issue #4516) — so no claim
 * waits on a human to close it: a `hand-tail` claim its card's marker settles
 * or whose card now compiles `ready`, and a `grammar` / `mechanic` /
 * `scenario` / `bot` claim whose key this run no longer computes
 * ({@link planClaimClosures}). Nothing else is ever closed, and the claim row
 * stays.
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
    issueBlockedBy,
    setIssueParent,
    subIssueCount as sharedSubIssueCount,
} from "./lib/gh";
import {
    cardBandIndex,
    openCardIssueIndex,
    strongestCardBand,
} from "./lib/backlog-triage";
import {
    applyUpdatedIssues,
    bandUmbrellaOf,
    buildGrammarGapFilings,
    GAP_TITLE_PREFIX,
    OP_KEY_PREFIX,
    originUmbrellaOf,
    PARTITIONED_KINDS,
    partitionCardIndex,
    PRD_ISSUE,
    RETIRED_UMBRELLAS,
    planUnlockEdges,
    clusterIssues,
    isAdoptedFiling,
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
    handTailMarkerIssues,
    opUserOracleIds,
} from "./lib/coverage-context";
import {
    buildBotGapFilings,
    buildFragmentGapFilings,
    buildHandTailFilings,
    buildMigrationFilings,
    buildQuarantineFilings,
    computedGapKeys,
    orphanCardActions,
    prioritySlices,
    enforcedCardIds,
    type ComputedGapKeys,
    floorlessCardIds,
    rankedCardIds,
    registeredCardIds,
    type KindInputs,
} from "./lib/gap-kinds";
import { LOCKFILE_PATH } from "./check-gaps";
import {
    botHash,
    FINDINGS_PATH,
    mergeBotVerdicts,
    parseFindings,
    type BotGapVerdict,
} from "./lib/oracle-bot-reach";
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

    close(number: number, comment: string): void {
        gh(["issue", "close", String(number), "--comment", comment]);
    }

    /** One GraphQL call for every number — the close list re-reads the same
     *  already-closed issues on every landing. A failed batch (a deleted
     *  number errors the whole query) falls back to one `view` each. */
    readIssues(numbers: readonly number[]): Map<number, ClosableIssue | null> {
        const out = new Map<number, ClosableIssue | null>();
        if (numbers.length === 0) return out;
        const fields = numbers
            .map((n) => `i${n}: issue(number: ${n}) { state title }`)
            .join(" ");
        const asIssue = (row: {
            state: string;
            title: string;
        }): ClosableIssue => ({
            state: row.state === "CLOSED" ? "CLOSED" : "OPEN",
            title: row.title,
        });
        try {
            const data = JSON.parse(
                gh([
                    "api",
                    "graphql",
                    "-F",
                    "owner={owner}",
                    "-F",
                    "name={repo}",
                    "-f",
                    `query=query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { ${fields} } }`,
                ])
            ) as {
                data: {
                    repository: Record<
                        string,
                        { state: string; title: string } | null
                    >;
                };
            };
            for (const n of numbers) {
                const row = data.data.repository[`i${n}`];
                out.set(n, row == null ? null : asIssue(row));
            }
            return out;
        } catch {
            for (const n of numbers) {
                try {
                    out.set(
                        n,
                        asIssue(
                            JSON.parse(
                                gh([
                                    "issue",
                                    "view",
                                    String(n),
                                    "--json",
                                    "state,title",
                                ])
                            ) as { state: string; title: string }
                        )
                    );
                } catch (err) {
                    if (!isIssueNotFound(err)) throw err;
                    out.set(n, null);
                }
            }
            return out;
        }
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

    /** Paginated (`issueBlockedBy`): this is both the idempotency check and
     *  `addBlockedBy`'s only proof that the write took, and `gh api` pages at
     *  30 — past that a freshly written edge falls off page one and the write
     *  reads as failed. Shared with the queue lint's parity rule since issue
     *  #3794; one reader, so the pagination rule cannot be re-learned. */
    blockedBy(issue: number): readonly number[] {
        return issueBlockedBy(issue);
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

/**
 * Every OPEN issue's number and body, for the `## Cards` adoption index (issue
 * #4515). FAILS CLOSED on a full page: a truncated list is not "fewer
 * adoptions", it is a duplicate filed for a card whose issue fell off the page.
 */
export function listOpenIssueBodies(): { number: number; body: string }[] {
    const limit = 2000;
    const rows = JSON.parse(
        gh([
            "issue",
            "list",
            "--state",
            "open",
            "--limit",
            String(limit),
            "--json",
            "number,body",
        ])
    ) as { number: number; body: string }[];
    if (rows.length >= limit) {
        throw new Error(
            `gaps:sync: the open-issue list returned ${rows.length} issue(s), which is the whole page — raise the limit or paginate; a truncated list would file a duplicate for a card whose issue it missed`
        );
    }
    return rows;
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
 * registry's `handTailFiling` flag and files only for `enforced` Targets'
 * cards (issue #4219); the other kinds file from day one.
 */
export function buildAllFilings(
    root: string,
    lock: ReturnType<typeof parseLockfile>,
    allowlist: ReturnType<typeof parseAllowlist>,
    registry: ReturnType<typeof readTargetRegistry>,
    ctx: ReturnType<typeof resolveContext>,
    /** The Bot Reach Findings report merged over the lockfile (issue #4406) —
     *  absent exactly when `data/bot-reach-findings.json` is missing. */
    botFindings?: ReadonlyMap<string, BotGapVerdict>,
    /** Oracle id → the open issue naming the card in its `## Cards` section
     *  (issue #4515) — what a card-keyed claim adopts instead of filing. */
    openCardIssues?: ReadonlyMap<string, readonly number[]>
): {
    filings: GapFiling[];
    handTailHeld: readonly GapFiling[];
    filed: ReadonlyMap<string, number>;
    settledHandTail: SettledHandTail;
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
    const markerIssues = handTailMarkerIssues(root, ctx.byName);
    const inputs: KindInputs = {
        lock,
        slices,
        ranked,
        filed,
        floor: registry.handTailFloor,
        handTailFiling: registry.handTailFiling,
        enforced: enforcedCardIds(registry, ctx),
        floorless: floorlessCardIds(registry, ctx),
        handTail: new Set(markerIssues.keys()),
        botFindings,
        openCardIssues,
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
    const reached = partitionCardIndex(
        lock,
        opUserOracleIds(ctx.byName),
        inputs.gapKeys
    );
    const filings = withPartitionBands(
        [
            ...buildGrammarGapFilings(allowlist),
            ...buildFragmentGapFilings(inputs),
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
            )?.target ?? null
    );
    return {
        filings,
        handTailHeld: handTail.held,
        filed,
        settledHandTail: settledHandTailOf(lock, markerIssues, inputs.gapKeys),
    };
}

/**
 * What the stale report needs to tell a SETTLED `hand-tail` claim from a gone
 * one (issue #4513) — both keyed by the card's lockfile name, the claim key.
 * Offline: the markers already parsed and the lockfile, no issue-state lookup.
 */
export interface SettledHandTail {
    /** Card → the issue its well-formed `hand-tail:` marker names. */
    readonly markerIssue: Map<string, number>;
    /** Cards still `unparsed` with at least one residual Grammar Gap. */
    readonly residual: Set<string>;
    /** Cards that compile `ready` — a Hand Tail claim's gap gone (issue
     *  #4516). Absent means none. */
    readonly ready?: Set<string>;
}

/**
 * {@link SettledHandTail} from the lockfile and the `hand-tail:` markers
 * (oracle id → issue), re-keyed by card name.
 */
export function settledHandTailOf(
    lock: Pick<ReturnType<typeof parseLockfile>, "cards">,
    markerIssues: ReadonlyMap<string, number>,
    gapKeys: KindInputs["gapKeys"]
): SettledHandTail {
    const settled = {
        markerIssue: new Map<string, number>(),
        residual: new Set<string>(),
        ready: new Set<string>(),
    };
    for (const row of lock.cards) {
        const issue = markerIssues.get(row.oracleId);
        if (issue !== undefined) settled.markerIssue.set(row.name, issue);
        if (row.state === "unparsed" && gapKeys(row).length > 0)
            settled.residual.add(row.name);
        if (row.state === "ready") settled.ready.add(row.name);
    }
    return settled;
}

/** One row of the stale-claims report. */
export type StaleClaim =
    | { kind: GapKind; key: string; issue: number }
    /** A `hand-tail` claim whose card is hand-written under ANOTHER issue's
     *  marker: the claim's own issue may be an open orphan. */
    | { kind: "hand-tail"; key: string; issue: number; settledBy: number };

/**
 * A `claims` row no filing referenced this run: the gap it names is gone, but
 * rows are never pruned (`applyUpdatedIssues`), so its issue is open and no
 * longer updated by anything. Printed; the ones whose work is provably done
 * are closed by {@link planClaimClosures}, the rest stay a line in the log.
 *
 * A `hand-tail` row is not filed again once its card is hand-written under a
 * `hand-tail:` marker, yet its gap is still there (issue #4513): while the
 * card keeps a residual gap, a marker naming the claim's own issue is silent,
 * and one naming ANOTHER issue comes back with `settledBy` — the claim's
 * issue is a possible open orphan. A card with no residual gap left is stale
 * whatever its marker says.
 */
export function staleClaims(
    filed: ReadonlyMap<string, number>,
    filings: readonly GapFiling[],
    settled: SettledHandTail = { markerIssue: new Map(), residual: new Set() }
): StaleClaim[] {
    const live = new Set(filings.map((f) => claimId(f.kind, f.key)));
    const out: StaleClaim[] = [];
    for (const [id, issue] of filed) {
        if (live.has(id)) continue;
        const { kind, key } = splitClaimId(id);
        if (kind === "grammar" && key.startsWith(OP_KEY_PREFIX)) continue; // `check:gaps` owns the ops rows.
        const marker = settled.markerIssue.get(key);
        if (
            kind === "hand-tail" &&
            marker !== undefined &&
            settled.residual.has(key)
        ) {
            if (marker !== issue)
                out.push({ kind, key, issue, settledBy: marker });
            continue;
        }
        out.push({ kind, key, issue });
    }
    return out;
}

/** Why a claim's issue is closed — each names what the run measured. */
export type ClosureReason =
    /** A `hand-tail` claim whose card's `hand-tail:` marker names its issue. */
    | "settled"
    /** A `hand-tail` claim whose card now compiles `ready`. */
    | "ready"
    /** A `grammar` / `mechanic` / `scenario` / `bot` key this run no longer
     *  computes anywhere in the corpus. */
    | "gone";

/** One claim issue {@link planClaimClosures} closes. */
export interface ClaimClosure {
    readonly kind: GapKind;
    readonly key: string;
    readonly issue: number;
    readonly reason: ClosureReason;
}

/**
 * The claim issues whose work is done (issue #4516) — the pure half of the
 * close pass; `closeClaims` is the shell over it. Over every `claims` row no
 * filing referenced this run:
 *
 * - `hand-tail`: its card's marker names the claim's own issue (`settled`), or
 *   the card has no marker and compiles `ready` (`ready`). A marker naming
 *   ANOTHER issue is never closed: that row is the `settled` line of the stale
 *   report, a possible orphan a human reconciles (issue #4513).
 * - `grammar` / `mechanic` / `scenario`: its key is absent from `computed`.
 * - `bot`: the same, but ONLY while the Findings report agrees with the
 *   lockfile (`computed.bot !== null`); otherwise every stale `bot` row comes
 *   back in `botSkipped` — "gone" on the lockfile fallback may be spurious.
 * - `migration` and the `(op) ›` rows (`check:gaps` owns those): never.
 *
 * An issue is closed only when EVERY row naming it closes — a Grammar
 * Cluster with one member still live stays open — and never the PRD
 * placeholder a row points at before it is filed.
 */
export function planClaimClosures(
    filed: ReadonlyMap<string, number>,
    filings: readonly GapFiling[],
    settled: SettledHandTail,
    computed: ComputedGapKeys
): {
    close: ClaimClosure[];
    botSkipped: { kind: "bot"; key: string; issue: number }[];
} {
    const live = new Set(filings.map((f) => claimId(f.kind, f.key)));
    const candidates: ClaimClosure[] = [];
    const botSkipped: { kind: "bot"; key: string; issue: number }[] = [];
    for (const [id, issue] of filed) {
        if (live.has(id) || issue === PRD_ISSUE) continue;
        const { kind, key } = splitClaimId(id);
        const reason = closureReason(kind, key, issue, settled, computed);
        if (reason === "bot-unverified")
            botSkipped.push({ kind: "bot", key, issue });
        else if (reason !== null) candidates.push({ kind, key, issue, reason });
    }
    const rowsOf = new Map<number, number>();
    for (const issue of filed.values())
        rowsOf.set(issue, (rowsOf.get(issue) ?? 0) + 1);
    const closingOf = new Map<number, number>();
    for (const c of candidates)
        closingOf.set(c.issue, (closingOf.get(c.issue) ?? 0) + 1);
    return {
        close: candidates.filter(
            (c) => closingOf.get(c.issue) === rowsOf.get(c.issue)
        ),
        botSkipped,
    };
}

function closureReason(
    kind: GapKind,
    key: string,
    issue: number,
    settled: SettledHandTail,
    computed: ComputedGapKeys
): ClosureReason | "bot-unverified" | null {
    switch (kind) {
        case "hand-tail": {
            const marker = settled.markerIssue.get(key);
            if (marker !== undefined)
                return marker === issue ? "settled" : null;
            return settled.ready?.has(key) === true &&
                !settled.residual.has(key)
                ? "ready"
                : null;
        }
        case "grammar":
            if (key.startsWith(OP_KEY_PREFIX)) return null;
            return computed.grammar.has(key) ? null : "gone";
        case "mechanic":
        case "scenario":
            return computed[kind].has(key) ? null : "gone";
        case "bot":
            if (computed.bot === null) return "bot-unverified";
            return computed.bot.has(key) ? null : "gone";
        case "migration":
            return null;
    }
}

/** Why one closure closes, as the sentence its comment carries. */
function closureWhy(closure: ClaimClosure): string {
    switch (closure.reason) {
        case "settled":
            return `the card \`${closure.key}\` carries a \`hand-tail:\` marker naming this issue — it is hand-written, the claim is settled`;
        case "ready":
            return `the card \`${closure.key}\` now compiles \`ready\` — its Hand Tail gap is gone`;
        case "gone":
            return `the ${closure.kind} gap \`${closure.key}\` is no longer computed anywhere in the corpus`;
    }
}

/** The comment a close carries: every reason for the issue, and the tip it
 *  was measured at. */
export function closureComment(
    closures: readonly ClaimClosure[],
    tip: string
): string {
    return [
        `Closed by \`gaps:sync\` at ${tip} (issue #4516):`,
        "",
        ...closures.map((c) => `- ${closureWhy(c)}.`),
        "",
        "The claim row in `data/grammar-gaps.json` stays; if the gap comes back, re-open this issue.",
    ].join("\n");
}

/** An issue as the close pass reads it: its state, and the title that says
 *  who filed it. */
export interface ClosableIssue {
    readonly state: "OPEN" | "CLOSED";
    readonly title: string;
}

/** What the close pass needs of the tracker — ONE batched read, and a close. */
export interface ClaimCloser {
    /** Every number asked → its issue, or `null` when it does not exist. */
    readIssues(numbers: readonly number[]): Map<number, ClosableIssue | null>;
    close(number: number, comment: string): void;
}

/**
 * More OPEN issues than this in one pass refuses the whole pass: a truncated
 * or narrowed lockfile reads as every gap gone, and a closed claim is never
 * re-filed (`syncGaps`' `skip-closed`), so a mass close silently orphans live
 * work. A real landing closes a handful; a human re-runs past a refusal.
 */
export const CLOSE_CAP = 25;

/**
 * The thin shell over {@link planClaimClosures}: one `close` per open issue
 * (a Grammar Cluster's rows share one), carrying {@link closureComment}. An
 * already-closed issue — or one deleted — is a no-op, never an error.
 *
 * Only an issue `gaps:sync` FILED is closed: its title opens with the claim
 * kind's `GAP_TITLE_PREFIX`. A claim may record a human-written issue — one
 * adopted because its `## Cards` names the card (issue #4515), or a
 * hand-authored Grammar Cluster — whose scope is wider than the claim, so it
 * comes back `foreign` and stays open.
 */
export function closeClaims(
    closures: readonly ClaimClosure[],
    closer: ClaimCloser,
    tip: string,
    cap = CLOSE_CAP
): {
    issue: number;
    closures: ClaimClosure[];
    action: "closed" | "already-closed" | "missing" | "foreign" | "over-cap";
}[] {
    const byIssue = new Map<number, ClaimClosure[]>();
    for (const c of closures)
        byIssue.set(c.issue, [...(byIssue.get(c.issue) ?? []), c]);
    const tracked = closer.readIssues([...byIssue.keys()]);
    const decided = [...byIssue].map(([issue, rows]) => {
        const read = tracked.get(issue) ?? null;
        const action =
            read === null
                ? ("missing" as const)
                : read.state === "CLOSED"
                  ? ("already-closed" as const)
                  : rows.every((c) =>
                          read.title.startsWith(GAP_TITLE_PREFIX[c.kind])
                      )
                    ? ("closed" as const)
                    : ("foreign" as const);
        return { issue, closures: rows, action };
    });
    const closing = decided.filter((d) => d.action === "closed");
    if (closing.length > cap)
        return decided.map((d) =>
            d.action === "closed" ? { ...d, action: "over-cap" as const } : d
        );
    for (const d of closing)
        closer.close(d.issue, closureComment(d.closures, tip));
    return decided;
}

/**
 * The merged Bot verdicts `computedGapKeys` may trust, or `null`: only a
 * Findings report that exists AND has no row disagreeing with the lockfile
 * (issue #4516) — on the lockfile's own fallback a Bot Gap reading gone may
 * be spurious.
 */
export function trustedBotFindings(
    findings: unknown | null,
    botMerge: {
        readonly merged: ReadonlyMap<string, BotGapVerdict>;
        readonly stale: readonly string[];
    }
): ReadonlyMap<string, BotGapVerdict> | null {
    return findings !== null && botMerge.stale.length === 0
        ? botMerge.merged
        : null;
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

    // The Bot Reach Findings report (issue #4175) merged over the lockfile
    // (issue #4406) — the `bot` kind's second input, absent exactly when the
    // committed artifact is missing (a checkout that predates it, or a
    // narrowed local run that wrote its measurement elsewhere).
    const findingsPath = join(root, FINDINGS_PATH);
    const findings = existsSync(findingsPath)
        ? parseFindings(readFileSync(findingsPath, "utf8"))
        : null;
    // Freshly computed, never the lockfile's own header: that field only
    // catches up the next time `oracle:compile` REPLAYS a card, so it can
    // lag behind the Bot's actual source for arbitrarily long between full
    // compiler runs (`mergeBotVerdicts`'s own doc).
    const botMerge = mergeBotVerdicts(findings, lock.cards, botHash(root));
    if (botMerge.stale.length > 0) {
        const nameOf = new Map(lock.cards.map((c) => [c.oracleId, c.name]));
        const names = botMerge.stale
            .map((id) => nameOf.get(id) ?? id)
            .slice(0, 20);
        console.log(
            `stale      ${FINDINGS_PATH}: ${botMerge.stale.length} row(s) disagree with the lockfile ` +
                "(Bot hash or definition hash moved since `bot:reach` last ran) — falling back to the " +
                `lockfile's own verdict, filing nothing from them: ${names.join(", ")}` +
                (botMerge.stale.length > names.length ? ", …" : "") +
                " — re-run `bun run bot:reach` to refresh"
        );
    }

    // Read before anything is filed, and a failed read THROWS: a card-keyed
    // claim adopts the open issue already naming the card (issue #4515), so an
    // empty index read as authoritative would file the duplicate. A dry run
    // makes no network call, so it previews without adoption.
    const openCardIssues = dryRun
        ? undefined
        : openCardIssueIndex(
              listOpenIssueBodies(),
              (name) => ctx.byName.get(name)?.oracleId
          );

    const { filings, handTailHeld, filed, settledHandTail } = buildAllFilings(
        root,
        lock,
        allowlist,
        registry,
        ctx,
        botMerge.merged,
        openCardIssues
    );

    // Reported whether or not filing is on — but a SUMMARY, plus one line per
    // card that is actually news: a hand-WRITTEN card whose `compiler-gap:`
    // names a gap that has since fallen below the floor. Its marker claims a
    // debt the grammar no longer has; the closing PR flips it to `hand-tail:`.
    if (handTailHeld.length > 0) {
        console.log(
            `hand-tail  ${handTailHeld.length} ranked card(s) below the floor of ${registry.handTailFloor}; not filed ` +
                (registry.handTailFiling
                    ? "(outside every `enforced` Target, issue #4219)"
                    : "(data/targets.json `handTailFiling`: false)")
        );
    }
    // Held AND filed cards alike: an enforced card with a stale marker is in
    // `filings`, and the nudge is exactly what its closing PR needs.
    const marked = compilerGapCards(root);
    for (const f of [
        ...handTailHeld,
        ...filings.filter((f) => f.kind === "hand-tail"),
    ].filter((f) => marked.has(f.key))) {
        console.log(
            `hand-tail  ${f.key} — its \`compiler-gap:\` marker names a gap now below the floor; flip it to \`hand-tail:\``
        );
    }
    // The close plan (issue #4516): the Bot's verdicts are trusted only while
    // the Findings report agrees with the lockfile, so a `bot` claim reading
    // gone on the lockfile's fallback is reported, never closed.
    const closures = planClaimClosures(
        filed,
        filings,
        settledHandTail,
        computedGapKeys(lock, trustedBotFindings(findings, botMerge))
    );
    const closing = new Set(closures.close.map((c) => claimId(c.kind, c.key)));
    const botSkipped = new Set(
        closures.botSkipped.map((c) => claimId(c.kind, c.key))
    );
    for (const stale of staleClaims(filed, filings, settledHandTail)) {
        const id = claimId(stale.kind, stale.key);
        if (closing.has(id)) continue;
        console.log(
            "settledBy" in stale
                ? `settled    hand-tail claim \`${stale.key}\` -> issue #${stale.issue} — the card is settled by #${stale.settledBy}; close #${stale.issue} if still open`
                : botSkipped.has(id)
                  ? `stale      bot claim \`${stale.key}\` -> issue #${stale.issue} — reads gone, not closed: ${FINDINGS_PATH} ${findings === null ? "is missing" : "disagrees with the lockfile"}`
                  : `stale      ${stale.kind} claim \`${stale.key}\` -> issue #${stale.issue} — no filing references it; not closable, the row stays`
        );
    }
    for (const c of closures.close) {
        console.log(
            `${dryRun ? "would close" : "close     "} ${c.kind} claim \`${c.key}\` -> issue #${c.issue} (${c.reason})`
        );
    }

    // Residue of the Target partition: no ranked Target among the cards it
    // reaches. Listed, never swept into an umbrella — it keeps its parent.
    const bandResidue = filings.filter(
        (f) =>
            PARTITIONED_KINDS[f.kind] !== undefined &&
            bandUmbrellaOf(f) === null
    );
    for (const f of bandResidue) {
        const at =
            f.currentIssue === null ? "unfiled" : `issue #${f.currentIssue}`;
        const why =
            f.target === undefined || f.target === null
                ? "no ranked Target among the cards it reaches"
                : `its Target \`${f.target}\` has no umbrella in BAND_UMBRELLAS — add the family's row (docs/agents/issue-tracker.md)`;
        console.log(
            `residue    ${f.kind} \`${f.key}\` (${at}) — ${why}; no Target umbrella: it keeps its parent (none, or a retired one: it moves to its family's lowest-ranked Target umbrella — or its P0 umbrella when this run has --band P0)`
        );
    }

    if (dryRun) {
        const clusters = clusterIssues(allowlist);
        for (const filing of filings) {
            const at =
                filing.currentIssue === null
                    ? "would CREATE"
                    : clusters.has(filing.currentIssue)
                      ? `would leave Grammar Cluster issue #${filing.currentIssue} alone`
                      : `would reconcile issue #${filing.currentIssue}`;
            const origin = originUmbrellaOf(filing, originBand);
            const umbrella = bandUmbrellaOf(filing);
            const band =
                origin !== null && filing.currentIssue === null
                    ? ` [origin P0 -> #${origin}]`
                    : umbrella === null
                      ? ""
                      : ` [${filing.target} -> #${umbrella}]`;
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
        originBand,
        clusterIssues(allowlist)
    );

    const counts = new Map<string, number>();
    for (const action of result.actions) {
        counts.set(action.action, (counts.get(action.action) ?? 0) + 1);
        if (action.action !== "noop") {
            console.log(
                `${action.kind.padEnd(10)} ${action.action.padEnd(11)} ${action.key} -> issue #${action.issue}` +
                    (action.parent === undefined
                        ? ""
                        : ` (parent #${action.parent})`)
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
        // An adopted issue's body is somebody else's and is never rewritten
        // (issue #4515), so it never gets the `## Blocked by` half of an edge:
        // wiring the native half alone would leave the two out of parity.
        const adopted = new Set(
            filings.filter(isAdoptedFiling).map((f) => claimId(f.kind, f.key))
        );
        const issueOf = new Map(
            result.actions
                .filter(
                    (a) =>
                        a.action !== "skip-closed" &&
                        !adopted.has(claimId(a.kind, a.key))
                )
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

    // The close pass (issue #4516), after every write above: it records
    // nothing, so its own try/catch — a failure here is not a failed filing.
    try {
        const tip = spawnSync("git", ["rev-parse", "HEAD"], {
            cwd: root,
            encoding: "utf8",
        }).stdout.trim();
        if (tip === "")
            throw new Error("could not read the tip (git rev-parse HEAD)");
        const done = closeClaims(closures.close, tracker, tip);
        for (const row of done.filter(
            (r) => r.action === "foreign" || r.action === "over-cap"
        )) {
            console.log(
                row.action === "foreign"
                    ? `close      issue #${row.issue} — not closed: its title is not a \`${GAP_TITLE_PREFIX[row.closures[0]!.kind]}\` issue gaps:sync filed (adopted or hand-authored)`
                    : `close      issue #${row.issue} — not closed: over CLOSE_CAP (${CLOSE_CAP}) open issues in one pass; check the lockfile, then close by hand or raise the cap`
            );
        }
        console.log(
            `gaps:sync: close pass at ${tip.slice(0, 12)} — ${done.filter((r) => r.action === "closed").length} issue(s) closed, ` +
                `${done.filter((r) => r.action === "already-closed" || r.action === "missing").length} already closed or missing, ` +
                `${done.filter((r) => r.action === "foreign").length} foreign, ${done.filter((r) => r.action === "over-cap").length} over cap, ${closures.botSkipped.length} bot claim(s) held`
        );
    } catch (err) {
        console.error(
            `gaps:sync: the close pass failed (${(err as Error).message}) — every filing above is already recorded`
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
