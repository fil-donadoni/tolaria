import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

/**
 * Pins the client-bundle lane (`check:bundle`) into the gate.
 *
 * The failure class it exists for: a diff that type-checks, lints and passes
 * every vitest project, and still leaves the SPA dead in a browser — because
 * nothing in `check:all` / `check:pr` ever ran a real bundler. It has landed on
 * `main` at least twice.
 *
 *  1. #2530 imported `getAllCards` from `@convex/cards` in
 *     `src/lib/ai/bot-view.ts`. `tsconfig` maps that specifier to the barrel
 *     (`convex/cards/index.ts`, which exports it); `vite.config.ts` maps it, by
 *     an exact-regex alias, to the client entry (`convex/cards/client.ts`, which
 *     does not). So `check:ts` was green and `vite build` died with
 *     `[MISSING_EXPORT]` — empty `#root`, every route down.
 *  2. A duplicate-import crash on cold load, caught only by vite's Babel pass.
 *
 * Both are invisible to every lane that is not a bundle. The two resolvers
 * disagreeing by design is not a bug to fix — the alias is what keeps the
 * catalogue out of the client entry — so the only honest check is to run the
 * resolver that ships.
 *
 * Why the lane is `check:all:inner` and not `check:guards`: `check:all` (the
 * before-merge gate the merge-train runs) does NOT reach `check:guards`, only
 * `check:pr` does. Putting the build in `check:all:inner` is what makes BOTH
 * gates run it — which is the whole point, since it is the merge-train's gate
 * that decides whether `main` goes dark.
 *
 * This test is a string check on `package.json` (plus, since #2702 round 2
 * wrapped the raw `vite build` in a size-budget script, one level into that
 * script's own source), deliberately: the guard proper is `vite build`
 * itself, and all that can rot is its wiring.
 */

const ROOT = path.resolve(__dirname, "../..");
const pkg = JSON.parse(
    fs.readFileSync(path.join(ROOT, "package.json"), "utf8")
) as { scripts: Record<string, string> };

/** `check:bundle` may point directly at `vite build`, or delegate to a
 *  `scripts/*.ts` wrapper (issue #2702 round 2: `check-bundle-size.ts` adds a
 *  chunk size budget around the same build) — either way it must still RUN a
 *  real `vite build`, not silently drop it while keeping the script name. */
function resolvesToRealViteBuild(command: string): boolean {
    if (/\bvite build\b/.test(command)) return true;
    const match = command.match(/\bscripts\/([\w.-]+\.ts)\b/);
    if (!match) return false;
    const scriptPath = path.join(ROOT, "scripts", match[1]!);
    if (!fs.existsSync(scriptPath)) return false;
    return /\bvite build\b/.test(fs.readFileSync(scriptPath, "utf8"));
}

describe("client-bundle lane (#2530)", () => {
    it("check:bundle runs a real vite build", () => {
        expect(
            resolvesToRealViteBuild(pkg.scripts["check:bundle"]!),
            "`check:bundle` is the only lane that runs the resolver the browser " +
                "gets. tsc's path mapping and Vite's alias resolve `@convex/cards` " +
                "to DIFFERENT modules on purpose, so no amount of type-checking " +
                "can stand in for it. Its command (or the scripts/*.ts file it " +
                "delegates to) must still invoke `vite build`."
        ).toBe(true);
    });

    it("is reached from check:all:inner, so both check:all and check:pr run it", () => {
        const inner = pkg.scripts["check:all:inner"];
        expect(
            inner,
            "`check:bundle` dropped out of `check:all:inner`. Without it a diff " +
                "that breaks the client bundle — a missing export behind the " +
                "`@convex/cards` alias (#2530), a duplicate import — passes the " +
                "full gate and lands on `main` with the app dead in a browser. " +
                "`check:all` does not reach `check:guards`, so `check:all:inner` " +
                "is the one place that covers the merge-train's gate too."
        ).toContain("check:bundle");

        // Both published gates funnel through that inner script — assert it
        // rather than trusting the comment above.
        expect(pkg.scripts["check:all"]).toContain("check:all:inner");
        expect(pkg.scripts["check:pr"]).toContain("check:all:inner");
    });
});
