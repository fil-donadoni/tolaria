// `expandClassLevelBars` + `classLevelActivationViolation` (CR 716.2, issue
// #3234).
//
// Two things are checked here that a card test cannot reach.
//
// The BAR SET validation: CR 716.2a's "activate only if this Class is level
// N-1" makes every level reachable ONLY from its immediate predecessor, so a
// bar set with a gap, a duplicate, an out-of-order entry or a first bar above
// level 2 strands every bar above the break. None of that is visible in a
// game — the stranded bar simply never becomes legal, silently — so the
// expander refuses at construction time, which is module load: a malformed
// Class is a red catalogue, never a permanent with an unreachable level.
//
// And the GATE itself, as a predicate rather than as one card's behaviour: it
// is the single authority the server mutation, the Bot enumerator, the
// mana-reservation planner and the client affordance all run, so its table of
// answers is worth pinning directly.

import { describe, expect, it } from "vitest";
import type { CardDefinition } from "../../types";
import {
    CLASS_SUBTYPE,
    classLevelActivationViolation,
    classLevelOf,
    expandClassLevelBars,
} from "../classLevels";

const base: CardDefinition = {
    id: "00000000-0000-0000-0000-000000000000",
    rarity: "rare",
    name: "Test Class",
    oracleText: "",
    manaCost: { U: 1 },
    types: ["Enchantment"],
    subtypes: [CLASS_SUBTYPE],
};

const bar = (level: number) => ({
    level,
    cost: { X: level, U: 1 },
    costLabel: `{${level}}{U}`,
});

describe("expandClassLevelBars — bar-set validation (CR 716.2a)", () => {
    it("an empty bar set is 'not a Class card', not a malformed one", () => {
        // The `chapterAbilities` treatment: an absent-or-empty declaration
        // returns the definition untouched, so the expander stays a no-op for
        // every other card in the pool rather than throwing on all of them.
        const expanded = expandClassLevelBars({ ...base, classLevelBars: [] });
        expect(expanded.activatedAbilities).toBeUndefined();
        expect(expanded.staticEffects).toBeUndefined();
    });

    it("CR 716.2a / 716.2d — refuses a first bar that is not level 2", () => {
        expect(() =>
            expandClassLevelBars({ ...base, classLevelBars: [bar(3)] })
        ).toThrow(/expected level 2, got 3/);
        expect(() =>
            expandClassLevelBars({ ...base, classLevelBars: [bar(1)] })
        ).toThrow(/expected level 2, got 1/);
    });

    it("CR 716.2a — refuses a gap, which would strand every bar above it", () => {
        expect(() =>
            expandClassLevelBars({ ...base, classLevelBars: [bar(2), bar(4)] })
        ).toThrow(/expected level 3, got 4/);
    });

    it("CR 716.2a — refuses duplicated or out-of-order bars", () => {
        expect(() =>
            expandClassLevelBars({ ...base, classLevelBars: [bar(2), bar(2)] })
        ).toThrow(/expected level 3, got 2/);
        expect(() =>
            expandClassLevelBars({ ...base, classLevelBars: [bar(3), bar(2)] })
        ).toThrow(/expected level 2, got 3/);
    });
});

describe("expandClassLevelBars — what a bar desugars into (CR 716.2)", () => {
    const expanded = expandClassLevelBars({
        ...base,
        classLevelBars: [bar(2), bar(3)],
    });

    it("CR 716.2a — one sorcery-speed activated ability per bar, gated on level N-1", () => {
        expect(
            expanded.activatedAbilities!.map((a) => ({
                id: a.id,
                oracleText: a.oracleText,
                sorcerySpeedOnly: a.sorcerySpeedOnly,
                useStack: a.useStack,
                classLevelBar: a.classLevelBar,
                effects: a.effects,
            }))
        ).toEqual([
            {
                id: "class-level-2",
                oracleText: "{2}{U}: Level 2",
                sorcerySpeedOnly: true,
                useStack: true,
                classLevelBar: 2,
                effects: [
                    { op: "setLevel", target: { ref: "$source" }, level: 2 },
                ],
            },
            {
                id: "class-level-3",
                oracleText: "{3}{U}: Level 3",
                sorcerySpeedOnly: true,
                useStack: true,
                classLevelBar: 3,
                effects: [
                    { op: "setLevel", target: { ref: "$source" }, level: 3 },
                ],
            },
        ]);
    });

    it("is idempotent — re-expanding a Class does not double its bars", () => {
        expect(expandClassLevelBars(expanded).activatedAbilities).toHaveLength(
            2
        );
    });

    it("is a no-op for a card with no bars", () => {
        expect(expandClassLevelBars(base)).toBe(base);
    });
});

