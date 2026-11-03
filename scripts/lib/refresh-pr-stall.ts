/**
 * A derived-data refresh PR that stalls is superseded, never waited on
 * (issue #7927). The daily bot cost refresh and the weekly lane sentinel
 * refresh each open ONE data PR at a time; before this,
 * an open one stopped every later run quietly, so a single red refresh froze
 * the table with no signal (PR #7810: red on 2026-11-01, two silent `success`
 * runs after it).
 *
 * The data is a pure function of measurements re-read at the base tip, so an
 * old PR has nothing a new one lacks: a PR older than `STALL_HOURS` is closed
 * (its branch deleted) and the run derives afresh. The caller then fails the
 * run, so GitHub notifies the owner — a stall is never silent (the
 * `afkDispatch.repairAgeHours` precedent). A healthy refresh PR lands within
 * the hour; 12 h also covers a queue held by a standing RED.
 */
import { BASE_BRANCH } from "./branches";
import { gh } from "./gh";

/** Hours after which an open refresh PR is stalled, not in flight. */
export const STALL_HOURS = 12;

export interface OpenRefreshPr {
    number: number;
    headRefName: string;
    createdAt: string;
}

export type RefreshPrState =
    | { kind: "none" }
    | { kind: "in-flight"; pr: OpenRefreshPr }
    | { kind: "stalled"; prs: OpenRefreshPr[] };

/** Pure: what the open PRs under `prefix` mean for a run at `now`. Any PR
 *  younger than `stallHours` is in flight and wins; otherwise every one of
 *  them is stalled. */
export function refreshPrState(
    open: readonly OpenRefreshPr[],
    prefix: string,
    now: Date,
    stallHours: number = STALL_HOURS
): RefreshPrState {
    const mine = open.filter((p) => p.headRefName.startsWith(prefix));
    if (mine.length === 0) return { kind: "none" };
    const ageH = (p: OpenRefreshPr) =>
        (now.getTime() - Date.parse(p.createdAt)) / 3_600_000;
    const young = mine.find((p) => !(ageH(p) >= stallHours));
    if (young !== undefined) return { kind: "in-flight", pr: young };
    return { kind: "stalled", prs: mine };
}

export const prLabel = (p: OpenRefreshPr): string =>
    `PR #${p.number} (${p.headRefName})`;

/** The open PRs against the base, with what `refreshPrState` reads. */
export function openPrsOnBase(): OpenRefreshPr[] {
    return JSON.parse(
        gh([
            "pr",
            "list",
            "--state",
            "open",
            "--base",
            BASE_BRANCH,
            "--limit",
            "200",
            "--json",
            "number,headRefName,createdAt",
        ])
    ) as OpenRefreshPr[];
}

/**
 * The step every refresh job runs before deriving: `null` when a refresh PR
 * is in flight (stop quietly), else the stalled PRs it just closed (empty
 * when there were none). A non-empty result obliges the caller to end the
 * run with `stallFailure` once its fresh PR is open.
 */
export function settleRefreshPr(
    prefix: string,
    job: string,
    say: (line: string) => void
): OpenRefreshPr[] | null {
    const state = refreshPrState(openPrsOnBase(), prefix, new Date());
    if (state.kind === "in-flight") {
        say(
            `${prLabel(state.pr)} is in flight (open < ${STALL_HOURS} h) — one refresh at a time; nothing to do`
        );
        return null;
    }
    if (state.kind === "none") return [];
    for (const pr of state.prs) {
        supersede(pr, job);
        say(`${prLabel(pr)} stalled (open ≥ ${STALL_HOURS} h) — closed`);
    }
    return state.prs;
}

/** The message a run that superseded a stalled PR fails with, or null. */
export function stallFailure(stalled: readonly OpenRefreshPr[]): string | null {
    if (stalled.length === 0) return null;
    return `superseded stalled ${stalled.map(prLabel).join(", ")} — the run is red so the stall is seen; read the closed PR's lane for why it could not land (issue #7927)`;
}

/** Close a stalled refresh PR and delete its branch, saying why. */
export function supersede(pr: OpenRefreshPr, job: string): void {
    gh([
        "pr",
        "close",
        String(pr.number),
        "--delete-branch",
        "--comment",
        `Superseded by \`${job}\` (issue #7927): open for ${STALL_HOURS} h or more without landing, so the next run closes it and re-derives at the base tip. The run that closed it is red, so the stall is reported — read this PR's lane to see why it could not land.`,
    ]);
}
