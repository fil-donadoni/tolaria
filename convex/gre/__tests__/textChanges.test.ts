// Text-changing-effects substrate tests (CR 612, layer 3 — ADR 0011).
//
// Covers `applySubstitution` (the read-time rewriter), `landTypesPresent` (the
// legal-`from` derivation), and the stringly-typed enforcement guard: every
// land-type / color token appearing in a structured string field of a
// registered Card Definition must be claimed by a substitution-aware parser.
// A new card that introduces a token in an unhandled string pattern turns this
// test red instead of becoming a silent runtime bug.
//
// The structured (compile-time) half of the enforcement is the exhaustive
// `switch (change.kind) { … default: assertNever }` inside `applySubstitution`
// — adding a new `TextChange["kind"]` breaks the build.

import { describe, it, expect } from "vitest";
import {
    applySubstitution,
    colorWordsPresent,
    landTypesPresent,
    substituteColorFilter,
} from "../textChanges";
import { LANDWALK_KEYWORDS } from "../constants";
import { getAllCards } from "../../cards";
import { parseProtectionFromColor } from "../protection";

describe("applySubstitution (CR 612.6)", () => {
    it("is a zero-copy no-op when no textChanges are present", () => {
        const inst = {
            subtypes: ["Forest"],
            staticAbilities: ["forestwalk"],
        };
        const out = applySubstitution(inst);
        // Same references — readers pay nothing on the common path.
        expect(out.subtypes).toBe(inst.subtypes);
        expect(out.staticAbilities).toBe(inst.staticAbilities);
    });

    it("rewrites a land subtype and its landwalk keyword together", () => {
        const out = applySubstitution({
            subtypes: ["Forest"],
            staticAbilities: ["forestwalk"],
            textChanges: [{ kind: "land-type", from: "Forest", to: "Island" }],
        });
        expect(out.subtypes).toEqual(["Island"]);
        expect(out.staticAbilities).toEqual(["islandwalk"]);
    });

    it("leaves unrelated subtypes and abilities untouched", () => {
        const out = applySubstitution({
            subtypes: ["Nymph", "Dryad"],
            staticAbilities: ["forestwalk", "flying"],
            textChanges: [{ kind: "land-type", from: "Forest", to: "Island" }],
        });
        expect(out.subtypes).toEqual(["Nymph", "Dryad"]);
        expect(out.staticAbilities).toEqual(["islandwalk", "flying"]);
    });

    it("treats a color-word change as inert for land mana / landwalk", () => {
        const out = applySubstitution({
            subtypes: ["Forest"],
            staticAbilities: ["forestwalk"],
            textChanges: [{ kind: "color-word", from: "green", to: "blue" }],
        });
        expect(out.subtypes).toEqual(["Forest"]);
        expect(out.staticAbilities).toEqual(["forestwalk"]);
    });

    it("rewrites a color word inside a protection-from string", () => {
        const out = applySubstitution({
            subtypes: [],
            staticAbilities: ["protection from white", "first strike"],
            textChanges: [{ kind: "color-word", from: "white", to: "blue" }],
        });
        expect(out.staticAbilities).toEqual([
            "protection from blue",
            "first strike",
        ]);
    });

    it("leaves abilities untouched when the color word is absent (zero-copy)", () => {
        const inst = {
            subtypes: [],
            staticAbilities: ["protection from black"],
            textChanges: [
                { kind: "color-word" as const, from: "white", to: "blue" },
            ],
        };
        const out = applySubstitution(inst);
        expect(out.staticAbilities).toBe(inst.staticAbilities);
    });

    it("treats a land-type change as inert for color words", () => {
        const out = applySubstitution({
            subtypes: ["Forest"],
            staticAbilities: ["protection from green"],
            textChanges: [{ kind: "land-type", from: "Forest", to: "Island" }],
        });
        expect(out.staticAbilities).toEqual(["protection from green"]);
    });
});

describe("substituteColorFilter (CR 202.2 under text change)", () => {
    it("passes a color through when no changes are present", () => {
        expect(substituteColorFilter({}, "W")).toBe("W");
    });

    it("remaps a color filter through a matching color-word change", () => {
        expect(
            substituteColorFilter(
                {
                    textChanges: [
                        { kind: "color-word", from: "white", to: "red" },
                    ],
                },
                "W"
            )
        ).toBe("R");
    });

    it("chains color-word changes in timestamp order", () => {
        expect(
            substituteColorFilter(
                {
                    textChanges: [
                        { kind: "color-word", from: "white", to: "blue" },
                        { kind: "color-word", from: "blue", to: "green" },
                    ],
                },
                "W"
            )
        ).toBe("G");
    });

    it("leaves colorless and non-matching colors unchanged", () => {
        const changes = {
            textChanges: [
                { kind: "color-word" as const, from: "white", to: "red" },
            ],
        };
        expect(substituteColorFilter(changes, "C")).toBe("C");
        expect(substituteColorFilter(changes, "U")).toBe("U");
    });
});

