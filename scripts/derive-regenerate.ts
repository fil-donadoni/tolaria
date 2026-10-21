#!/usr/bin/env bun
/**
 * `bun run derive:regenerate` — rebuild the derived whole-file state for the
 * tree it runs in (ADR 0157 § Option 1b, issue #6246).
 *
 * The queue's lane runs this in the draft's working tree before `check:lane`,
 * so the draft (base + PR + fresh derived state) is the one integration test
 * and the bytes it tests are those the base will hold. Two steps, both
 * deterministic (pinned by `derived-state.test.ts`):
 *
 *   1. the lockfile's header hashes are rewritten to the tree's own, ROWS
 *      KEPT — regenerating the rows too would regenerate a wrong row away, and
 *      `check:oracle` judges rows per row;
 *   2. `data/catalogue/*` is re-packed from the tree.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { treeHashes } from "./check-oracle-lockfile";
import {
    parseLockfile,
    serializeLockfile,
    type Lockfile,
} from "./lib/oracle-lockfile";

const ROOT = resolve(import.meta.dirname, "..");
const LOCKFILE_PATH = join(ROOT, "data", "oracle-compiled.json");

/** The lockfile with its header hashes set to the tree's, every row untouched. */
export function withTreeHashes(
    lock: Lockfile,
    hashes: ReturnType<typeof treeHashes>
): Lockfile {
    return { ...lock, header: { ...lock.header, ...hashes } };
}

export function regenerateLockfileHeader(): boolean {
    const before = readFileSync(LOCKFILE_PATH, "utf8");
    const after = serializeLockfile(
        withTreeHashes(parseLockfile(before), treeHashes())
    );
    if (after === before) return false;
    writeFileSync(LOCKFILE_PATH, after, "utf8");
    return true;
}

function main(): void {
    const header = regenerateLockfileHeader();
    console.log(
        header
            ? "derive:regenerate: lockfile header hashes rewritten"
            : "derive:regenerate: lockfile header already current"
    );
    const pack = spawnSync(
        "bun",
        [join(ROOT, "scripts", "catalogue-artifact.ts")],
        { cwd: ROOT, stdio: "inherit" }
    );
    process.exit(pack.status ?? 1);
}

if (import.meta.main) main();
