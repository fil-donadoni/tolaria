// The hosted advisory lane's one recorded test exclusion (issue #5675). A
// LEAF module, no imports: the structure guard (`scripts/ci/workflow-
// structure.ts`, pure), the corpus fixture and the gating entry points all
// read the one name.

/**
 * The ONE recorded exclusion of the committed-corpus tests (issue #5675,
 * owner's option 4): set to `1` only by a GitHub-hosted advisory lane
 * (`pr-check.yml`), which holds no read key because ADR 0156 §8 forbids a
 * secret in a PR job. The tests that read the locked corpus skip there; a
 * GATING lane (`land`, health, `release`) refuses to start with it set
 * (`refuseCorpusExclusion`), and the structure guard refuses it in any
 * workflow holding a self-hosted job — so the gate that merges and the gate
 * that releases always run them.
 */
export const CORPUS_EXCLUSION_ENV = "TOLARIA_HOSTED_NO_VERDICT_CORPUS";

/** Whether this process runs with the corpus tests excluded: the variable
 *  AND a GitHub-hosted Actions runner (`RUNNER_ENVIRONMENT`, set by the
 *  runner itself). On the owner's machines — a self-hosted job, a shell
 *  profile, a `.env` — the variable does nothing, whatever path set it. */
export function corpusExcluded(env: NodeJS.ProcessEnv = process.env): boolean {
    return (
        env[CORPUS_EXCLUSION_ENV] === "1" &&
        env.GITHUB_ACTIONS === "true" &&
        env.RUNNER_ENVIRONMENT === "github-hosted"
    );
}

/** Throws when a gating lane (`what`) would run with the corpus tests
 *  excluded — the exclusion is the advisory hosted lane's only. */
export function refuseCorpusExclusion(
    what: string,
    env: NodeJS.ProcessEnv = process.env
): void {
    if (
        env[CORPUS_EXCLUSION_ENV] !== undefined &&
        env[CORPUS_EXCLUSION_ENV] !== ""
    )
        throw new Error(
            `${what} is a gating lane and ${CORPUS_EXCLUSION_ENV} is set: the committed-corpus tests would be skipped. Unset it — it belongs to the hosted pr-check only (issue #5675).`
        );
}
