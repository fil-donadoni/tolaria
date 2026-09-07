import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import picomatch from "picomatch";
import vitestConfig from "../../vitest.config";

/**
 * Perf-test boundary guard (issue #3123).
 *
 * A test that asserts on ELAPSED WALL-CLOCK time is not a correctness test: it
 * measures the machine it runs on. In the general suites that machine is
 * running seven other vitest workers plus `tsc` plus eslint, so the assertion
 * reds on correct code — health runs measured load average 21 on 8 cores, and
 * at that contention a second-scale ceiling is noise, not signal.
 *
 * `vitest.config.ts` therefore gives such tests their own project, selected by
 * the `*.perf.test.ts` filename suffix and excluded from `node` / `dom` /
 * `bot-node` / `bot-dom`. `bun run test:perf` runs them on demand, solo; no
 * gate runs them at all.
 *
 * A filename convention rots silently — the same reasoning as
 * `bot-suite-boundary.test.ts`, which this is modelled on. Two guards here:
 *
 *   1. No NON-perf test file asserts on a clock delta.
 *   2. `vitest.config.ts` still excludes `**\/*.perf.test.ts` from the four
 *      general projects, so a config edit cannot silently fold the perf tests
 *      back into the gate while guard 1 keeps passing vacuously.
 *
 * It lives under `scripts/` alongside the repo's other hygiene guards rather
 * than under `convex/`, whose bundler rejects Node builtins like `fs`.
 */

const REPO_ROOT = path.resolve(__dirname, "..", "..");

/** Directories worth walking — everything else holds no test files. */
const SCAN_ROOTS = ["convex", "scripts", "src"];

/** The perf project's include glob. Mirrors `PERF_GLOB` in vitest.config.ts. */
const PERF_GLOB = "**/*.perf.test.ts";

/**
 * Gated tests allowed to read a clock delta, with the reason.
 *
 * Exactly one legitimate shape: the elapsed time is not a PERFORMANCE number
 * but the only observable distinguishing two BEHAVIOURS, and the margin is an
 * order of magnitude, not a few percent. "It returned in under 10s" where the
 * wrong behaviour sleeps for 30s says nothing about how fast the machine is.
 *
 * A new entry is almost always the wrong call: if the assertion would get
 * tighter on a faster machine, it is a measurement — move it to a sibling
 * `*.perf.test.ts`.
 */
const ALLOWLIST = new Map([
    [
        "scripts/__tests__/loop-drain.test.ts",
        "the stop-file must abort a 30s error backoff; elapsed < 10s is the only " +
            "observable that separates 'aborted' from 'slept the whole backoff', and " +
            "the 3x margin is not a speed claim",
    ],
]);

// ─── the detector ───────────────────────────────────────────────────────────
//
// Deliberately simple, and deliberately two-step. A file is flagged when:
//
//   (a) it reads a clock — `Date.now()`, `performance.now()` or
//       `process.hrtime…` — into a named binding, or inline; AND
//   (b) an `expect(…)` whose argument reaches that clock read (directly, or
//       through one of those bindings in a subtraction) is chained to a
//       THRESHOLD matcher: toBeLessThan / toBeLessThanOrEqual /
//       toBeGreaterThan / toBeGreaterThanOrEqual.
//
// Step (b) is what keeps it honest. A clock read alone is fine — tests stamp
// `createdAt: Date.now()` constantly — and a threshold matcher alone is fine.
// It is the pair that encodes "this machine was fast enough today".
//
// `vi.useFakeTimers()` exempts a whole file: under fake timers the clock is a
// deterministic counter the test itself advances, so the assertion measures
// the code's scheduling, not the hardware.

/** A clock READ. The regex is written escaped, so this file never matches its
 *  own detector — the same self-fixture problem bot-suite-boundary.test.ts
 *  solves by building its specimens at runtime. */
const CLOCK_RE =
    /Date\.now\s*\(\s*\)|performance\.now\s*\(\s*\)|process\.hrtime/;

/** `const elapsed = <anything containing a clock read>` — the binding is then
 *  treated as clock-derived wherever a subtraction reaches it. */
const CLOCK_BINDING_RE =
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([^;\n]*)/g;

const FAKE_TIMERS_RE = /useFakeTimers/;

