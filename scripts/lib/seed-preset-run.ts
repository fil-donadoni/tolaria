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
// TWO TARGETS, one write (issue #3499). A Preset Deck row is deployment-local,
// and until #3499 the only target this module could reach was the developer's
// own backend: it ran `convex run` from the PRIMARY CHECKOUT, whose `.env.local`
// names `CONVEX_DEPLOYMENT` (a linked worktree has no such file, so a seed
// driven from `../tolaria-issue-N` would find no deployment or, worse, a
// different one). Production was therefore never seeded by anything — the
// release step pushes CODE, and a Card Definition is code while the Preset Deck
// referencing it is a ROW. So the Psychatog list was live-and-unpickable.
//
// The `"deployment"` target is the deploy-time half: it runs in the build's own
// checkout, reads no env file, and lets `CONVEX_DEPLOY_KEY` — already in the
// build environment, since `convex deploy` just used it — select the
// deployment. Only the WRITE differs between the two; the canonical list and
// the card registry are git-tracked and read from wherever the caller runs.

import { spawnSync } from "node:child_process";
import { convexRunErrorMessage } from "./convex-run-error";
import { primaryCheckout } from "./primary-checkout";
import type { PresetPayload } from "./preset-deck-seed";

/**
 * Which deployment the write goes to.
 *
 * `local` — the developer's backend, named by the primary checkout's
 * `.env.local`. `deployment` — whatever `CONVEX_DEPLOY_KEY` selects, which is
 * how the hosting build reaches production without an env file existing there
 * at all.
 */
export type SeedTarget = "local" | "deployment";

/** The two names the Convex CLI itself reads a deploy key from
 *  (`readDeployKeyFromEnv`). Listed here rather than assumed, because the
 *  deploy-time target's whole contract is "the key the CLI will use". */
export const DEPLOY_KEY_ENV_VARS = [
    "CONVEX_DEPLOY_KEY",
    "CONVEX_DEPLOYMENT_TOKEN",
] as const;

export interface SeedTargetPlan {
    /** Working directory the CLI runs in. Absent exactly when `error` is set. */
    readonly cwd?: string;
    /** Deployment-selection flags, between `run` and the function name. */
    readonly flags?: readonly string[];
    /** Why no write is possible from here. */
    readonly error?: string;
}

/**
 * Where the CLI must run, and under which deployment selection, for a target.
 *
 * Pure, so the deploy-time path is testable offline — the failure it exists to
 * prevent (a seed that silently writes to the developer's backend, or to the
 * DEV deployment of the project the deploy key belongs to) leaves no trace in
 * the build log to assert on afterwards.
 *
 * `--prod` on the deploy-time target is not redundant. A deploy key comes in
 * two shapes: a DEPLOYMENT-scoped key pins the deployment by itself and the CLI
 * logs "Ignoring `--prod` … using deployment from CONVEX_DEPLOY_KEY"; a
 * PROJECT-scoped key — the shape a hosting provider is usually given — selects
 * only the project, and `convex run` with no selection flag resolves to that
 * project's DEV deployment. `convex deploy` passes its own implicit-prod
 * selection, so without this flag the seed could write to a different
 * deployment than the code it was chained after.
 *
 * The CLI knows a third shape, a PREVIEW key, on which `--prod` is ignored down
 * a different path again. No preview key can reach here today — `vercel.json`
 * builds `main` and nothing else (`git.deploymentEnabled`) — so this target is
 * not written for one, and enabling preview builds means revisiting it rather
 * than assuming it already works.
 */
export function resolveSeedTarget(
    target: SeedTarget,
    env: Record<string, string | undefined> = process.env,
    cwd: string = process.cwd()
): SeedTargetPlan {
    if (target === "local") {
        return { cwd: primaryCheckout(), flags: [] };
    }
    const key = DEPLOY_KEY_ENV_VARS.map((name) => env[name]).find(
        (v) => v !== undefined && v !== ""
    );
    if (!key) {
        return {
            error:
                `no deploy key in the environment — set ${DEPLOY_KEY_ENV_VARS[0]} ` +
                `(this target deliberately reads no env file, so there is nothing ` +
                `else it could fall back to)`,
        };
    }
    return { cwd, flags: ["--prod"] };
}

/** The CLI argv for one upsert, deployment-selection flags included. Exported
 *  for the same reason `seedScenarioArgv` is: the flags ARE the contract, and
 *  a missing one fails silently against the wrong deployment. */
export function seedPresetArgv(
    slug: string,
    payload: PresetPayload,
    flags: readonly string[] = []
): string[] {
    return [
        "convex",
        "run",
        ...flags,
        "decks:seedPresetDirect",
        JSON.stringify({ expectedSlug: slug, input: payload }),
    ];
}

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
    payload: PresetPayload,
    target: SeedTarget = "local"
): SeedPresetResult {
    const plan = resolveSeedTarget(target);
    if (plan.error || !plan.cwd) {
        return { error: plan.error ?? "no deployment selected" };
    }
    const res = spawnSync("npx", seedPresetArgv(slug, payload, plan.flags), {
        cwd: plan.cwd,
        encoding: "utf8",
        timeout: 120_000,
    });
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
