// Issue #5152 — the creature keyword bonus table prices every registry-
// implemented keyword that is a creature characteristic (keyword abilities).
import { describe, expect, it } from "vitest";
import { MECHANICS_REGISTRY } from "../../cards/mechanicsRegistry";
import { creatureValueRaw, keywordBonusFor } from "../creatureBody";

/** A concrete declared string per registry row whose `staticAbilities` form is
 *  parametrized — the table prices the family, the census feeds it an example. */
const EXAMPLE_STRING: Record<string, string> = {
    shroud: "shroud",
    landwalk: "swampwalk",
    protection: "protection from red",
    rampage: "rampage 2",
};

/** Implemented keyword rows that are NOT a creature characteristic the body
 *  prices, listed by name so a newly implemented keyword forces a decision.
 *  Cast-time / cost keywords are priced by the cast route and the script;
 *  the rest are not a standing creature quality. */
const NOT_A_BODY_KEYWORD = new Set([
    // priced once, by their expanded trigger script (a row here would count
    // twice): see the note in creatureBody.ts
    "exalted",
    "prowess",
    "battle-cry",
    "annihilator",
    "ward",
    "fading",
    // cast-time / cost / zone-route keywords
    "flash",
    "cycling",
    "typecycling",
    "kicker",
    "multikicker",
    "buyback",
    "flashback",
    "madness",
    "morph",
    "storm",
    "affinity",
    "sunburst",
    "splice",
    "convoke",
    "replicate",
    "delve",
    "evoke",
    "retrace",
    "cascade",
    "rebound",
    "overload",
    "bestow",
    "dash",
    "improvise",
    "eternalize",
    "escape",
    "companion",
    "squad",
    "offspring",
    "warp",
    "ninjutsu",
    "ravenous",
    "hideaway",
    "level-up",
    "job-select",
    "cumulative-upkeep",
    // attach / vehicle / ETB-shaped, not a body quality
    "enchant",
    "equip",
    "reconfigure",
    "crew",
    "living-weapon",
    "for-mirrodin",
    "backup",
    "boast",
    "ascend",
    "firebending",
    "chapter-ability",
    "class-level-bar",
]);

/** Table keys with no registry row of their own (engine-internal spellings). */
const EXTRA_PRICED = ["does-not-untap", "may-choose-not-to-untap"];

describe("creature keyword bonus table (issue #5152)", () => {
    const bodyRows = MECHANICS_REGISTRY.filter(
        (r) =>
            r.kind === "keyword-ability" &&
            r.status === "implemented" &&
            !NOT_A_BODY_KEYWORD.has(r.id)
    );

    it("prices every implemented creature-characteristic keyword non-zero", () => {
        const unpriced: string[] = [];
        for (const row of bodyRows) {
            const declared =
                EXAMPLE_STRING[row.id] ??
                (row.id === "vanishing"
                    ? `${row.id} 3`
                    : (row.binding ?? row.id));
            if (keywordBonusFor(declared, 3, {}) === 0)
                unpriced.push(`${row.id} (${declared})`);
        }
        expect(unpriced).toEqual([]);
        for (const key of EXTRA_PRICED)
            expect(keywordBonusFor(key, 3)).not.toBe(0);
    });

    const body = (kw: string[], counters?: Record<string, number>) =>
        creatureValueRaw(2, 2, 2, kw, counters);

    it.each(["deathtouch", "lifelink", "menace"])(
        "a 2/2 %s values above a vanilla 2/2 of the same MV",
        (kw) => {
            expect(body([kw])).toBeGreaterThan(body([]));
        }
    );

    it("a 4/4 with does-not-untap values below a vanilla 4/4", () => {
        expect(creatureValueRaw(4, 4, 4, ["does-not-untap"])).toBeLessThan(
            creatureValueRaw(4, 4, 4, [])
        );
    });

    it("a 3/3 vanishing 1 values below a 3/3 vanishing 3 (definition path)", () => {
        expect(creatureValueRaw(3, 3, 3, ["vanishing 1"])).toBeLessThan(
            creatureValueRaw(3, 3, 3, ["vanishing 3"])
        );
    });

    it("reads the live counters on the instance path", () => {
        expect(
            creatureValueRaw(3, 3, 3, ["vanishing 3"], { time: 1 })
        ).toBeLessThan(creatureValueRaw(3, 3, 3, ["vanishing 3"], { time: 3 }));
    });
});