const THRESHOLD_TAIL_RE =
    /^\s*(?:\.\s*(?:not|resolves|rejects)\s*)*\.\s*toBe(?:Less|Greater)Than(?:OrEqual)?\s*\(/;

/** Reads the balanced-paren argument text of a call whose "(" is at `open`. */
function readCallArgs(src: string, open: number): { arg: string; end: number } {
    let depth = 0;
    for (let i = open; i < src.length; i++) {
        const c = src[i];
        if (c === "(") depth++;
        else if (c === ")") {
            depth--;
            if (depth === 0) {
                return { arg: src.slice(open + 1, i), end: i + 1 };
            }
        }
    }
    return { arg: src.slice(open + 1), end: src.length };
}

/** Bindings whose initializer reads a clock, split into
 *  `stamp` (`const t0 = Date.now()`) and `delta` (`const d = Date.now() - t0`).
 *  A stamp only accuses when a SUBTRACTION reaches it; a delta already IS the
 *  elapsed time, so naming it inside `expect(…)` is enough. */
function clockBindings(source: string): {
    stamp: Set<string>;
    delta: Set<string>;
} {
    const stamp = new Set<string>();
    const delta = new Set<string>();
    for (const m of source.matchAll(CLOCK_BINDING_RE)) {
        if (!CLOCK_RE.test(m[2])) continue;
        (m[2].includes("-") ? delta : stamp).add(m[1]);
    }
    return { stamp, delta };
}

/** Does `arg` mention any of `names` as a whole identifier? */
function mentions(arg: string, names: Set<string>): boolean {
    return [...names].some((n) =>
        new RegExp(`\\b${n.replace(/\$/g, "\\$")}\\b`).test(arg)
    );
}

/** Every elapsed-wall-clock assertion in `source`, as `line:snippet`. */
function elapsedAssertions(source: string): { line: number; text: string }[] {
    if (FAKE_TIMERS_RE.test(source)) return [];
    const { stamp, delta } = clockBindings(source);
    const hits: { line: number; text: string }[] = [];

    const EXPECT_RE = /\bexpect\s*\(/g;
    for (const m of source.matchAll(EXPECT_RE)) {
        const open = m.index! + m[0].length - 1;
        const { arg, end } = readCallArgs(source, open);
        if (!THRESHOLD_TAIL_RE.test(source.slice(end, end + 120))) continue;

        const timed =
            CLOCK_RE.test(arg) ||
            mentions(arg, delta) ||
            (arg.includes("-") && mentions(arg, stamp));
        if (!timed) continue;

        hits.push({
            line: source.slice(0, m.index!).split("\n").length,
            text: arg.replace(/\s+/g, " ").trim().slice(0, 80),
        });
    }
    return hits;
}

// ─── the walk ───────────────────────────────────────────────────────────────

function walk(dir: string, out: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name === "dist") continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, out);
        else out.push(full);
    }
    return out;
}

/** Every test file that is NOT a perf test — i.e. every test a gate runs. */
function gatedTestFiles(): string[] {
    const files: string[] = [];
    for (const root of SCAN_ROOTS) {
        const abs = path.join(REPO_ROOT, root);
        if (!fs.existsSync(abs)) continue;
        for (const f of walk(abs)) {
            if (!/\.test\.tsx?$/.test(f)) continue;
            if (/\.perf\.test\.ts$/.test(f)) continue;
            files.push(path.relative(REPO_ROOT, f).split(path.sep).join("/"));
        }
    }
    return files.sort();
}

