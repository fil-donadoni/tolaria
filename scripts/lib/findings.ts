// The findings drawer — what a subagent noticed but was not asked to fix.
//
// A subagent working an issue routinely trips over something adjacent: a
// producer nobody enumerated, a guard that fails open, a second card with the
// same bug. Until now that observation lived in the receipt's prose and died
// with the orchestrator's context, so the same gap got rediscovered months
// later by a different pass.
//
// Two constraints shape the design, and they are in tension:
//
//   * **A subagent must never file its own issue.** The loop DRAINS the
//     `ready-for-agent` queue and never fills it — an agent that creates its
//     own work removes the one place a human sets direction. So a finding is a
//     DRAFT, and the triage is the user's.
//   * **It has to survive.** The receipt artifacts are gitignored run
//     telemetry; a finding needs to be readable next month. So a finding is a
//     tracked markdown file that lands with the PR that discovered it.
//
// One file per finding, never a shared append-only list. That is not a style
// choice: a tracked file every subagent appends to produces a merge conflict on
// every parallel batch, which is exactly why debug scenarios stopped being a
// code array (issue #1455).

export type FindingStatus = "draft" | "triaged" | "declined";

export interface Finding {
    /** File path, repo-relative. */
    file: string;
    title: string;
    /** The issue whose work surfaced this. */
    discoveredBy: number;
    status: FindingStatus;
    /** Required once `status` is `triaged` — the issue that now owns it. */
    issue?: number;
    /** How sure the discoverer was. Low is fine; silence is not. */
    confidence: "high" | "medium" | "low";
    /** Free text: what is wrong, the evidence, why it may not deserve a ticket. */
    body: string;
}

export class FindingError extends Error {
    readonly file: string;
    constructor(file: string, detail: string) {
        super(`${file}: ${detail}`);
        this.name = "FindingError";
        this.file = file;
    }
}

const STATUSES: readonly FindingStatus[] = ["draft", "triaged", "declined"];
const CONFIDENCES = ["high", "medium", "low"] as const;

/**
 * Parse one finding file. Frontmatter is a deliberately tiny fixed set — the
 * point of the drawer is that a human reads the body, so the metadata only
 * needs to answer "is this still open, and who found it".
 */
export function parseFinding(file: string, source: string): Finding {
    const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(source);
    if (!match) {
        throw new FindingError(
            file,
            "expected YAML frontmatter delimited by --- lines"
        );
    }
    const [, front, body] = match;

    const field = (name: string): string | undefined => {
        const m = new RegExp(`^${name}:\\s*(.+)$`, "m").exec(front);
        return m ? m[1].trim().replace(/^["']|["']$/g, "") : undefined;
    };

    const require = (name: string): string => {
        const value = field(name);
        if (!value) throw new FindingError(file, `missing \`${name}\``);
        return value;
    };

    const status = require("status") as FindingStatus;
    if (!STATUSES.includes(status)) {
        throw new FindingError(
            file,
            `status must be ${STATUSES.join(" | ")}, got "${status}"`
        );
    }

    const confidence = require("confidence") as Finding["confidence"];
    if (!CONFIDENCES.includes(confidence)) {
        throw new FindingError(
            file,
            `confidence must be ${CONFIDENCES.join(" | ")}, got "${confidence}"`
        );
    }

    const discoveredBy = Number(require("discoveredBy").replace(/^#/, ""));
    if (!Number.isInteger(discoveredBy) || discoveredBy <= 0) {
        throw new FindingError(file, "discoveredBy must be an issue number");
    }

    const rawIssue = field("issue");
    const issue =
        rawIssue === undefined ? undefined : Number(rawIssue.replace(/^#/, ""));
    if (issue !== undefined && (!Number.isInteger(issue) || issue <= 0)) {
        throw new FindingError(file, "issue must be an issue number");
    }

    // A `triaged` finding with no issue is the failure this whole drawer exists
    // to prevent: it reads as handled, and nothing tracks it.
    if (status === "triaged" && issue === undefined) {
        throw new FindingError(
            file,
            "status is `triaged` but no `issue` is named — a triaged finding must point at the issue that now owns it"
        );
    }

    if (body.trim().length < 40) {
        throw new FindingError(
            file,
            "body is too short to triage — state what is wrong and the evidence for it"
        );
    }

    return {
        file,
        title: require("title"),
        discoveredBy,
        status,
        ...(issue === undefined ? {} : { issue }),
        confidence,
        body: body.trim(),
    };
}

/** Sort for the CLI: open drafts first, highest confidence first, then oldest. */
export function triageOrder(findings: Finding[]): Finding[] {
    const statusRank: Record<FindingStatus, number> = {
        draft: 0,
        triaged: 1,
        declined: 2,
    };
    const confRank = { high: 0, medium: 1, low: 2 } as const;
    return [...findings].sort(
        (a, b) =>
            statusRank[a.status] - statusRank[b.status] ||
            confRank[a.confidence] - confRank[b.confidence] ||
            a.discoveredBy - b.discoveredBy
    );
}
