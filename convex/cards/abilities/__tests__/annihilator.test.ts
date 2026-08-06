// Capability tests for the Annihilator N keyword expansion (CR 702.86,
// convex/cards/abilities/annihilator.ts, issue #2295).
//
// This slice ships the ENGINE capability only — no card in the catalogue
// declares the keyword yet (Emrakul is a tracked stub, PRD #1301), so the
// catalogue-wide sweeps (`effectScripts.test.ts` static validation, the canned
// `effectScriptSmoke` generator) cannot see it. These hand-written tests are
// therefore the keyword's whole proof obligation, and they drive the REAL
// paths end to end: the `getDefinition` expansion seam, the trigger scan
// (`collectTriggers` off a real `ATTACKERS_DECLARED` emission), the
// interpreter's `choice`/`sacrifice` Ops through `resolveTopOfStack`, the
// submit validator (`applyPendingChoiceSubmit`), and the wire projection
// (`projectPublicState`) plus the client's own routing predicate.

import { describe, it, expect } from "vitest";
import { getCardByName, preloadDefinitions, getDefinition } from "../..";
import type { CardDefinition, GameEvent, PermanentView } from "../../types";
import type { GameState, StackItem } from "../../../gre/state";
import { resolveTopOfStack } from "../../../gre/state";
import { applyPendingChoiceSubmit } from "../../../gre/pendingChoiceSubmit";
import { collectTriggers, placeTriggersOnStack } from "../../../gre/triggers";
import { isNamedMechanic, MECHANICS_REGISTRY } from "../../mechanicsRegistry";
import { makeInstance, makePlayer, makeState } from "../../__tests__/setup";
import {
    annihilatorOracleText,
    annihilatorTrigger,
    annihilatorTriggerId,
    expandAnnihilator,
} from "../annihilator";

const GRIZZLY_BEARS = getCardByName("Grizzly Bears").id;
const SAVANNAH_LIONS = getCardByName("Savannah Lions").id;
const FOREST = getCardByName("Forest").id;
const BLACK_LOTUS = getCardByName("Black Lotus").id;
const CRUSADE = getCardByName("Crusade").id;

/** Registers a synthetic 15/15 attacker carrying the given annihilator
 *  keyword string(s), so `getDefinition` runs it through the real expansion
 *  chain (`convex/cards/registry.ts`) — the same seam a printed card uses. */
function registerAnnihilatorCreature(
    id: string,
    staticAbilities: string[]
): string {
    preloadDefinitions([
        {
            id,
            name: `Synthetic ${id}`,
            rarity: "mythic",
            manaCost: { X: 15 },
            types: ["Creature"],
            subtypes: ["Eldrazi"],
            power: 15,
            toughness: 15,
            staticAbilities,
        } as CardDefinition,
    ]);
    return id;
}

/** Bare expansion (no registry round-trip) for shape assertions. */
function expandedWith(staticAbilities: string[]): CardDefinition {
    return expandAnnihilator({
        id: `synthetic-${staticAbilities.join("+")}`,
        name: "Synthetic",
        rarity: "common",
        manaCost: { X: 1 },
        types: ["Creature"],
        subtypes: [],
        power: 1,
        toughness: 1,
        staticAbilities,
    } as CardDefinition);
}

/** Builds a board: p1 has the annihilator attacker, p2 has `defenderCards`
 *  (any permanent types). Phase is DECLARE_ATTACKERS with combat declared, so
 *  a real `ATTACKERS_DECLARED` emission is meaningful. */
function boardWith(
    attackerCardId: string,
    defenderCards: string[]
): { state: GameState; attackerId: string } {
    const attacker = makeInstance(attackerCardId, {
        id: "atk",
        controllerId: "p1",
        ownerId: "p1",
        zone: "battlefield",
    });
    const defenderPermanents = defenderCards.map((cardId, i) =>
        makeInstance(cardId, {
            id: `d${i}`,
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
        })
    );
    const state = makeState({
        players: [
            makePlayer("p1", { battlefield: [attacker] }),
            makePlayer("p2", { battlefield: defenderPermanents }),
        ],
        phase: "DECLARE_ATTACKERS",
        activePlayerId: "p1",
        combat: {
            attackerIds: [attacker.id],
            confirmed: true,
            blockerAssignments: {},
            blockersConfirmed: false,
        },
    });
    return { state, attackerId: attacker.id };
}

