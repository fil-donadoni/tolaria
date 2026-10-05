#!/usr/bin/env bun
/**
 * Brings this tree's `convex/_generated/` in step with its own `convex/`
 * (issue #5077) — the mechanism and its cost are in `lib/generated-api.ts`.
 *
 * `land` runs it right after the rebase: a worktree cut BEFORE a landing that
 * added Convex modules carries a generated API without them, and the rebased
 * tip would red `check:ts` on modules the branch never touched.
 *
 * Silent when the copy already matches (nearly every landing); one line when
 * it regenerated; exit 1 when the tree is still out of step.
 *
 * Run: bun scripts/refresh-generated-api.ts
 */
import { refreshGeneratedApi, refreshReceipt } from "./lib/generated-api";

const outcome = refreshGeneratedApi(process.cwd());
if (outcome.kind !== "fresh")
    console.log(`refresh: ${refreshReceipt(outcome)}`);
if (outcome.kind === "failed") process.exit(1);
