// Capability tests for the Exalted (CR 702.83), Prowess (CR 702.108) & Battle
// cry (CR 702.91) keyword expansions
// (convex/cards/abilities/keywordTriggers.ts, issues #699 / #3222). Built
// once here and reused by every card that declares the keyword — the two
// Vintage Cube Hierarchs (Noble/Ignoble) declare `staticAbilities: ["exalted"]`
// and inherit the trigger through the `getDefinition` seam.
//
// Covers the two things new in this slice: the keyword-expansion mechanism and
// the `ATTACKERS_DECLARED.soleAttacker` event-field ref (ADR 0049). The `pump`
// Op both keywords resolve to is already exercised (issue #840), so the
// end-to-end assertion here proves the expand → trigger → pump path, plus the
// wire-format survival of the resulting until-end-of-turn buff.

import { describe, it, expect } from "vitest";
import { makeInstance, makePlayer, makeState } from "../../__tests__/setup";
import type { CardDefinition, GameEvent, PermanentView } from "../../types";
import type {
    CardInstanceState,
    GameState,
    StackItem,
} from "../../../gre/state";
import { resolveTopOfStack } from "../../../gre/state";
import { getEffectivePower, getEffectiveToughness } from "../../../gre/layers";
import { projectPublicState } from "../../../gameProjections";
import { getCardByName, getDefinition } from "../..";
import { getEventFieldRow } from "../../mechanicsRegistry";
import { expandKeywordTriggers } from "../keywordTriggers";
import { nobleHierarch } from "../../sets/con/green";

/** Minimal synthetic creature def carrying the given keyword, run through the
 *  expander so we can inspect the injected triggered ability. */
function expandedWith(keyword: string): CardDefinition {
    return expandKeywordTriggers({
        id: `synthetic-${keyword}`,
        name: `Synthetic ${keyword}`,
        rarity: "common",
        manaCost: { X: 1 },
        types: ["Creature"],
        subtypes: [],
        power: 1,
        toughness: 1,
        staticAbilities: [keyword],
    } as CardDefinition);
}

/** Push a triggered ability onto the stack with its firing event, then resolve
 *  it through the real path (mirrors the c19 red.test.ts helper). */
function resolveTrigger(
    state: GameState,
    source: CardInstanceState,
    triggeredAbilityId: string,
    triggerEvent: StackItem["triggerEvent"]
): void {
    const item: StackItem = {
        ...source,
        zone: "stack",
        castById: source.controllerId,
        triggeredAbilityId,
        triggerSourceId: source.id,
        triggerEvent,
        targets: [],
    };
    state.stack.push(item);
    resolveTopOfStack(state);
}

