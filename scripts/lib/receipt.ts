// Subagent receipts as a typed, durable contract (issue #2182, PRD #2180).
//
// A receipt is what a subagent hands back to the orchestrator: the outcome, the
// PR, the paths the diff actually touched, one proof-of-failure line per
// behaviour-guarding test, and — for a card or a user-visible mechanic — the
// debug-scenario spec the orchestrator registers post-merge.
//
// Until now that existed only as prose in the orchestrator's context window,
// which has three consequences the loop pays for repeatedly:
//
//   * an orchestrator that dies mid-train loses every receipt it collected, so
//     the post-merge scenario registration is replayed from memory or lost;
//   * nothing about a finished batch is measurable afterwards — no scorecard
//     can read a context window (#2187);
//   * a field that never arrived is indistinguishable from a field that arrived
//     empty, so the failure surfaces three steps later as an `undefined`.
//
// So the receipt is a FILE, and this module is its contract. Two properties are
// load-bearing:
//
//   * TYPED AT THE BOUNDARY — `parseReceipt` rejects a malformed receipt where
//     it is written, with a message naming the offending field. A shape-by-
//     convention receipt fails far from its cause; this one fails at the write.
//   * MISSING ≠ EMPTY — a subagent that stopped without writing anything gets a
//     recorded `missing` marker from the SubagentStop hook
//     (`.claude/hooks/receipt-guard.sh`). The hook is the guarantee; the
//     subagent's own write is the payload. "No receipt" is a fact on disk, not
//     the absence of one.
//
// The schema is the deliverable as much as the plumbing: the merge-train order
// (#2185) reads `targetFiles`, and the scorecard (#2187) reads `outcome` and
// `proofOfFailure`.

import * as fs from "fs";
import * as path from "path";

export const RECEIPT_VERSION = 1;

/**
 * Which subagent produced this receipt. The role is part of the FILENAME, so
 * an implement receipt, its review verdict and a later fixup for the same issue
 * coexist rather than overwrite each other — "was this PR reviewed" has to be
 * answerable from disk alone (#2182 AC).
 */
export type ReceiptRole = "implement" | "review" | "fixup";

/** Terminal states of an implement/fixup subagent. */
export type WorkOutcome = "pr-open" | "wip" | "failed" | "collision";

/** Terminal states of a reviewer subagent. */
export type ReviewOutcome = "approve" | "blocking";

/**
 * One proof-of-failure line: what was broken, and what went red as a result.
 * Both halves are required — "I broke it and it failed" without naming the
 * mutation is the claim, not the evidence.
 */
export interface ProofOfFailure {
    /** The mutation applied to the subject (`inverted the phase check`). */
    broke: string;
    /** What went red (`layers.test.ts > grants survive the source leaving`). */
    failed: string;
}

/** A debug-scenario spec the orchestrator registers post-merge (issue #1455). */
export interface ScenarioSpec {
    label: string;
    /** `debugSetupScenario`'s args minus `gameId`. */
    spec: Record<string, unknown>;
}

interface ReceiptCommon {
    version: typeof RECEIPT_VERSION;
    /** Unix seconds. Set by `writeReceipt` when the caller omits it. */
    ts?: number;
}

/** An implement or fixup subagent's receipt. */
export interface WorkReceipt extends ReceiptCommon {
    role: "implement" | "fixup";
    issue: number;
    outcome: WorkOutcome;
    branch: string;
    worktree: string;
    /** `git diff --name-only main` — the paths the diff ACTUALLY touched. */
    targetFiles: string[];
    /**
     * The subset of `targetFiles` this PR RESTRUCTURED — moved, renamed, split,
     * or rewrote — as opposed to appended to or edited in place.
     *
     * The merge-train order (#2185) cannot derive this from paths: "both PRs
     * touched `layers.ts`" says nothing about which one has to land first. Only
     * the subagent that wrote the diff knows, so it declares it. Omitted means
     * "nothing restructured", which is the common and safe case — a wrong
     * restructure claim costs one avoidable ordering constraint, a missing one
     * costs a rebase conflict the train resolves anyway.
     */
    restructures?: string[];
    proofOfFailure: ProofOfFailure[];
    /** Required when `outcome === "pr-open"`. */
    pr?: number;
    scenario?: ScenarioSpec;
    /** Required when the outcome is not `pr-open`: what is still red. */
    reason?: string;
}

