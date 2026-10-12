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
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_PATH } from "./branches";
import {
    HEALTH_DIR_REL,
    UI_WALK_CONTEXT,
    githubVerdictStore,
    originRepo,
    readVerdictBackend,
    type GhRunner,
    type Verdict,
    type VerdictBackend,
    type WriteOutcome,
} from "./health-verdict-store";

/** Where the file backend keeps the walk's last verdict. */
export const UI_WALK_FILE = "ui-walk.json";

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
 *  and as gating elsewhere. */
export function readUiWalkGating(
    path = CONFIG_PATH,
    platform: NodeJS.Platform = process.platform
): boolean {
    try {
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
 * Write the walk's verdict under `context=ui-walk`: a commit status on the
 * github backend, `ui-walk.json` under the health dir on the file backend.
 * Neither touches the `health` context or its `RED` / `AMBER` markers.
 * `machine` must be set — the point of the record is which machine walked.
 */
export function writeWalkVerdict(
    root: string,
    verdict: Verdict & { machine: string },
    opts: { backend?: VerdictBackend; run?: GhRunner } = {}
): WriteOutcome {
    const env = process.env.TOLARIA_VERDICT_STORE;
    const backend =
        opts.backend ??
        (env === "file" || env === "github" ? env : readVerdictBackend());
    if (backend === "github") {
        return githubVerdictStore({
            repo: originRepo(root),
            context: UI_WALK_CONTEXT,
            run: opts.run,
        }).write(verdict);
    }
    const dir = join(root, HEALTH_DIR_REL);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, UI_WALK_FILE), JSON.stringify(verdict, null, 2));
    return { written: true };
}
