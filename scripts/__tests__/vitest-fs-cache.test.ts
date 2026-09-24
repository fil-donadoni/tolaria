import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
    VITEST_FS_CACHE_ENV,
    fsModuleCacheOptions,
    gateChildEnv,
} from "../lib/vitest-fs-cache";
import { HEALTH_SCRIPTS } from "../lib/health-step";

/**
 * vitest's filesystem module cache: on for a bare targeted run, off in every
 * gate (issue #4614). What must hold: the default is on, an explicit `0`
 * turns it off, and every command `scripts/gate.ts` fronts sees `0` — and
 * every gate script reaches `scripts/gate.ts`.
 */
const ROOT = resolve(__dirname, "../..");

describe("fsModuleCacheOptions — the switch", () => {
    it("is on by default, at vitest's default location inside the worktree", () => {
        const on = { experimental: { fsModuleCache: true } };
        expect(fsModuleCacheOptions({})).toEqual(on);
        expect(fsModuleCacheOptions({ [VITEST_FS_CACHE_ENV]: "" })).toEqual(on);
    });

    it("is off on an explicit 0 — no `experimental` key at all", () => {
        expect(fsModuleCacheOptions({ [VITEST_FS_CACHE_ENV]: "0" })).toEqual(
            {}
        );
    });

    it("keeps the cache at the directory the variable names", () => {
        expect(
            fsModuleCacheOptions({ [VITEST_FS_CACHE_ENV]: "/cache/dir" })
        ).toEqual({
            experimental: {
                fsModuleCache: true,
                fsModuleCachePath: "/cache/dir",
            },
        });
    });
});

describe("gateChildEnv — what scripts/gate.ts hands its command", () => {
    for (const heavy of [true, false]) {
        const tier = heavy ? "heavy/yield" : "light";
        it(`turns the cache off on the ${tier} tier, whatever the caller exported`, () => {
            for (const caller of [undefined, "", "/some/dir"]) {
                const env = gateChildEnv(
                    { [VITEST_FS_CACHE_ENV]: caller },
                    heavy,
                    4
                );
                expect(fsModuleCacheOptions(env)).toEqual({});
            }
        });
    }

    it("keeps the worker cap and the held flag it always exported", () => {
        expect(gateChildEnv({}, true, 4)).toMatchObject({
            TOLARIA_GATE_HELD: "1",
            TOLARIA_VITEST_WORKERS: "4",
        });
        expect(
            gateChildEnv({ TOLARIA_VITEST_WORKERS: "7" }, true, 4)
        ).toMatchObject({ TOLARIA_VITEST_WORKERS: "7" });
        expect(gateChildEnv({}, false, 4).TOLARIA_VITEST_WORKERS).toBe(
            undefined
        );
    });

    it("is the environment the real gate process exports", () => {
        const lockRoot = mkdtempSync(join(tmpdir(), "tolaria-gate-env-"));
        try {
            const r = spawnSync(
                "bun",
                [
                    join(ROOT, "scripts", "gate.ts"),
                    "light",
                    `printf %s "$${VITEST_FS_CACHE_ENV}"`,
                ],
                {
                    encoding: "utf8",
                    timeout: 30_000,
                    env: {
                        ...process.env,
                        TOLARIA_GATE_LOCK_ROOT: lockRoot,
                        [VITEST_FS_CACHE_ENV]: "/caller/dir",
                    },
                }
            );
            expect(r.status, r.stderr).toBe(0);
            expect(r.stdout).toBe("0");
        } finally {
            rmSync(lockRoot, { recursive: true, force: true });
        }
    }, 30_000);
});

describe("every gate reaches scripts/gate.ts", () => {
    const scripts: Record<string, string> = JSON.parse(
        readFileSync(join(ROOT, "package.json"), "utf8")
    ).scripts;

    // Direct: the script IS a gate.ts invocation.
    for (const name of [
        "check:all",
        "check:pr",
        "test",
        "test:app",
        "test:bot",
        "test:blade",
    ]) {
        it(`${name} runs under scripts/gate.ts`, () => {
            expect(scripts[name]).toMatch(
                /^bun scripts\/gate\.ts (heavy|yield|light) /
            );
        });
    }

    // Indirect: a runner that spawns gate.ts for every check it runs.
    for (const [name, file] of [
        ["check:lane", "scripts/check-lane.ts"],
        ["land", "scripts/land.ts"],
    ] as const) {
        it(`${name} spawns its checks through scripts/gate.ts`, () => {
            expect(scripts[name]).toBe(`bun ${file}`);
            expect(readFileSync(join(ROOT, file), "utf8")).toContain(
                'const GATE = resolve(__dirname, "gate.ts");'
            );
        });
    }

    // `health` (and `release`, which runs it) steps through package scripts;
    // the two that run vitest are the direct gate scripts above.
    it("health's vitest steps are gate scripts", () => {
        expect(HEALTH_SCRIPTS).toEqual(
            expect.arrayContaining(["check:all", "test"])
        );
        for (const step of ["check:all", "test"])
            expect(scripts[step]).toMatch(/^bun scripts\/gate\.ts /);
    });
});
