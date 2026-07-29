import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

/**
 * Bot fast-lane deny-list guard (issue #1912).
 *
 * `check:pr` runs the bot suite through the `TOLARIA_BOT_FAST=1` lane, which
 * excludes `HEAVY_BOT_GLOB` in `vitest.config.ts`. The lane exists because the
 * catalogue-wide GUARDS (aiEffectsGuard, pickRatings, opValuerCoverage, the
 * moves/cardProfile censuses) all live in the bot suite, which the light gate
 * never ran — three consecutive card PRs reached a green `check:pr` while red
 * in the bot suite.
 *
 * A deny-list was chosen over an allow-list of guard files precisely so it
 * cannot silently stop covering a NEWLY added guard. But it has its own rot
 * mode, in the opposite direction: if a deny-listed file is renamed or deleted,
 * the pattern matches nothing, and the failure is silent in the direction that
 * matters least (the lane just gets slow again) — until someone assumes the
 * deny-list is doing something it isn't.
 *
 * This guard pins both ends:
 *   1. every deny-list pattern still matches at least one real file;
 *   2. the deny-list stays SMALL — it is a budget exception for genuinely
 *      expensive files, not a place to park an inconvenient guard.
 *
 * Deliberately an APPLICATION test: it must run in `bun run test:app`, so the
 * signal never depends on the very lane it describes.
 */

const ROOT = path.resolve(__dirname, "../..");

/** Must mirror `HEAVY_BOT_GLOB` in `vitest.config.ts`. */
const HEAVY_BOT_BASENAMES = ["ai-diagnosis.bot.test.ts"];

/** A deny-list bigger than this is a smell, not a budget exception. */
const MAX_DENY_LIST = 4;

function collectBotTests(dir: string, out: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name.startsWith(".")) {
            continue;
        }
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            collectBotTests(full, out);
        } else if (entry.name.endsWith(".bot.test.ts")) {
            out.push(path.relative(ROOT, full));
        }
    }
    return out;
}

describe("bot fast lane — deny-list stays honest (issue #1912)", () => {
    const botTests = [
        ...collectBotTests(path.join(ROOT, "convex")),
        ...collectBotTests(path.join(ROOT, "src")),
        ...collectBotTests(path.join(ROOT, "scripts")),
    ];

    it("finds bot tests at all (sanity — the collector is not silently empty)", () => {
        expect(botTests.length).toBeGreaterThan(20);
    });

    it.each(HEAVY_BOT_BASENAMES)(
        "deny-listed file %s still exists",
        (basename) => {
            const matches = botTests.filter(
                (f) => path.basename(f) === basename
            );
            expect(
                matches,
                `HEAVY_BOT_GLOB in vitest.config.ts excludes "${basename}", but no such bot test exists. ` +
                    `It was renamed or deleted — update the glob (and this list), or the fast lane is ` +
                    `excluding nothing and check:pr silently got ~3x slower.`
            ).toHaveLength(1);
        }
    );

    it("keeps the deny-list small — it is a cost exception, not a hiding place", () => {
        expect(
            HEAVY_BOT_BASENAMES.length,
            `The bot fast lane defers ${HEAVY_BOT_BASENAMES.length} files from check:pr. Past ${MAX_DENY_LIST} ` +
                `the lane stops being "the bot suite minus a couple of slow episodes" and becomes a ` +
                `hand-curated subset — the allow-list anti-pattern this deny-list exists to avoid. ` +
                `If a file is slow enough to defer, prefer making it faster.`
        ).toBeLessThanOrEqual(MAX_DENY_LIST);
    });

    it("mirrors vitest.config.ts — the two lists have not drifted apart", () => {
        const config = fs.readFileSync(
            path.join(ROOT, "vitest.config.ts"),
            "utf8"
        );
        const block = config.match(
            /const HEAVY_BOT_GLOB\s*=\s*\[([\s\S]*?)\]/
        )?.[1];
        expect(
            block,
            "HEAVY_BOT_GLOB not found in vitest.config.ts"
        ).toBeTruthy();
        const inConfig = [...block!.matchAll(/"\*\*\/([^"]+)"/g)]
            .map((m) => m[1])
            .sort();
        expect(inConfig).toEqual([...HEAVY_BOT_BASENAMES].sort());
    });
});
