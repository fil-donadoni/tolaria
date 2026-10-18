/**
 * The evidence a RED health verdict carries to the OTHER machine (issue
 * #5589): what failed, how, and the output that shows it — published on the
 * pivot (`EvidenceStore` in `lib/health-verdict-store.ts`), never left as a
 * path on the machine that ran the gate.
 *
 * The incident that asked for it: base tips `bb54e006f` and `00aebfc40` went
 * RED at `test` on the Huawei with an EMPTY `tests:` field and a log path
 * only the Huawei could open; `/health-fix` on the MacBook re-ran every
 * suite green and ended `stuck`. The field was empty because vitest prints a
 * project label two ways — `|node-tooling|` without colour, ` node-tooling `
 * on a coloured background with it (`formatProjectName`) — and the parser
 * knew only the first: under a colour-forcing environment (`FORCE_COLOR`,
 * `CI`) no FAIL line matched, no file was named, and the retry
 * (`lib/health-retry.ts`), reading the same lines, never ran.
 *
 * Everything here is pure: `health-main.ts` builds the evidence from a
 * step's output, the store publishes it. A failure that is NOT a failing
 * test — a crash, a kill, an unhandled error, a gate that is not vitest — is
 * named as such (`FailureKind`), so an empty file list is never silent.
 *
 * Node builtins only: `health-main.ts` imports this, and it runs before
 * `node_modules` may exist.
 */

/** What a RED was, as the verdict's `failure:` field names it. */
export type FailureKind =
    /** A failing test, at least one not a timeout. */
    | "assertion"
    /** Every failing test timed out. */
    | "timeout"
    /** The run died: a signal, a worker crash, an unhandled error, OOM. */
    | "crash"
    /** A gate that is not a test suite failed (`check:all`'s tsc, lint…). */
    | "gate"
    /** A test step failed and its output names no failing test and no
     *  crash: the parser could not read it. A defect of THIS module — the
     *  excerpt is the only evidence, and it says so. */
    | "unparsed";

export const FAILURE_KINDS: readonly FailureKind[] = [
    "assertion",
    "timeout",
    "crash",
    "gate",
    "unparsed",
];

/** The steps whose failure is a vitest run's (`lib/health-retry.ts`). */
const TEST_STEP = /^test(?::|\b)/;

/** The first line of every published evidence body — how a reader finds
 *  the evidence of ONE sha among a commit's comments. */
export function evidenceMarker(sha: string): string {
    return `<!-- tolaria-health-evidence sha=${sha} -->`;
}

/** Whether `body` is the evidence of `sha` — a full sha, or the abbreviated
 *  one a reader on the other machine may hold before it fetched the tip. */
export function isEvidenceFor(
    body: string | null | undefined,
    sha: string
): boolean {
    return (
        sha.length >= 7 &&
        /^[0-9a-f]+$/.test(sha) &&
        (body ?? "").startsWith(`<!-- tolaria-health-evidence sha=${sha}`)
    );
}

/** The pivot caps a comment at 65,536 characters; room for the header. */
export const EVIDENCE_MAX = 60_000;

