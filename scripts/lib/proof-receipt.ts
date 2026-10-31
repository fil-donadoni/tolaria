// The proof-of-failure receipt (issue #7655, PRD issue #7645): what
// `bun run proof` prints and `land:ready` reads back from the PR body.
//
// A proof-of-failure used to be a sentence in the PR body ("broke X, saw
// red"): nothing checked it was ever run, nor that it was run on the head the
// queue lands. The receipt is a fenced block naming the head sha it was run
// on, the broken file, a hash of the broken text and the two outcomes;
// `land:ready` refuses a code-lane PR (`engine`, `skin`, `full`) whose body
// carries none for its head. The refusal is the session's — nothing in the
// queue reads the receipt (`land`'s `pr-checks` never see it).

import { createHash } from "node:crypto";
import type { Lane } from "../check-lane";

/** The fence info string a receipt block opens with. */
export const PROOF_FENCE = "proof-receipt";

/** The command a refusal names. */
export const PROOF_COMMAND =
    "bun run proof --break <file>:<pattern> --test <path>";

/** The lanes whose PR owes a receipt; `cards` and `docs` owe none. */
export const PROOF_LANES: readonly Lane[] = ["engine", "skin", "full"];

export interface ProofReceipt {
    /** The commit the proof ran on (40 hex). */
    head: string;
    /** The file the break was applied to. */
    file: string;
    /** `patternHash` of the broken text. */
    patternSha256: string;
    /** The test file run against the break. */
    test: string;
    /** Exit code with the break applied (non-zero = red). */
    brokenExit: number;
    /** Exit code after the revert (zero = green). */
    revertedExit: number;
}

/** A short, stable hash of the broken text: the receipt names it without
 *  quoting code into the PR body. */
export function patternHash(pattern: string): string {
    return createHash("sha256").update(pattern).digest("hex").slice(0, 16);
}

function outcome(exit: number): string {
    return `${exit === 0 ? "green" : "red"} (exit ${exit})`;
}

/** The fenced block `proof` prints, pasted verbatim into the PR body. */
export function formatReceipt(r: ProofReceipt): string {
    return [
        "```" + PROOF_FENCE,
        `head: ${r.head}`,
        `break: ${r.file}`,
        `pattern-sha256: ${r.patternSha256}`,
        `test: ${r.test}`,
        `broken: ${outcome(r.brokenExit)}`,
        `reverted: ${outcome(r.revertedExit)}`,
        "```",
    ].join("\n");
}

const FENCE_RE = new RegExp(
    "^```" + PROOF_FENCE + "[ \\t]*\\r?\\n([\\s\\S]*?)^```[ \\t]*$",
    "gm"
);
const OUTCOME_RE = /^(red|green) \(exit (\d+)\)$/;

/** Every receipt block in a PR body; a malformed one is an error naming its
 *  first bad field, never silently skipped. */
export function parseReceipts(body: string): {
    receipts: ProofReceipt[];
    errors: string[];
} {
    const receipts: ProofReceipt[] = [];
    const errors: string[] = [];
    for (const m of body.matchAll(FENCE_RE)) {
        const fields = new Map<string, string>();
        for (const line of m[1].split(/\r?\n/)) {
            const i = line.indexOf(":");
            if (i > 0)
                fields.set(line.slice(0, i).trim(), line.slice(i + 1).trim());
        }
        const n = receipts.length + errors.length + 1;
        const head = fields.get("head") ?? "";
        const broken = OUTCOME_RE.exec(fields.get("broken") ?? "");
        const reverted = OUTCOME_RE.exec(fields.get("reverted") ?? "");
        const bad = !/^[0-9a-f]{40}$/.test(head)
            ? "head"
            : !fields.get("break")
              ? "break"
              : !/^[0-9a-f]{16}$/.test(fields.get("pattern-sha256") ?? "")
                ? "pattern-sha256"
                : !fields.get("test")
                  ? "test"
                  : broken === null
                    ? "broken"
                    : reverted === null
                      ? "reverted"
                      : null;
        if (bad !== null || broken === null || reverted === null) {
            errors.push(`receipt ${n}: field \`${bad}\` missing or malformed`);
            continue;
        }
        receipts.push({
            head,
            file: fields.get("break") as string,
            patternSha256: fields.get("pattern-sha256") as string,
            test: fields.get("test") as string,
            brokenExit: Number(broken[2]),
            revertedExit: Number(reverted[2]),
        });
    }
    return { receipts, errors };
}

/**
 * `land:ready`'s refusal: null = the PR owes no receipt or carries a valid one
 * for one of `heads`: the head `land:ready` judges first (its base-drift
 * rebase or derived-state restore, when it made one — the head a re-run
 * names), then the one the session pushed. EVERY receipt in the
 * body must name one of them: a stale block left beside a fresh one is a
 * proof of a tree that no longer exists.
 */
export function proofReceiptRefusal(input: {
    lane: Lane;
    prBody: string;
    heads: readonly string[];
}): string | null {
    if (!PROOF_LANES.includes(input.lane)) return null;
    const head = input.heads[0];
    const rerun = `run \`${PROOF_COMMAND}\` on ${head.slice(0, 10)} (clean tree) and paste its \`${PROOF_FENCE}\` block into the PR body`;
    const { receipts, errors } = parseReceipts(input.prBody);
    if (errors.length > 0)
        return `the PR body's proof-of-failure receipt is malformed (${errors.join("; ")}) — paste \`bun run proof\`'s block byte-exact: ${rerun}`;
    if (receipts.length === 0)
        return `a \`${input.lane}\`-lane PR owes a proof-of-failure receipt and the body carries none — ${rerun}`;
    const stale = receipts.filter((r) => !input.heads.includes(r.head));
    if (stale.length > 0)
        return `proof-of-failure receipt(s) for ${stale.map((r) => `${r.head.slice(0, 10)} (${r.test})`).join(", ")}, not the PR's head ${head.slice(0, 10)} (amended or new commits) — re-run: ${rerun}, replacing the stale block(s)`;
    const unproven = receipts.filter(
        (r) => r.brokenExit === 0 || r.revertedExit !== 0
    );
    if (unproven.length > 0)
        return `proof-of-failure receipt(s) for ${unproven.map((r) => r.test).join(", ")} record no red→green — ${rerun}`;
    return null;
}
