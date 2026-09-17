import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import {
    BASE_BRANCH,
    CONFIG_PATH,
    ORIGIN_BASE,
    RELEASE_BRANCH,
    parseBranchConfig,
    parseSessionConfig,
    readBranchConfig,
    readSessionConfig,
    sessionCap,
} from "../lib/branches";

/**
 * ADR 0116 — branch names are configuration, not literals.
 *
 * `tolaria.config.json` is the one place the integration (`base`) and
 * production (`release`) branch names live; `scripts/lib/branches.ts` and
 * `.claude/hooks/deny-guard.sh` (via `jq`) read it. Before this, `main` was a
 * literal in 57 places in `land.ts` alone, and moving the integration branch
 * meant finding every one of them by hand. The literal sweep below is what
 * keeps that count at zero: an `origin/<name>` written into a script or hook
 * is the bug class, whatever the name.
 */

const REPO_ROOT = resolve(__dirname, "..", "..");

function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        const p = join(dir, entry);
        if (entry === "node_modules" || entry === "__tests__") continue;
        if (statSync(p).isDirectory()) walk(p, out);
        else out.push(p);
    }
    return out;
}

describe("tolaria.config.json — the branch configuration", () => {
    it("names a base and a release branch, and they differ", () => {
        const cfg = readBranchConfig(CONFIG_PATH);
        expect(cfg.base).toBe(BASE_BRANCH);
        expect(cfg.release).toBe(RELEASE_BRANCH);
        expect(cfg.base).not.toBe(cfg.release);
        expect(ORIGIN_BASE).toBe(`origin/${cfg.base}`);
    });

    it("rejects a config that is not a branch pair", () => {
        expect(() => parseBranchConfig("{", "x.json")).toThrow(
            /not valid JSON/
        );
        expect(() => parseBranchConfig("{}", "x.json")).toThrow(/branches/);
        expect(() =>
            parseBranchConfig('{"branches":{"base":"a"}}', "x.json")
        ).toThrow(/release/);
        expect(() =>
            parseBranchConfig(
                '{"branches":{"base":"a","release":"a"}}',
                "x.json"
            )
        ).toThrow(/must differ/);
        expect(() =>
            parseBranchConfig(
                '{"branches":{"base":"-bad","release":"main"}}',
                "x.json"
            )
        ).toThrow(/git branch name/);
        expect(
            parseBranchConfig(
                '{"branches":{"base":"staging","release":"main"}}',
                "x.json"
            )
        ).toEqual({ base: "staging", release: "main" });
    });
});

describe("tolaria.config.json — the session cap (ADR 0136 §7, issue #3775)", () => {
    it("names a positive integer cap, and the planner reads that one", () => {
        const cfg = readSessionConfig(CONFIG_PATH);
        expect(cfg.cap).toBe(sessionCap());
        expect(Number.isInteger(cfg.cap)).toBe(true);
        expect(cfg.cap).toBeGreaterThanOrEqual(1);
    });

    it("is read lazily — importing a branch name must not require a cap", () => {
        // `health-main.ts` and `bootstrap-worktree.ts` import this module
        // before `node_modules` may exist and never read the cap; validating
        // it at import time would make a config missing `sessions` break the
        // bootstrap instead of the one reader that asked for the number.
        const src = readFileSync(
            join(REPO_ROOT, "scripts/lib/branches.ts"),
            "utf8"
        );
        expect(src).not.toMatch(/^export const SESSIONS/m);
    });

    it("rejects a config that does not name a usable cap", () => {
        expect(() => parseSessionConfig("{", "x.json")).toThrow(
            /not valid JSON/
        );
        expect(() => parseSessionConfig("{}", "x.json")).toThrow(/sessions/);
        expect(() => parseSessionConfig('{"sessions":{}}', "x.json")).toThrow(
            /positive integer/
        );
        // A cap of 0 refuses every pick forever and a fractional one compares
        // as garbage against a claim COUNT — both read like a live cap in the
        // refusal message, which is why they throw here instead.
        expect(() =>
            parseSessionConfig('{"sessions":{"cap":0}}', "x.json")
        ).toThrow(/positive integer/);
        expect(() =>
            parseSessionConfig('{"sessions":{"cap":2.5}}', "x.json")
        ).toThrow(/positive integer/);
        expect(() =>
            parseSessionConfig('{"sessions":{"cap":"3"}}', "x.json")
        ).toThrow(/positive integer/);
        expect(parseSessionConfig('{"sessions":{"cap":4}}', "x.json")).toEqual({
            cap: 4,
        });
    });

    it("the planner reads the cap from here, never from a literal of its own", () => {
        // The failure this pins is the one ADR 0116 pinned for branch names:
        // a number copied into the code diverges from the document that is
        // supposed to own it, and the copy is what actually runs.
        //
        // Scoped to the SESSION cap on purpose — `DEFAULTS.cap` in the same
        // file is the fan-out BATCH size (`--cap 1`), a different number with
        // a different owner, and a sweep that conflated the two would fail on
        // a correct tree.
        const wrapper = readFileSync(
            join(REPO_ROOT, "scripts/queue-plan.ts"),
            "utf8"
        );
        expect(wrapper).toMatch(
            /import\s*\{\s*sessionCap\s*\}\s*from\s*"\.\/lib\/branches"/
        );
        expect(wrapper).toMatch(/sessionCap\(\)/);
        for (const file of [
            "scripts/queue-plan.ts",
            "scripts/lib/queue-plan.ts",
        ]) {
            const src = readFileSync(join(REPO_ROOT, file), "utf8");
            expect(src).not.toMatch(/sessionCap\s*=\s*\(?\s*\)?\s*=?>?\s*\d/);
        }
    });
});

describe("no script or hook names a remote branch by literal (ADR 0116)", () => {
    // `origin/<anything>` is the shape every fetch/rebase/diff/ff site took
    // before the config existed. Prose in comments is allowed to say
    // `origin/main` when it is describing history; code is not — so the
    // sweep strips line comments before matching and keeps the rest.
    const LITERAL = /origin\/(main|master|staging)\b/;
    const files = [
        ...walk(join(REPO_ROOT, "scripts")).filter(
            (p) => p.endsWith(".ts") || p.endsWith(".mjs") || p.endsWith(".sh")
        ),
        ...walk(join(REPO_ROOT, ".claude", "hooks")).filter((p) =>
            p.endsWith(".sh")
        ),
    ].filter((p) => !p.endsWith(join("lib", "branches.ts")));

    it("sweeps a non-empty set", () => {
        expect(files.length).toBeGreaterThan(10);
    });

    it("finds no `origin/<branch>` literal in code", () => {
        const offenders: string[] = [];
        for (const file of files) {
            const lines = readFileSync(file, "utf8").split("\n");
            lines.forEach((line, i) => {
                const code = line
                    .replace(/^\s*(\/\/|#|\*|\/\*\*?).*$/, "")
                    .replace(/\s\/\/.*$/, "");
                if (LITERAL.test(code)) {
                    offenders.push(
                        `${relative(REPO_ROOT, file)}:${i + 1}: ${line.trim()}`
                    );
                }
            });
        }
        expect(
            offenders,
            `branch literals in code — read them from scripts/lib/branches.ts (tolaria.config.json):\n${offenders.join("\n")}`
        ).toEqual([]);
    });
});
