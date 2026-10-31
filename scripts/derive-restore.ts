#!/usr/bin/env bun
/**
 * `bun run derive:restore` — put the derived state a PR carries back to its
 * merge-base with the base branch, staged, NOT committed (issue #7653).
 *
 * The queue fixup's `derived` row (`scripts/pr-fixup.ts`): a lane red on
 * `check:derived-in-diff` — a PR that moved a catalogue file, the lockfile's
 * header hashes or a Bot refit artefact after its hand-off — is cured by the
 * very restore `land:ready` makes at hand-off (`restoreDerivedState`), and
 * the fixup commits it with any other regeneration. A tree carrying nothing
 * is left untouched.
 */
import { ORIGIN_BASE } from "./lib/branches";
import { REAL_RESTORE_GIT, restoreDerivedState } from "./land-ready";

if (import.meta.main) {
    restoreDerivedState(
        process.cwd(),
        ORIGIN_BASE,
        REAL_RESTORE_GIT,
        (l) => console.log(l.replace(/^land:ready: /, "derive:restore: ")),
        { commit: false }
    );
}
