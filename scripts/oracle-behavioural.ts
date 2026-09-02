#!/usr/bin/env bun
/**
 * `bun run oracle:behavioural` — the behavioural gold report (issue #2703,
 * PRD #2693 user stories 11 / 13 / 23).
 *
 * ── The question this answers ──────────────────────────────────────────────
 *
 * `bun run oracle:report` says how much of the CORPUS the grammar reads.
 * `gold.test.ts` says whether what it read is RIGHT, by diffing the compiled
 * definition against the hand-written one. That diff is decisive for a DSL card
 * and impossible for a `resolve()` card: a closure cannot be compared to an
 * `EffectOp[]`. Those cards come out of the gold harness as `incomparable` —
 * accepted, unproven.
 *
 * They are also exactly the population the `resolve()`→`effects[]` migration
 * (PRD #795) is about. So this script asks the one question left: does the
 * card's OWN test suite — written by a human against the hand-written
 * behaviour, citing the CR — still pass when the registry serves the COMPILED
 * definition instead? A green run is behavioural equality, and a card with
 * behavioural equality is a card whose hand-written closure is a duplicate that
 * can be retired.
 *
 * ── How ────────────────────────────────────────────────────────────────────
 *
 * Two phases, cheap one first:
 *
 *   1. IN-PROCESS. Compile every candidate's own Oracle text (`compiledTwin`,
 *      the same seam `roundTripCard` uses). A card the compiler refuses is
 *      `unparsed` and needs no test run — it is reported with its fragment,
 *      which is the deliverable that ranks the next grammar rule.
 *   2. PER CARD, ONE VITEST RUN. For each accepted candidate, run its own test
 *      file with `TOLARIA_ORACLE_SWAP=<id>`, which makes `vitest.setup.node.ts`
 *      register the twin through `preloadDefinitions` (ADR 0046) before any
 *      test runs. Green → `compiled-green`. Red → `compiled-red`, with the
 *      first failing assertion quoted.
 *
 * A separate process per card, rather than one run with every card swapped at
 * once, is deliberate: a batch run tells you SOMETHING is red without telling
 * you which twin caused it, and per-card is the granularity a retirement
 * decision needs. It costs one node-project import graph per card, which is
 * why this is a report script and not a gate.
 *
 * ── Candidates ─────────────────────────────────────────────────────────────
 *
 * Every catalogue card that (a) carries a closure somewhere in its definition —
 * `resolve`, `resolveSteps`, `effect`, or the `effect: "<name>"` shorthand that
 * `cards/effectRegistry.ts` resolves to one — and (b) has a per-card test file
 * that names it. (b) is not a filter on interestingness: without a test there
 * is no behavioural evidence to gather, and the card is reported as `no-test`
 * so the hole is visible rather than absent.
 *
 * ── What a green does NOT prove ────────────────────────────────────────────
 *
 * Green means the card's own tests pass against the twin. Those tests were
 * written against the HAND-WRITTEN card, so they cover what the hand-written
 * card could do — and a twin that is BROADER than the hand-written card passes
 * them all while behaving differently in cases nobody wrote a test for.
 *
 * Desert Twister is the standing example and the reason this paragraph exists.
 * Its Oracle text is "Destroy target permanent"; the hand-written definition
 * writes `targetRequirement.type: "any"`, which per CR 115.4 is a creature,
 * planeswalker, battle or PLAYER, while the compiler emits the six permanent
 * types (CR 110.4). The twin is therefore both wider (artifacts, enchantments)
 * and narrower (no players) — and its per-card test, which destroys a creature,
 * is green either way. So it is reported green here and is NOT retirable.
 *
 * The check that catches this is structural, and it already exists: a card that
 * differs structurally is a `mismatch` in the gold harness
 * (`KNOWN_DIVERGENCES` in `gold.test.ts`). **Retire on green here AND
 * `equal`/`incomparable` there** — behavioural evidence closes the gap
 * structural comparison cannot reach, it does not overrule it.
 *
 * Usage:
 *   bun scripts/oracle-behavioural.ts              # full report
 *   bun scripts/oracle-behavioural.ts --only "Royal Assassin,Onulet"
 *   bun scripts/oracle-behavioural.ts --compile-only   # phase 1, no test runs
 *   bun scripts/oracle-behavioural.ts --json
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { getAllCards } from "../convex/cards/catalogue";
import { CLOSURE_SENTINEL, compiledTwin } from "../convex/oracle/gold";
import { SWAP_ENV } from "../convex/oracle/behavioural";
import { behaviouralProjection } from "../convex/oracle/gold";
import type { CardDefinition } from "../convex/cards/types";

const ROOT = join(dirname(new URL(import.meta.url).pathname), "..");
const SETS_ROOT = join(ROOT, "convex", "cards", "sets");

export type Verdict =
    | "compiled-green"
    | "compiled-red"
    | "unparsed"
    | "no-oracle-text"
    | "no-test";

interface Row {
    readonly name: string;
    readonly id: string;
    readonly verdict: Verdict;
    /** The fragment the grammar could not consume, or the failing assertion. */
    readonly detail: string;
    readonly testFile?: string;
}

