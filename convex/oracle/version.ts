/**
 * Grammar version — bumped whenever the accepted language changes.
 *
 * It is recorded in the lockfile header beside a HASH of the compiler's own
 * source (computed by `scripts/oracle-compile.ts`). The hash is what the
 * offline drift guard actually compares: a human-maintained version number
 * tells you a change was intended, a source hash tells you a change happened.
 * Both are useful; only the second is enforceable.
 */
export const GRAMMAR_VERSION = "v0";
