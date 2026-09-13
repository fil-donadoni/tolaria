// Queue lint — is this issue well-formed enough to be worked?
// (issue #2188, PRD #2180)
//
// The loop assumes every issue in the queue declares its target files, hangs off
// its parent, and states a verifiable outcome. Nothing enforced it, so the
// defects were only ever discovered downstream: a ticket with no acceptance
// criteria burns a full implement + review cycle (median 105k tokens) before
// anyone notices there was nothing to verify against, and a slice with no parent
// edge sorts on its own number and starves at the back of the queue forever
// without anyone noticing at all.
//
// Pure: an issue in, findings out. Two callers, at opposite ends — the intake
// skills before publishing (so quality is enforced at WRITE time, where the
// author is still in context) and the planner before admitting (so a
// pre-existing defect cannot poison a batch).
//
// **Severity is calibrated against the live queue, not against an ideal.** A
// rule that would send half the backlog to `needs-info` is not a quality gate,
// it is an outage. Only defects that make the issue genuinely unworkable — or
// that are already a contradiction in the data — block; everything else is
// advisory and names the one-line fix. See the per-rule notes.

export interface LintableIssue {
    number: number;
    title: string;
    labels: string[];
    /** The native GitHub sub-issue edge, or null. */
    parentNumber: number | null;
    body: string;
}

export type Severity =
    /** Keep it out of the batch and send it back: working it would waste a cycle. */
    | "blocking"
    /** Report it; the loop can still work the issue. */
    | "advisory";

export interface Finding {
    /** Stable kebab id — callers key off this, never off the message. */
    rule: string;
    severity: Severity;
    /** What is wrong. */
    message: string;
    /** What would fix it — a finding with no remedy is just a complaint. */
    fix: string;
}

const HEADING = /^#{1,6}\s+/;

/**
 * The `Target files` section label, in BOTH forms the queue actually contains
 * (issue #3535).
 *
 * The Agent Brief template emits every other section as a bold label, and its
 * `Target files` section was no exception; this lint's own fix hint, and the
 * planner's reader, matched a markdown HEADING only. Template, lint and reader
 * therefore disagreed three ways, and an author following the intake skill
 * verbatim silently lost batching: 77 of the 200 open `ready-for-agent` issues
 * declared a real list of paths under the bold label and every one of them was
 * read as "unknown blast radius" and scheduled solo.
 *
 * This constant is the single authority on what is accepted. The planner's
 * `parseTargetFiles` imports it rather than re-stating the pattern, so the
 * drift cannot come back by editing one copy.
 *
 * The HEADING form stays canonical for issues written from now on — it is what
 * `TARGET_FILES_FIX` tells an author to write and what the intake template now
 * emits — but an existing bold label is read, not corrected.
 */