describe("perf-test boundary — no gated test asserts on elapsed wall-clock time", () => {
    it("finds test files at all (an empty walk would pass vacuously)", () => {
        expect(gatedTestFiles().length).toBeGreaterThan(300);
    });

    it("no *.test.ts outside the perf project times itself", () => {
        const violations: string[] = [];
        for (const file of gatedTestFiles()) {
            if (ALLOWLIST.has(file)) continue;
            const source = fs.readFileSync(path.join(REPO_ROOT, file), "utf-8");
            for (const hit of elapsedAssertions(source)) {
                violations.push(`${file}:${hit.line}  expect(${hit.text})`);
            }
        }

        expect(
            violations,
            `These gated tests assert on elapsed wall-clock time. Under the ` +
                `contention a health run actually sees (load 21 on 8 cores) ` +
                `they red on correct code. Move the timing assertion into a ` +
                `sibling *.perf.test.ts (run by \`bun run test:perf\`, no ` +
                `gate) and keep the machine-independent assertions where they ` +
                `are:\n` +
                violations.join("\n")
        ).toEqual([]);
    });

    it("every allowlisted file exists, is gated, and still needs the entry", () => {
        for (const [file, reason] of ALLOWLIST) {
            expect(
                reason.length,
                `allowlist entry needs a reason: ${file}`
            ).toBeGreaterThan(0);
            const abs = path.join(REPO_ROOT, file);
            expect(
                fs.existsSync(abs),
                `allowlisted file no longer exists: ${file}`
            ).toBe(true);
            expect(
                /\.perf\.test\.ts$/.test(file),
                `allowlisted file is already a perf test — drop the entry: ${file}`
            ).toBe(false);
            // A stale entry silently exempts a file that no longer times itself.
            expect(
                elapsedAssertions(fs.readFileSync(abs, "utf-8")).length,
                `allowlisted file no longer asserts on elapsed time — drop the entry: ${file}`
            ).toBeGreaterThan(0);
        }
    });

    it("flags a real clock delta, ignores a bare clock read, exempts fake timers", () => {
        // Built at runtime, never as literals: this file is itself walked by
        // the scan above, and a literal specimen would make the guard flag its
        // own fixture. Same trick as bot-suite-boundary.test.ts.
        const clock = `${"Date"}.${"now"}()`;
        const lt = `toBe${"Less"}Than`;
        const delta = `const t0 = ${clock};\nexpect(${clock} - t0).${lt}(5);`;
        const named = `const t0 = ${clock};\nconst d = ${clock} - t0;\nexpect(d).${lt}(5);`;
        const bare = `const createdAt = ${clock};\nexpect(createdAt).toBe(createdAt);`;
        const notTiming = `const n = list.length;\nexpect(n).${lt}(5);`;
        const faked = `vi.useFakeTimers();\n${delta}`;

        expect(elapsedAssertions(delta)).toHaveLength(1);
        expect(elapsedAssertions(named)).toHaveLength(1);
        expect(elapsedAssertions(bare)).toEqual([]);
        expect(elapsedAssertions(notTiming)).toEqual([]);
        expect(elapsedAssertions(faked)).toEqual([]);
    });
});

// ─── guard 2: the config still banishes them ────────────────────────────────

interface ProjectConfig {
    test?: { name?: string; include?: string[]; exclude?: string[] };
}

const projects =
    (vitestConfig as { test?: { projects?: ProjectConfig[] } }).test
        ?.projects ?? [];

/** Which projects would select `file`, by their own globs (as vitest does). */
function selectedBy(file: string): string[] {
    return projects
        .filter((p) => {
            const include = p.test?.include ?? [];
            const exclude = p.test?.exclude ?? [];
            return (
                include.some((g) => picomatch(g)(file)) &&
                !exclude.some((g) => picomatch(g)(file))
            );
        })
        .map((p) => p.test?.name ?? "?");
}

describe("perf project — vitest.config.ts keeps perf tests out of every gate", () => {
    it("declares a `perf` project that selects the suffix", () => {
        const perf = projects.find((p) => p.test?.name === "perf");
        expect(perf, "no `perf` project in vitest.config.ts").toBeTruthy();
        expect(perf!.test?.include).toEqual([PERF_GLOB]);
        // Its own exclude must NOT carry the perf glob, or it selects nothing.
        expect(perf!.test?.exclude ?? []).not.toContain(PERF_GLOB);
    });

    it("selects a perf test by the `perf` project and by nothing else", () => {
        // One specimen per scan root: the exclusion has to hold for whichever
        // general project's include glob would otherwise have claimed the file.
        for (const file of [
            "convex/gre/__tests__/autoTap.perf.test.ts",
            "scripts/__tests__/example.perf.test.ts",
            "src/lib/example.perf.test.ts",
        ]) {
            expect(
                selectedBy(file),
                `${file} must run in the perf project only — a general project ` +
                    `claiming it puts a wall-clock assertion back into the gate`
            ).toEqual(["perf"]);
        }
    });

    it("the real moved test exists and is the one the perf project runs", () => {
        expect(
            fs.existsSync(
                path.join(
                    REPO_ROOT,
                    "convex/gre/__tests__/autoTap.perf.test.ts"
                )
            )
        ).toBe(true);
    });
});
