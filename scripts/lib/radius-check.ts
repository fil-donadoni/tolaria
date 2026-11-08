/**
 * The blast-radius gate (issue #8937): an issue that declares no readable
 * `Target files` never reaches the queue or a worktree from a session.
 *
 * On 2026-11-08 three issues reached `in-progress` with no readable radius —
 * two with no section, one writing `Target files:` as a plain line — and,
 * with the in-flight hold of issue #8934, idled the queue for ~7 h. The
 * planner's `queue:lint` already refuses them, but attended sessions claim
 * without it; this gate sits where they file, label, claim and branch
 * (`deny-guard.sh` § 8, `wt:new`).
 *
 * ONE reader: `declaresTargetFiles`, the planner's and the lint's definition.
 */
import { declaresTargetFiles, TARGET_FILES_FIX } from "./queue-lint";

/** A `Target files:` line the parser does not read: no heading, no bold. */
const PLAIN_LABEL = /^\s*target files\s*:?\s*$/i;

/**
 * `null` when the body declares a radius; otherwise the refusal, naming the
 * fix and, for the plain-line shape, why that line is not read.
 */
export function radiusRefusal(subject: string, body: string): string | null {
    if (declaresTargetFiles(body)) return null;
    const plain = body.split("\n").some((l) => PLAIN_LABEL.test(l));
    const why = plain
        ? "its `Target files:` line is plain text — the parser reads only a `## Target files` heading or the bold `**Target files:**` label"
        : "it declares no readable `Target files`";
    return `${subject}: unknown blast radius — ${why}. The planner cannot schedule it against other work (issue #8937). Fix: ${TARGET_FILES_FIX}.`;
}
