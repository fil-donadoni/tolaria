/**
 * Does a diff to the router or the shell's route table only REGISTER a new
 * static route (issue #8409, owner ruling)?
 *
 * WHY. `src/router.tsx` and `src/lib/shellChrome.ts` are global to `check:ui`:
 * every route renders through them, so a diff to either forces the full lane
 * (77 surfaces × 5 viewports). A new screen must add one row to each, so every
 * new screen paid the full lane to prove one screen. A new row with a path no
 * `$param` in it matches only that pathname, so it can move no other surface;
 * the screen itself is placed by its own route module, which forces `full` if
 * no surface declares it.
 *
 * FAIL-CLOSED, by reconstruction. Removing the recognised new blocks from the
 * new source must give back the OLD source byte for byte, so an edited row, a
 * dynamic path, an extra key or a change elsewhere in the file all answer
 * `false`, and the caller walks the full lane. `isAdditive*` are pure;
 * `additiveRegistrationsSinceBase` reads the two sources from git and disk.
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { ORIGIN_BASE } from "./branches.ts";

export const ROUTER_FILE = "src/router.tsx";
export const SHELL_CHROME_FILE = "src/lib/shellChrome.ts";

/** A literal path: nothing in it can match a second pathname. */
const STATIC_PATH = /^\/[a-z0-9/-]*$/;

const SHELL_RULE =
    /^ {4}\{\n {8}pattern: "([^"\n]+)",\n {8}mode: "browse",\n {8}why: "[^"\n]*",\n {4}\},\n/gm;

const ROUTE_BLOCK =
    /(?:^\/\/.*\n)*^const (\w+Route) = createRoute\(\{\n {4}getParentRoute: \(\) => rootRoute,\n {4}path: "([^"\n]+)",\n {4}component: lazyRouteComponent\(\s*\(\) => import\("\.\/routes\/[\w-]+\.route"\),?\s*\),\n\}\);\n\n/gm;

/** Only new `SHELL_ROUTE_RULES` rows of a static path, `browse`, with no other
 *  key (a return target or chrome flag can reach beyond the row's own page). */
export function isAdditiveShellRule(
    oldSource: string,
    newSource: string
): boolean {
    const open = newSource.indexOf("export const SHELL_ROUTE_RULES");
    const close = newSource.indexOf("\n]", open);
    if (open === -1 || close === -1) return false;
    let added = 0;
    const stripped = newSource.replace(
        SHELL_RULE,
        (row: string, pattern: string, at: number) => {
            const isNew =
                at > open &&
                at < close &&
                STATIC_PATH.test(pattern) &&
                !oldSource.includes(`pattern: "${pattern}"`);
            if (!isNew) return row;
            added += 1;
            return "";
        }
    );
    return added > 0 && stripped === oldSource;
}

/** Only new top-level routes of a static path under the root, lazily loaded,
 *  each with its one line in the route tree. */
export function isAdditiveRouteRegistration(
    oldSource: string,
    newSource: string
): boolean {
    const names: string[] = [];
    let stripped = newSource.replace(
        ROUTE_BLOCK,
        (block: string, name: string, routePath: string) => {
            const isNew =
                STATIC_PATH.test(routePath) &&
                !oldSource.includes(`const ${name} =`) &&
                !oldSource.includes(`path: "${routePath}"`);
            if (!isNew) return block;
            names.push(name);
            return "";
        }
    );
    for (const name of names) {
        const treeLine = new RegExp(`^ +${name},\\n`, "m");
        if (!treeLine.test(stripped)) return false;
        stripped = stripped.replace(treeLine, "");
    }
    return names.length > 0 && stripped === oldSource;
}

/** The changed paths whose diff against the merge-base only registers a new
 *  static route. Anything that cannot be read stays out of the set: the scope
 *  walks MORE, never less. */
export function additiveRegistrationsSinceBase(
    changed: readonly string[],
    root: string
): Set<string> {
    const additive = new Set<string>();
    const rules = [
        [ROUTER_FILE, isAdditiveRouteRegistration],
        [SHELL_CHROME_FILE, isAdditiveShellRule],
    ] as const;
    for (const [file, rule] of rules) {
        if (!changed.includes(file)) continue;
        try {
            const git = (args: string[]) =>
                execFileSync("git", args, {
                    cwd: root,
                    encoding: "utf8",
                    maxBuffer: 64 * 1024 * 1024,
                    stdio: ["ignore", "pipe", "ignore"],
                });
            const mergeBase = git(["merge-base", ORIGIN_BASE, "HEAD"]).trim();
            const before = git(["show", `${mergeBase}:${file}`]);
            const after = fs.readFileSync(path.join(root, file), "utf8");
            if (rule(before, after)) additive.add(file);
        } catch {
            // Unreadable: the path stays global.
        }
    }
    return additive;
}