/** A reviewer subagent's verdict. */
export interface ReviewReceipt extends ReceiptCommon {
    role: "review";
    issue: number;
    outcome: ReviewOutcome;
    pr: number;
    /** One line per finding. Required non-empty when `blocking`. */
    findings: string[];
}

/**
 * Written by the SubagentStop hook when a subagent stopped and left nothing.
 * It carries no issue number — the hook cannot know which issue the subagent
 * was working on, and inventing one would be worse than recording the gap.
 */
export interface MissingReceipt extends ReceiptCommon {
    role: "missing";
    outcome: "missing";
    session: string;
    /** Transcript path from the hook payload, so the gap is traceable. */
    transcript: string | null;
}

export type Receipt = WorkReceipt | ReviewReceipt | MissingReceipt;

/** A validation failure that names the field it is about. */
export class ReceiptError extends Error {
    readonly field: string;
    constructor(field: string, detail: string) {
        super(`receipt.${field}: ${detail}`);
        this.name = "ReceiptError";
        this.field = field;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────────────────────────────────────

const WORK_OUTCOMES: readonly WorkOutcome[] = [
    "pr-open",
    "wip",
    "failed",
    "collision",
];
const REVIEW_OUTCOMES: readonly ReviewOutcome[] = ["approve", "blocking"];

function asRecord(value: unknown): Record<string, unknown> {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new ReceiptError("", "expected a JSON object");
    }
    return value as Record<string, unknown>;
}

function requireString(raw: Record<string, unknown>, field: string): string {
    const value = raw[field];
    if (typeof value !== "string" || value.trim() === "") {
        throw new ReceiptError(field, "expected a non-empty string");
    }
    return value;
}

function requirePositiveInt(
    raw: Record<string, unknown>,
    field: string
): number {
    const value = raw[field];
    if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
        throw new ReceiptError(field, "expected a positive integer");
    }
    return value;
}

function requireStringArray(
    raw: Record<string, unknown>,
    field: string
): string[] {
    const value = raw[field];
    if (!Array.isArray(value)) {
        throw new ReceiptError(field, "expected an array of strings");
    }
    value.forEach((entry, i) => {
        if (typeof entry !== "string" || entry.trim() === "") {
            throw new ReceiptError(
                `${field}[${i}]`,
                "expected a non-empty string"
            );
        }
    });
    return value as string[];
}

function parseProofOfFailure(raw: Record<string, unknown>): ProofOfFailure[] {
    const value = raw.proofOfFailure;
    if (!Array.isArray(value)) {
        throw new ReceiptError(
            "proofOfFailure",
            "expected an array (use [] when no behaviour-guarding test was added)"
        );
    }
    return value.map((entry, i) => {
        const item = (() => {
            try {
                return asRecord(entry);
            } catch {
                throw new ReceiptError(
                    `proofOfFailure[${i}]`,
                    "expected a { broke, failed } object"
                );
            }
        })();
        for (const key of ["broke", "failed"] as const) {
            const text = item[key];
            if (typeof text !== "string" || text.trim() === "") {
                throw new ReceiptError(
                    `proofOfFailure[${i}].${key}`,
                    "expected a non-empty string"
                );
            }
        }
        return { broke: item.broke as string, failed: item.failed as string };
    });
}