describe("Exalted keyword expansion (CR 702.83)", () => {
    it("injects a single ATTACKERS_DECLARED triggered ability from the bare keyword", () => {
        const def = expandedWith("exalted");
        const trig = def.triggeredAbilities ?? [];
        expect(trig).toHaveLength(1);
        expect(trig[0].id).toBe("exalted");
        expect(trig[0].event).toBe("ATTACKERS_DECLARED");
    });

    it("is idempotent — re-expanding never double-injects", () => {
        const once = expandedWith("exalted");
        const twice = expandKeywordTriggers(once);
        expect(twice.triggeredAbilities ?? []).toHaveLength(1);
    });

    it("fires only when exactly one creature the controller controls attacks", () => {
        const def = expandedWith("exalted");
        const trig = def.triggeredAbilities![0];
        const self = { id: "src", controllerId: "p1" } as PermanentView;
        const lone: GameEvent = {
            type: "ATTACKERS_DECLARED",
            attackingPlayerId: "p1",
            attackerIds: ["a1"],
        } as GameEvent;
        const pair: GameEvent = {
            type: "ATTACKERS_DECLARED",
            attackingPlayerId: "p1",
            attackerIds: ["a1", "a2"],
        } as GameEvent;
        const opponentAlone: GameEvent = {
            type: "ATTACKERS_DECLARED",
            attackingPlayerId: "p2",
            attackerIds: ["a1"],
        } as GameEvent;
        expect(trig.matches(lone, self)).toBe(true);
        // CR 702.83a — "attacks ALONE": two attackers does not qualify.
        expect(trig.matches(pair, self)).toBe(false);
        // CR 109.4 — only the exalted source's controller's attack fires it.
        expect(trig.matches(opponentAlone, self)).toBe(false);
    });

    it("pumps the lone attacker +1/+1 until end of turn, surviving the wire", () => {
        // Noble Hierarch (exalted) + a lone Grizzly Bears (2/2) attacking alone.
        const hierarch = makeInstance(nobleHierarch.id, {
            id: "hierarch",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const bears = getCardByName("Grizzly Bears");
        const attacker = makeInstance(bears.id, {
            id: "attacker",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [hierarch, attacker] }),
                makePlayer("p2"),
            ],
            phase: "DECLARE_ATTACKERS",
        });

        // Baseline 2/2.
        expect(getEffectivePower(state, attacker)).toBe(2);
        expect(getEffectiveToughness(state, attacker)).toBe(2);

        resolveTrigger(state, hierarch, "exalted", {
            type: "ATTACKERS_DECLARED",
            attackingPlayerId: "p1",
            attackerIds: [attacker.id],
        } as StackItem["triggerEvent"]);

        // GRE: +1/+1 → 3/3.
        const pumped = state.players[0].battlefield.find(
            (c) => c.id === "attacker"
        )!;
        expect(getEffectivePower(state, pumped)).toBe(3);
        expect(getEffectiveToughness(state, pumped)).toBe(3);

        // Wire format: the buff survives projectPublicState (issue #699 —
        // the pumped attacker is client-visible, so the mandatory wire test).
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "attacker"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(3);
        expect(getEffectiveToughness(projected, slim)).toBe(3);
    });
});

describe("ATTACKERS_DECLARED.soleAttacker event-field ref (ADR 0049)", () => {
    it("flattens attackerIds to the lone member, undefined otherwise", () => {
        const row = getEventFieldRow("ATTACKERS_DECLARED", "soleAttacker")!;
        expect(row.family).toBe("object");
        expect(
            row.resolve({
                type: "ATTACKERS_DECLARED",
                attackingPlayerId: "p1",
                attackerIds: ["only"],
            } as GameEvent)
        ).toBe("only");
        expect(
            row.resolve({
                type: "ATTACKERS_DECLARED",
                attackingPlayerId: "p1",
                attackerIds: ["a", "b"],
            } as GameEvent)
        ).toBeUndefined();
    });
});

describe("Prowess keyword expansion (CR 702.108)", () => {
    it("injects a single SPELL_CAST triggered ability from the bare keyword", () => {
        const def = expandedWith("prowess");
        const trig = def.triggeredAbilities ?? [];
        expect(trig).toHaveLength(1);
        expect(trig[0].id).toBe("prowess");
        expect(trig[0].event).toBe("SPELL_CAST");
    });

    it("fires on your noncreature spell only (scope you, noncreature filter)", () => {
        const def = expandedWith("prowess");
        const trig = def.triggeredAbilities![0];
        const self = { id: "src", controllerId: "p1" } as PermanentView;
        const base = {
            type: "SPELL_CAST" as const,
            spellInstanceId: "s1",
            spellCardId: "c1",
            spellSubtypes: [],
            spellColors: [],
        };
        const yourInstant: GameEvent = {
            ...base,
            casterId: "p1",
            spellTypes: ["Instant"],
        } as GameEvent;
        const yourCreature: GameEvent = {
            ...base,
            casterId: "p1",
            spellTypes: ["Creature"],
        } as GameEvent;
        const opponentInstant: GameEvent = {
            ...base,
            casterId: "p2",
            spellTypes: ["Instant"],
        } as GameEvent;
        expect(trig.matches(yourInstant, self)).toBe(true);
        // CR 702.108a — noncreature only: a creature spell does not fire it.
        expect(trig.matches(yourCreature, self)).toBe(false);
        // scope "you" — an opponent's spell does not fire it.
        expect(trig.matches(opponentInstant, self)).toBe(false);
    });

    it("resolves to a +1/+1 pump on the source", () => {
        const def = expandedWith("prowess");
        const trig = def.triggeredAbilities![0];
        expect(trig.effects).toEqual([
            {
                op: "pump",
                target: { ref: "$source" },
                power: 1,
                toughness: 1,
                duration: { phase: "end-of-turn" },
            },
        ]);
    });
});

