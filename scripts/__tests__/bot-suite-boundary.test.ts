import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

/**
 * Bot-suite boundary guard.
 *
 * The test suite is split on two axes (`vitest.config.ts`): runtime environment
 * (node / jsdom) and SUBSYSTEM — application vs bot/AI. Membership in the bot
 * suite is declared by the filename suffix `*.bot.test.ts`, because bot tests
 * live interleaved with application tests in shared directories and no
 * directory glob isolates them.
 *
 * A filename convention rots silently: a new ISMCTS/bot test written as a plain
 * `*.test.ts` lands in the application suite, where it competes for CPU with
 * ~578 other files and its heavy episodes time out — the exact failure this
 * split exists to fix. This guard is the convention's enforcement: an
 * application test file may not import a bot-only module.
 *
 * It is deliberately an APPLICATION test (it runs in `bun run test:app`), so
 * the misfiled-test signal never depends on someone remembering to run the bot
 * suite. It lives under `scripts/` alongside the repo's other hygiene guards
 * (`check-stub-coverage.ts`) rather than under `convex/`, whose bundler
 * rejects Node builtins like `fs`.
 */

const REPO_ROOT = path.resolve(__dirname, "..", "..");

/** Directories worth walking — everything else holds no test files. */
const SCAN_ROOTS = ["convex", "src", "scripts"];

/** Modules that belong to the bot/AI subsystem. A test importing any of these
 *  is a bot test and must carry the `.bot.test.ts` suffix. Paths are
 *  repo-relative and extensionless. */
const BOT_MODULE_PREFIXES = ["convex/gre/ai/", "src/lib/ai/"];
const BOT_MODULE_EXACT = [
    "convex/gre/search",
    "convex/gre/searchBench",
    "convex/gre/evaluate",
    "convex/gre/greedy",
    "convex/gre/determinize",
    "convex/gre/difficulty",
    "convex/gre/shouldThink",
    "convex/gre/moves",
    "src/hooks/useVsAiDriver",
    // The Limited bot subsystem. CLAUDE.md puts "drafter" in `test:bot`, and
    // every test of these two already carries the suffix — but until they were
    // listed here nothing ENFORCED that, and `matchSim.test.ts` shipped into
    // the application suite unnoticed (issue #1642 third review). That is
    // precisely the silent rot this guard exists to prevent.
    "convex/limited/botDrafter",
    "convex/limited/matchSim",
];

/**
 * Application test files allowed to import a bot module, with the reason.
 * Two legitimate shapes, and nothing else:
 *
 *   1. A single `describe` block inside an otherwise pure card-catalogue test
 *      asserts how the bot's move enumeration sees that card. Splitting it
 *      would mean extracting the block into its own file, separating the
 *      assertion from the card it documents — not worth it for a handful of
 *      cheap `enumerateMoves` calls.
 *   2. The test covers an APP feature that happens to be implemented in a bot
 *      module. `evaluate.ts` is the bot's static position evaluator, but its
 *      `evaluateAutoTapPosition` export is also called from `convex/game.ts`
 *      to rank smart-auto-tap plans for HUMAN players — so a test of the
 *      auto-tap solver is an application test, not a bot test.
 *
 * This list is meant to stay short. A NEW entry is almost always the wrong
 * call: name the test `*.bot.test.ts` instead.
 */
const ALLOWLIST = new Map([
    [
        "convex/cards/sets/ice/__tests__/blue.test.ts",
        "one describe block asserts bot move enumeration for Winter's Chill",
    ],
    [
        "convex/cards/sets/nph/__tests__/blue.test.ts",
        "one describe block asserts bot move enumeration for Phyrexian Metamorph",
    ],
    [
        "convex/cards/sets/leg/__tests__/white.test.ts",
        "one describe block asserts bot move enumeration for Moat",
    ],
    [
        "convex/cards/sets/leg/__tests__/green.test.ts",
        "one describe block asserts bot move enumeration for Giant Turtle",
    ],
    [
        "convex/gre/__tests__/autoTap.test.ts",
        "covers the auto-tap solver, whose scorer (evaluateAutoTapPosition) is app-facing — called from convex/game.ts for human players",
    ],
    [
        "convex/__tests__/limitedEvents.test.ts",
        "covers the limitedEvents BACKEND (convex-test mutations/queries: seats, pools, draft timers, standings); it imports chooseBotPick only as the injected ChooseBotPick the production wiring passes, and asserts the mutations' behaviour, not the drafter's",
    ],
    [
        "convex/__tests__/debugLoadBladeScenario.test.ts",
        "covers the Debug-panel loader mutation (convex/game.ts): a label lookup plus a pure state build (resolveBladeLoadState) — reads the blade registry, runs no search",
    ],
]);

function walk(dir: string, out: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name === "dist") continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, out);
        else out.push(full);
    }
    return out;
}

/** Every application test file (i.e. every test that is NOT `*.bot.test.*`). */
function appTestFiles(): string[] {
    const files: string[] = [];
    for (const root of SCAN_ROOTS) {
        const abs = path.join(REPO_ROOT, root);
        if (!fs.existsSync(abs)) continue;
        for (const f of walk(abs)) {
            if (!/\.test\.tsx?$/.test(f)) continue;
            if (/\.bot\.test\.tsx?$/.test(f)) continue;
            files.push(path.relative(REPO_ROOT, f));
        }
    }
    return files.sort();
}

