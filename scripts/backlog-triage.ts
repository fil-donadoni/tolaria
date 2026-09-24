#!/usr/bin/env bun
/**
 * `bun run backlog:triage` — the band rule of issue #3851 decision 3, as a
 * re-runnable script (issue #4054). The rule itself is the pure `triage` in
 * `lib/backlog-triage.ts`; this file only gathers its three inputs and prints
 * the per-class diff.
 *
 * **Dry run by default.** A run with no flags — or with `--dry-run`, accepted
 * for the habit — performs zero mutations. `--write` (issue #4055) applies
 * the bands, and this is the command re-run whenever the Target List or the
 * lockfile moves: the band is RECOMPUTED, never assigned once (issue #3851
 * decision 5), so the command stays and its second run is a no-op.
 *
 * What `--write` touches is `planWrites` in the lib: only the CHANGED values,
 * never a `P0` (written or cleared), never the residue. An unchanged run makes
 * no write call at all — not even the project-metadata read. The writes go as
 * aliased GraphQL mutations, `WRITE_BATCH` per request: one
 * `addProjectV2ItemById` batch (idempotent — it returns the existing item for
 * an issue already on the board) then one `updateProjectV2ItemFieldValue`
 * batch. A run cut short leaves a board the next run simply finishes.
 * A Target-keyed umbrella (`BAND_UMBRELLAS`, a `P0` slot excluded) is banded
 * from its Target's `targetBand()` instead of its own verdict (issue #4212),
 * so a Target completing shifts its umbrellas in the same batched write, and
 * the children that inherit the umbrella are banded from the value it is
 * about to hold, so one run converges them too. The Target's band outranks a
 * `## Band` ruling on the umbrella itself.
 * An issue whose body carries a `## Band` line (`P2 — <reason>`, issue #4230)
 * is banded by it — the `user-decision` source, the truth over every other
 * one; a line that bands nothing is reported under `## Band residue`. An issue
 * no source bands takes the coarse label default (`labels`, issue #4231 — the
 * weakest source; `prd` and unlabelled rows stay residue). The
 * board field stays the OUTPUT of this script, never hand-written.
 * `--clear-residue` (ADR 0143, issue #4232) is the ONE-SHOT blank of the
 * stale board values on rows no source bands — residue AFTER `labels`, the
 * `planClear` in the lib; alone it previews, with `--write` it applies (one
 * `addProjectV2ItemById` + one `clearProjectV2ItemFieldValue` batch per
 * `WRITE_BATCH`). It replaces the normal pass for that run and is announced,
 * not routine: an owner runs it once, before the next batch.
 * `--suggest-cards` appends the `## Cards` backfill (issue #4086) — a
 * proposal per residue issue, printed, never written, with or without
 * `--write`.
 *
 * Reads, and their budget (~470 items against a 5000-point/hour GraphQL pool
 * shared with `queue:plan`):
 *
 *   - the board's `Priority` field through `fetchBoardPriority` — the shared
 *     single-field query (8 points against `gh project item-list`'s 766,
 *     `docs/agents/issue-tracker.md`), never a whole-board item list;
 *   - the open issues with their body, their parent, the issues they block
 *     and their label names (the `labels` source, issue #4231), one paginated
 *     GraphQL query at 2 points a page — the `blocking` and `labels`
 *     connections each cost a request per issue, 1 + 100 + 100 = 201 against
 *     GitHub's per-100 rounding (it was 1 point before `labels`, ~10 a run);
 *   - the lockfile, the Target registry and `data/grammar-gaps.json`'s claims,
 *     all local.
 *
 * Runs from the primary checkout with `GITHUB_TOKEN` stripped (`lib/gh.ts`),
 * like `queue:plan` and `gaps:sync`.
 */

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ALLOWLIST_PATH, LOCKFILE_PATH, parseAllowlist } from "./check-gaps";
import {
    cardBandIndex,
    claimedCards,
    filingGaps,
    issueCards,
    planClear,
    planUmbrellas,
    planWrites,
    parseBand,
    parseCards,
    renderClearReport,
    renderReport,
    renderSuggestions,
    resolveDeclaredCards,
    suggestCards,
    summarize,
    triage,
    umbrellaSlots,
    type Band,
    type BandClear,
    type BandWrite,
    type BandResidue,
    type RecordedP0,
    type CardsResidue,
    type TriageIssue,
} from "./lib/backlog-triage";
import { fetchBoardPriority, type BoardPriority } from "./lib/board-priority";
import { gh } from "./lib/gh";
import { BAND_UMBRELLAS } from "./lib/gap-issues";
import { parseLockfile } from "./lib/oracle-lockfile";
import {
    gapIndex,
    parseClaimRows,
    readTargetRegistry,
    resolveContext,
    resolveTarget,
} from "./lib/targets";

