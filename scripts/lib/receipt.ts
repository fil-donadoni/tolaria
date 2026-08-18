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

/**
 * Which re-attempt of THIS (issue, role) pair this receipt is. Absent means 1
 * — the common case, and the one that keeps the filename unchanged
 * (`receiptFilename`). A second review or a second fixup for the same issue
 * sets `round: 2` explicitly; there is no auto-increment inside the schema,
 * because only the orchestrator (reading what is already on disk) knows the
 * next number.
 *
 * This is what makes a re-review or a re-fixup writable through
 * `writeReceipt` at all: before this field existed, a second round had no
 * filename of its own, so it was either hand-written outside the validator or
 * it overwrote the first round's verdict.
 */
interface RoundedReceipt {
    round?: number;
}

/** An implement or fixup subagent's receipt. */
export interface WorkReceipt extends ReceiptCommon, RoundedReceipt {
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
export interface ReviewReceipt extends ReceiptCommon, RoundedReceipt {
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
    /** Parent-session transcript from the hook payload — same for every subagent. */
    transcript: string | null;
    /**
     * `agent_id` from the payload: WHICH subagent left the gap. It is also the
     * marker's filename key, which is what keeps a background agent's repeated
     * yields collapsing onto one marker instead of one per stop. Null only on a
     * harness whose payload carries no agent id.
     */
    agentId: string | null;
    /** `agent_type` — e.g. `general-purpose`, so the gap names its role. */
    agentType: string | null;
    /** The subagent's OWN transcript, unlike `transcript`. Traces the gap. */
    agentTranscript: string | null;
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

/**
 * A field the hook writes when the payload carried it and omits otherwise.
 * Absent, null and empty all collapse to null — a marker written by an older
 * hook must still parse, so this can never be the thing that rejects one.
 */
function optionalString(
    raw: Record<string, unknown>,
    field: string
): string | null {
    const value = raw[field];
    if (value === undefined || value === null) return null;
    if (typeof value !== "string") {
        throw new ReceiptError(field, "expected a string or null");
    }
    return value.trim() === "" ? null : value;
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

/**
 * Like {@link requirePositiveInt}, but the field may be absent — absent means
 * "round 1" to every caller, so `undefined` is a valid parse rather than a
 * rejection. What is NOT valid is present-but-wrong-shaped: `round: 0`,
 * `round: "2"`, `round: 1.5` are all rejected rather than coerced, because a
 * round is a filename component and a coerced value would silently rename the
 * receipt the caller thinks they are writing.
 */
function optionalPositiveInt(
    raw: Record<string, unknown>,
    field: string
): number | undefined {
    const value = raw[field];
    if (value === undefined) return undefined;
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
            agentId: optionalString(raw, "agentId"),
            agentType: optionalString(raw, "agentType"),
            agentTranscript: optionalString(raw, "agentTranscript"),
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
        const round = optionalPositiveInt(raw, "round");
        return {
            version: RECEIPT_VERSION,
            role,
            issue,
            outcome: outcome as ReviewOutcome,
            pr: requirePositiveInt(raw, "pr"),
            findings,
            ...(round === undefined ? {} : { round }),
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
    const round = optionalPositiveInt(raw, "round");
    const receipt: WorkReceipt = {
        version: RECEIPT_VERSION,
        role,
        issue,
        outcome: outcome as WorkOutcome,
        branch: requireString(raw, "branch"),
        worktree: requireString(raw, "worktree"),
        targetFiles,
        proofOfFailure: parseProofOfFailure(raw),
        ...(round === undefined ? {} : { round }),
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

/**
 * `12-implement.json`, `12-review.json`, `missing-<agentId>.json` — and, for a
 * second or later round of the same (issue, role), `12-review-2.json`,
 * `12-fixup-3.json`.
 *
 * **Round 1 (or an absent `round`) MUST keep the un-suffixed name.** That is
 * not an implementation detail: `.claude/hooks/receipt-guard.sh`'s accounting,
 * the scorecard's readers, every test fixture on disk and every doc line that
 * instructs an agent to write `<issue>-<role>.json` all key off it. Only
 * `round >= 2` earns a suffix, so the overwhelming common case — one
 * implement, one review, at most one fixup — is unaffected by this file
 * existing at all.
 *
 * A missing marker is named for the SUBAGENT, not the moment: `SubagentStop`
 * fires on every yield of a background agent, so a timestamped name mints one
 * file per yield (676 in the worst session on disk) while an agent-keyed one
 * overwrites in place. Only a payload with no `agent_id` falls back to the
 * timestamp, and then the flood is the lesser evil against silence. A missing
 * marker has no round — it is not a re-attempt of anything.
 */
export function receiptFilename(receipt: Receipt): string {
    if (receipt.role !== "missing") {
        const round = receipt.round ?? 1;
        return round <= 1
            ? `${receipt.issue}-${receipt.role}.json`
            : `${receipt.issue}-${receipt.role}-${round}.json`;
    }
    return `missing-${receipt.agentId ?? receipt.ts ?? 0}.json`;
}

/**
 * Look for another batch directory under `root` (excluding `batchId` itself)
 * that already holds a receipt for `issue` — a filename starting `<issue>-`.
 * `undefined` when no sibling has one, which is the common case and lets a
 * genuinely new batch write its first receipt untouched.
 */
function findSiblingBatchWithIssue(
    root: string,
    batchId: string,
    issue: number
): string | undefined {
    if (!fs.existsSync(root)) return undefined;
    const prefix = `${issue}-`;
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.name === batchId) continue;
        const siblingDir = path.join(root, entry.name);
        let siblingFiles: string[];
        try {
            siblingFiles = fs.readdirSync(siblingDir);
        } catch {
            // Several sessions share this root and nothing prunes it (#2527:
            // 134 batch dirs, 8176 files) — a sibling can be removed or
            // otherwise become unreadable between the `readdirSync(root)`
            // above and this call (a concurrent prune or cleanup). That is
            // not evidence of a misroute, so skip this sibling rather than
            // let writeReceipt throw on an unrelated race.
            continue;
        }
        const hasIssueReceipt = siblingFiles.some(
            (f) => f.startsWith(prefix) && f.endsWith(".json")
        );
        if (hasIssueReceipt) return siblingDir;
    }
    return undefined;
}

/**
 * Validate, then write **only if the target does not already exist**. Returns
 * the path written.
 *
 * Validation happens BEFORE the write so a malformed receipt never reaches
 * disk to be read back three steps later as an `undefined` field.
 *
 * The existence check is what makes a receipt append-only: nothing today
 * legitimately re-writes one (each role writes once, and a repeat round gets
 * its own filename via `round`), so a collision here is either a caller that
 * forgot to bump `round` or a caller trying to rewrite a verdict it does not
 * own — both are bugs the throw is supposed to surface, not silently resolve
 * by picking a winner.
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

    // Misrouted-batch guard: a subagent handed the WRONG batch id (a typo'd
    // session id, e.g.) writes into a directory that looks empty and is
    // therefore silently invisible to `queue:train` — the exact failure this
    // exists to catch (a reviewer's verdict landed in a batch dir nobody read
    // back). The signal is cheap and specific: this issue's receipts already
    // live in a DIFFERENT batch directory, and we are about to create a new
    // one. A subagent can never learn its own session id (it only ever
    // arrives via a hook payload on stdin), so the id has to stay a caller
    // parameter — this makes a WRONG one loud instead of silent.
    //
    // **Narrower than it reads — it only ever inspects the FIRST receipt
    // written into a batch**, because the check is gated on `!fs.existsSync(dir)`.
    // It does NOT catch: a typo landing on a stale-but-real batch id (that
    // directory already exists, so the check is skipped entirely); or a
    // misroute where the repeated issue's receipt is written SECOND into a
    // dir some other (issue, role) already created. And in the real loop the
    // batch dir usually exists before any numbered receipt reaches it at all
    // — `.claude/hooks/receipt-guard.sh` does `mkdir -p "$dir"` on every
    // `SubagentStop`, which in the 08-18 batch ran a full hour before the
    // first receipt was written — so this guard fires far less often than a
    // reader would assume from its name. Do not treat it as a general
    // invariant; it catches one specific shape (a genuinely fresh batch id
    // whose very first write collides with a sibling), nothing more.
    if (!fs.existsSync(dir) && receipt.role !== "missing") {
        const root = path.join(projectRoot, RECEIPTS_ROOT);
        const sibling = findSiblingBatchWithIssue(root, batchId, receipt.issue);
        if (sibling && process.env.TOLARIA_ALLOW_RECEIPT_REBATCH !== "1") {
            throw new Error(
                `writeReceipt: refusing to create batch directory ${dir} for ` +
                    `issue ${receipt.issue} — issue ${receipt.issue} already has ` +
                    `receipt(s) in ${sibling}, a different batch. This is the shape ` +
                    `of a caller handed the wrong batch id (a typo'd session id ` +
                    `mints a new, empty-looking directory that "queue:train" never ` +
                    `reads, since it only ever reads the ONE batch dir it was told ` +
                    `about — the new one). Writing into ${sibling} instead would make ` +
                    `the receipt invisible to the CURRENT train, which is the same ` +
                    `misroute again. Re-run with the correct batch id, or — if this ` +
                    `genuinely is a fresh re-attempt of issue ${receipt.issue} in a ` +
                    `new batch — set TOLARIA_ALLOW_RECEIPT_REBATCH=1 and re-run.`
            );
        }
    }

    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, receiptFilename(receipt));
    if (fs.existsSync(file)) {
        throw new Error(
            `writeReceipt: refusing to overwrite existing receipt at ${file} ` +
                `— a receipt is append-only; a repeat round writes with an ` +
                `explicit higher "round" instead of overwriting this one`
        );
    }
    fs.writeFileSync(file, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
    return file;
}

/**
 * One receipt file (or, for a round-sequence gap, one receipt GROUP) that
 * `readReceipts` could not vouch for.
 */
export interface ReceiptFileError {
    /**
     * The offending path. For a round-sequence gap — which is a property of
     * several correctly-named files together, not any one of them — this is
     * a synthetic glob-shaped label (`12-review-*.json`) rather than a real
     * path, so the caller always has something to print.
     */
    file: string;
    /** The validation message — names the field for a schema failure. */
    message: string;
    /**
     * Best-effort issue attribution, from the filename convention
     * (`<issue>-<role>[-<round>].json`), so a caller can quarantine just this
     * issue rather than the whole batch. Derived from the FILENAME, not the
     * (possibly unparseable, possibly tampered) contents — the file is where
     * the quarantine has to land regardless of what is inside it. `undefined`
     * only when the filename itself gives no clue (e.g. a `missing-*` file
     * that fails to parse, or a name that isn't `<digits>-...`).
     */
    issue?: number;
}

export interface ReadReceiptsResult {
    /** Every receipt that parsed AND whose on-disk filename matches its own
     * contents (`receiptFilename`). */
    receipts: Receipt[];
    /**
     * Every file (or file group) `readReceipts` could not vouch for. NON-EMPTY
     * is a fact worth surfacing, but `readReceipts` itself never throws for
     * it — one corrupt file must not hide every other receipt in the same
     * directory from a caller that can still act on them.
     */
    errors: ReceiptFileError[];
}

function issueFromFilename(name: string): number | undefined {
    const match = /^(\d+)-/.exec(name);
    return match ? Number(match[1]) : undefined;
}

/**
 * Read every receipt in a batch, given its SESSION id — the common path,
 * joining `projectRoot + RECEIPTS_ROOT + batchId` via `receiptDir`.
 *
 * A file that fails validation, or whose name does not match what
 * `receiptFilename` would emit for its own contents (a tampering signal —
 * nothing on the sanctioned write path can produce that mismatch), is
 * reported in `errors` rather than thrown: a corrupt or tampered receipt is a
 * fact worth stopping ON, but it must quarantine only the issue it names, not
 * every other receipt sharing its directory.
 */
export function readReceipts(
    projectRoot: string,
    batchId: string
): ReadReceiptsResult {
    const dir = receiptDir(projectRoot, batchId);
    if (!fs.existsSync(dir)) return { receipts: [], errors: [] };
    return readReceiptsFromDir(dir);
}

/**
 * Read every receipt from an EXPLICIT directory — no `RECEIPTS_ROOT` join.
 *
 * This is what `--dir <path>` (the documented resume entry point) wants: the
 * caller already has the receipt directory itself, e.g. from
 * `.claude/receipts/<batch>` printed by an earlier `ls`. `readReceipts`
 * re-deriving that path from `(projectRoot, batchId)` and re-appending
 * `RECEIPTS_ROOT` is exactly the bug this function exists to avoid — feeding
 * an already-complete directory through that join doubles `RECEIPTS_ROOT`
 * onto itself, finds nothing, and used to report an empty plan with exit 0.
 */
export function readReceiptsFromDir(dir: string): ReadReceiptsResult {
    if (!fs.existsSync(dir)) return { receipts: [], errors: [] };

    const receipts: Receipt[] = [];
    const errors: ReceiptFileError[] = [];

    for (const f of fs
        .readdirSync(dir)
        .filter((f) => f.endsWith(".json"))
        .sort()) {
        const file = path.join(dir, f);
        try {
            const parsed = parseReceipt(
                JSON.parse(fs.readFileSync(file, "utf8")) as unknown
            );
            const expected = receiptFilename(parsed);
            if (expected !== f) {
                // The sanctioned write path always writes to
                // receiptFilename(receipt) — this file disagreeing with its
                // own contents means it was written or edited some other way
                // (hand-named, or hand-edited after the fact).
                errors.push({
                    file,
                    message:
                        `filename "${f}" does not match receiptFilename() for its own contents ` +
                        `("${expected}") — written or edited outside writeReceipt`,
                    issue: issueFromFilename(f),
                });
                continue;
            }
            receipts.push(parsed);
        } catch (error) {
            errors.push({
                file,
                message: error instanceof Error ? error.message : String(error),
                issue: issueFromFilename(f),
            });
        }
    }

    // Round-sequence gap: the correctly-named receipts for a given (issue,
    // role) whose rounds are not a contiguous 1..N run starting at 1. This
    // covers a LONE receipt too — a single round-2 review with no round-1 on
    // disk is exactly as much a gap as a 1-then-3 sequence missing its 2: in
    // both cases a round was deleted (or never landed) and the reader cannot
    // tell whether it approved or blocked, so it is exactly as untrustworthy
    // as a corrupt file. A lone round-1 (or an absent round, which normalises
    // to 1) is the common, valid case and must NOT be flagged — the
    // contiguity check below already lets it through: `[1]` satisfies
    // `round === i + 1` at i = 0.
    const groups = new Map<string, Receipt[]>();
    for (const r of receipts) {
        if (r.role === "missing") continue;
        const key = `${r.issue}:${r.role}`;
        const list = groups.get(key);
        if (list) list.push(r);
        else groups.set(key, [r]);
    }
    for (const [key, group] of groups) {
        const rounds = group
            .map((r) => (r.role === "missing" ? 1 : (r.round ?? 1)))
            .sort((a, b) => a - b);
        const contiguous = rounds.every((round, i) => round === i + 1);
        if (!contiguous) {
            const [issueStr, role] = key.split(":");
            errors.push({
                file: `${issueStr}-${role}-*.json`,
                message:
                    `round sequence has a gap or a duplicate: rounds present [${rounds.join(", ")}], ` +
                    `expected a contiguous run starting at 1`,
                issue: Number(issueStr),
            });
        }
    }

    return { receipts, errors };
}

function nowSeconds(): number {
    return Math.floor(Date.now() / 1000);
}