describe("colorWordsPresent (legal `from` derivation)", () => {
    it("reads color words from protection-from strings", () => {
        expect(
            colorWordsPresent({
                subtypes: [],
                staticAbilities: ["protection from white", "first strike"],
            })
        ).toEqual(["white"]);
    });

    it("reads color words from structured color filters", () => {
        expect(
            colorWordsPresent(
                { subtypes: [], staticAbilities: [] },
                ["U"] // a "blue source of your choice" filter
            )
        ).toEqual(["blue"]);
    });

    it("reads through an active color-word change (CR 612.6)", () => {
        expect(
            colorWordsPresent(
                {
                    subtypes: [],
                    staticAbilities: [],
                    textChanges: [
                        { kind: "color-word", from: "white", to: "red" },
                    ],
                },
                ["W"]
            )
        ).toEqual(["red"]);
    });

    it("dedups a word shared by a string and a filter", () => {
        expect(
            colorWordsPresent(
                { subtypes: [], staticAbilities: ["protection from blue"] },
                ["U"]
            )
        ).toEqual(["blue"]);
    });

    it("returns empty for an object referencing no color word", () => {
        expect(
            colorWordsPresent({ subtypes: ["Forest"], staticAbilities: [] })
        ).toEqual([]);
    });

    it("applies chained changes in timestamp order", () => {
        const out = applySubstitution({
            subtypes: ["Forest"],
            staticAbilities: ["forestwalk"],
            textChanges: [
                { kind: "land-type", from: "Forest", to: "Island" },
                { kind: "land-type", from: "Island", to: "Swamp" },
            ],
        });
        expect(out.subtypes).toEqual(["Swamp"]);
        expect(out.staticAbilities).toEqual(["swampwalk"]);
    });
});

describe("landTypesPresent (legal `from` derivation)", () => {
    it("reads basic land subtypes", () => {
        expect(
            landTypesPresent({ subtypes: ["Forest"], staticAbilities: [] })
        ).toEqual(["Forest"]);
    });

    it("reads landwalk-referenced types from abilities", () => {
        expect(
            landTypesPresent({
                subtypes: ["Nymph", "Dryad"],
                staticAbilities: ["forestwalk"],
            })
        ).toEqual(["Forest"]);
    });

    it("dedups subtype and landwalk references to the same type", () => {
        expect(
            landTypesPresent({
                subtypes: ["Forest"],
                staticAbilities: ["forestwalk"],
            })
        ).toEqual(["Forest"]);
    });

    it("reads through an active text change (CR 612.6)", () => {
        expect(
            landTypesPresent({
                subtypes: ["Forest"],
                staticAbilities: [],
                textChanges: [
                    { kind: "land-type", from: "Forest", to: "Island" },
                ],
            })
        ).toEqual(["Island"]);
    });

    it("returns empty for an object referencing no basic land type", () => {
        expect(
            landTypesPresent({
                subtypes: ["Wraith"],
                staticAbilities: ["fear"],
            })
        ).toEqual([]);
    });
});

describe("token coverage guard (ADR 0011 — stringly-typed enforcement)", () => {
    const LAND_TOKENS = Object.values(LANDWALK_KEYWORDS); // Plains…Forest
    const COLOR_WORDS = ["white", "blue", "black", "red", "green"];
    const TOKEN_RE = new RegExp(
        `\\b(${[...LAND_TOKENS, ...COLOR_WORDS].join("|")})\\b`,
        "i"
    );
    const LANDWALK_SET = new Set(Object.keys(LANDWALK_KEYWORDS));

    // A `staticAbilities` string is "claimed" by a substitution-aware parser
    // iff it is a landwalk keyword (rewritten by applySubstitution) or a
    // "protection from <color>" string (parsed by getProtectedColors, the
    // color-word surface wired in #125). Anything else carrying a land-type or
    // color token is an unrouted consumer.
    function isClaimedAbility(ability: string): boolean {
        return (
            LANDWALK_SET.has(ability) ||
            parseProtectionFromColor(ability) !== null
        );
    }

    it("every land-type / color token in a card's staticAbilities is claimed", () => {
        const unclaimed: string[] = [];
        for (const card of getAllCards()) {
            for (const ability of card.staticAbilities ?? []) {
                if (TOKEN_RE.test(ability) && !isClaimedAbility(ability)) {
                    unclaimed.push(`${card.name}: "${ability}"`);
                }
            }
        }
        expect(
            unclaimed,
            "card defs carrying a land-type/color token in an unhandled " +
                "staticAbilities pattern — route it through a " +
                "substitution-aware parser or extend applySubstitution"
        ).toEqual([]);
    });

    it("every basic-land token in a card's subtypes is a recognized land subtype", () => {
        // Land tokens may only appear in `subtypes` as a genuine basic land
        // subtype (Plains…Forest), which applySubstitution rewrites. Catch a
        // land word smuggled into subtypes in any other shape.
        const landSubtypes = new Set(Object.values(LANDWALK_KEYWORDS));
        const offenders: string[] = [];
        for (const card of getAllCards()) {
            for (const subtype of card.subtypes ?? []) {
                if (TOKEN_RE.test(subtype) && !landSubtypes.has(subtype)) {
                    offenders.push(`${card.name}: "${subtype}"`);
                }
            }
        }
        expect(offenders).toEqual([]);
    });
});