const PROJECT_OWNER = process.env.TOLARIA_PROJECT_OWNER ?? "fil-donadoni";
const PROJECT_NUMBER = process.env.TOLARIA_PROJECT_NUMBER ?? "2";
const PROJECT_REPO = process.env.TOLARIA_PROJECT_REPO ?? "fil-donadoni/tolaria";

/** Per issue, how many blocked issues one page reads. An issue blocking more
 *  fails closed rather than dropping an edge. */
const BLOCKING_PAGE = 50;

/** Per issue, how many labels one page reads; more fails closed — a dropped
 *  `user-report` would be a wrong default band. */
const LABELS_PAGE = 30;

/**
 * `$endCursor` is named exactly that because `gh api graphql --paginate` keys
 * its walk to it — renamed, the read silently returns page one only.
 */
export const OPEN_ISSUES_QUERY = `
query($owner: String!, $name: String!, $endCursor: String) {
    repository(owner: $owner, name: $name) {
        issues(states: OPEN, first: 100, after: $endCursor) {
            totalCount
            pageInfo { hasNextPage endCursor }
            nodes {
                id
                number
                title
                body
                parent { number }
                blocking(first: ${BLOCKING_PAGE}) {
                    totalCount
                    nodes { number }
                }
                labels(first: ${LABELS_PAGE}) {
                    totalCount
                    nodes { name }
                }
            }
        }
    }
}`;

interface IssuePage {
    data?: {
        repository?: {
            issues?: {
                totalCount?: number;
                pageInfo?: { hasNextPage?: boolean };
                nodes?: {
                    id: string;
                    number: number;
                    title: string;
                    body: string;
                    parent: { number: number } | null;
                    blocking: {
                        totalCount: number;
                        nodes: { number: number }[];
                    };
                    labels: {
                        totalCount: number;
                        nodes: { name: string }[];
                    };
                }[];
            };
        };
    };
}

export interface OpenIssue {
    /** The issue's GraphQL node id — what `addProjectV2ItemById` takes. */
    readonly nodeId: string;
    readonly number: number;
    readonly title: string;
    /** Read in the SAME query — the `## Cards` section (issue #4086) costs
     *  no second read. */
    readonly body: string;
    readonly parent: number | null;
    readonly blocks: readonly number[];
    /** Its label names — the `labels` source. */
    readonly labels: readonly string[];
}

/** Every open issue with its parent and the issues it blocks. Fails closed on
 *  a truncated walk or a truncated edge list — a missing edge is a wrong band. */
export function fetchOpenIssues(
    run: (args: string[]) => string,
    repo: string = PROJECT_REPO
): OpenIssue[] {
    const [owner, name] = repo.split("/");
    const raw = run([
        "api",
        "graphql",
        "--paginate",
        "--slurp",
        "-f",
        `owner=${owner}`,
        "-f",
        `name=${name}`,
        "-f",
        `query=${OPEN_ISSUES_QUERY}`,
    ]);
    const pages = JSON.parse(raw) as IssuePage[];
    const conns = Array.isArray(pages)
        ? pages.map((p) => p.data?.repository?.issues)
        : [];
    if (conns.length === 0 || conns.some((c) => !Array.isArray(c?.nodes)))
        throw new Error(
            `backlog:triage: the open-issue query for ${repo} returned no issues — the repo does not resolve or the shape changed`
        );
    if (conns[conns.length - 1]!.pageInfo?.hasNextPage === true)
        throw new Error(
            "backlog:triage: the open-issue walk stopped with pages outstanding — re-run"
        );
    const out: OpenIssue[] = [];
    for (const node of conns.flatMap((c) => c!.nodes!)) {
        if (node.blocking.totalCount > node.blocking.nodes.length)
            throw new Error(
                `backlog:triage: issue #${node.number} blocks ${node.blocking.totalCount} issues, more than one page (${BLOCKING_PAGE}) — paginate before trusting its band`
            );
        if (node.labels.totalCount > node.labels.nodes.length)
            throw new Error(
                `backlog:triage: issue #${node.number} carries ${node.labels.totalCount} labels, more than one page (${LABELS_PAGE}) — paginate before trusting its default band`
            );
        out.push({
            nodeId: node.id,
            number: node.number,
            title: node.title,
            body: node.body ?? "",
            parent: node.parent?.number ?? null,
            blocks: node.blocking.nodes.map((n) => n.number),
            labels: node.labels.nodes.map((l) => l.name),
        });
    }
    return out;
}

