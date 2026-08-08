import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import {
    classifyTestBlocks,
    findIdentityBlocks,
} from "../lib/identity-test-classifier";

/**
 * Identity-only card-test guard (issue #2363).
 *
 * A card-set `it()` block that calls nothing and only re-asserts fields of the
 * card definition is the definition written a second time. It cannot fail for
 * a reason anyone wants to hear about:
 *
 *   - it goes RED on every edit to the definition, correct edits included, and
 *     cannot tell a typo from its fix;
 *   - it stays GREEN when the card is completely inert in the engine;
 *   - it counts as coverage — 103 `describe` blocks in this repo held nothing
 *     but these, and read as tested.
 *
 * 916 such blocks were deleted when this guard landed. It exists so the class
 * cannot regrow: the cost of writing one is a minute, the cost of trusting one
 * is a card that ships broken behind a green suite.
 *
 * ── What to write instead ────────────────────────────────────────────────────
 * Nothing, usually. A DSL card whose `effects[]` reuse already-exercised Ops is
 * covered catalogue-wide and automatically, with no per-card test at all:
 * `convex/cards/__tests__/effectScripts.test.ts` (static validation) plus
 * `effectScriptSmoke.test.ts` (a generated scenario through the real
 * `resolveTopOfStack`). A card whose only addition is `staticAbilities[]` is
 * covered by `mechanicsRegistry.test.ts`, which fails CI when a shipped keyword
 * does not resolve to an `implemented` registry row. Both are stronger than a
 * hand-copied snapshot, because both run the engine.
 *
 * When a card DOES earn a per-card test — `resolve()`, `staticEffects[]`, an
 * `activatedAbilities[]` outcome visible on the board — the testing table in
 * `.claude/rules/gre-development.md` says what it must do: reach the behaviour
 * through a real engine entry point (`resolveTopOfStack`, `resolveActivated`,
 * `getLegalTargets`, `getEffectivePower`, `getManaTapOptionsDetailed`, …), and
 * re-assert through `projectPublicState` when the outcome is client-visible.
 * Any of those is a call, so any of those clears this guard.
 *
 * Scope is deliberately the card-set suites only. Catalogue-level guards
 * elsewhere (`mechanicsRegistry.test.ts`'s duplicate-id checks, the Effect
 * Script JSON-purity round-trips) legitimately assert over static data with no
 * engine call, and they live outside `convex/cards/sets/**`.
 */

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SETS_ROOT = path.join(REPO_ROOT, "convex/cards/sets");

/**
 * Blocks exempted from the guard, keyed `<repo-relative file>:<line>`.
 *
 * Deliberately EMPTY, and it stays that way. An identity block has exactly two
 * honest outcomes: delete it (the catalogue regime already covers the card), or
 * rewrite it as a behaviour test through a real engine entry point. There is no
 * third case that an exemption would serve — an entry here would be a card
 * asserting its own definition and calling that coverage, which is the bug.
 *
 * If one is ever genuinely warranted, the reason goes in the value and the
 * self-check below enforces that the entry still corresponds to a real block.
 */
const ALLOWLIST = new Map<string, string>();

function walk(dir: string, out: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, out);
        else if (entry.name.endsWith(".test.ts") && full.includes("__tests__"))
            out.push(full);
    }
    return out;
}

function cardSetTestFiles(): string[] {
    return walk(SETS_ROOT)
        .map((f) => path.relative(REPO_ROOT, f))
        .sort();
}

function scan(): { key: string; title: string | null; where: string }[] {
    const hits: { key: string; title: string | null; where: string }[] = [];
    for (const rel of cardSetTestFiles()) {
        const source = fs.readFileSync(path.join(REPO_ROOT, rel), "utf-8");
        for (const block of findIdentityBlocks(rel, source)) {
            const key = `${rel}:${block.line}`;
            if (ALLOWLIST.has(key)) continue;
            hits.push({
                key,
                title: block.title,
                where: block.describeChain.join(" > "),
            });
        }
    }
    return hits;
}

describe("identity-only card tests (issue #2363)", () => {
    it("no card-set test block asserts the definition without calling anything", () => {
        const report = scan().map(
            (h) =>
                `${h.key} — "${h.title ?? "<dynamic title>"}" (in ${h.where}) ` +
                `asserts card-definition fields and calls nothing: it re-states ` +
                `the definition instead of testing it. Delete it (a DSL card on ` +
                `exercised Ops is covered by effectScripts.test.ts + ` +
                `effectScriptSmoke.test.ts; a keyword by mechanicsRegistry.test.ts), ` +
                `or rewrite it to reach the behaviour through a real engine entry ` +
                `point per the testing table in .claude/rules/gre-development.md.`
        );
        expect(report, report.join("\n\n")).toEqual([]);
    }, 120_000);

    it("every allowlist entry carries a reason and still names a real identity block", () => {
        for (const [key, reason] of ALLOWLIST) {
            expect(
                reason.trim().length,
                `allowlist entry needs a written justification: ${key}`
            ).toBeGreaterThan(0);
            const [file, lineText] = [
                key.slice(0, key.lastIndexOf(":")),
                key.slice(key.lastIndexOf(":") + 1),
            ];
            const abs = path.join(REPO_ROOT, file);
            expect(
                fs.existsSync(abs),
                `allowlisted file no longer exists: ${file}`
            ).toBe(true);
            const blocks = findIdentityBlocks(
                file,
                fs.readFileSync(abs, "utf-8")
            );
            // A stale entry silently exempts nothing — but it also hides that
            // the exemption was paid off, so it must be removed, not left.
            expect(
                blocks.some((b) => String(b.line) === lineText),
                `allowlisted block is no longer an identity block — drop the entry: ${key}`
            ).toBe(true);
        }
    });

    it("the card-set corpus is actually being scanned", () => {
        // A guard whose sweep silently walks an empty directory passes forever.
        // Two independent facts must hold: files were found, and blocks were
        // parsed out of them.
        const files = cardSetTestFiles();
        expect(files.length).toBeGreaterThan(200);
        const blocks = files.flatMap((rel) =>
            classifyTestBlocks(
                rel,
                fs.readFileSync(path.join(REPO_ROOT, rel), "utf-8")
            )
        );
        expect(blocks.length).toBeGreaterThan(3000);
        expect(blocks.some((b) => b.verdict === "behavioural")).toBe(true);
    }, 120_000);
});