/** Emits the real CR 508.1 event and pushes whatever triggers it produces —
 *  the production `emitAttackersDeclaredEvents` path, minus the phase machinery
 *  (which would also advance priority). */
function declareAttackers(state: GameState): StackItem[] {
    const event: GameEvent = {
        type: "ATTACKERS_DECLARED",
        attackingPlayerId: state.activePlayerId,
        attackerIds: [...state.combat!.attackerIds],
    };
    const triggers = collectTriggers(state, [event]);
    placeTriggersOnStack(state, triggers);
    return triggers;
}

describe("Annihilator N — Mechanics Registry (CR 702.86)", () => {
    it("the numbered keyword resolves to an `implemented` row", () => {
        expect(isNamedMechanic("annihilator 6")).toBe(true);
        expect(isNamedMechanic("annihilator 1")).toBe(true);
        // The bare word is still the row's `name`, so it matches too — but a
        // card declares the numbered form.
        const row = MECHANICS_REGISTRY.find((r) => r.id === "annihilator")!;
        expect(row.status).toBe("implemented");
        expect(row.binding).toContain("annihilator.ts");
        expect(row.bindingPattern!.test("annihilator 6")).toBe(true);
        expect(row.bindingPattern!.test("annihilator")).toBe(false);
    });
});

describe("Annihilator N — keyword expansion (CR 702.86a)", () => {
    it("injects one ATTACKERS_DECLARED trigger from the bare keyword string", () => {
        const def = expandedWith(["annihilator 6"]);
        const trig = def.triggeredAbilities ?? [];
        expect(trig).toHaveLength(1);
        expect(trig[0].id).toBe(annihilatorTriggerId(6));
        expect(trig[0].event).toBe("ATTACKERS_DECLARED");
        expect(trig[0].oracleText).toBe(
            "Annihilator 6 (Whenever this creature attacks, defending player sacrifices six permanents.)"
        );
    });

    it("is a no-op for a card without the keyword", () => {
        const def = expandedWith(["flying"]);
        expect(def.triggeredAbilities).toBeUndefined();
    });

    it("is idempotent — re-expanding never double-injects (CR 702.86b would over-count)", () => {
        const once = expandedWith(["annihilator 2"]);
        const twice = expandAnnihilator(once);
        expect(twice.triggeredAbilities ?? []).toHaveLength(1);
    });

    it("is parametrized off the string, not enumerated — any N works", () => {
        for (const n of [1, 2, 4, 6, 9]) {
            const def = expandedWith([`annihilator ${n}`]);
            expect(def.triggeredAbilities).toHaveLength(1);
            expect(def.triggeredAbilities![0].effects![0]).toMatchObject({
                op: "choice",
                kind: "sacrifice-permanents",
                player: "opponent",
                zone: "battlefield",
                count: n,
            });
        }
        // Singular reminder text at N=1.
        expect(annihilatorOracleText(1)).toContain("sacrifices one permanent.");
        // Beyond the spelled-out table, the numeral is used verbatim.
        expect(annihilatorOracleText(9)).toContain("sacrifices 9 permanents.");
    });

    it("the choice carries NO filter — every permanent type is eligible (CR 702.86a)", () => {
        const [choice] = expandedWith(["annihilator 6"]).triggeredAbilities![0]
            .effects!;
        expect(choice).not.toHaveProperty("filter");
        expect((choice as { candidates?: unknown }).candidates).toBeUndefined();
    });

    it("reaches the card through the real getDefinition seam", () => {
        const id = registerAnnihilatorCreature("synthetic-annihilator-seam", [
            "flying",
            "annihilator 6",
        ]);
        const def = getDefinition(id);
        expect(def.staticAbilities).toContain("annihilator 6");
        expect(def.triggeredAbilities?.map((t) => t.id)).toEqual([
            annihilatorTriggerId(6),
        ]);
    });
});

