// The two hand-kept Effect Script FIELD-KIND lists, each driven through the
// public seam that reads it (issue #4477):
//
//   - `NESTED_SCRIPT_KEYS` (validate.ts) — the keys whose values are an
//     independently-scoped nested script, which the CR 402.3 / 701.20a
//     filtered-hand-count check must NOT walk from the outer entry.
//   - `AMOUNT_KEYS` (scenarioGenerator.ts) — the fields typed `EffectValue`,
//     which the smoke generator's op-covered argument read (ADR 0105 § 7.1)
//     must treat as a runtime amount.
//
// Characterisation ahead of the field-kind derivation (issue #4451), which
// replaces both hand lists: each member is pinned by BEHAVIOUR (a key the
// derivation drops changes a verdict below), and each list's membership is
// pinned too, so a derivation that silently narrows or widens it is a
// deliberate edit here rather than an unnoticed one.

import { describe, expect, it } from "vitest";
import type { EffectOp } from "../../../cards/types";
import { NESTED_SCRIPT_KEYS, validateEffectScript } from "../validate";
import { AMOUNT_KEYS, planSmokeTest } from "../scenarioGenerator";
import { NESTING_SHAPES } from "../../__tests__/fixtures/nestedOpShapes";

/** "Count the creature cards in your hand" — a FILTERED hand count, the read
 *  CR 402.3 hides unless a preceding reveal made the hand public (CR 701.20a). */
function hiddenHandCountDraw(): EffectOp {
    return {
        op: "draw",
        player: "controller",
        count: {
            count: {
                zone: "hand",
                controller: "controller",
                filter: { type: "Creature" },
            },
        },
    };
}

const HOST = "Key Set Probe";

/** The hidden-zone errors `validateEffectScript` reports for `effects`. */
function hiddenHandErrors(effects: EffectOp[]): string[] {
    return validateEffectScript({
        id: "key-set-probe",
        name: HOST,
        types: ["Sorcery"],
        effects,
    }).filter((e) =>
        e.includes("reads characteristics of cards in a hidden zone")
    );
}

/** An error the OUTER entry's own walk raised — the one a nested script must
 *  never produce, because its reads are checked in its own scope. */
const OUTER_PREFIX = `${HOST} (key-set-probe): effects[0]: a count`;

/** The one `NESTED_SCRIPT_KEYS` member that is not an Op-list nesting shape:
 *  `token` holds a whole card spec, whose abilities carry their own scripts. */
const TOKEN_HOST: EffectOp = {
    op: "createToken",
    controller: "controller",
    token: {
        name: "Probe",
        types: ["Creature"],
        power: 1,
        toughness: 1,
        triggeredAbilities: [
            {
                id: "probe-dies",
                oracleText: "When this token dies, draw a card.",
                event: "CREATURE_DIED",
                effects: [hiddenHandCountDraw()],
            },
        ],
    },
};

/** Every host that nests the hidden count, labelled by `<op>.<key>` — each
 *  shared nesting shape, plus the token spec. */
const NESTED_HOSTS: readonly (readonly [string, string, EffectOp])[] = [
    ...NESTING_SHAPES.map(
        (s) => [s.label, s.key, s.nest([hiddenHandCountDraw()])] as const
    ),
    ["createToken.token", "token", TOKEN_HOST] as const,
];

describe("NESTED_SCRIPT_KEYS — a nested script's hand read is checked in ITS scope (CR 402.3 / 701.20a)", () => {
    it("names exactly the keys the nesting shapes (and a token spec) sit under", () => {
        expect([...NESTED_SCRIPT_KEYS].sort()).toEqual(
            [...new Set(NESTED_HOSTS.map(([, key]) => key))].sort()
        );
    });

    it("the contrast: the same count at the TOP level is caught by the outer walk", () => {
        const errors = hiddenHandErrors([hiddenHandCountDraw()]);
        expect(errors).toHaveLength(1);
        expect(errors[0].startsWith(OUTER_PREFIX)).toBe(true);
    });

    it.each(NESTED_HOSTS)(
        "%s: the outer entry does not walk into %s, the nested scope does",
        (_label, _key, host) => {
            const errors = hiddenHandErrors([host]);
            // Reached: the nested re-entry reports the unrevealed read …
            expect(errors.length).toBeGreaterThanOrEqual(1);
            // … and only there. A key missing from the set would add a
            // second report at the outer entry's own path.
            expect(errors.filter((e) => e.startsWith(OUTER_PREFIX))).toEqual(
                []
            );
        }
    );
});

/** `preventDamage` is an op-covered Op (a dormant shield — ADR 0105 § 7.1),
 *  so the generator reads its OWN arguments back; `key` carries an object
 *  the generator cannot size. */
function opCoveredWith(key: string): EffectOp[] {
    return [
        {
            op: "preventDamage",
            mode: "next-n",
            to: { target: 0 },
            amount: 1,
            duration: { phase: "end-of-turn" },
            [key]: { opaque: true },
        } as EffectOp,
    ];
}

/** The runtime-amount skip the generator raised for `key`, if any. */
function runtimeAmountSkipFor(key: string): boolean {
    const plan = planSmokeTest(opCoveredWith(key));
    if (plan.kind !== "skip") return false;
    return plan.skips.some(
        (s) =>
            s.code === "runtime-amount" &&
            s.reason.includes(`reads a runtime "${key}" amount`)
    );
}

describe("AMOUNT_KEYS — an op-covered Op's runtime amount is card-dependent (ADR 0105 § 7.1)", () => {
    it("names exactly the EffectValue-typed fields it names today", () => {
        expect([...AMOUNT_KEYS].sort()).toEqual([
            "amount",
            "costPerKept",
            "count",
            "energyEqualTo",
            "genericEqualTo",
            "left",
            "look",
            "max",
            "min",
            "negate",
            "power",
            "reducedBy",
            "right",
            "take",
            "toughness",
        ]);
    });

    it.each([...AMOUNT_KEYS].sort())(
        "%s: an unsizable value under it is a runtime-amount skip",
        (key) => {
            expect(runtimeAmountSkipFor(key)).toBe(true);
        }
    );

    it("the contrast: the same value under a non-amount key is not read as an amount", () => {
        expect(runtimeAmountSkipFor("notAnAmount")).toBe(false);
    });
});
