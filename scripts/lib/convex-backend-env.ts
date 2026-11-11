/**
 * The environment every LOCAL Convex backend this repo starts runs with
 * (issue #9105) — one table, read by `convex:ensure`'s own spawn and pinned
 * against the two service templates (`scripts/runner-units/
 * com.tolaria.convex.plist`, `tolaria-convex.service`) by
 * `scripts/__tests__/convex-backend-env.test.ts`. `convex dev --local` hands
 * its environment to the `convex-local-backend` it forks, so a variable here
 * reaches the backend's knobs.
 *
 * DOCUMENT_RETENTION_DELAY (seconds): how long the backend keeps superseded
 * document versions. The binary's default is 14 days (measured 2026-11-11:
 * `document_min_snapshot_ts` sat exactly 14 days behind `max_repeatable_ts`),
 * and every `convex dev` push from any worktree writes a new version of every
 * `_modules` row — 480,261 document versions, 845 MB compacted, nearly all
 * of them from the last 14 days. A local deployment never reads a snapshot older
 * than its newest push, so one day is ample; the deleted rows' pages are
 * reused by sqlite, which bounds the file at live data + one day of churn.
 */
export const CONVEX_BACKEND_ENV: Readonly<Record<string, string>> = {
    DOCUMENT_RETENTION_DELAY: String(24 * 60 * 60),
};
