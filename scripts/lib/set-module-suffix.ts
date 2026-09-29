/**
 * Suffix of every module under `convex/cards/sets/**` (issue #4811). The Convex
 * CLI makes every SINGLE-dot `.ts` under `convex/` a function entry point; a
 * multi-dot name stays importable (bundled into whatever imports it) but is
 * no longer one. Card sets are data, not functions, so they carry `.cards`.
 * `scripts/__tests__/convex-bundle-size.test.ts` reds on a single-dot set file.
 */
export const SET_MODULE_SUFFIX = ".cards";