/** Writes per GraphQL request — each is one aliased mutation field. */
export const WRITE_BATCH = 25;

/** The project node, its `Priority` field and that field's options. */
export const PRIORITY_FIELD_QUERY = `
query($owner: String!, $number: Int!) {
    repositoryOwner(login: $owner) {
        ... on ProjectV2Owner {
            projectV2(number: $number) {
                id
                field(name: "Priority") {
                    ... on ProjectV2SingleSelectField {
                        id
                        options { id name }
                    }
                }
            }
        }
    }
}`;

interface PriorityField {
    readonly projectId: string;
    readonly fieldId: string;
    readonly optionId: Readonly<Record<string, string>>;
}

/** A node id goes into a mutation literal — refuse anything that is not one. */
const NODE_ID = /^[A-Za-z0-9_=-]+$/;
function nodeId(value: unknown, what: string): string {
    if (typeof value !== "string" || !NODE_ID.test(value))
        throw new Error(
            `backlog:triage: ${what} is not a GraphQL node id: ${JSON.stringify(value)}`
        );
    return value;
}

function graphql(
    run: (args: string[]) => string,
    query: string,
    vars: string[] = []
): Record<string, unknown> {
    const res = JSON.parse(
        run(["api", "graphql", ...vars, "-f", `query=${query}`])
    ) as { data?: Record<string, unknown>; errors?: unknown[] };
    if (res.errors !== undefined && res.errors.length > 0)
        throw new Error(
            `backlog:triage: GraphQL errors: ${JSON.stringify(res.errors)}`
        );
    if (res.data === undefined)
        throw new Error("backlog:triage: GraphQL response carried no data");
    return res.data;
}

/** Fails closed before any write: a board with no `Priority` single-select, or
 *  one missing an option a write needs, writes nothing. */
function fetchPriorityField(
    run: (args: string[]) => string,
    bands: ReadonlySet<Band>
): PriorityField {
    const data = graphql(run, PRIORITY_FIELD_QUERY, [
        "-f",
        `owner=${PROJECT_OWNER}`,
        "-F",
        `number=${PROJECT_NUMBER}`,
    ]) as {
        repositoryOwner?: {
            projectV2?: {
                id?: string;
                field?: {
                    id?: string;
                    options?: { id: string; name: string }[];
                };
            } | null;
        } | null;
    };
    const project = data.repositoryOwner?.projectV2;
    const options = project?.field?.options;
    if (!project || !Array.isArray(options))
        throw new Error(
            `backlog:triage: project ${PROJECT_OWNER}/${PROJECT_NUMBER} has no \`Priority\` single-select field — nothing written`
        );
    const optionId: Record<string, string> = {};
    for (const o of options)
        optionId[o.name] = nodeId(o.id, `option ${o.name}`);
    for (const band of bands)
        if (optionId[band] === undefined)
            throw new Error(
                `backlog:triage: the \`Priority\` field has no \`${band}\` option — nothing written`
            );
    return {
        projectId: nodeId(project.id, "project id"),
        fieldId: nodeId(project.field!.id, "Priority field id"),
        optionId,
    };
}

/** The board item of each issue in `batch` — one aliased `addProjectV2ItemById`
 *  request, idempotent (it returns the existing item for an issue already on
 *  the board), so the write and the clear side share it. */
