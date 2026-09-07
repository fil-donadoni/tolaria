import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import {
    BASE_BRANCH,
    CONFIG_PATH,
    ORIGIN_BASE,
    RELEASE_BRANCH,
    parseBranchConfig,
    readBranchConfig,
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