function parseScenario(raw: Record<string, unknown>): ScenarioSpec | undefined {
    if (raw.scenario === undefined) return undefined;
    const scenario = (() => {
        try {
            return asRecord(raw.scenario);
        } catch {
            throw new ReceiptError(
                "scenario",
                "expected a { label, spec } object"
            );
        }
    })();
    const label = scenario.label;
    if (typeof label !== "string" || label.trim() === "") {
        throw new ReceiptError("scenario.label", "expected a non-empty string");
    }
    let spec: Record<string, unknown>;
    try {
        spec = asRecord(scenario.spec);
    } catch {
        throw new ReceiptError(
            "scenario.spec",
            "expected a JSON object (debugSetupScenario args minus gameId)"
        );
    }
    return { label, spec };
}

/**
 * Parse and validate a receipt, throwing a {@link ReceiptError} naming the
 * offending field. This is the only entry point — nothing writes or reads a
 * receipt without going through it.
 */
export function parseReceipt(value: unknown): Receipt {
    const raw = asRecord(value);

    if (raw.version !== RECEIPT_VERSION) {
        throw new ReceiptError(
            "version",
            `expected ${RECEIPT_VERSION}, got ${JSON.stringify(raw.version)}`
        );
    }

    const role = raw.role;
    if (
        role !== "implement" &&
        role !== "fixup" &&
        role !== "review" &&
        role !== "missing"
    ) {
        throw new ReceiptError(
            "role",
            `expected implement | fixup | review | missing, got ${JSON.stringify(role)}`
        );
    }

    const ts = raw.ts === undefined ? undefined : requirePositiveInt(raw, "ts");

    if (role === "missing") {
        const transcript = raw.transcript;
        if (transcript !== null && typeof transcript !== "string") {
            throw new ReceiptError("transcript", "expected a string or null");
        }
        if (raw.outcome !== "missing") {
            throw new ReceiptError(
                "outcome",
                `expected "missing" for a missing receipt, got ${JSON.stringify(raw.outcome)}`
            );
        }
        return {
            version: RECEIPT_VERSION,
            role,
            outcome: "missing",
            session: requireString(raw, "session"),
            transcript: (transcript as string | null) ?? null,
            ...(ts === undefined ? {} : { ts }),
        };
    }

    const issue = requirePositiveInt(raw, "issue");

    if (role === "review") {
        const outcome = raw.outcome;
        if (!REVIEW_OUTCOMES.includes(outcome as ReviewOutcome)) {
            throw new ReceiptError(
                "outcome",
                `expected ${REVIEW_OUTCOMES.join(" | ")}, got ${JSON.stringify(outcome)}`
            );
        }
        const findings = requireStringArray(raw, "findings");
        // A blocking verdict with no findings is the shape that quietly stalls
        // the train: the orchestrator refuses the merge and has nothing to hand
        // back to the fixup subagent.
        if (outcome === "blocking" && findings.length === 0) {
            throw new ReceiptError(
                "findings",
                "a blocking verdict must list at least one finding"
            );
        }
        return {
            version: RECEIPT_VERSION,
            role,
            issue,
            outcome: outcome as ReviewOutcome,
            pr: requirePositiveInt(raw, "pr"),
            findings,
            ...(ts === undefined ? {} : { ts }),
        };
    }

    const outcome = raw.outcome;
    if (!WORK_OUTCOMES.includes(outcome as WorkOutcome)) {
        throw new ReceiptError(
            "outcome",
            `expected ${WORK_OUTCOMES.join(" | ")}, got ${JSON.stringify(outcome)}`
        );
    }

    const targetFiles = requireStringArray(raw, "targetFiles");
    const receipt: WorkReceipt = {
        version: RECEIPT_VERSION,
        role,
        issue,
        outcome: outcome as WorkOutcome,
        branch: requireString(raw, "branch"),
        worktree: requireString(raw, "worktree"),
        targetFiles,
        proofOfFailure: parseProofOfFailure(raw),
        ...(ts === undefined ? {} : { ts }),
    };

    if (outcome === "pr-open") {
        receipt.pr = requirePositiveInt(raw, "pr");
        // The train reads `targetFiles` to order merges (#2185). A pr-open
        // receipt claiming an empty diff would make an issue look conflict-free
        // with everything — the one wrong answer with no visible symptom.
        if (targetFiles.length === 0) {
            throw new ReceiptError(
                "targetFiles",
                "a pr-open receipt must list the paths the diff touched"
            );
        }
    } else {
        receipt.reason = requireString(raw, "reason");
        if (raw.pr !== undefined) receipt.pr = requirePositiveInt(raw, "pr");
    }

    if (raw.restructures !== undefined) {
        const restructures = requireStringArray(raw, "restructures");
        // A restructured path outside the diff is a receipt describing a PR
        // that does not exist. The train would build an ordering constraint on
        // a file this PR never touched — an invented edge, and the kind that
        // reads as a considered decision afterwards.
        const stray = restructures.filter((p) => !targetFiles.includes(p));
        if (stray.length > 0) {
            throw new ReceiptError(
                "restructures",
                `not a subset of targetFiles: ${stray.join(", ")}`
            );
        }
        receipt.restructures = restructures;
    }

    const scenario = parseScenario(raw);
    if (scenario) receipt.scenario = scenario;

    return receipt;
}