export function stripAnsi(output: string): string {
    // eslint-disable-next-line no-control-regex -- stripping the ANSI colour codes
    return output.replace(/\u001b\[[0-9;]*m/g, "");
}

/**
 * One vitest FAIL line, either label form: `FAIL  |proj| path > test`
 * (no colour) or `FAIL   proj  path > test` (colour stripped). Group 1 is
 * the project when there is one, group 2 the test file.
 */
export const VITEST_FAIL_LINE =
    /^\s*(?:[❯>×✗]\s*)?FAIL\s+(?:\|([^|\n]+)\|\s+|([\w@.:/-]+)\s+(?=\S+\.(?:test|spec)\.[cm]?[jt]sx?\b))?(\S+\.(?:test|spec)\.[cm]?[jt]sx?)\b/gm;

/** Every FAIL line, project-tagged or not (`lib/health-retry.ts`). */
export const ANY_FAIL_LINE = /^\s*(?:[❯>×✗]\s*)?FAIL\s+\S/gm;

export interface FailLine {
    /** The vitest project, when the line names one. */
    project?: string;
    file: string;
}

/** The FAIL lines of a vitest run's output, in order, colours stripped. */
export function failLines(output: string): FailLine[] {
    const out: FailLine[] = [];
    for (const m of stripAnsi(output).matchAll(VITEST_FAIL_LINE)) {
        const project = (m[1] ?? m[2])?.trim();
        out.push(project ? { project, file: m[3] } : { file: m[3] });
    }
    return out;
}

/** The failing test FILES — what a repair's lane must run. Sorted, unique. */
export function failingFiles(output: string): string[] {
    return [...new Set(failLines(output).map((l) => l.file))].sort();
}

/** The vitest projects with a failing test, sorted, unique. */
export function failingProjects(output: string): string[] {
    const set = new Set<string>();
    for (const l of failLines(output)) if (l.project) set.add(l.project);
    return [...set].sort();
}

/** Lines that say the run died rather than a test failing. */
/** Anchored to the forms vitest, node and the shell print — never a bare
 *  phrase, which a test NAME or a passing test's console output can carry. */
export const CRASH_LINE =
    /^.*⎯{3,}\s*Unhandled Errors?\s*⎯{3,}.*$|^\s*Vitest caught \d+ unhandled errors?.*$|^\s*(?:Error: )?\[?vitest-pool\]?.*Worker exited unexpectedly.*$|^\s*Error: Worker exited unexpectedly.*$|^.*FATAL ERROR: .*JavaScript heap out of memory.*$|^\s*(?:Segmentation fault|Aborted \(core dumped\)|Killed)\b.*$/m;

/** Every failed test timed out: vitest's per-test blocks, read whole. */
function timeoutOnly(plain: string): boolean {
    const failed = [...plain.matchAll(/^\s*Tests\s+(\d+) failed/gm)].reduce(
        (n, m) => n + Number(m[1]),
        0
    );
    const lines = plain.split("\n");
    let blocks = 0;
    for (let i = 0; i < lines.length; i++) {
        if (!/^\s*FAIL\s+\S/.test(lines[i])) continue;
        blocks++;
        const error = lines.slice(i + 1).find((l) => l.trim() !== "") ?? "";
        if (!/^\s*Error: (?:Test|Hook) timed out in \d+ms/.test(error))
            return false;
    }
    return failed > 0 && blocks === failed;
}

export interface Classified {
    kind: FailureKind;
    /** One line saying why — the crash line, the signal, the gate. */
    detail: string;
}

/** What kind of failure a step's output shows. */
export function classifyFailure(input: {
    step: string;
    output: string;
    status: number | null;
    signal: string | null;
}): Classified {
    const plain = stripAnsi(input.output);
    if (input.signal)
        return {
            kind: "crash",
            detail: `killed by ${input.signal}${input.signal === "SIGKILL" ? " (an OOM kill reads this way)" : ""}`,
        };
    const crash = CRASH_LINE.exec(plain);
    // A crash beside failing tests is still a crash: the run did not finish,
    // and the failing files may be its casualties rather than its cause.
    if (crash) return { kind: "crash", detail: crash[0].trim().slice(0, 200) };
    const files = failingFiles(plain);
    if (files.length > 0)
        return timeoutOnly(plain)
            ? { kind: "timeout", detail: "every failing test timed out" }
            : {
                  kind: "assertion",
                  detail: `${files.length} failing test file${files.length === 1 ? "" : "s"}`,
              };
    if (!TEST_STEP.test(input.step))
        return {
            kind: "gate",
            detail: `${input.step} exited ${input.status ?? "with no code"}`,
        };
    return {
        kind: "unparsed",
        detail: `${input.step} exited ${input.status ?? "with no code"} and its output names no failing test and no crash — read the excerpt`,
    };
}

/** The vitest sections a reader needs, in order: the failed tests with
 *  their assertions and stack heads, and any unhandled errors. */
function failureSections(plain: string): string {
    const lines = plain.split("\n");
    const out: string[] = [];
    let on = false;
    for (const line of lines) {
        // `⎯⎯⎯ Failed Tests 5 ⎯⎯⎯`, `⎯⎯⎯ Unhandled Errors ⎯⎯⎯` open a section;
        // the run's `Test Files …` summary closes it.
        if (
            /⎯{3,}\s*(?:Failed Tests|Unhandled Errors?|Failed Suites)\b/.test(
                line
            )
        )
            on = true;
        else if (on && /^\s*Test Files\s/.test(line)) on = false;
        if (on) out.push(line);
    }
    if (out.length > 0) return out.join("\n");
    // No summary section (a crash before it): each FAIL line and what follows.
    for (let i = 0; i < lines.length; i++)
        if (/^\s*(?:[❯>×✗]\s*)?FAIL\s+\S/.test(lines[i]))
            out.push(...lines.slice(i, i + 25), "");
    return out.join("\n");
}

function capped(text: string, max: number): string {
    if (text.length <= max) return text;
    const cut = text.slice(0, max);
    return `${cut.slice(0, cut.lastIndexOf("\n") + 1)}… [${text.length - max} more characters — the full log is on the machine named above]\n`;
}

/** A fence the excerpt cannot close from inside. */
function fenced(text: string): string {
    return `~~~~text\n${text.replace(/~{4,}/g, "~~~")}\n~~~~`;
}

export interface EvidenceInput {
    sha: string;
    step: string;
    machine: string;
    /** The log on `machine` — named, never relied on. */
    logPath: string;
    output: string;
    status: number | null;
    signal: string | null;
    /** The projects a retried `test` step re-ran, and what the first
     *  failure was (`lib/health-retry.ts`). */
    retried?: readonly string[];
    retryCause?: string;
    /** Why a failed step was NOT re-run (`retryDecision`, issue #5939). */
    retryRefused?: string;
    at: string;
}

export interface Evidence {
    kind: FailureKind;
    detail: string;
    projects: string[];
    files: string[];
    /** The markdown body the pivot carries, ≤ `EVIDENCE_MAX`. */
    body: string;
}

/** The evidence of one RED, ready to publish. */
export function buildEvidence(input: EvidenceInput): Evidence {
    const plain = stripAnsi(input.output);
    const { kind, detail } = classifyFailure(input);
    const files = failingFiles(plain);
    const projects = failingProjects(plain);
    const head = [
        evidenceMarker(input.sha),
        `## Health RED · \`${input.sha.slice(0, 12)}\` · ${input.step}`,
        "",
        `- **failure:** ${kind} — ${detail}`,
        `- **machine:** ${input.machine} · **at:** ${input.at}`,
        `- **projects:** ${projects.length > 0 ? projects.join(", ") : "none named"}`,
        `- **files:** ${files.length > 0 ? files.map((f) => `\`${f}\``).join(", ") : "none named"}`,
        input.retried && input.retried.length > 0
            ? `- **retry:** re-ran ${input.retried.join(", ")} once (first failure: ${input.retryCause ?? "unrecorded"}) — failed again; the excerpt is the retry's`
            : `- **retry:** none — ${input.retryRefused ?? "not a retryable test failure"}`,
        `- **log on ${input.machine}:** \`${input.logPath}\``,
        "",
    ].join("\n");
    const sections = failureSections(plain);
    const tail = plain.split("\n").slice(-80).join("\n");
    // Half the room each, the failures first: they are the diagnosis, the
    // tail is the context a crash leaves.
    const room = EVIDENCE_MAX - head.length - 200;
    const failText = sections ? capped(sections, Math.floor(room / 2)) : "";
    const tailText = capped(tail, room - failText.length);
    const body = [
        head,
        "### Failures",
        "",
        failText ? fenced(failText) : "_no FAIL block in the output_",
        "",
        "### Output tail",
        "",
        fenced(tailText),
        "",
    ].join("\n");
    return { kind, detail, projects, files, body };
}

