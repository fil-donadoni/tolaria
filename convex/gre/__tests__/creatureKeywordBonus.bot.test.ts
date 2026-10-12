// Issue #5152 — the creature keyword bonus table prices every registry-
// implemented keyword that is a creature characteristic (keyword abilities).
import { describe, expect, it } from "vitest";
import { wardAbility } from "../../cards/abilities/ward";
import { MECHANICS_REGISTRY } from "../../cards/mechanicsRegistry";
import { withTemporaryDefinition } from "../../cards/registry";
import { grizzlyBears } from "../../cards/sets/lea/green.cards";
import type { CardDefinition } from "../../cards/types";
import { dslRealizedAbilityValueById } from "../cardValue";
import {
    PRICED_KEYWORD_SHAPES,
    creatureValueRaw,
    keywordBonusFor,
} from "../creatureBody";

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
/** Keywords priced ONCE, by their ability script (`dslRealizedAbilityValueById`)
 *  — a body-table row would count them twice (issue #5355). Each entry is the
 *  declared string plus the abilities a card printing it carries beside the
 *  string (ward is declared, not expanded; the rest expand at `getDefinition`). */
const SCRIPT_PRICED: Record<
    string,
    { declared: string; triggered?: CardDefinition["triggeredAbilities"] }
> = {
    exalted: { declared: "exalted" },
    prowess: { declared: "prowess" },
    "battle-cry": { declared: "battle cry" },
    annihilator: { declared: "annihilator 2" },
    ward: {
        declared: "ward {2}",
        triggered: [
            wardAbility({ cost: { mana: { X: 2 } }, costLabel: "{2}" }),
        ],
    },
    fading: { declared: "fading 3" },
};

const NOT_A_BODY_KEYWORD = new Set([
    ...Object.keys(SCRIPT_PRICED),
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

/** Body-priced keywords that ALSO carry an ability script, each with the reason
 *  the two readings price different things. Empty: none does today. */
const DOUBLE_PRICE_EXCLUSIONS: Record<string, string> = {};

/** One declared string per parametrized `PRICED_KEYWORD_SHAPES` pattern. */
const PATTERN_EXAMPLES = [
    ...Object.values(EXAMPLE_STRING),
    "snow forestwalk",
    "legendary landwalk",
    "vanishing 3",
];

/** A vanilla 2/2 carrying `declared` (and any abilities printed beside it),
 *  registered for the duration of the read so `getDefinition` expands it. */
function scriptValueOf(
    declared: string,
    triggered: CardDefinition["triggeredAbilities"] = []
): number {
    const probe: CardDefinition = {
        ...grizzlyBears(),
        id: "issue-5355-keyword-probe",
        name: "Keyword Probe",
        staticAbilities: [declared],
        triggeredAbilities: triggered,
    };
    return withTemporaryDefinition(probe, () =>
        dslRealizedAbilityValueById(probe.id)
    );
}

describe("a keyword is priced once — body table XOR script (issue #5355)", () => {
    it("every parametrized priced shape has an example declared string", () => {
        const uncovered = PRICED_KEYWORD_SHAPES.patterns.filter(
            (re) => !PATTERN_EXAMPLES.some((s) => re.test(s))
        );
        expect(uncovered.map(String)).toEqual([]);
    });

    it("no body-priced keyword carries an ability script worth anything", () => {
        const doubled: string[] = [];
        for (const declared of [
            ...PRICED_KEYWORD_SHAPES.exact,
            ...PATTERN_EXAMPLES,
        ]) {
            if (declared in DOUBLE_PRICE_EXCLUSIONS) continue;
            expect(keywordBonusFor(declared, 3, {})).not.toBe(0);
            const script = scriptValueOf(declared);
            if (script !== 0) doubled.push(`${declared} (script ${script})`);
        }
        expect(doubled).toEqual([]);
    });

    it.each(Object.entries(SCRIPT_PRICED))(
        "script-priced %s has no body-table row, and its script is worth something",
        (_id, { declared, triggered }) => {
            expect(keywordBonusFor(declared, 3, {})).toBe(0);
            expect(keywordBonusFor(declared, 3)).toBe(0);
            expect(scriptValueOf(declared, triggered)).not.toBe(0);
        }
    );
});