describe("expandClassLevelBars — section gating (CR 716.2a)", () => {
    const expanded = expandClassLevelBars({
        ...base,
        classLevelBars: [
            {
                ...bar(2),
                staticEffects: [
                    {
                        kind: "pt-buff",
                        applies: (target, source) => target.id === source.id,
                        power: 1,
                        toughness: 1,
                    },
                ],
                activatedAbilities: [
                    {
                        id: "section-activated",
                        oracleText: "{T}: Draw a card.",
                        cost: { tap: true },
                        useStack: true,
                        effects: [
                            { op: "draw", player: "controller", count: 1 },
                        ],
                    },
                ],
                triggeredAbilities: [
                    {
                        id: "section-trigger",
                        oracleText: "Whenever anything happens, do nothing.",
                        event: "PERMANENT_ENTERED",
                        matches: () => true,
                        effects: [],
                    },
                ],
            },
        ],
    });

    /** A minimal `PermanentView`-shaped subject for the gated predicates. */
    const self = (classLevel?: number) =>
        ({
            id: "self",
            controllerId: "p1",
            ownerId: "p1",
            types: ["Enchantment"],
            subtypes: [CLASS_SUBTYPE],
            isTapped: false,
            classLevel,
        }) as Parameters<typeof classLevelOf>[0] & {
            id: string;
            controllerId: string;
        };

    it("CR 716.2a — the section's static is live only at level 2 or greater", () => {
        const effect = expanded.staticEffects![0] as {
            applies: (t: unknown, s: unknown, c: unknown) => boolean;
        };
        const below = self(undefined);
        const at = self(2);
        const above = self(3);
        expect(effect.applies(below, below, undefined)).toBe(false);
        expect(effect.applies(at, at, undefined)).toBe(true);
        expect(effect.applies(above, above, undefined)).toBe(true);
    });

    it("CR 716.2a — the section's trigger cannot match below level 2", () => {
        const trigger = expanded.triggeredAbilities!.find(
            (t) => t.id === "section-trigger"
        )!;
        const event = {
            type: "PERMANENT_ENTERED" as const,
            instanceId: "x",
            controllerId: "p1",
            types: ["Creature" as const],
            subtypes: [],
        };
        expect(trigger.classLevelSection).toBe(2);
        expect(trigger.matches(event, self(undefined))).toBe(false);
        expect(trigger.matches(event, self(2))).toBe(true);
    });

    it("CR 716.2a — the section's activated ability carries the declarative level gate", () => {
        const ability = expanded.activatedAbilities!.find(
            (a) => a.id === "section-activated"
        )!;
        expect(ability.functionsAtClassLevel).toBe(2);
        expect(ability.classLevelBar).toBeUndefined();
    });
});

describe("classLevelActivationViolation (CR 716.2a)", () => {
    it("CR 716.2d — a permanent with no level is level 1, so the level-2 bar is legal", () => {
        expect(
            classLevelActivationViolation({}, { classLevelBar: 2 })
        ).toBeNull();
    });

    it("CR 716.2a — a bar is legal at exactly level N-1, and nowhere else", () => {
        expect(
            classLevelActivationViolation(
                { classLevel: 2 },
                { classLevelBar: 3 }
            )
        ).toBeNull();
        expect(
            classLevelActivationViolation(
                { classLevel: 1 },
                { classLevelBar: 3 }
            )
        ).toMatch(/level 2/);
        expect(
            classLevelActivationViolation(
                { classLevel: 3 },
                { classLevelBar: 3 }
            )
        ).toMatch(/level 2/);
    });

    it("CR 716.2a — a section ability is legal at level N or greater", () => {
        expect(
            classLevelActivationViolation(
                { classLevel: 1 },
                { functionsAtClassLevel: 3 }
            )
        ).toMatch(/level 3 or greater/);
        expect(
            classLevelActivationViolation(
                { classLevel: 3 },
                { functionsAtClassLevel: 3 }
            )
        ).toBeNull();
        expect(
            classLevelActivationViolation(
                { classLevel: 4 },
                { functionsAtClassLevel: 3 }
            )
        ).toBeNull();
    });

    it("says nothing about an ability that carries neither gate", () => {
        expect(classLevelActivationViolation({ classLevel: 1 }, {})).toBeNull();
    });
});