const IMPORT_RE = /(?:from|import)\s*\(?\s*["']([^"']+)["']/g;

/** Type-only imports (`import type { X } from "…"` / `export type … from "…"`)
 *  are ERASED at compile time: the module is never loaded, so it costs the
 *  application worker nothing and cannot drag a heavy bot module into the app
 *  suite's CPU race — the one thing this guard exists to prevent. Stripping
 *  them lets a UI component test type its props off a bot module's exported
 *  type (`PickTerm` from `botDrafter`) without being exiled to the bot suite,
 *  where a jsdom render test does not belong.
 *
 *  Deliberately conservative: only the statement form is stripped. An inline
 *  `import { type X, y }` still loads the module for `y`, and even the
 *  all-inline-type form stays flagged rather than parsed heuristically. */
function stripTypeOnlyImports(source: string): string {
    return source.replace(
        /\b(?:import|export)\s+type\s+[^;]*?from\s*["'][^"']+["']/g,
        ""
    );
}

/** Resolves an import specifier to a repo-relative, extensionless path.
 *  Returns null for a bare package specifier (nothing to check). */
function resolveSpecifier(fromFile: string, spec: string): string | null {
    let rel: string;
    if (spec.startsWith(".")) {
        rel = path.relative(
            REPO_ROOT,
            path.resolve(path.dirname(path.join(REPO_ROOT, fromFile)), spec)
        );
    } else if (spec.startsWith("~/") || spec.startsWith("@/")) {
        rel = path.join("src", spec.slice(2));
    } else if (spec.startsWith("@convex/")) {
        rel = path.join("convex", spec.slice("@convex/".length));
    } else {
        return null;
    }
    return rel.replace(/\.(ts|tsx|js)$/, "");
}

function isBotModule(resolved: string): boolean {
    if (BOT_MODULE_EXACT.includes(resolved)) return true;
    return BOT_MODULE_PREFIXES.some((p) => resolved.startsWith(p));
}

describe("bot-suite boundary (vitest.config.ts subsystem split)", () => {
    it("no application test imports a bot-only module without the .bot.test suffix", () => {
        const violations: string[] = [];

        for (const file of appTestFiles()) {
            if (ALLOWLIST.has(file)) continue;
            const source = stripTypeOnlyImports(
                fs.readFileSync(path.join(REPO_ROOT, file), "utf-8")
            );
            const hits = new Set<string>();
            for (const m of source.matchAll(IMPORT_RE)) {
                const resolved = resolveSpecifier(file, m[1]);
                if (resolved && isBotModule(resolved)) hits.add(resolved);
            }
            if (hits.size > 0) {
                violations.push(`${file} → ${[...hits].sort().join(", ")}`);
            }
        }

        expect(
            violations,
            `These application tests import bot-only modules. Rename each to ` +
                `*.bot.test.ts so it runs in the bot suite (bun run test:bot):\n` +
                violations.join("\n")
        ).toEqual([]);
    });

    it("every allowlisted file exists, is an application test, and still needs the entry", () => {
        for (const [file, reason] of ALLOWLIST) {
            expect(
                reason.length,
                `allowlist entry needs a reason: ${file}`
            ).toBeGreaterThan(0);
            expect(
                fs.existsSync(path.join(REPO_ROOT, file)),
                `allowlisted file no longer exists: ${file}`
            ).toBe(true);
            expect(
                /\.bot\.test\.tsx?$/.test(file),
                `allowlisted file is already a bot test — drop the entry: ${file}`
            ).toBe(false);
            // A stale entry silently exempts a file that no longer needs it.
            const source = fs.readFileSync(path.join(REPO_ROOT, file), "utf-8");
            const stillImportsBotModule = [...source.matchAll(IMPORT_RE)].some(
                (m) => {
                    const resolved = resolveSpecifier(file, m[1]);
                    return resolved !== null && isBotModule(resolved);
                }
            );
            expect(
                stillImportsBotModule,
                `allowlisted file no longer imports any bot module — drop the entry: ${file}`
            ).toBe(true);
        }
    });

    it("skips type-only imports but still flags a value import of the same module", () => {
        // Built at runtime, never written as a literal: this file is itself
        // walked by the scan above, and a literal specifier here would make the
        // guard flag its own fixture.
        const MOD = `@convex/limited/${"botDrafter"}`;
        const typeOnly = `import type { PickTerm } from "${MOD}";`;
        const value = `import { scorePack } from "${MOD}";`;

        const hitsFor = (source: string) =>
            [...stripTypeOnlyImports(source).matchAll(IMPORT_RE)]
                .map((m) =>
                    resolveSpecifier("src/components/x/y.test.tsx", m[1])
                )
                .filter((r): r is string => r !== null && isBotModule(r));

        // erased at compile time — the bot module never loads in the app worker
        expect(hitsFor(typeOnly)).toEqual([]);
        // loads the module at runtime — still a boundary violation
        expect(hitsFor(value)).toEqual(["convex/limited/botDrafter"]);
    });
});