/**
 * Does this definition's behaviour live in a closure?
 *
 * Two shapes, because the catalogue has two. A literal function anywhere in the
 * definition is the obvious one. The other is the pre-ADR-0045 shorthand
 * `effect: "destroy-target"` — a STRING that `cards/effectRegistry.ts` resolves
 * to a closure at resolution time; `behaviouralProjection` renders both as
 * `CLOSURE_SENTINEL`, which is why asking the projection is more reliable than
 * walking the object for `typeof === "function"` (that walk misses every
 * shorthand card, and the shorthand cards are six of the nine the gold harness
 * currently reports as incomparable).
 */
function carriesClosure(definition: CardDefinition): boolean {
    return JSON.stringify(behaviouralProjection(definition)).includes(
        CLOSURE_SENTINEL
    );
}

/**
 * The card's OWN test file, resolved through its own set module.
 *
 * Test files are colour-split beside the set module (ADR 0043):
 * `sets/<code>/<colour>.ts` → `sets/<code>/__tests__/<colour>.test.ts` — the
 * same derivation `scripts/migration-classifier.mjs`'s `hasTest` column makes,
 * so the two reports agree about which cards have evidence.
 *
 * Anchored on the definition's `id` (a uuid, unique in the tree) rather than on
 * its NAME, because a name search across every test file is not safe here: a
 * short name like "Castle" substring-matches unrelated prose, and running the
 * wrong file would report a green that never executed the card's assertions —
 * a vacuous pass, on the strength of which a working closure gets deleted.
 */
function findTestFile(card: CardDefinition): string | undefined {
    const module = moduleDefining(card.id);
    if (module === undefined) return undefined;
    const testFile = join(
        dirname(module),
        "__tests__",
        `${basename(module, ".ts")}.test.ts`
    );
    if (!existsSync(testFile)) return undefined;
    // Present but silent about this card: the file covers its siblings, and
    // running it would prove nothing about this one.
    if (!readFileSync(testFile, "utf8").includes(card.name)) return undefined;
    return testFile.slice(ROOT.length + 1);
}

/** Absolute path of the set module whose source contains `id:` for this card. */
function moduleDefining(cardId: string): string | undefined {
    for (const setDir of listDirs(SETS_ROOT)) {
        for (const entry of readdirSync(setDir)) {
            if (!entry.endsWith(".ts")) continue;
            const path = join(setDir, entry);
            if (readFileSync(path, "utf8").includes(`id: "${cardId}"`)) {
                return path;
            }
        }
    }
    return undefined;
}

function listDirs(root: string): string[] {
    return readdirSync(root)
        .map((e) => join(root, e))
        .filter((p) => statSync(p).isDirectory());
}

/**
 * Run THIS CARD's own tests with the twin served from the registry.
 *
 * Scoped with `-t <card name>` to the card's own `describe` block rather than
 * run over the whole colour file, for a reason that is not convenience. Every
 * set's test file also carries a REGISTRY PARITY block — `expect(getDefinition(
 * def.id)).toBe(def)`, asserting the registry serves the hand-written OBJECT
 * for each of the set's cards. That assertion is false under a swap BY
 * CONSTRUCTION: making the registry serve a different object is the entire
 * mechanism here. Counting it as a behavioural difference reported three of the
 * first seven reds as disagreements about card behaviour when all three were
 * the same assertion about object identity, and the card's own block was green.
 *
 * The cost of scoping is that a card's behaviour asserted OUTSIDE its own
 * `describe` is not exercised. That is the same boundary the issue draws ("the
 * card's existing tests") and the same one `hasPerCardTest` draws.
 *
 * `count` is the anti-vacuity half. A `-t` filter that matches nothing exits 0
 * with zero tests run, which reads exactly like a pass — so the caller must
 * check it, and treats zero as "no evidence", never as green.
 */
function runSwapped(
    id: string,
    name: string,
    testFile: string
): { ok: boolean; count: number; log: string } {
    const result = spawnSync(
        "bunx",
        ["vitest", "run", "--project", "node", testFile, "-t", name],
        {
            cwd: ROOT,
            encoding: "utf8",
            env: { ...process.env, [SWAP_ENV]: id },
        }
    );
    const log = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    const tally = log.match(/Tests\s+(.*)$/m)?.[1] ?? "";
    const ran =
        (Number(tally.match(/(\d+) passed/)?.[1] ?? 0) || 0) +
        (Number(tally.match(/(\d+) failed/)?.[1] ?? 0) || 0);
    return { ok: result.status === 0, count: ran, log };
}