// ─────────────────────────────────────────────────────────────────────────────
// Artifact directory
//
// Batch-scoped, keyed by the orchestrator's SESSION id: that is the only
// identifier the SubagentStop hook can see in its payload, and a directory the
// hook cannot find is a guarantee that does not hold. Receipts within a session
// are keyed by issue + role, so a second batch touching the same issue lands on
// the role that describes it (`fixup`) rather than overwriting the first.
// ─────────────────────────────────────────────────────────────────────────────

export const RECEIPTS_ROOT = path.join(".claude", "receipts");

export function receiptDir(projectRoot: string, batchId: string): string {
    if (batchId.trim() === "" || batchId.includes("/")) {
        throw new ReceiptError("batchId", "expected a non-empty path segment");
    }
    return path.join(projectRoot, RECEIPTS_ROOT, batchId);
}

/** `12-implement.json`, `12-review.json`, `missing-<n>.json`. */
export function receiptFilename(receipt: Receipt): string {
    return receipt.role === "missing"
        ? `missing-${receipt.ts ?? 0}.json`
        : `${receipt.issue}-${receipt.role}.json`;
}

/**
 * Validate, then write. Returns the path written. Validation happens BEFORE the
 * write so a malformed receipt never reaches disk to be read back three steps
 * later as an `undefined` field.
 */
export function writeReceipt(
    projectRoot: string,
    batchId: string,
    value: unknown
): string {
    const receipt = parseReceipt(
        typeof value === "object" && value !== null && !("ts" in value)
            ? { ...(value as Record<string, unknown>), ts: nowSeconds() }
            : value
    );
    const dir = receiptDir(projectRoot, batchId);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, receiptFilename(receipt));
    fs.writeFileSync(file, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
    return file;
}

/**
 * Read every receipt in a batch. A file that fails validation throws — a
 * corrupt receipt is a fact worth stopping on, not one to skip past silently.
 */
export function readReceipts(projectRoot: string, batchId: string): Receipt[] {
    const dir = receiptDir(projectRoot, batchId);
    if (!fs.existsSync(dir)) return [];
    return fs
        .readdirSync(dir)
        .filter((f) => f.endsWith(".json"))
        .sort()
        .map((f) => {
            const file = path.join(dir, f);
            try {
                return parseReceipt(
                    JSON.parse(fs.readFileSync(file, "utf8")) as unknown
                );
            } catch (error) {
                throw new Error(
                    `${file}: ${error instanceof Error ? error.message : String(error)}`
                );
            }
        });
}

function nowSeconds(): number {
    return Math.floor(Date.now() / 1000);
}
