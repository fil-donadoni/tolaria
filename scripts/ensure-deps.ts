#!/usr/bin/env bun
/**
 * Reinstalls this tree's dependencies when `node_modules/` was installed from
 * other manifests than the tree carries now (issue #6000) — the mechanism is
 * in `lib/deps-stamp.ts`.
 *
 * `land` runs it right after the rebase, before anything that imports a
 * dependency: a base that added one would otherwise red `tsc` on the
 * rebased tip. Silent when the stamp matches; one line when it installed.
 * A failed install exits 77 — INFRA, nothing was gated — never a red lane.
 *
 * Run: bun scripts/ensure-deps.ts
 */
import { spawnSync } from "node:child_process";
import { ensureDeps } from "./lib/deps-stamp";
import { MACHINE_SATURATED_EXIT } from "./lib/machine-admission";

const cwd = process.cwd();
const outcome = ensureDeps(
    cwd,
    () =>
        spawnSync("bun", ["install", "--frozen-lockfile"], {
            cwd,
            stdio: "inherit",
        }).status === 0
);
if (outcome === "installed")
    console.log(
        "deps: bun install --frozen-lockfile (node_modules was installed from other manifests than this tree's)"
    );
if (outcome === "failed") {
    console.error(
        `deps: bun install --frozen-lockfile failed — INFRA (exit ${MACHINE_SATURATED_EXIT}), nothing was gated`
    );
    process.exit(MACHINE_SATURATED_EXIT);
}
