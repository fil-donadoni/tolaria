// Unit tests for `spellCastTrigger` (CR 603.2 + 601.2i). Exercises the
// scope vocabulary, the SpellFilter integration, the condition gate
// (CR 603.4), and the engine-facing `interveningIf` wiring (CR 603.4).
// Resolve-time behavior with real card scenarios lives in `lea.test.ts`.

import { describe, it, expect } from "vitest";
import type {
    CardType,
    PermanentView,
    SpellCastEvent,
    SpellContext,
} from "../../../types";
import { nthSpellThisTurn, spellCastTrigger } from "../spellCastTrigger";

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

describe("nthSpellThisTurn (issue #1343, CR 601.2i) — per-player 'Nth spell' condition", () => {
    it("N=2 fires exactly on the caster's second spell (prior count 1), not the first or third", () => {
        const condition = nthSpellThisTurn(2);
        const self = makeSelf();
        // First spell: casterSpellCountThisTurn = 0 (prior count) -> no fire.
        expect(
            condition(makeEvent({ casterSpellCountThisTurn: 0 }), self)
        ).toBe(false);
        // Second spell: casterSpellCountThisTurn = 1 -> fires.
        expect(
            condition(makeEvent({ casterSpellCountThisTurn: 1 }), self)
        ).toBe(true);
        // Third spell: casterSpellCountThisTurn = 2 -> does NOT fire (CR
        // 701.50's "second spell" is exact, not "2nd or later").
        expect(
            condition(makeEvent({ casterSpellCountThisTurn: 2 }), self)
        ).toBe(false);
    });

    it("N=1 fires on the caster's first spell (prior count 0) — the general 'Nth spell' template", () => {
        const condition = nthSpellThisTurn(1);
        const self = makeSelf();
        expect(
            condition(makeEvent({ casterSpellCountThisTurn: 0 }), self)
        ).toBe(true);
        expect(
            condition(makeEvent({ casterSpellCountThisTurn: 1 }), self)
        ).toBe(false);
    });

    it("an event with no casterSpellCountThisTurn reads as the caster's first spell (fallback convention)", () => {
        // Mirrors `priorSpellCount`'s own fallback — a pre-#1343 hand-built
        // fixture that never set the field.
        expect(nthSpellThisTurn(1)(makeEvent(), makeSelf())).toBe(true);
        expect(nthSpellThisTurn(2)(makeEvent(), makeSelf())).toBe(false);
    });

    it("composes with scope: 'any' as a spellCastTrigger.condition (Ledger Shredder's exact template)", () => {
        let resolved = 0;
        const trig = spellCastTrigger({
            id: "t",
            oracleText: "x",
            scope: "any",
            condition: nthSpellThisTurn(2),
            resolve: () => {
                resolved++;
            },
        });
        const self = makeSelf({ controllerId: "p1" });
        // P1's first spell and P2's first spell (2 spells total, but each is
        // individually a FIRST spell for its own caster) must NOT fire —
        // the per-player distinction the global Storm counter can't make.
        expect(
            trig.matches(
                makeEvent({ casterId: "p1", casterSpellCountThisTurn: 0 }),
                self
            )
        ).toBe(false);
        expect(
            trig.matches(
                makeEvent({ casterId: "p2", casterSpellCountThisTurn: 0 }),
                self
            )
        ).toBe(false);
        // P1's SECOND spell fires, regardless of which player controls the
        // source permanent (scope: "any" — "a player casts their second
        // spell", CR 701.50).
        expect(
            trig.matches(
                makeEvent({ casterId: "p1", casterSpellCountThisTurn: 1 }),
                self
            )
        ).toBe(true);
        expect(
            trig.matches(
                makeEvent({ casterId: "p2", casterSpellCountThisTurn: 1 }),
                self
            )
        ).toBe(true);
        void resolved;
    });
});

describe("spellCastTrigger — engine intervening-if wiring (CR 603.4)", () => {
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
        trig.resolve!(fakeCtx, event);
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