describe("Annihilator N — trigger condition (CR 508.1)", () => {
    const self = { id: "atk", controllerId: "p1" } as PermanentView;
    const trig = annihilatorTrigger(6);

    it("fires when the source is among the declared attackers", () => {
        expect(
            trig.matches(
                {
                    type: "ATTACKERS_DECLARED",
                    attackingPlayerId: "p1",
                    attackerIds: ["other", "atk"],
                } as GameEvent,
                self
            )
        ).toBe(true);
    });

    it("does not fire when some OTHER creature attacks", () => {
        expect(
            trig.matches(
                {
                    type: "ATTACKERS_DECLARED",
                    attackingPlayerId: "p1",
                    attackerIds: ["other"],
                } as GameEvent,
                self
            )
        ).toBe(false);
    });
});

describe("Annihilator N — resolution (CR 702.86a / 608.2b)", () => {
    it("defending player sacrifices N permanents of ANY type, of their choice", () => {
        const id = registerAnnihilatorCreature("synthetic-annihilator-mixed", [
            "annihilator 3",
        ]);
        // A deliberately mixed board: land, artifact, enchantment, creature.
        // A type-filtered choice would offer only a subset of these.
        const { state } = boardWith(id, [
            FOREST,
            BLACK_LOTUS,
            CRUSADE,
            GRIZZLY_BEARS,
        ]);
        declareAttackers(state);
        expect(state.stack).toHaveLength(1);

        // CR 509.1 — the ability is on the stack during declare-attackers,
        // i.e. before blockers are declared.
        expect(state.phase).toBe("DECLARE_ATTACKERS");

        expect(resolveTopOfStack(state)).toBeNull(); // suspended on the choice
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("sacrifice-permanents");
        expect(head.playerId).toBe("p2"); // the DEFENDING player chooses
        expect(head.count).toBe(3);
        // No filter on the wire either — every one of the four permanents is a
        // legal pick regardless of card type.
        expect(head.filter).toBeUndefined();

        applyPendingChoiceSubmit(state, {
            playerId: "p2",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            // A land, an artifact and an enchantment — no creature.
            cardInstanceIds: ["d0", "d1", "d2"],
        });

        expect(state.players[1].battlefield.map((c) => c.id)).toEqual(["d3"]);
        expect(state.players[1].graveyard.map((c) => c.id)).toEqual(
            expect.arrayContaining(["d0", "d1", "d2"])
        );
        expect(state.stack).toHaveLength(0);
        expect(state.pendingChoices ?? []).toHaveLength(0);
    });

    it("clamps to however many permanents the defender controls (CR 608.2b)", () => {
        const id = registerAnnihilatorCreature("synthetic-annihilator-clamp", [
            "annihilator 6",
        ]);
        const { state } = boardWith(id, [SAVANNAH_LIONS, FOREST]);
        declareAttackers(state);
        expect(resolveTopOfStack(state)).toBeNull();
        const head = state.pendingChoices![0];
        // Six requested, two available → the choice asks for two, not six.
        expect(head.count).toBe(2);
        applyPendingChoiceSubmit(state, {
            playerId: "p2",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["d0", "d1"],
        });
        expect(state.players[1].battlefield).toHaveLength(0);
        expect(state.stack).toHaveLength(0);
        expect(state.pendingChoices ?? []).toHaveLength(0);
    });

    it("is a clean no-op when the defender controls nothing (CR 608.2b)", () => {
        const id = registerAnnihilatorCreature("synthetic-annihilator-empty", [
            "annihilator 6",
        ]);
        const { state } = boardWith(id, []);
        declareAttackers(state);
        expect(state.stack).toHaveLength(1);
        // Resolves outright — no suspension, nothing left dangling.
        expect(resolveTopOfStack(state)).not.toBeNull();
        expect(state.stack).toHaveLength(0);
        expect(state.pendingChoices ?? []).toHaveLength(0);
        expect(state.players[1].battlefield).toHaveLength(0);
        expect(state.players[1].graveyard).toHaveLength(0);
    });
});

