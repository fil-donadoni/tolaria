/**
 * What a Contained RED forgives a lane (ADR 0163 §4): every failure of a step
 * is a test NAME the standing RED's published evidence lists, or the step is
 * red. Another failure in the same file, a file that cannot load, a failure
 * with no name, an unreadable lineage or evidence: nothing is forgiven.
 *
 * `check:lane` and `land:ready` both read this one function, because they run
 * the same plan.
 */
import {
    evidenceTestNames,
    failingTestNames,
    unattributedFailure,
} from "./health-evidence";
import {
    evidenceStore,
    readVerdictLineage,
    verdictStore,
    type Lineage,
} from "./health-verdict-store";

/**
 * A step whose FAIL lines can vouch for it: one vitest run, and nothing after
 * it. `check:pr` and the other chains stop at their first red (`&&`), so
 * passing one would pass every step it never reached.
 */
const PLAIN_VITEST = /^(?:[A-Z_]+=\S*\s+)*bunx vitest run(\s|$)/;

/**
 * The failing test names of a failed lane step, or undefined when they do not
 * account for the whole failure. Pure: `failedFiles` stays what it was, read
 * by `--retry-flaky` and the fixup classifier.
 */
export function laneStepFailedTests(
    command: string,
    output: string
): string[] | undefined {
    if (!PLAIN_VITEST.test(command)) return undefined;
    if (unattributedFailure(output) !== null) return undefined;
    return failingTestNames(output);
}

/**
 * The names forgiven, or null when the step stays red. No names is never
 * forgiven: `every` over nothing would pass a failure nobody can name.
 */
export function toleratedTests(
    known: ReadonlySet<string>,
    failedTests: readonly string[] | undefined
): string[] | null {
    if (failedTests === undefined || failedTests.length === 0) return null;
    return failedTests.every((name) => known.has(name))
        ? [...failedTests]
        : null;
}

export interface ContainedDeps {
    /** `readVerdictLineage`'s total reading: an outage carries `error`. */
    lineage: () => Lineage & { error?: string };
    /** The published evidence of a sha, or null; may throw. */
    evidence: (sha: string) => string | null;
    /** Why a Contained RED forgives nothing: named, never silent. */
    log: (line: string) => void;
}

/** The test names the standing Contained RED's evidence lists. Empty when no
 *  Contained RED stands, or when its evidence cannot be read. */
export function containedTestNames(deps: ContainedDeps): ReadonlySet<string> {
    const lineage = deps.lineage();
    if (lineage.error)
        deps.log(
            `contained: nothing tolerated — the lineage is unreadable (${lineage.error})`
        );
    if (lineage.kind !== "contained" || !lineage.verdict) return new Set();
    const sha = lineage.verdict.sha;
    try {
        const body = deps.evidence(sha);
        if (body === null)
            deps.log(
                `contained: nothing tolerated — no evidence published on ${sha.slice(0, 8)}`
            );
        return new Set(body === null ? [] : evidenceTestNames(body));
    } catch (e) {
        deps.log(
            `contained: nothing tolerated — the evidence on ${sha.slice(0, 8)} is unreadable (${(e as Error).message})`
        );
        return new Set();
    }
}

/** What a run asks of a failed step: the names forgiven, or null for red. */
export type ContainedTolerance = (
    failedTests: readonly string[] | undefined
) => string[] | null;

/**
 * The run's tolerance. The pivot is read at the first failure that names its
 * tests, once: a green lane and a nameless red make no call, and one run judges
 * all its steps against one evidence.
 */
export function containedTolerance(deps: ContainedDeps): ContainedTolerance {
    let known: ReadonlySet<string> | null = null;
    return (failedTests) => {
        if (failedTests === undefined || failedTests.length === 0) return null;
        known ??= containedTestNames(deps);
        return toleratedTests(known, failedTests);
    };
}

/** `containedTolerance` over the pivot of the repository `root` checks out. */
export function liveContainedTolerance(
    root: string,
    log: (line: string) => void
): ContainedTolerance {
    return containedTolerance({
        lineage: () => readVerdictLineage(() => verdictStore(root)),
        evidence: (sha) => evidenceStore(root).read(sha),
        log,
    });
}