function boardItemIds(
    run: (args: string[]) => string,
    projectId: string,
    batch: readonly { readonly number: number }[],
    nodeIds: ReadonlyMap<number, string>
): string[] {
    const added = graphql(
        run,
        `mutation {\n${batch
            .map(
                (w, i) =>
                    `    a${i}: addProjectV2ItemById(input: { projectId: "${projectId}", contentId: "${nodeId(nodeIds.get(w.number), `issue #${w.number}`)}" }) { item { id } }`
            )
            .join("\n")}\n}`
    ) as Record<string, { item?: { id?: string } } | null>;
    return batch.map((w, i) =>
        nodeId(added[`a${i}`]?.item?.id, `board item of issue #${w.number}`)
    );
}

/**
 * Applies `writes` to the board. Makes NO call for an empty list — the
 * second run on unchanged inputs costs nothing. Returns the writes applied;
 * a failure throws after the batches already sent, which the next run's
 * `planWrites` no longer owes.
 */
export function applyWrites(
    run: (args: string[]) => string,
    writes: readonly BandWrite[],
    nodeIds: ReadonlyMap<number, string>
): BandWrite[] {
    if (writes.length === 0) return [];
    const field = fetchPriorityField(run, new Set(writes.map((w) => w.band)));
    const applied: BandWrite[] = [];
    for (let at = 0; at < writes.length; at += WRITE_BATCH) {
        const batch = writes.slice(at, at + WRITE_BATCH);
        const itemIds = boardItemIds(run, field.projectId, batch, nodeIds);
        graphql(
            run,
            `mutation {\n${batch
                .map(
                    (w, i) =>
                        `    u${i}: updateProjectV2ItemFieldValue(input: { projectId: "${field.projectId}", itemId: "${itemIds[i]}", fieldId: "${field.fieldId}", value: { singleSelectOptionId: "${field.optionId[w.band]}" } }) { projectV2Item { id } }`
                )
                .join("\n")}\n}`
        );
        applied.push(...batch);
    }
    return applied;
}

/**
 * Blanks the board `Priority` of `clears` (`--clear-residue --write`): the
 * same batching as {@link applyWrites}, `clearProjectV2ItemFieldValue` in place
 * of the option update. Makes NO call for an empty list; a failure throws after
 * the batches already sent, which the next run's `planClear` no longer owes.
 */
export function applyClears(
    run: (args: string[]) => string,
    clears: readonly BandClear[],
    nodeIds: ReadonlyMap<number, string>
): BandClear[] {
    if (clears.length === 0) return [];
    const field = fetchPriorityField(run, new Set());
    const applied: BandClear[] = [];
    for (let at = 0; at < clears.length; at += WRITE_BATCH) {
        const batch = clears.slice(at, at + WRITE_BATCH);
        const itemIds = boardItemIds(run, field.projectId, batch, nodeIds);
        graphql(
            run,
            `mutation {\n${batch
                .map(
                    (_, i) =>
                        `    c${i}: clearProjectV2ItemFieldValue(input: { projectId: "${field.projectId}", itemId: "${itemIds[i]}", fieldId: "${field.fieldId}" }) { projectV2Item { id } }`
                )
                .join("\n")}\n}`
        );
        applied.push(...batch);
    }
    return applied;
}

/** The whole run, minus printing — the seam the tests drive with a recording
 *  `ghClient`. */
