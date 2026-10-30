// Issue #5152 — the creature keyword bonus table prices every registry-
// implemented keyword that is a creature characteristic (keyword abilities).
import { describe, expect, it } from "vitest";
import { echoTrigger } from "../../cards/abilities/echo";
import { wardAbility } from "../../cards/abilities/ward";
import { walkHandWrittenDefinitions } from "../../cards/catalogue";
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
    echo: {
        declared: "echo",
        triggered: [
            echoTrigger({ cost: { mana: { R: 1 } }, costLabel: "{R}" }),
        ],
    },
};

/** Implemented keyword rows that are NOT a creature characteristic the body
 *  prices, listed by name so a newly implemented keyword forces a decision.
 *  Cast-time / cost keywords are priced by the cast route and the script;
 *  the rest are not a standing creature quality. */
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
    "emerge",
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

/** The leading word of a declared keyword string — the id a keyword ability
 *  factory gives its ability (`wardAbility` → "ward", `echoTrigger` → "echo"). */
const keywordWord = (declared: string) => declared.split(" ")[0];

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

/** The realized script value of `def`, registered under a probe id for the
 *  duration of the read so `getDefinition` expands it. */
function scriptValueOfDefinition(def: CardDefinition): number {
    const probe = { ...def, id: "issue-5355-keyword-probe" };
    return withTemporaryDefinition(probe, () =>
        dslRealizedAbilityValueById(probe.id)
    );
}

/** A vanilla 2/2 carrying `declared` (and any abilities printed beside it). */
function scriptValueOf(
    declared: string,
    triggered: CardDefinition["triggeredAbilities"] = []
): number {
    return scriptValueOfDefinition({
        ...grizzlyBears(),
        name: "Keyword Probe",
        staticAbilities: [declared],
        triggeredAbilities: triggered,
    });
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

    // The probe above sees only what `getDefinition` expands from the string;
    // a keyword whose ability is a hand-written companion (ward, echo) reads
    // 0 there. The catalogue scan closes that class: on every card declaring
    // a body-priced keyword, the abilities named after it — by id (`ward`,
    // `rampage-2`) or by reminder text ("Echo {R} (…"); an ability GRANTING the
    // keyword to another creature prices something else and is not matched
    // — add nothing to the realized script value.
    it("no catalogue card's keyword-named ability adds script value to a body-priced keyword", () => {
        const doubled: string[] = [];
        for (const { definition: def } of walkHandWrittenDefinitions()) {
            for (const declared of def.staticAbilities ?? []) {
                if (declared in DOUBLE_PRICE_EXCLUSIONS) continue;
                if (keywordBonusFor(declared, 3, {}) === 0) continue;
                const word = keywordWord(declared);
                const named = (a: { id?: string; oracleText?: string }) =>
                    a.id === word ||
                    a.id?.startsWith(`${word}-`) === true ||
                    keywordWord(a.oracleText?.toLowerCase() ?? "") === word;
                const triggered = def.triggeredAbilities ?? [];
                const activated = def.activatedAbilities ?? [];
                if (![...triggered, ...activated].some(named)) continue;
                const withNamed = scriptValueOfDefinition(def);
                const withoutNamed = scriptValueOfDefinition({
                    ...def,
                    triggeredAbilities: triggered.filter((a) => !named(a)),
                    activatedAbilities: activated.filter((a) => !named(a)),
                });
                if (withNamed !== withoutNamed)
                    doubled.push(
                        `${def.name}: ${declared} (script ${withNamed - withoutNamed})`
                    );
            }
        }
        expect(doubled).toEqual([]);
    });
});