describe("Annihilator N — multiple instances trigger separately (CR 702.86b)", () => {
    it("two instances of the same N inject two abilities, each for N", () => {
        const def = expandedWith(["annihilator 2", "annihilator 2"]);
        const trig = def.triggeredAbilities!;
        expect(trig).toHaveLength(2);
        // Same id: two copies of one printed ability, so CR 603.3b's ordering
        // right auto-resolves (ADR 0003 / `triggerOrderKey`) instead of
        // prompting the controller to order two identical triggers.
        expect(trig.map((t) => t.id)).toEqual([
            annihilatorTriggerId(2),
            annihilatorTriggerId(2),
        ]);
        // Both sacrifice N — not one merged trigger for 2N.
        for (const t of trig) {
            expect(t.effects![0]).toMatchObject({ count: 2 });
        }
    });

    it("instances with DIFFERENT N keep distinct ids, each with its own count", () => {
        const def = expandedWith(["annihilator 2", "annihilator 6"]);
        const trig = def.triggeredAbilities!;
        expect(trig.map((t) => t.id)).toEqual([
            annihilatorTriggerId(2),
            annihilatorTriggerId(6),
        ]);
        expect(trig[0].effects![0]).toMatchObject({ count: 2 });
        expect(trig[1].effects![0]).toMatchObject({ count: 6 });
    });

    it("is NOT collapsed by the one-Oracle-line dedup guard's predicate", () => {
        // `triggerDedup.test.ts` flags same-`oracleText` triggers listening on
        // DISTINCT scalar events. Two annihilator instances share BOTH the
        // oracle text and the event, so the guard's per-oracleText event Set
        // has size 1 and they are outside its net by construction — which is
        // exactly right: these are two keyword INSTANCES (CR 702.86b), not one
        // Oracle line rendered twice.
        const trig = expandedWith([
            "annihilator 2",
            "annihilator 2",
        ]).triggeredAbilities!;
        const events = new Set(trig.map((t) => t.event as string));
        expect(new Set(trig.map((t) => t.oracleText)).size).toBe(1);
        expect(events.size).toBe(1);
    });

    it("produces TWO stack objects, each sacrificing N (not one for 2N)", () => {
        const id = registerAnnihilatorCreature("synthetic-annihilator-double", [
            "annihilator 2",
            "annihilator 2",
        ]);
        const { state } = boardWith(id, [
            FOREST,
            BLACK_LOTUS,
            CRUSADE,
            GRIZZLY_BEARS,
            SAVANNAH_LIONS,
        ]);
        declareAttackers(state);
        // Both landed on the stack in one shot — no ordering prompt for two
        // identical copies (ADR 0003), and no pendingTriggerBatch left parked.
        expect(state.stack).toHaveLength(2);
        expect(state.pendingTriggerBatch ?? []).toHaveLength(0);
        expect(state.stack.map((s) => s.triggeredAbilityId)).toEqual([
            annihilatorTriggerId(2),
            annihilatorTriggerId(2),
        ]);

        // First trigger: two of the five permanents.
        expect(resolveTopOfStack(state)).toBeNull();
        let head = state.pendingChoices![0];
        expect(head.count).toBe(2);
        applyPendingChoiceSubmit(state, {
            playerId: "p2",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["d0", "d1"],
        });
        expect(state.players[1].battlefield).toHaveLength(3);
        expect(state.stack).toHaveLength(1);

        // Second trigger: two MORE, independently — four sacrificed in total.
        expect(resolveTopOfStack(state)).toBeNull();
        head = state.pendingChoices![0];
        expect(head.count).toBe(2);
        applyPendingChoiceSubmit(state, {
            playerId: "p2",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["d2", "d3"],
        });
        expect(state.players[1].battlefield.map((c) => c.id)).toEqual(["d4"]);
        expect(state.stack).toHaveLength(0);
    });
});