export function runTriage(opts: {
    root: string;
    argv: readonly string[];
    ghClient: (args: string[]) => string;
}): string {
    const write = opts.argv.includes("--write");
    if (write && opts.argv.includes("--dry-run"))
        throw new Error(
            "backlog:triage: `--write` and `--dry-run` together — pick one"
        );
    const clearResidue = opts.argv.includes("--clear-residue");
    if (clearResidue && opts.argv.includes("--suggest-cards"))
        throw new Error(
            "backlog:triage: `--clear-residue` and `--suggest-cards` together — pick one"
        );
    const lock = parseLockfile(
        readFileSync(join(opts.root, LOCKFILE_PATH), "utf8")
    );
    const allowlist = parseAllowlist(
        readFileSync(join(opts.root, ALLOWLIST_PATH), "utf8")
    );
    const registry = readTargetRegistry(opts.root);
    const ctx = resolveContext(opts.root, lock);
    const byName = (name: string): string | undefined =>
        ctx.byName.get(name)?.oracleId;

    const index = cardBandIndex(
        registry.targets.map((row) => ({
            id: row.id,
            ids: resolveTarget(row, ctx).cards.map((c) => c.oracleId),
        }))
    );
    const claimed = claimedCards(
        parseClaimRows(allowlist, ALLOWLIST_PATH),
        lock,
        gapIndex(lock).gapKeys,
        byName
    );

    const errors: string[] = [];
    const board = fetchBoardPriority({
        owner: PROJECT_OWNER,
        projectNumber: PROJECT_NUMBER,
        repo: PROJECT_REPO,
        onError: (message) => errors.push(message),
        ghClient: opts.ghClient,
    });
    // A degraded board read would report every hand-set P0 as a band to
    // write over — fail closed, never triage against a partial board.
    if (errors.length > 0)
        throw new Error(
            `backlog:triage: board read failed:\n${errors.join("\n")}`
        );

    const open = fetchOpenIssues(opts.ghClient);
    const cardsResidue: CardsResidue[] = [];
    const bandResidue: BandResidue[] = [];
    const recordedP0: RecordedP0[] = [];
    const issues: TriageIssue[] = open.map((i) => {
        const declared = resolveDeclaredCards(i.number, i.body, byName);
        cardsResidue.push(...declared.residue);
        const band = parseBand(i.number, i.body);
        bandResidue.push(...band.residue);
        if (band.recordedP0) recordedP0.push(band.recordedP0);
        return {
            number: i.number,
            title: i.title,
            parent: i.parent,
            blocks: i.blocks,
            cards: issueCards(i, claimed, byName, declared.ids),
            ruling: band.ruling,
            labels: i.labels,
        };
    });
    // A Target-keyed umbrella's own Priority follows its Target (issue #4212):
    // planned in dry runs too, so the report names what `--write` would do.
    const umbrellas = planUmbrellas(
        umbrellaSlots(BAND_UMBRELLAS, new Set(open.map((i) => i.number))),
        board
    );
    const nodeIds = new Map(open.map((i) => [i.number, i.nodeId]));
    if (clearResidue) {
        const clears = planClear(issues, index, board, umbrellas);
        return renderClearReport(
            clears,
            write ? applyClears(opts.ghClient, clears, nodeIds) : null
        );
    }
    // Children inherit the umbrella's board value (`parent` source): triage
    // reads it as this run will leave it, so one run converges the children
    // too. `planWrites` and `summarize` compare against the board AS IT IS.
    const settled: Record<number, BoardPriority> = { ...board };
    for (const w of umbrellas.writes) settled[w.number] = w.band;
    const verdicts = triage(issues, index, settled);
    const summary = summarize(issues, verdicts, board, umbrellas.owned);
    const written = write
        ? applyWrites(
              opts.ghClient,
              planWrites(verdicts, board, umbrellas),
              nodeIds
          )
        : null;
    const report = renderReport(
        summary,
        written,
        cardsResidue,
        bandResidue,
        umbrellas.writes,
        umbrellas.current,
        recordedP0,
        filingGaps(issues)
    );
    if (!opts.argv.includes("--suggest-cards")) return report;
    // The backfill is a PROPOSAL: printed, never written. An issue that
    // already declares its cards has been ruled on — its bad lines are in
    // the `## Cards residue` block above, nothing to suggest.
    const bodies = new Map(open.map((i) => [i.number, i.body] as const));
    const ranked = new Set(index.keys());
    return (
        report +
        "\n" +
        renderSuggestions(
            summary.residue
                .filter((r) => parseCards(bodies.get(r.number) ?? "") === null)
                .map((r) => ({
                    number: r.number,
                    names: suggestCards(
                        bodies.get(r.number) ?? "",
                        byName,
                        ranked
                    ),
                }))
        )
    );
}

function main(): void {
    try {
        console.log(
            runTriage({
                root: resolve("."),
                argv: process.argv.slice(2),
                ghClient: gh,
            })
        );
    } catch (err) {
        console.error((err as Error).message);
        process.exit(1);
    }
}

if (import.meta.main) main();
