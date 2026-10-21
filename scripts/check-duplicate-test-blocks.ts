#!/usr/bin/env bun
/**
 * `check:duplicate-test-blocks` — the duplicate-test-block guard (issue
 * #4620, after issue #4493).
 *
 * A duplicate test block is a project ANTIPATTERN: two `it` / `test` blocks
 * that run the same code against the same fixtures assert one behaviour
 * twice. The copy costs a run on every suite, doubles the edit when the
 * behaviour changes, and — the real damage — reads as independent evidence
 * when it is the same evidence counted twice. Issue #4493 deleted 20 of them
 * (PR #4618), most of them a set-side or caller-side copy of an engine test.
 *
 * The rule: **one behaviour, one block, in the module that owns it.** A card
 * test does not restate the engine test its mechanic already has; a caller
 * does not restate the gate its callee's suite already asserts. When the same
 * shape recurs with different INPUTS, that is a table — `it.each` — not a
 * copy.
 *
 * ── What it flags ────────────────────────────────────────────────────────────
 * Two or more test blocks, anywhere in the repo, with the same FINGERPRINT:
 *
 * 1. the body's token sequence — comments and whitespace do not count;
 * 2. every binding the body reads from OUTSIDE itself, resolved lexically
 *    (enclosing `describe` callbacks, loops, the module): an import is "this
 *    name from this module"; any other declaration contributes its own token
 *    text plus, recursively, the bindings IT reads.
 *
 * A `let` / `var` binding contributes its whole declaring scope instead of
 * its declaration, so a fixture seeded by `beforeEach` counts. A cycle between
 * helpers contributes the name of the helper that closes it.
 *
 * Part 2 is what makes the guard safe to red on. The same text reading a
 * different `describe`-local `setup()` / `gyState()` / `castKickedWith()` is
 * a different test — issue #4493 found 12 such look-alikes and kept them —
 * and here their fingerprints differ because their fixtures' text does.
 *
 * ── What it misses, by construction ──────────────────────────────────────────
 * It compares SYNTAX, so two blocks that reach the same value through
 * differently-spelled bindings (one imports `juggernaut`, the other builds
 * `getDefinition("<uuid>")` locally) are not recognised as one. The guard
 * trades that recall for zero false positives; review catches the rest.
 *
 * ── Where it runs ────────────────────────────────────────────────────────────
 * A cheap guard (`CHEAP_GUARDS` in `check-lane.ts`): `land` runs it on a
 * diff carrying a test file, and batch health runs it whole as its own step.
 * One AST parse per test file, 4.4 s under `bun`. It was a vitest test until
 * issue #6098, paying 17–22 s for the same parse: inside health's `test` step
 * it shared the machine with every `test:app` worker and timed out at 120 s.
 * A script has no `testTimeout` — contention slows it, never reds it. The
 * detector and its fixture tests:
 * `scripts/lib/duplicate-test-blocks.ts`,
 * `scripts/__tests__/duplicate-test-blocks.test.ts`.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import {
    DUPLICATE_ALLOWLIST,
    DUPLICATE_SCAN_ROOTS,
    collectTestBlocks,
    duplicateTestBlockVerdict,
} from "./lib/duplicate-test-blocks";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");

function walk(dir: string, out: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name === "dist") continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, out);
        else out.push(full);
    }
    return out;
}

/** Every test file in the repo — application and bot suites alike. */
function testFiles(): string[] {
    const files: string[] = [];
    for (const root of DUPLICATE_SCAN_ROOTS) {
        const abs = path.join(REPO_ROOT, root);
        if (!fs.existsSync(abs)) continue;
        for (const f of walk(abs)) {
            if (!/\.test\.tsx?$/.test(f)) continue;
            files.push(path.relative(REPO_ROOT, f));
        }
    }
    return files.sort();
}

const files = testFiles();
const blocks = files.flatMap((file) =>
    collectTestBlocks(
        file,
        fs.readFileSync(path.join(REPO_ROOT, file), "utf-8")
    )
);
const verdict = duplicateTestBlockVerdict(blocks, DUPLICATE_ALLOWLIST);
const summary = `check:duplicate-test-blocks: ${files.length} test files, ${blocks.length} blocks`;

if (verdict.ok) {
    console.log(`✓ ${summary}, no duplicates`);
} else {
    console.error(`✗ ${summary}`);
    for (const line of verdict.findings) console.error(line);
    process.exit(1);
}
