// ADR 0137 / ADR 0105 § 7.1 (issue #3823) — a golden fixture is evidence, not
// a declaration. Every registered fixture must compile to exactly its
// `expected` definition (otherwise the forms `fixtureForms` reads off
// `expected` would clear cards on the strength of output the compiler does not
// produce), and must exhibit at least one card-dependent form (otherwise it
// clears nothing and is dead weight in the compiler hash).

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { fixtureForms, sortKeys } from "../gates";
import { GOLDEN_FIXTURES, type GoldenFixture } from "../grammar/fixtures";
import { oracleCard } from "./fixtures";

/** Why `fixture` is not golden, or null when it is. */
function goldenDefect(fixture: GoldenFixture): string | null {
    const outcome = compileCard(fixture.card);
    if (outcome.state === "unparsed")
        return `${fixture.card.name} does not parse`;
    if (
        JSON.stringify(sortKeys(outcome.definition)) !==
        JSON.stringify(sortKeys(fixture.expected))
    )
        return `${fixture.card.name} compiles to a different definition than its expected one`;
    if (fixtureForms([fixture]).size === 0)
        return `${fixture.card.name} exhibits no card-dependent form — it clears nothing`;
    return null;
}

// A card whose script the canned smoke generator cannot scenario-ize (its
// `moveZone` leaves the battlefield), so it exhibits a card-dependent form and
// a fixture of it clears something. A `$source` pump does NOT qualify any more
// — the generator seeds the ability's source and runs it (issue #3831).
const SELF_BOUNCE = oracleCard({
    name: "Flickering Sprite",
    manaCost: "{1}{U}",
    typeLine: "Creature — Faerie",
    oracleText: "{2}: Return Flickering Sprite to its owner's hand.",
    power: "1",
    toughness: "1",
});

function compiledOf(card = SELF_BOUNCE) {
    const outcome = compileCard(card);
    if (outcome.state === "unparsed") throw new Error("does not parse");
    return outcome.definition;
}

describe("golden fixtures (ADR 0137)", () => {
    it("every registered fixture is golden", () => {
        expect(GOLDEN_FIXTURES.map(goldenDefect).filter(Boolean)).toEqual([]);
    });

    it("the check accepts a fixture that matches the compiler", () => {
        expect(
            goldenDefect({
                rule: "effect clause",
                card: SELF_BOUNCE,
                expected: compiledOf(),
            })
        ).toBeNull();
    });

    it("the check rejects a fixture whose expected drifted from the compiler", () => {
        const expected = compiledOf();
        expect(
            goldenDefect({
                rule: "effect clause",
                card: SELF_BOUNCE,
                expected: { ...expected, power: 2 },
            })
        ).toMatch(/different definition/);
    });

    it("the check rejects a fixture that exhibits no card-dependent form", () => {
        const card = oracleCard({
            name: "Metallurgeon",
            manaCost: "{1}{W}",
            typeLine: "Artifact Creature — Human Artificer",
            oracleText: "{W}, {T}: Regenerate target artifact.",
            power: "1",
            toughness: "2",
        });
        expect(
            goldenDefect({
                rule: "effect clause",
                card,
                expected: compiledOf(card),
            })
        ).toMatch(/clears nothing/);
    });
});
