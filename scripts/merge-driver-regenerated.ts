#!/usr/bin/env bun
/**
 * The `merge=regenerated` merge driver (issue #3069).
 *
 * Registered in LOCAL git config by `scripts/bootstrap-worktree.ts` — git merge
 * drivers cannot be committed, so the bootstrap is the only repo-controlled
 * place to install one. `.gitattributes` names it for every artifact in
 * {@link REGENERATED_ARTIFACTS}.
 *
 * WHAT IT DOES, AND WHAT IT DELIBERATELY DOES NOT.
 *
 * It first runs the ordinary 3-way merge (`git merge-file`). A clean result is
 * KEPT: two PRs adding disjoint card rows produce exactly the file a
 * regeneration would, and forcing a regenerate there would turn today's
 * clean merge into a refusal on any machine without the corpus cache.
 *
 * Only when that conflicts does it act: it restores OURS byte-for-byte (during
 * a rebase, "ours" is the branch being rebased ONTO — the same side the manual
 * procedure resolved to) and appends the path to a marker in the git dir.
 * One exception to byte-for-byte: on the compiler's lockfile the Bot-play
 * verdicts the commit changed are laid over OURS (issue #5814), because the
 * regeneration CARRIES verdicts from the tree and would otherwise drop them. It
 * does NOT regenerate here: the driver runs once per replayed commit, mid-merge,
 * on a tree that is not yet the tree the artifact must be derived from, and the
 * compile it would have to run reads 34,890 corpus rows. Regeneration happens
 * ONCE, at the rebased tip, in `scripts/resolve-generated-artifacts.ts`.
 *
 * Exits 0 on a taken side ON PURPOSE: a non-zero exit is how a driver says
 * "conflict markers are in the file, a human must look", which is precisely the
 * manual resolution this exists to abolish. The safety net is the marker — the
 * resolver refuses to let a side-taken artifact reach `check:lane` unresolved.
 */
import { spawnSync } from "node:child_process";
import {
    appendFileSync,
    copyFileSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { REGENERATE_MARKER } from "./lib/generated-artifacts";
import { writeStderrSync } from "./lib/merge-driver-io";
import type { Lockfile } from "./lib/oracle-lockfile";
import {
    BOT_VERDICT_OVERLAY_PATH,
    overlayBranchVerdicts,
} from "./lib/oracle-verdict-overlay";

// git invokes a merge driver with cwd at the top of the working tree and
// substitutes %O (base), %A (ours — and the file to write), %B (theirs),
// %P (the path being merged, for messages).
const [base, ours, theirs, path] = process.argv.slice(2);
if (!base || !ours || !theirs) {
    writeStderrSync(
        "merge-driver-regenerated: expected %O %A %B %P as arguments\n"
    );
    process.exit(2);
}
const label = path ?? ours;

// Keep a pristine copy of OURS: `git merge-file` writes its result — conflict
// markers included — into `ours` in place, so the fallback needs a copy taken
// before the attempt, not a re-read after it.
// `process.exit()` does not run `finally` blocks, so the scratch dir is torn
// down explicitly at each exit rather than wrapped in try/finally.
const scratch = mkdtempSync(join(tmpdir(), "tolaria-merge-"));
const oursBackup = join(scratch, "ours");

function done(code: number): never {
    rmSync(scratch, { recursive: true, force: true });
    process.exit(code);
}

/**
 * The compiler's lockfile only: keep the Bot-play verdicts THEIRS changed on
 * top of the side taken, so the resolver's `--carry-bot` carries them rather
 * than the base's (issue #5814, `lib/oracle-verdict-overlay.ts`). A side it
 * cannot parse leaves plain OURS — the regeneration still runs, the verdicts
 * are only as stale as before.
 */
function overlayVerdicts(): void {
    if (path !== BOT_VERDICT_OVERLAY_PATH) return;
    const parse = (file: string): Lockfile | null => {
        try {
            return JSON.parse(readFileSync(file, "utf8")) as Lockfile;
        } catch {
            return null;
        }
    };
    const oursLock = parse(ours!);
    const theirsLock = parse(theirs!);
    if (oursLock === null || theirsLock === null) return;
    const { lock, carried } = overlayBranchVerdicts(
        parse(base!),
        oursLock,
        theirsLock
    );
    if (carried === 0) return;
    writeFileSync(ours!, `${JSON.stringify(lock)}\n`);
    writeStderrSync(
        `merge-driver-regenerated: ${label} keeps ${carried} Bot-play verdict(s) the commit changed (issue #5814)\n`
    );
}

copyFileSync(ours, oursBackup);

const attempt = spawnSync(
    "git",
    [
        "merge-file",
        "-L",
        "ours",
        "-L",
        "base",
        "-L",
        "theirs",
        ours,
        base,
        theirs,
    ],
    { stdio: ["ignore", "ignore", "pipe"], encoding: "utf8" }
);
if (attempt.status === 0) {
    // Clean 3-way merge — the ordinary case, and already correct.
    done(0);
}

copyFileSync(oursBackup, ours);
overlayVerdicts();

const markerPath = spawnSync(
    "git",
    ["rev-parse", "--git-path", REGENERATE_MARKER],
    { encoding: "utf8" }
);
if (markerPath.status !== 0) {
    // No marker means no safety net, and a silently side-taken artifact is the
    // exact failure this driver exists to prevent — so fail loudly and let git
    // report a conflict the operator can see.
    writeStderrSync(
        `merge-driver-regenerated: cannot locate the git dir to mark ${label} for regeneration\n`
    );
    done(1);
}
appendFileSync(markerPath.stdout.trim(), `${label}\n`);

writeStderrSync(
    `merge-driver-regenerated: ${label} carries whole-file state — took ours and marked it for regeneration ` +
        `(a generated artifact is regenerated, not merged — issue #3069)\n`
);
done(0);
