import { spawnSync } from "node:child_process";
import {
    appendFileSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readdirSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
    decide,
    defaultCacheDir,
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
    mkdirSync(join(root, "other"), { recursive: true });
    writeFileSync(join(root, "src", "a.ts"), "export const a = 1;\n");
    writeFileSync(join(root, "other", "note.txt"), "outside the inputs\n");
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
    rmSync(join(root, ".."), {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 100,
    });
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
        appendFileSync(join(root, "other", "note.txt"), "edited\n");
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
            rmSync(loose, {
                recursive: true,
                force: true,
                maxRetries: 10,
                retryDelay: 100,
            });
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

/** The decision line a guard printed: what it chose, and the short hash. */
function decisionIn(out: string, guard: string) {
    const label = guard.replace(":", "\\:");
    const m = new RegExp(
        `^(?:▶ ${label}: (ran)|✓ ${label}: (cached) PASS) \\(([0-9a-f]{12})\\)`,
        "m"
    ).exec(out);
    expect(m, `no ${guard} decision line in:\n${out}`).not.toBeNull();
    return { kind: m![1] ?? m![2], short: m![3] };
}

describe("each pure drift guard consults the cache (issue #3646)", () => {
    const GUARDS = [
        ["check:index", "scripts/check-card-index.ts"],
        ["check:stubs", "scripts/check-stub-coverage.ts"],
        ["check:oracle", "scripts/check-oracle-lockfile.ts"],
        ["cr:lint", "scripts/check-cr-citations.ts"],
    ] as const;

    // These run against the live checkout, which other test workers and
    // processes write to: an input can change between the two runs (issue
    // #6349). So every expectation is keyed on the hash each run PRINTS —
    // a skip is owed exactly when the second run hashed what the first
    // recorded green — never on the tree holding still.
    it.each(GUARDS)(
        "%s prints ran/cached with the hash, and skips only after a green run",
        (guard, script) => {
            const records = join(
                defaultCacheDir({ CLAUDE_PROJECT_DIR: join(cacheDir, "..") }),
                guard.replace(/[^A-Za-z0-9_.-]/g, "_")
            );
            const recordedAs = (short: string) =>
                existsSync(records)
                    ? readdirSync(records).filter((h) => h.startsWith(short))
                    : [];

            const first = runBun(script, REPO);
            const ran = decisionIn(first.out, guard);
            expect(ran.kind).toBe("ran");
            expect(recordedAs(ran.short)).toHaveLength(
                first.status === 0 ? 1 : 0
            );

            const second = decisionIn(runBun(script, REPO).out, guard);
            expect(second.kind).toBe(
                first.status === 0 && second.short === ran.short
                    ? "cached"
                    : "ran"
            );
        },
        60_000
    );
});
