#!/usr/bin/env bun
/**
 * `bun run issue:inherit-band <from> <to>` — an issue filed while working
 * `<from>` takes `<from>`'s band as its board `Priority` (issue #4928).
 *
 * A `/next-ticket` session that files an issue — an abort prerequisite, a
 * follow-up split off an unmet acceptance criterion — used to leave it with
 * no `Priority`. Issue #4917, split out of P0 issue #4896, sat unprioritised
 * until the owner set it by hand. The owner's rule (2026-10-01): an issue
 * born of the work inherits that work's band.
 *
 * The band is `originBandOfIssue` (`lib/origin-band.ts`), the rule `land`
 * already uses for `gaps:sync --band` and `queue:plan` orders by: the parent
 * umbrella's `Priority` when it carries one, else `<from>`'s own. This COPIES
 * a band a human set; it never derives one. That is the only way a script
 * writes `P0` (ADR 0143, Amendment IV).
 *
 * Refuses (exit 1, nothing written) when `<from>` has no readable band, or
 * when `<to>` already carries a `Priority`: a hand-set band is never
 * overwritten. Exit 2 on bad arguments.
 */

import {
    fetchBoardPriority,
    setBoardPriority,
    type BoardPriority,
} from "./lib/board-priority";
import {
    LIVE_ORIGIN_BAND_DEPS,
    originBandOfIssue,
    type OriginBandDeps,
} from "./lib/origin-band";

const PROJECT_OWNER = process.env.TOLARIA_PROJECT_OWNER ?? "fil-donadoni";
const PROJECT_NUMBER = process.env.TOLARIA_PROJECT_NUMBER ?? "2";
const PROJECT_REPO = process.env.TOLARIA_PROJECT_REPO ?? "fil-donadoni/tolaria";

export type InheritPlan =
    | { kind: "write"; band: BoardPriority }
    | { kind: "refuse"; reason: string };

export interface InheritDeps extends OriginBandDeps {
    /** `<to>`'s own board `Priority`, or null when unset. May throw. */
    readOwn: (issue: number) => BoardPriority | null;
}

/** What `issue:inherit-band <from> <to>` will do. Pure over `deps`. */
export function planInheritance(
    from: number,
    to: number,
    deps: InheritDeps
): InheritPlan {
    if (from === to) {
        return {
            kind: "refuse",
            reason: `issue #${to} cannot inherit from itself`,
        };
    }
    const origin = originBandOfIssue(from, deps);
    if (origin.band === null) {
        return {
            kind: "refuse",
            reason: origin.reason ?? `issue #${from} has no band`,
        };
    }
    let own: BoardPriority | null;
    try {
        own = deps.readOwn(to);
    } catch (err) {
        return {
            kind: "refuse",
            reason: `could not read the board Priority of issue #${to} (${(err as Error).message})`,
        };
    }
    if (own !== null) {
        return {
            kind: "refuse",
            reason: `issue #${to} already carries ${own}; a set band is never overwritten`,
        };
    }
    return { kind: "write", band: origin.band };
}

function parseIssue(raw: string | undefined): number | null {
    if (raw === undefined) return null;
    const n = Number(raw.replace(/^#/, ""));
    return Number.isInteger(n) && n > 0 ? n : null;
}

function main(): void {
    const [fromRaw, toRaw] = process.argv.slice(2);
    const from = parseIssue(fromRaw);
    const to = parseIssue(toRaw);
    if (from === null || to === null) {
        console.error("usage: bun run issue:inherit-band <from> <to>");
        process.exit(2);
    }
    let board: Record<number, BoardPriority> | null = null;
    const readBoard = (): Record<number, BoardPriority> =>
        (board ??= LIVE_ORIGIN_BAND_DEPS.readBoard());
    const plan = planInheritance(from, to, {
        readParent: LIVE_ORIGIN_BAND_DEPS.readParent,
        readBoard,
        readOwn: (issue) => readBoard()[issue] ?? null,
    });
    if (plan.kind === "refuse") {
        console.error(`issue:inherit-band: refused — ${plan.reason}`);
        process.exit(1);
    }
    setBoardPriority(to, plan.band, {
        owner: PROJECT_OWNER,
        projectNumber: PROJECT_NUMBER,
        repo: PROJECT_REPO,
    });
    // Read back: the write is the whole point, so prove it landed. The board
    // can lag a write by a moment, so a mismatch is retried before it counts.
    let after: BoardPriority | undefined;
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            after = fetchBoardPriority({
                owner: PROJECT_OWNER,
                projectNumber: PROJECT_NUMBER,
                repo: PROJECT_REPO,
                onError: (message) => {
                    throw new Error(message.split("\n")[0]);
                },
            })[to];
        } catch (err) {
            console.error(
                `issue:inherit-band: wrote ${plan.band} on issue #${to}, but the read-back failed: ${(err as Error).message}`
            );
            process.exit(1);
        }
        if (after === plan.band) break;
        Bun.sleepSync(1500);
    }
    if (after !== plan.band) {
        console.error(
            `issue:inherit-band: wrote ${plan.band} on issue #${to} but the board reads ${after ?? "nothing"}`
        );
        process.exit(1);
    }
    console.log(
        `issue:inherit-band: issue #${to} ← ${plan.band} (band of issue #${from}); its body's ## Band should say "${plan.band} — inherited from issue #${from}"`
    );
}

if (import.meta.main) main();
