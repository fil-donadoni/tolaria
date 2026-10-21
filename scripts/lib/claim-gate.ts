// The I/O half of `claimOwnership` (issue #5996): what `wt:new` and
// `land:ready` run before they touch a worktree or a label. The decision is
// `lib/queue-claim.ts`; this reads the issue's labels and the claim journal
// and applies the announced escape.

import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gh } from "./gh";
import { CLAIM_LABEL } from "./claim-labels";
import { primaryCheckout } from "./primary-checkout";
import {
    claimOwnership,
    UNCLAIMED_OK_ENV,
    type ClaimOwnership,
} from "./queue-claim";

/** Pure: an `afk-pass` job holds its claim as the dispatcher's label, with no
 *  journal row (`job.md`) — it is outside this check. */
export function isAfkJob(env: NodeJS.ProcessEnv): boolean {
    return env.GITHUB_ACTIONS === "true";
}

export interface ClaimGateDeps {
    labels: (issue: number) => string[];
    ledger: () => string;
    log: (verb: string, issue: number, session: string, why: string) => void;
}

/**
 * Exit-code style verdict: `null` = proceed (claimed by this session, an
 * afk-pass job, or the logged escape), else the refusal message.
 */
export function checkClaimGate(
    issue: number,
    verb: string,
    env: NodeJS.ProcessEnv,
    deps: ClaimGateDeps
): string | null {
    if (isAfkJob(env)) return null;
    const session = env.CLAUDE_CODE_SESSION_ID ?? "";
    const r: ClaimOwnership = claimOwnership({
        issue,
        session,
        hasClaimLabel: deps.labels(issue).includes(CLAIM_LABEL),
        ledgerText: deps.ledger(),
        verb,
    });
    if (r.ok) return null;
    if (env[UNCLAIMED_OK_ENV] === "1") {
        deps.log(verb, issue, session, r.reason);
        console.error(
            `${verb}: claim check OVERRIDDEN (${UNCLAIMED_OK_ENV}=1) — issue #${issue}: ${r.reason}`
        );
        return null;
    }
    return r.message;
}

/** The real deps: `gh` for the labels, the primary checkout's journal. */
export function realClaimGateDeps(
    ledgerPath: (root: string) => string,
    root = process.env.CLAUDE_PROJECT_DIR ?? primaryCheckout()
): ClaimGateDeps {
    return {
        labels: (issue) =>
            (
                JSON.parse(
                    gh(["issue", "view", String(issue), "--json", "labels"])
                ) as { labels: { name: string }[] }
            ).labels.map((l) => l.name),
        ledger: () => {
            try {
                return readFileSync(ledgerPath(root), "utf8");
            } catch {
                return "";
            }
        },
        log: (verb, issue, session, why) => {
            try {
                const dir = join(root, ".claude", "telemetry");
                mkdirSync(dir, { recursive: true });
                appendFileSync(
                    join(dir, "claim-ownership.jsonl"),
                    JSON.stringify({
                        ts: Math.floor(Date.now() / 1000),
                        event: "override",
                        verb,
                        issue,
                        session,
                        reason: why,
                    }) + "\n"
                );
            } catch {
                /* telemetry is never load-bearing */
            }
        },
    };
}
