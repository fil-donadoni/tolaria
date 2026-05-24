// Unit tests for `spellCastTrigger` (CR 603.2 + 601.2i). Exercises the
// scope vocabulary, the SpellFilter integration, the condition gate
// (CR 603.4), and the engine-facing `interveningIf` wiring (CR 603.4d).
// Resolve-time behavior with real card scenarios lives in `lea.test.ts`.

import { describe, it, expect } from "vitest";
import type {
    CardType,
    PermanentView,
    SpellCastEvent,
    SpellContext,
} from "../../../types";
import { spellCastTrigger } from "../spellCastTrigger";

function makeSelf(overrides: Partial<PermanentView> = {}): PermanentView {
    return {
        id: "self-1",
        controllerId: "p1",
        ownerId: "p1",
        types: ["Creature"] as CardType[],
        subtypes: [],
        isTapped: false,
        card: {},
        ...overrides,
    };
}

function makeEvent(overrides: Partial<SpellCastEvent> = {}): SpellCastEvent {
    return {
        type: "SPELL_CAST",
        casterId: "p1",
        spellInstanceId: "spell-x",
        spellCardId: "spell-x-card",
        spellTypes: ["Instant"] as CardType[],
        spellSubtypes: [],
        spellColors: [],
        ...overrides,
    };
}

describe("spellCastTrigger — scope vocabulary", () => {
    const baseArgs = {
        id: "t",
        oracleText: "test",
        resolve: () => {},
    };

    it("scope: 'you' fires only when caster equals source's controller", () => {
        const trig = spellCastTrigger({ ...baseArgs, scope: "you" });
        const self = makeSelf({ controllerId: "p1" });
        expect(trig.matches(makeEvent({ casterId: "p1" }), self)).toBe(true);
        expect(trig.matches(makeEvent({ casterId: "p2" }), self)).toBe(false);
    });

    it("scope: 'opponents' fires only when caster is different from controller", () => {
        const trig = spellCastTrigger({ ...baseArgs, scope: "opponents" });
        const self = makeSelf({ controllerId: "p1" });
        expect(trig.matches(makeEvent({ casterId: "p1" }), self)).toBe(false);
        expect(trig.matches(makeEvent({ casterId: "p2" }), self)).toBe(true);
    });

    it("scope: 'any' fires on every caster", () => {
        const trig = spellCastTrigger({ ...baseArgs, scope: "any" });
        const self = makeSelf({ controllerId: "p1" });
        expect(trig.matches(makeEvent({ casterId: "p1" }), self)).toBe(true);
        expect(trig.matches(makeEvent({ casterId: "p2" }), self)).toBe(true);
    });

    it("scope: 'self' fires only when the spell instance id equals the source id", () => {
        const trig = spellCastTrigger({ ...baseArgs, scope: "self" });
        const self = makeSelf({ id: "src" });
        expect(trig.matches(makeEvent({ spellInstanceId: "src" }), self)).toBe(
            true
        );
        expect(
            trig.matches(makeEvent({ spellInstanceId: "other" }), self)
        ).toBe(false);
    });
});

describe("spellCastTrigger — filter integration", () => {
    it("rejects spells whose types miss the filter", () => {
        const trig = spellCastTrigger({
            id: "t",
            oracleText: "x",
            scope: "any",
            filter: { types: "Enchantment" },
            resolve: () => {},
        });
        const self = makeSelf();
        expect(
            trig.matches(
                makeEvent({ spellTypes: ["Enchantment"] as CardType[] }),
                self
            )
        ).toBe(true);
        expect(
            trig.matches(
                makeEvent({ spellTypes: ["Creature"] as CardType[] }),
                self
            )
        ).toBe(false);
    });

    it("rejects spells whose colors miss the filter", () => {
        const trig = spellCastTrigger({
            id: "t",
            oracleText: "x",
            scope: "any",
            filter: { colors: "U" },
            resolve: () => {},
        });
        const self = makeSelf();
        expect(trig.matches(makeEvent({ spellColors: ["U"] }), self)).toBe(
            true
        );
        expect(trig.matches(makeEvent({ spellColors: ["R"] }), self)).toBe(
            false
        );
    });
});

describe("spellCastTrigger — condition gate (CR 603.4)", () => {
    it("blocks fire when condition returns false even if scope+filter pass", () => {
        let called = 0;
        const trig = spellCastTrigger({
            id: "t",
            oracleText: "x",
            scope: "any",
            condition: () => {
                called++;
                return false;
            },
            resolve: () => {},
        });
        expect(trig.matches(makeEvent(), makeSelf())).toBe(false);
        expect(called).toBe(1);
    });
});

describe("spellCastTrigger — engine intervening-if wiring (CR 603.4d)", () => {
    it("populates `interveningIf` only when supplied by the caller", () => {
        const without = spellCastTrigger({
            id: "t",
            oracleText: "x",
            scope: "any",
            resolve: () => {},
        });
        expect(without.interveningIf).toBeUndefined();

        const withIf = spellCastTrigger({
            id: "t",
            oracleText: "x",
            scope: "any",
            interveningIf: () => false,
            resolve: () => {},
        });
        expect(withIf.interveningIf).toBeDefined();
        expect(withIf.interveningIf!(makeEvent(), makeSelf())).toBe(false);
    });

    it("narrows the event before delegating to the caller's predicate", () => {
        let seenType: string | undefined;
        const trig = spellCastTrigger({
            id: "t",
            oracleText: "x",
            scope: "any",
            interveningIf: (event) => {
                seenType = event.type;
                return true;
            },
            resolve: () => {},
        });
        expect(trig.interveningIf!(makeEvent(), makeSelf())).toBe(true);
        expect(seenType).toBe("SPELL_CAST");
    });
});

describe("spellCastTrigger — derived payload at resolve", () => {
    it("hands the resolve callback a SpellCastDerived populated from the event", () => {
        let derived: unknown;
        const trig = spellCastTrigger({
            id: "t",
            oracleText: "x",
            scope: "any",
            resolve: (_ctx, _event, spell) => {
                derived = spell;
            },
        });
        const fakeCtx = {} as SpellContext;
        const event = makeEvent({
            casterId: "p2",
            spellInstanceId: "x",
            spellCardId: "card-x",
            spellTypes: ["Creature"] as CardType[],
            spellSubtypes: ["Goblin"],
            spellColors: ["R"],
        });
        trig.resolve(fakeCtx, event);
        expect(derived).toEqual({
            instanceId: "x",
            casterId: "p2",
            cardId: "card-x",
            types: ["Creature"],
            subtypes: ["Goblin"],
            colors: ["R"],
        });
    });
});
