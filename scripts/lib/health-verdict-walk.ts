/**
 * The Linux browser walk as an ADVISORY verdict (issue #5465, ADR 0154 §9).
 *
 * The walk on a Linux health machine writes its own verdict under the
 * `ui-walk` context — never `health` — so a divergence that exists only on
 * Linux can never write RED. Whether the health verdict heeds the walk is the
 * config flag `ui-walk.gating` (default false) on Linux; a MacBook walk is
 * the authority (`release`, ADR 0116) and always gates. The flag is promoted
 * to true by hand once `bun run ui:calibrate` reports zero divergence
 * between a MacBook receipt and a Linux one of the same tip.
 *
 * Node builtins plus the sibling store only: `health-main.ts` imports this.
 */
import { readFileSync } from "node:fs";
import { CONFIG_PATH } from "./branches";
import {
    UI_WALK_CONTEXT,
    githubVerdictStore,
    originRepo,
    type GhRunner,
    type Verdict,
    type WriteOutcome,
} from "./health-verdict-store";

/** `ui-walk.gating` — absent reads `undefined`, a non-boolean is an error. */
export function parseUiWalkGating(
    raw: string,
    source = CONFIG_PATH
): boolean | undefined {
    let doc: unknown;
    try {
        doc = JSON.parse(raw);
    } catch (e) {
        throw new Error(`${source}: not valid JSON — ${(e as Error).message}`);
    }
    const walk = (doc as { "ui-walk"?: unknown })?.["ui-walk"];
    if (walk === undefined) return undefined;
    const v = (walk as { gating?: unknown } | null)?.gating;
    if (v === undefined) return undefined;
    if (typeof v === "boolean") return v;
    throw new Error(
        `${source}: ui-walk.gating must be a boolean, got ${JSON.stringify(v)}`
    );
}

/** Does the walk's result reach the health verdict? Linux: only once the
 *  config promotes it. Any other platform: always — the MacBook walk is the
 *  authority. */
export function uiWalkGating(
    configured: boolean | undefined,
    platform: NodeJS.Platform = process.platform
): boolean {
    return platform !== "linux" || configured === true;
}

/** The effective flag on this machine, fail-closed: a torn config reads as
 *  advisory on Linux (the walk must not red the health verdict by accident)
 *  and as gating elsewhere. `TOLARIA_UI_WALK_GATING` (`true`/`false`)
 *  overrides both for one process — a test (issue #5590). */
export function readUiWalkGating(
    path = CONFIG_PATH,
    platform: NodeJS.Platform = process.platform,
    env: NodeJS.ProcessEnv = process.env
): boolean {
    const pin = env.TOLARIA_UI_WALK_GATING;
    try {
        if (pin !== undefined) {
            if (pin === "true" || pin === "false") return pin === "true";
            throw new Error(
                `TOLARIA_UI_WALK_GATING must be true or false, got ${JSON.stringify(pin)}`
            );
        }
        return uiWalkGating(
            parseUiWalkGating(readFileSync(path, "utf8"), path),
            platform
        );
    } catch (e) {
        console.error(`ui-walk gating: ${(e as Error).message} — advisory`);
        return uiWalkGating(undefined, platform);
    }
}

/**
 * Write the walk's verdict under `context=ui-walk`: a commit status that
 * never touches the `health` context or its RED / AMBER lineage. `machine`
 * must be set — the point of the record is which machine walked.
 */
export function writeWalkVerdict(
    root: string,
    verdict: Verdict & { machine: string },
    opts: { run?: GhRunner } = {}
): WriteOutcome {
    return githubVerdictStore({
        repo: originRepo(root),
        context: UI_WALK_CONTEXT,
        run: opts.run,
    }).write(verdict);
}