describe("Battle cry keyword expansion (CR 702.91)", () => {
    /** Three attackers under p1 — the battle-cry source plus two 2/2 Grizzly
     *  Bears — with a fourth Bears sitting home, untapped and not attacking.
     *  Returns the state and the instances so each test asserts on the same
     *  board shape. */
    function attackingBoard(): {
        state: GameState;
        source: CardInstanceState;
        ids: { ally: string; ally2: string; homebody: string };
    } {
        // Sanguine Evangelist (2/1, `staticAbilities: ["battle cry"]`) is the
        // registered card the seam expands — a synthetic definition is not in
        // the registry, so the engine could not resolve its instances.
        const def = getCardByName("Sanguine Evangelist");
        const source = makeInstance(def.id, {
            id: "crier",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
            isAttacking: true,
        });
        const bears = getCardByName("Grizzly Bears");
        const mk = (id: string, attacking: boolean): CardInstanceState =>
            makeInstance(bears.id, {
                id,
                controllerId: "p1",
                ownerId: "p1",
                zone: "battlefield",
                isAttacking: attacking,
            });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        source,
                        mk("ally", true),
                        mk("ally2", true),
                        mk("homebody", false),
                    ],
                }),
                makePlayer("p2"),
            ],
            phase: "DECLARE_ATTACKERS",
        });
        return {
            state,
            source,
            ids: { ally: "ally", ally2: "ally2", homebody: "homebody" },
        };
    }

    const power = (state: GameState, id: string): number => {
        const inst = state.players[0].battlefield.find((c) => c.id === id)!;
        return getEffectivePower(state, inst);
    };

    function fireBattleCry(state: GameState, sourceId: string): void {
        const src = state.players[0].battlefield.find(
            (c) => c.id === sourceId
        )!;
        const attackerIds = state.players[0].battlefield
            .filter((c) => c.isAttacking)
            .map((c) => c.id);
        resolveTrigger(state, src, "battle-cry", {
            type: "ATTACKERS_DECLARED",
            attackingPlayerId: "p1",
            attackerIds,
        } as StackItem["triggerEvent"]);
    }

    it("injects a single ATTACKERS_DECLARED triggered ability from the bare keyword", () => {
        const def = expandedWith("battle cry");
        const trig = def.triggeredAbilities ?? [];
        expect(trig).toHaveLength(1);
        expect(trig[0].id).toBe("battle-cry");
        expect(trig[0].event).toBe("ATTACKERS_DECLARED");
    });

    it("is idempotent — re-expanding never double-injects", () => {
        const once = expandedWith("battle cry");
        const twice = expandKeywordTriggers(once);
        expect(twice.triggeredAbilities ?? []).toHaveLength(1);
    });

    it("fires only when the source itself attacks (CR 702.91a scope self)", () => {
        const def = expandedWith("battle cry");
        const trig = def.triggeredAbilities![0];
        const self = { id: "src", controllerId: "p1" } as PermanentView;
        const withSource: GameEvent = {
            type: "ATTACKERS_DECLARED",
            attackingPlayerId: "p1",
            attackerIds: ["src", "other"],
        } as GameEvent;
        const withoutSource: GameEvent = {
            type: "ATTACKERS_DECLARED",
            attackingPlayerId: "p1",
            attackerIds: ["other"],
        } as GameEvent;
        expect(trig.matches(withSource, self)).toBe(true);
        // "Whenever THIS creature attacks" — an ally attacking alone is not it.
        expect(trig.matches(withoutSource, self)).toBe(false);
    });

    it("pumps each other attacking creature +1/+0 and never itself, surviving the wire", () => {
        const { state, ids } = attackingBoard();
        expect(power(state, "crier")).toBe(2);
        expect(power(state, ids.ally)).toBe(2);

        fireBattleCry(state, "crier");

        // CR 702.91a — "each OTHER attacking creature": both allies, +1/+0.
        expect(power(state, ids.ally)).toBe(3);
        expect(power(state, ids.ally2)).toBe(3);
        // The source excludes itself (`excludeSource`), so it stays 2/1 …
        expect(power(state, "crier")).toBe(2);
        // … and a creature that never attacked is untouched.
        expect(power(state, ids.homebody)).toBe(2);
        // Toughness is unchanged by a +1/+0 (CR 613.4c signed amounts).
        const ally = state.players[0].battlefield.find(
            (c) => c.id === ids.ally
        )!;
        expect(getEffectiveToughness(state, ally)).toBe(2);

        // Wire format: the buff is client-visible, so it must survive the
        // projection (the mandatory wire test for a board-visible outcome).
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === ids.ally
        )!;
        expect(getEffectivePower(projected, slim)).toBe(3);
        expect(getEffectiveToughness(projected, slim)).toBe(2);
    });

    it("two battle-cry attackers each pump the other, neither itself", () => {
        const def = getCardByName("Sanguine Evangelist");
        const mk = (id: string): CardInstanceState =>
            makeInstance(def.id, {
                id,
                controllerId: "p1",
                ownerId: "p1",
                zone: "battlefield",
                isAttacking: true,
            });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [mk("criA"), mk("criB")] }),
                makePlayer("p2"),
            ],
            phase: "DECLARE_ATTACKERS",
        });

        fireBattleCry(state, "criA");
        fireBattleCry(state, "criB");

        // Each 2/1 got exactly ONE +1/+0 — from the other, never from itself.
        expect(power(state, "criA")).toBe(3);
        expect(power(state, "criB")).toBe(3);
    });

    it("a creature that ENTERS attacking after the trigger resolved is not pumped (CR 611.2c)", () => {
        const { state } = attackingBoard();
        fireBattleCry(state, "crier");

        // CR 611.2c — the set a resolution-generated continuous effect affects
        // is fixed when it begins, so a creature that was not on the
        // battlefield at all when the trigger resolved gets nothing however
        // attacking it is. Modelled as the real shape: a NEW permanent
        // entering the battlefield attacking (a token made by a later
        // trigger), not a flag flipped on a creature that was already there.
        const bears = getCardByName("Grizzly Bears");
        const late = makeInstance(bears.id, {
            id: "late",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
            isAttacking: true,
        });
        state.players[0].battlefield.push(late);
        expect(getEffectivePower(state, late)).toBe(2);
        // And the creatures the effect DID catch keep their buff — the
        // assertion pairs, so a "nothing is ever pumped" regression cannot
        // pass this test.
        expect(power(state, "ally")).toBe(3);
    });
});

describe("Hierarch definitions carry the exalted keyword (issue #699)", () => {
    it("Noble Hierarch is a green 0/1 with exalted + a colour-choice mana ability", () => {
        const def = getDefinition(nobleHierarch.id);
        expect(def.staticAbilities).toContain("exalted");
        expect(def.power).toBe(0);
        expect(def.toughness).toBe(1);
        const mana = def.activatedAbilities?.[0];
        expect(mana?.useStack).toBe(false);
        expect(mana?.manaChoices).toEqual([{ G: 1 }, { W: 1 }, { U: 1 }]);
        // Exalted trigger injected by the seam.
        expect(def.triggeredAbilities?.some((t) => t.id === "exalted")).toBe(
            true
        );
    });

    it("Ignoble Hierarch carries exalted + BRG mana choice", () => {
        const def = getCardByName("Ignoble Hierarch");
        expect(def.staticAbilities).toContain("exalted");
        expect(def.activatedAbilities?.[0].manaChoices).toEqual([
            { B: 1 },
            { R: 1 },
            { G: 1 },
        ]);
    });
});
