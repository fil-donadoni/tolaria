// The ONE deployment write behind `bun run seed:preset` (issue #3254).
//
// It used to be inline in `scripts/seed-preset-deck.ts`, with that file's own
// header naming the condition for extracting it:
//
//   "A second entry point — a sweep seeding all six Tier 1 lists once #2719's
//    card slices land — is the moment to extract it, before the two copies
//    drift."
//
// `--all` is that second entry point, so this is that extraction. The split
// mirrors `scripts/lib/seed-scenario-run.ts`, which exists for the identical
// reason (a per-PR CLI plus a backlog sweep).
//
// It runs `convex run` from the PRIMARY CHECKOUT: `.env.local` carries
// `CONVEX_DEPLOYMENT` and a linked worktree does not have it, so a seed driven
// from `../tolaria-issue-N` would find no deployment or, worse, a different
// one. Only the WRITE needs that directory — the canonical list and the card
// registry are git-tracked and read from wherever the caller runs.

import { spawnSync } from "node:child_process";
import { convexRunErrorMessage } from "./convex-run-error";
import { primaryCheckout } from "./primary-checkout";
import type { PresetPayload } from "./preset-deck-seed";

export interface SeedPresetResult {
    /** `insert` / `patch` as reported by the mutation, when it succeeded. */
    action?: string;
    /** Why the write failed, when it did. */
    error?: string;
}

/** Upserts one preset by slug. Never throws: a refusal is returned as `error`
 *  so a sweep can report every deck and still exit on the first real failure
 *  by its own policy rather than dying mid-list. */
export function seedPreset(
    slug: string,
    payload: PresetPayload
): SeedPresetResult {
    const res = spawnSync(
        "npx",
        [
            "convex",
            "run",
            "decks:seedPresetDirect",
            JSON.stringify({ expectedSlug: slug, input: payload }),
        ],
        { cwd: primaryCheckout(), encoding: "utf8", timeout: 120_000 }
    );
    if (res.error || res.status !== 0) {
        const out = `${res.stderr ?? ""}${res.stdout ?? ""}`.trim();
        return {
            error: res.error?.message ?? convexRunErrorMessage(out),
        };
    }
    try {
        const parsed = JSON.parse((res.stdout ?? "").trim()) as {
            action?: string;
        };
        return { action: parsed.action ?? "written" };
    } catch {
        // A return-shape change must not turn a successful write into a
        // reported failure — same tolerance as `seedScenario`.
        return { action: "written" };
    }
}