/** The lines of a published body worth printing in `health:status` —
 *  the header, up to the first section. */
export function evidenceSummary(body: string): string {
    const lines = body.split("\n").filter((l) => !l.startsWith("<!--"));
    const end = lines.findIndex((l) => l.startsWith("### "));
    return lines
        .slice(0, end === -1 ? lines.length : end)
        .join("\n")
        .trim();
}

/** The failing files a published body names (its `- **files:**` line) — what
 *  the RED ladder re-runs (`lib/health-bisect.ts`, issue #5645). The commit
 *  status's description may have had no room for them; the body always has. */
export function evidenceFiles(body: string): string[] {
    const line = body.split("\n").find((l) => l.startsWith("- **files:** "));
    if (line === undefined) return [];
    return [...line.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
}

/** `body` with one more bullet in its header (the bisect's culprit line),
 *  where `evidenceSummary` — and so `health:status` — prints it. Idempotent
 *  per line: a re-run's same culprit is not added twice. */
export function withEvidenceLine(body: string, line: string): string {
    if (body.split("\n").includes(line)) return body;
    const at = body.indexOf("\n\n### ");
    return at === -1
        ? `${body.trimEnd()}\n${line}\n`
        : `${body.slice(0, at)}\n${line}${body.slice(at)}`;
}
