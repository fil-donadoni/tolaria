import { existsSync } from "node:fs";
import { join } from "node:path";

export interface LaunchdSubstitutions {
    repo: string;
    bun: string;
    nodeBin: string;
    home: string;
}

const PLACEHOLDER = /__[A-Z_]+__/g;

/** The fixed directories every runner unit's PATH starts with, on either OS:
 *  the user's local bin first (where the `claude` CLI installs, issue #6217),
 *  then bun's, then node's. ONE list for the launchd and systemd units so the
 *  two cannot drift. */
export function runnerPathHead(home: string, nodeBin: string): string[] {
    return [`${home}/.local/bin`, `${home}/.bun/bin`, nodeBin];
}

/** The PATH a runner's launchd plist carries (`__RUNNER_PATH__`). */
export function launchdRunnerPath(home: string, nodeBin: string): string {
    return [
        ...runnerPathHead(home, nodeBin),
        "/opt/homebrew/bin",
        "/usr/local/bin",
        "/usr/bin",
        "/bin",
        "/usr/sbin",
        "/sbin",
    ].join(":");
}

/** The `PATH` a rendered plist carries, read back out of its text. */
export function renderedPath(plist: string): string {
    const m = /<key>PATH<\/key>\s*<string>([^<]*)<\/string>/.exec(plist);
    return m?.[1] ?? "";
}

/** Render a launchd plist template. Throws — at install, not at the first
 *  landing — on a placeholder left unsubstituted or a `node` not resolvable on
 *  the rendered PATH (issue #5598: launchd's PATH lacks nvm's node). */
export function renderLaunchdUnit(
    template: string,
    subs: LaunchdSubstitutions,
    exists: (p: string) => boolean = existsSync
): string {
    const out = template
        .replaceAll("__REPO__", () => subs.repo)
        .replaceAll("__BUN__", () => subs.bun)
        .replaceAll("__NODE_BIN__", () => subs.nodeBin)
        .replaceAll("__HOME__", () => subs.home)
        .replaceAll("__RUNNER_PATH__", () =>
            launchdRunnerPath(subs.home, subs.nodeBin)
        );
    const left = out.match(PLACEHOLDER);
    if (left) {
        throw new Error(
            `unsubstituted placeholder(s): ${[...new Set(left)].join(", ")}`
        );
    }
    const dirs = renderedPath(out).split(":").filter(Boolean);
    if (!dirs.some((d) => exists(join(d, "node")))) {
        throw new Error(
            `node not resolvable on the rendered PATH: ${dirs.join(":")}`
        );
    }
    return out;
}
