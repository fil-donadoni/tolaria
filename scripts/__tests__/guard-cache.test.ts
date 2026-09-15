import { spawnSync } from "node:child_process";
import {
    appendFileSync,
    mkdirSync,
    mkdtempSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
    decide,
    GUARD_CACHE_BYPASS_ENV,
    recordPass,
    type GuardInputs,
} from "../lib/guard-cache";
import { healthGateEnv } from "../lib/health-step";

/**
 * The content-hash cache for the pure drift guards (issue #3646). A cache that
 * skips when it should run is a guard that is not there, so every case here is
 * a way the skip could be wrong: a changed input, a red verdict, the release
 * bypass — and the wiring, since a guard that never consults the cache saves
 * nothing and a guard that consults it without recording never skips.
 */

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const LIB = join(REPO, "scripts", "lib", "guard-cache.ts");

const INPUTS: GuardInputs = { guard: "fixture", globs: ["src/**"] };

let root: string;
let cacheDir: string;

function sh(args: string[]) {
    const r = spawnSync("git", args, { cwd: root, encoding: "utf8" });
    if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
}

beforeEach(() => {
    const base = mkdtempSync(join(tmpdir(), "guard-cache-"));
    root = join(base, "repo");
    cacheDir = join(base, "cache");
    mkdirSync(join(root, "src"), { recursive: true });
    mkdirSync(join(root, "docs"), { recursive: true });
    writeFileSync(join(root, "src", "a.ts"), "export const a = 1;\n");
    writeFileSync(join(root, "docs", "note.md"), "outside the inputs\n");
    sh(["init", "-q"]);
    sh(["add", "."]);
    sh([
        "-c",
        "user.email=t@t",
        "-c",
        "user.name=t",
        "commit",
        "-q",
        "-m",
        "fixture",
    ]);
});

afterEach(() => {
    rmSync(join(root, ".."), { recursive: true, force: true });
});

const decideHere = (env: NodeJS.ProcessEnv = {}) =>
    decide(INPUTS, { root, cacheDir, env });

/** A green first decision, recorded — the state every skip case starts from. */
function recordGreen(): string {
    const first = decideHere();
    expect(first).toMatchObject({ kind: "run", reason: "miss" });
    recordPass(cacheDir, INPUTS.guard, first.hash!);
    return first.hash!;
}

describe("guard cache — when it skips (issue #3646)", () => {
    it("same inputs → skipped with the recorded verdict", () => {
        const hash = recordGreen();
        expect(decideHere()).toEqual({ kind: "cached", hash });
    });

    it("a change outside the declared inputs stays cached", () => {
        const hash = recordGreen();
        appendFileSync(join(root, "docs", "note.md"), "edited\n");
        expect(decideHere()).toEqual({ kind: "cached", hash });
    });
});

describe("guard cache — when it runs (issue #3646)", () => {
    it("one uncommitted change to an input file → runs", () => {
        const hash = recordGreen();
        appendFileSync(join(root, "src", "a.ts"), "export const b = 2;\n");
        const after = decideHere();
        expect(after).toMatchObject({ kind: "run", reason: "miss" });
        expect(after.hash).not.toBe(hash);
    });

    it("an untracked file inside the inputs → runs", () => {
        recordGreen();
        writeFileSync(join(root, "src", "new.ts"), "export {};\n");
        expect(decideHere()).toMatchObject({ kind: "run", reason: "miss" });
    });

    it("a deleted input file → runs", () => {
        recordGreen();
        rmSync(join(root, "src", "a.ts"));
        expect(decideHere()).toMatchObject({ kind: "run", reason: "miss" });
    });

    it("a changed non-file key → runs", () => {
        const hash = recordGreen();
        const moved = decide(
            { ...INPUTS, keys: ["merge-base:other"] },
            { root, cacheDir, env: {} }
        );
        expect(moved).toMatchObject({ kind: "run", reason: "miss" });
        expect(moved.hash).not.toBe(hash);
    });

    it("release runs regardless: the health gate's env bypasses a recorded PASS", () => {
        recordGreen();
        const env = healthGateEnv({ TOLARIA_GATE_HELD: "1" });
        expect(env[GUARD_CACHE_BYPASS_ENV]).toBe("off");
        expect(decide(INPUTS, { root, cacheDir, env })).toMatchObject({
            kind: "run",
            reason: "bypassed",
        });
    });

    it("outside a git work tree → runs, never skips", () => {
        const loose = mkdtempSync(join(tmpdir(), "guard-cache-loose-"));
        try {
            expect(
                decide(INPUTS, { root: loose, cacheDir, env: {} })
            ).toMatchObject({ kind: "run", hash: null, reason: "unhashable" });
        } finally {
            rmSync(loose, { recursive: true, force: true });
        }
    });
});

function runBun(script: string, cwd: string, env: NodeJS.ProcessEnv = {}) {
    const r = spawnSync("bun", [script], {
        cwd,
        encoding: "utf8",
        env: {
            ...process.env,
            [GUARD_CACHE_BYPASS_ENV]: "",
            CLAUDE_PROJECT_DIR: join(cacheDir, ".."),
            ...env,
        },
    });
    return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

describe("enterGuardCache — the CLI seam records only a green exit (issue #3646)", () => {
    beforeEach(() => {
        mkdirSync(join(root, "tools"), { recursive: true });
        writeFileSync(
            join(root, "tools", "guard.ts"),
            `import { enterGuardCache } from ${JSON.stringify(LIB)};\n` +
                `enterGuardCache({ guard: "fixture", globs: ["src/**"] });\n` +
                `process.exit(Number(process.env.FIXTURE_EXIT));\n`
        );
    });

    it("a red run is never cached; the green run after it is", () => {
        const script = join(root, "tools", "guard.ts");
        const red = runBun(script, root, { FIXTURE_EXIT: "1" });
        expect(red.status).toBe(1);
        expect(red.out).toMatch(/▶ fixture: ran \([0-9a-f]{12}\)/);

        const again = runBun(script, root, { FIXTURE_EXIT: "1" });
        expect(again.out).toMatch(/▶ fixture: ran \(/);

        const green = runBun(script, root, { FIXTURE_EXIT: "0" });
        expect(green.out).toMatch(/▶ fixture: ran \(/);

        const skipped = runBun(script, root, { FIXTURE_EXIT: "1" });
        expect(skipped.status).toBe(0);
        expect(skipped.out).toMatch(/✓ fixture: cached PASS \([0-9a-f]{12}\)/);
    });
});

describe("each pure drift guard consults the cache (issue #3646)", () => {
    const GUARDS = [
        ["check:index", "scripts/check-card-index.ts"],
        ["check:stubs", "scripts/check-stub-coverage.ts"],
        ["check:oracle", "scripts/check-oracle-lockfile.ts"],
        ["cr:lint", "scripts/check-cr-citations.ts"],
    ] as const;

    it.each(GUARDS)(
        "%s prints ran/cached with the hash, and skips only after a green run",
        (guard, script) => {
            const first = runBun(script, REPO);
            const label = guard.replace(":", "\\:");
            expect(first.out).toMatch(
                new RegExp(`▶ ${label}: ran \\([0-9a-f]{12}\\)`)
            );
            const second = runBun(script, REPO);
            expect(second.out).toMatch(
                first.status === 0
                    ? new RegExp(`✓ ${label}: cached PASS \\([0-9a-f]{12}\\)`)
                    : new RegExp(`▶ ${label}: ran \\(`)
            );
        },
        60_000
    );
});
