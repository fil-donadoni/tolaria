// Regression tripwire for `scripts/backfill-card-index.ts`'s
// `NON_PRINT_SET_TYPES` (issue #1844).
//
// The backfill resolves ADR 0041's "home set = earliest paper printing" by
// sorting a card's prints by release date and taking the first one that is
// neither digital nor a non-print set type. Which set types count is therefore
// the whole rule, and it is a ONE-LINE thing to regress — the script is an
// online tool nothing else exercises, and a wrong answer is silent: it produces
// a lockfile that `check-card-index.ts` then happily validates, because the
// guard only asserts `scryfallId === firstPrintId`, never that `firstPrintId`
// is sane.
//
// That is exactly how Thought Monitor shipped homed under `pmh2`: a prerelease
// promo is the SAME card with a date stamp, Scryfall dates it ~6 weeks before
// its set, so it sorted first for every modern rare. The definition id resolves
// card art, so the board rendered the stamped promo.
//
// The script is a `#!/usr/bin/env bun` one-shot with top-level side effects
// (it reads the lockfile and hits the network on import), so this asserts
// against the SOURCE rather than importing it — the same approach
// `worktree-bootstrap.test.ts` takes to the husky hooks.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SRC = readFileSync(resolve("scripts/backfill-card-index.ts"), "utf-8");

/** The literal members of the `NON_PRINT_SET_TYPES` set, parsed out of the
 *  script source. */
function nonPrintSetTypes(): string[] {
    const m = SRC.match(
        /const NON_PRINT_SET_TYPES = new Set\(\[([\s\S]*?)\]\)/
    );
    expect(
        m,
        "NON_PRINT_SET_TYPES declaration not found — was it renamed or reshaped? " +
            "This test is the only guard on the home-set resolution rule (issue #1844)."
    ).toBeTruthy();
    return [...m![1].matchAll(/"([a-z_]+)"/g)].map((x) => x[1]);
}

describe("backfill-card-index NON_PRINT_SET_TYPES (ADR 0041, issue #1844)", () => {
    const types = nonPrintSetTypes();

    it.each([
        [
            "promo",
            "a prerelease promo is the same card with a date stamp, dated ~6 weeks BEFORE its set — " +
                "it sorts first for every modern rare and renders stamped art (Thought Monitor / pmh2)",
        ],
        [
            "masterpiece",
            "Expeditions / Inventions / Invocations are special-art inserts distributed WITH a set, not a release of the card",
        ],
        ["token", "a token is not a printing of the card"],
        ["memorabilia", "oversized / gold-border, excluded by ADR 0041"],
        ["minigame", "not a playable printing"],
    ])("excludes %s — %s", (type) => {
        expect(types).toContain(type);
    });

    it("does NOT exclude `funny` — an Un-set is a real release, so a card first printed in one legitimately homes there", () => {
        expect(types).not.toContain("funny");
    });

    it("relies on the `digital` flag for digital-only printings rather than listing them", () => {
        // `alchemy` / `treasure_chest` are digital; the filter drops them via
        // `!p.digital`. Listing them here too would be redundant, and their
        // ABSENCE from this set is only safe while that flag check survives.
        expect(SRC).toMatch(/!p\.digital/);
        expect(types).not.toContain("alchemy");
    });

    it("the filter actually consults the set (not just declares it)", () => {
        expect(SRC).toMatch(/NON_PRINT_SET_TYPES\.has\(p\.set_type\)/);
    });
});
