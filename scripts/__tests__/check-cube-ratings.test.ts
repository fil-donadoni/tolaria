/**
 * `check:cube-ratings` — a hand-written Vintage Cube card owes a Pick Rating
 * (issue #7629, after PR #7579 went `land-failed` on it).
 *
 * The reader and the verdict run on synthetic set-file lines, so each red is
 * reachable on purpose; the definition shapes are the ones the scan has to
 * read on the committed tree (a literal id, a same-file constant, a factory
 * call, a split card), each beside an ability `id:` it must not pick.
 */

import { describe, expect, it } from "vitest";
import { missingCubeRatings, scanSourceCards } from "../check-cube-ratings";

const SET_FILE = `const WAVE_ID = "wave-id";

export const soulScarMage = defineCard(() => ({
    id: "mage-id",
    name: "Soul-Scar Mage",
    activatedAbilities: [
        {
            id: "mage-ability",
        },
    ],
}));

export const parallaxWave = defineCard(() => ({
    id: WAVE_ID,
    name: "Parallax Wave",
}));

export const raugrinTriome = defineCard(() =>
    makeTriome({
        id: "triome-id",
        name: "Raugrin Triome",
    })
);

export const abilityFirst = defineCard(() => ({
    triggeredAbilities: [
        {
            id: "ability-first-trigger",
        },
    ],
    id: "ability-first-id",
    name: "Ability First",
}));

export const lifeDeath = defineCard(() =>
    defineSplitCard({
        id: "split-id",
        halves: [
            {
                name: "Life",
            },
            {
                name: "Death",
            },
        ],
    })
);
`.split("\n");

describe("scanSourceCards — the definition's own id, never an ability's", () => {
    it("reads a literal, a same-file constant, a factory call, an id after an ability and a split card", () => {
        expect(
            scanSourceCards(SET_FILE, "red.cards.ts").map((c) => [c.name, c.id])
        ).toEqual([
            ["Soul-Scar Mage", "mage-id"],
            ["Parallax Wave", "wave-id"],
            ["Raugrin Triome", "triome-id"],
            ["Ability First", "ability-first-id"],
            ["Life // Death", "split-id"],
        ]);
    });
});

describe("missingCubeRatings — reds a cube card with no Pick Rating", () => {
    const cards = scanSourceCards(SET_FILE, "red.cards.ts");

    it("is green when every cube card is rated, and ignores cards off the list", () => {
        expect(
            missingCubeRatings(cards, ["Soul-Scar Mage", "Life // Death"], {
                "mage-id": 3,
                "split-id": 2.5,
            })
        ).toEqual([]);
    });

    it("reds a cube card whose id has no rating, naming its anchor", () => {
        const reds = missingCubeRatings(cards, ["Soul-Scar Mage"], {});
        expect(reds).toHaveLength(1);
        expect(reds[0]).toContain("red.cards.ts:3");
        expect(reds[0]).toContain('"mage-id"');
    });

    it("reds a cube card whose id could not be read (fail-closed)", () => {
        const reds = missingCubeRatings(
            [{ name: "Soul-Scar Mage", id: null, at: "x.ts:1" }],
            ["Soul-Scar Mage"],
            { "mage-id": 3 }
        );
        expect(reds).toEqual([
            "x.ts:1: `Soul-Scar Mage` is on the Vintage Cube list but its definition's `id:` could not be read",
        ]);
    });
});