export const TARGET_FILES_LABEL =
    /^(?:#{1,6}\s+target files|\*\*\s*target files\s*:?\s*\*\*\s*:?\s*$)/i;

/**
 * Where a section ENDS: the next heading, or the next bold label.
 *
 * A bold-labelled section has no `#` to stop at, so without the second
 * alternative a `**Target files:**` with nothing under it would swallow the
 * list items of whatever section came after it.
 */
export const SECTION_BREAK = /^(?:#{1,6}\s+|\*\*[^*]+\*\*:?\s*$)/;

/**
 * Does the body DECLARE a file set — a `Target files` label with at least one
 * list item under it?
 *
 * A label with nothing under it is not a declaration: the planner reads it as
 * absent (unknown blast radius, scheduled solo), so the lint must say the same
 * thing rather than let an author believe an empty section bought them
 * batching.
 */
export function declaresTargetFiles(body: string): boolean {
    return (targetFilesSection(body) ?? []).some((l) =>
        /^[-*]\s+/.test(l.trim())
    );
}

/** The one sentence that names the accepted forms, shared by the fix hint. */
export const TARGET_FILES_FIX =
    "add a `## Target files` section listing the modules/globs it touches (coarse is fine) — the template's `**Target files:**` label is read too";

function hasSection(body: string, name: RegExp): boolean {
    return body.split("\n").some((l) => HEADING.test(l) && name.test(l));
}

/**
 * The raw lines of the `Target files` section, in either accepted form, or
 * `null` when the section is ABSENT.
 *
 * `null` is not the same as `[]`, and the planner's whole scheduling decision
 * hangs off the difference: absent means the blast radius is unknown and the
 * issue runs solo; empty would mean "declares it touches nothing", which is
 * never what a label with no list under it is saying.
 */
export function targetFilesSection(body: string): string[] | null {
    const lines = body.split("\n");
    const start = lines.findIndex((l) => TARGET_FILES_LABEL.test(l.trim()));
    if (start === -1) return null;
    const rest = lines.slice(start + 1);
    const end = rest.findIndex((l) => SECTION_BREAK.test(l.trim()));
    return end === -1 ? rest : rest.slice(0, end);
}

/** Lines of the named section, up to the next heading. */
function section(body: string, name: RegExp): string[] {
    const lines = body.split("\n");
    const start = lines.findIndex((l) => HEADING.test(l) && name.test(l));
    if (start === -1) return [];
    const rest = lines.slice(start + 1);
    const end = rest.findIndex((l) => HEADING.test(l));
    return end === -1 ? rest : rest.slice(0, end);
}

const ACCEPTANCE = /acceptance criteria/i;
const PARENT = /^#{1,6}\s+parent/i;

/** Words that mean a human has to look at it. Deliberately narrow: the cost of a
 *  false positive here is telling an author their HITL flag is wrong when it is
 *  not, which erodes trust in every other finding. */
const HUMAN_JUDGMENT =
    /\b(browser|visually|visual|looks right|screenshot|by hand|manually|manual|design review|judgement|judgment|decide|chrome)\b/i;

export function lintIssue(issue: LintableIssue): Finding[] {
    const findings: Finding[] = [];
    const body = issue.body ?? "";
    const labels = issue.labels;

    // ── Contradictions in the data — always blocking ────────────────────────
    // These are not "the author could have written more"; they are states that
    // cannot be right, and each one silently costs the loop something specific.

    if (labels.includes("prd") && labels.includes("ready-for-agent")) {
        findings.push({
            rule: "prd-with-ready-for-agent",
            severity: "blocking",
            message:
                "a PRD is a spec umbrella, not a work item — the loop skips it on every pass forever, and because it is never claimed it permanently falsifies the stop condition (“no unclaimed ready-for-agent issues”)",
            fix: `gh issue edit ${issue.number} --remove-label ready-for-agent`,
        });
    }

    if (body.trim().length < 80) {
        findings.push({
            rule: "empty-body",
            severity: "blocking",
            message:
                "the body is too short to be a spec — an implementer would be guessing, and a reviewer would have nothing to judge against",
            fix: "write what to build and how it will be verified, then re-label ready-for-agent",
        });
    }

    // An issue no agent can land: it is not malformed, it is misrouted, and
    // claiming it burns a full implement + review cycle before failing at push.
    for (const raw of targetFilesSection(body) ?? []) {
        const t = raw
            .trim()
            .replace(/^[-*]\s+/, "")
            .replace(/`/g, "");
        if (!t || HEADING.test(raw)) continue;
        if (t.startsWith(".github/workflows")) {
            findings.push({
                rule: "unmergeable-ci-config",
                severity: "blocking",
                message:
                    "touches `.github/workflows/**`, which needs the `workflow` OAuth scope only an interactive `gh auth refresh` can grant — an agent implements it and then fails at `git push`",
                fix: `gh issue edit ${issue.number} --remove-label ready-for-agent --add-label ready-for-human`,
            });
            break;
        }
        if (t.startsWith("~") || t.startsWith("/") || t.startsWith("..")) {
            findings.push({
                rule: "unmergeable-outside-repo",
                severity: "blocking",
                message: `target \`${t}\` lives outside the repository — no PR can carry the change`,
                fix: `move the file into the repo, or: gh issue edit ${issue.number} --remove-label ready-for-agent --add-label ready-for-human`,
            });
            break;
        }
    }

    // ── Quality, not correctness — advisory ─────────────────────────────────

    if (!hasSection(body, ACCEPTANCE)) {
        // NOT blocking, and the reason is measured rather than principled: at
        // the time this rule was written a large share of the open queue
        // predated the convention, and blocking would have emptied the backlog
        // into `needs-info` in one pass. An outage is not a quality gate.
        // Revisit the severity once the advisory count is near zero.
        findings.push({
            rule: "no-acceptance-criteria",
            severity: "advisory",
            message:
                "no `Acceptance criteria` section — nothing states what “done” means, so the implementer guesses and the reviewer cannot falsify",
            fix: "add an `## Acceptance criteria` section with one checkbox per verifiable outcome",
        });
    }

    if (!declaresTargetFiles(body)) {
        findings.push({
            rule: "no-target-files",
            severity: "advisory",
            message:
                "no `Target files` section — the planner will not guess a file set, so the issue is scheduled SOLO and the rest of the batch waits behind it",
            fix: TARGET_FILES_FIX,
        });
    }

    if (issue.parentNumber === null && hasSection(body, PARENT)) {
        // The body claims a parent, the edge is missing. This one is invisible
        // and permanent: the loop sorts on `parent.number ?? number`, so the
        // slice sorts on its own number and lands at the BACK of the queue
        // while its umbrella never converges.
        const referenced = /#(\d+)/.exec(section(body, PARENT).join("\n"))?.[1];
        findings.push({
            rule: "missing-parent-edge",
            severity: "advisory",
            message:
                "the body names a parent but the native sub-issue edge is missing — the lineage sort will place this slice at the back of the queue and its umbrella will never converge",
            fix: referenced
                ? `gh issue edit ${issue.number} --parent ${referenced}   # then read it back: the API no-ops silently under rapid fire`
                : `gh issue edit ${issue.number} --parent <umbrella>`,
        });
    }

    const modelLabels = labels.filter((l) => l.startsWith("model:"));
    if (modelLabels.length > 1) {
        findings.push({
            rule: "multiple-model-labels",
            severity: "advisory",
            message: `carries ${modelLabels.length} model labels (${modelLabels.join(", ")}) — the planner will take the most capable and report the ambiguity`,
            fix: "leave exactly one, or none for the default tier",
        });
    }

    if (/⚠️\s*HITL|\bHITL\b/.test(body) && hasSection(body, ACCEPTANCE)) {
        const criteria = section(body, ACCEPTANCE).join("\n");
        if (criteria.trim() && !HUMAN_JUDGMENT.test(criteria)) {
            findings.push({
                rule: "hitl-machine-checkable",
                severity: "advisory",
                message:
                    "flagged HITL, but no acceptance criterion needs a human to look at anything — an HITL flag stops the PR being merged, so a wrong one parks finished work indefinitely (heuristic: no human-judgment wording found)",
                fix: "drop the HITL flag, or state the criterion that genuinely needs a person",
            });
        }
    }

    return findings;
}

export const isBlocking = (findings: Finding[]): boolean =>
    findings.some((f) => f.severity === "blocking");