/** The first line that names what went wrong: the swap error if the twin never
 *  reached the registry (which is a harness failure, not a card failure, and
 *  must never be reported as `compiled-red`), else the first assertion. */
function firstFailure(log: string): string {
    const swapError = log.match(/BehaviouralSwapError: .*/)?.[0];
    if (swapError !== undefined) return swapError;
    const assertion = log.match(/^\s*(AssertionError|Error): .*/m)?.[0];
    return (assertion ?? "test run failed with no assertion line").trim();
}

function main(): void {
    const argv = process.argv.slice(2);
    const onlyAt = argv.indexOf("--only");
    const only =
        onlyAt === -1
            ? undefined
            : new Set((argv[onlyAt + 1] ?? "").split(",").map((s) => s.trim()));
    const compileOnly = argv.includes("--compile-only");
    const asJson = argv.includes("--json");

    const candidates = getAllCards()
        .filter((c) => carriesClosure(c))
        .filter((c) => only === undefined || only.has(c.name))
        .sort((a, b) => a.name.localeCompare(b.name));

    const rows: Row[] = [];
    for (const card of candidates) {
        const twin = compiledTwin(card);
        if (!twin.ok) {
            // `no-oracle-text` is a fixture hole, `unparsed` is the grammar
            // backlog — kept apart so the second is never inflated by the first.
            if (twin.kind === "no-oracle-text") continue;
            rows.push({
                name: card.name,
                id: card.id,
                verdict: "unparsed",
                detail: twin.detail,
            });
            continue;
        }
        const testFile = findTestFile(card);
        if (testFile === undefined) {
            rows.push({
                name: card.name,
                id: card.id,
                verdict: "no-test",
                detail: "compiles, but no per-card test file names it — no behavioural evidence available",
            });
            continue;
        }
        if (compileOnly) {
            rows.push({
                name: card.name,
                id: card.id,
                verdict: "compiled-green",
                detail: "--compile-only: not run",
                testFile,
            });
            continue;
        }
        process.stderr.write(`  running ${card.name} … `);
        const { ok, count, log } = runSwapped(card.id, card.name, testFile);
        if (count === 0) {
            // Exit 0 with nothing run is not a pass — see `runSwapped`.
            process.stderr.write("no matching test\n");
            rows.push({
                name: card.name,
                id: card.id,
                verdict: "no-test",
                detail: `"${testFile}" names the card but no test title matched it — no behavioural evidence`,
                testFile,
            });
            continue;
        }
        process.stderr.write(ok ? `green (${count})\n` : `RED (${count})\n`);
        rows.push({
            name: card.name,
            id: card.id,
            verdict: ok ? "compiled-green" : "compiled-red",
            detail: ok ? `${count} assertions` : firstFailure(log),
            testFile,
        });
    }

    if (asJson) {
        process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
        return;
    }
    report(rows, candidates.length);
}

function report(rows: readonly Row[], candidates: number): void {
    const of = (v: Verdict) => rows.filter((r) => r.verdict === v);
    const green = of("compiled-green");
    const red = of("compiled-red");
    const unparsed = of("unparsed");
    const noTest = of("no-test");

    process.stdout.write(
        `\nBehavioural gold — closure cards against their own tests (issue #2703)\n` +
            `${"=".repeat(72)}\n\n` +
            `closure-carrying catalogue cards   ${candidates}\n` +
            `  compiler ACCEPTED                ${green.length + red.length + noTest.length}\n` +
            `    compiled-and-green             ${green.length}   ← retirable\n` +
            `    compiled-but-red               ${red.length}\n` +
            `    accepted, no per-card test     ${noTest.length}\n` +
            `  unparsed                         ${unparsed.length}\n\n`
    );

    if (green.length > 0) {
        process.stdout.write(
            `compiled-and-green — the card's own tests pass against the compiled twin:\n`
        );
        for (const r of green)
            process.stdout.write(`  ${r.name.padEnd(28)} ${r.testFile}\n`);
        process.stdout.write("\n");
    }
    if (red.length > 0) {
        process.stdout.write(
            `compiled-but-red — accepted, but the card's own tests disagree:\n`
        );
        for (const r of red)
            process.stdout.write(`  ${r.name}\n      ${r.detail}\n`);
        process.stdout.write("\n");
    }
    if (noTest.length > 0) {
        process.stdout.write(
            `accepted but untested — nothing to prove behavioural equality with:\n`
        );
        for (const r of noTest) process.stdout.write(`  ${r.name}\n`);
        process.stdout.write("\n");
    }
    process.stdout.write(
        `unparsed: ${unparsed.length} — the grammar backlog. Fragment histogram: bun run oracle:report\n\n`
    );
}

if (import.meta.main) {
    main();
}
