// ODY (Odyssey) — blue behavior tests (ADR 0043 colour split).

import { describe, it, expect } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import { resolveTopOfStack } from "../../../../gre/state";
import { checkStateBasedActions } from "../../../../gre/sba";
import { validateEffectScript } from "../../../../gre/effects/validate";
import { projectPublicState } from "../../../../gameProjections";
import { registerTokenDefinition } from "../../..";
import { getDefinition } from "../../../index";
import { collectTriggers } from "../../../../gre/triggers";
import type { GameEvent } from "../../../types";

const upheaval = getDefinition("9e201229-34a6-48c8-a07c-d8aefcf5f8a7");

const BEAR_ID = "test-odyblue-bear";
registerTokenDefinition({
    id: BEAR_ID,
    name: BEAR_ID,
    rarity: "common",
    manaCost: { G: 1 },
    types: ["Creature"],
    subtypes: ["Bear"],
    power: 2,
    toughness: 2,
});

const LAND_ID = "test-odyblue-land";
registerTokenDefinition({
    id: LAND_ID,
    name: LAND_ID,
    rarity: "common",
    manaCost: {},
    types: ["Land"],
});

const permFor = (id: string, controllerId: string, def: string = BEAR_ID) =>
    makeInstance(def, { id, controllerId, ownerId: controllerId });

// Upheaval — "Return all permanents to their owners' hands." (CR 400.7.) The
// first DSL card composing forEach's `$each` with moveZone's target-shape
// (`to: "hand"`) — the interpreter-level permanent test for the combination
// lives in `convex/gre/effects/__tests__/interpreter.test.ts` ("forEach +
// moveZone — mass bounce"); this file covers Upheaval's own card shape.
describe("Upheaval (return all permanents to hand — mass bounce, CR 400.7, issue #685)", () => {
    it("is a {4}{U}{U} sorcery, DSL-only with a valid Effect Script and no targets", () => {
        expect(upheaval.manaCost).toEqual({ X: 4, U: 2 });
        expect(upheaval.types).toEqual(["Sorcery"]);
        expect(upheaval.targetRequirement).toBeUndefined();
        expect(upheaval.resolve).toBeUndefined();
        expect(upheaval.resolveSteps).toBeUndefined();
        expect(validateEffectScript(upheaval)).toEqual([]);
    });

    it("returns every permanent on BOTH battlefields — every type, both players, no scope", () => {
        const myCreature = permFor("uphA", "p1");
        const myLand = permFor("uphB", "p1", LAND_ID);
        const theirCreature = permFor("uphC", "p2");
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [myCreature, myLand] }),
                makePlayer("p2", { battlefield: [theirCreature] }),
            ],
        });
        pushSpell(state, upheaval.id, "p1");
        expect(resolveTopOfStack(state)).not.toBeNull(); // never suspended
        expect(state.players[0].battlefield).toHaveLength(0);
        expect(state.players[1].battlefield).toHaveLength(0);
        expect(state.players[0].hand.map((c) => c.id).sort()).toEqual([
            "uphA",
            "uphB",
        ]);
        expect(state.players[1].hand.map((c) => c.id)).toEqual(["uphC"]);
    });

    it("a bounced token ceases to exist instead (CR 111.7 SBA)", () => {
        const token = makeInstance(BEAR_ID, {
            id: "uphTok",
            controllerId: "p1",
            ownerId: "p1",
            isToken: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [token] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, upheaval.id, "p1");
        resolveTopOfStack(state);
        checkStateBasedActions(state);
        expect(state.players[0].battlefield).toHaveLength(0);
        expect(state.players[0].hand.some((c) => c.id === "uphTok")).toBe(
            false
        );
    });

    it("resolves cleanly when no permanent is in play (CR 608.2b)", () => {
        const state = makeState();
        pushSpell(state, upheaval.id, "p1");
        expect(resolveTopOfStack(state)).not.toBeNull();
        expect(state.stack).toHaveLength(0);
    });

    // Wire format (mandatory — the effect is fully client-visible).
    it("wire format: the mass-bounce outcome survives projectPublicState", () => {
        const mine = permFor("uphW1", "p1");
        const theirs = permFor("uphW2", "p2");
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [mine] }),
                makePlayer("p2", { battlefield: [theirs] }),
            ],
        });
        pushSpell(state, upheaval.id, "p1");
        resolveTopOfStack(state);
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.players[0].battlefield).toHaveLength(0);
        expect(projected.players[1].battlefield).toHaveLength(0);
        expect(projected.players[0].hand).toHaveLength(1);
        // ADR 0026 — a permanent bounced from the battlefield stays PUBLIC
        // knowledge (every player watched it move), so the opponent's slot
        // carries its real identity rather than a hidden `null`.
        expect(projected.players[1].hand).toHaveLength(1);
        expect(projected.players[1].hand[0]).not.toBeNull();
    });
});

const standstill = getDefinition("3ede3f6f-e642-4fe4-aa37-0f01cdf4d149");

/** A SPELL_CAST event for `casterId`, shaped as `emitSpellCastEvent` builds it
 *  (CR 601.2i) — the head is scope-gated on the caster and nothing else, so
 *  the spell's own identity is deliberately the same in every case here. */
const CAST_BY = (casterId: string): GameEvent => ({
    type: "SPELL_CAST",
    casterId,
    spellInstanceId: `spell-${casterId}`,
    spellCardId: upheaval.id,
    spellTypes: upheaval.types,
    spellSubtypes: [],
    spellColors: ["U"],
});

/** Three library cards for `owner`, so a draw of three has something to take. */
const libraryOf = (owner: string) =>
    [0, 1, 2].map((n) =>
        makeInstance(BEAR_ID, {
            id: `${owner}-lib${n}`,
            controllerId: owner,
            ownerId: owner,
            zone: "library",
        })
    );

// Standstill — "When a player casts a spell, sacrifice this enchantment. If
// you do, each of that player's opponents draws three cards." (CR 603.2 /
// 601.2i cast trigger at `scope: "any"`; CR 701.21 sacrifice; CR 608.2h the
// bind that expresses "if you do"; CR 109.5 the caster-relative complement.)
//
// The card earns hand-written tests despite the per-Op regime: it is the FIRST
// definition to nest an `$event` player ref inside `{ opponentOf }`
// (`{ opponentOf: { ref: "$event.caster" } }`), a construct COMBINATION the
// interpreter suite covers on neither side alone — `opponentOf` is exercised
// only over `"controller"` / `{ controllerOf }`, and `$event.caster` only in a
// bare player position.
describe("Standstill (cast-by-any-player trigger, sacrifice, if-you-do draw)", () => {
    it("is a {1}{U} enchantment whose Effect Script validates, with no targets and no resolve()", () => {
        expect(standstill.manaCost).toEqual({ X: 1, U: 1 });
        expect(standstill.types).toEqual(["Enchantment"]);
        expect(standstill.resolve).toBeUndefined();
        expect(standstill.targetRequirement).toBeUndefined();
        expect(validateEffectScript(standstill)).toEqual([]);
    });

    it("fires on the OPPONENT's cast and the Standstill controller draws three (CR 601.2i)", () => {
        const ss = makeInstance(standstill.id, {
            id: "ss",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [ss],
                    library: libraryOf("p1"),
                }),
                makePlayer("p2", { library: libraryOf("p2") }),
            ],
        });
        const triggers = collectTriggers(state, [CAST_BY("p2")]);
        expect(triggers).toHaveLength(1);
        state.stack.push(...triggers);
        expect(resolveTopOfStack(state)).not.toBeNull();
        // CR 701.21 — sacrificed by its controller into its owner's graveyard.
        expect(state.players[0].battlefield).toHaveLength(0);
        expect(state.players[0].graveyard.map((c) => c.id)).toEqual(["ss"]);
        // CR 109.5 — "that player's opponents" is p2's opponent, i.e. p1.
        expect(state.players[0].hand).toHaveLength(3);
        expect(state.players[1].hand).toHaveLength(0);
        // SURFACE (mandatory) — the sacrifice reaches the client through the
        // real reducer, not just the engine state.
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.players[0].battlefield).toHaveLength(0);
        expect(projected.players[0].graveyard.map((c) => c.id)).toEqual(["ss"]);
        expect(projected.players[0].hand).toHaveLength(3);
    });

    it("fires on its OWN controller's cast too, and then the OPPONENT draws (scope: any, CR 603.2)", () => {
        const ss = makeInstance(standstill.id, {
            id: "ss",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [ss],
                    library: libraryOf("p1"),
                }),
                makePlayer("p2", { library: libraryOf("p2") }),
            ],
        });
        const triggers = collectTriggers(state, [CAST_BY("p1")]);
        expect(triggers).toHaveLength(1);
        state.stack.push(...triggers);
        expect(resolveTopOfStack(state)).not.toBeNull();
        expect(state.players[0].graveyard.map((c) => c.id)).toEqual(["ss"]);
        // The cards go to p1's OPPONENT — this is the half a "you draw"
        // misreading would get backwards, and the reason the ref is
        // `{ opponentOf: { ref: "$event.caster" } }` rather than "controller".
        expect(state.players[1].hand).toHaveLength(3);
        expect(state.players[0].hand).toHaveLength(0);
    });

    it('draws nothing when Standstill already left the battlefield — "if you do" is false (CR 608.2b)', () => {
        const ss = makeInstance(standstill.id, {
            id: "ss",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [ss],
                    library: libraryOf("p1"),
                }),
                makePlayer("p2", { library: libraryOf("p2") }),
            ],
        });
        const triggers = collectTriggers(state, [CAST_BY("p2")]);
        state.stack.push(...triggers);
        // Disenchanted with the trigger on the stack: by resolution there is
        // nothing to sacrifice, so the `sacrifice` Op binds nothing and the
        // `boundMatchesFilter` gate reads false.
        state.players[0].battlefield = [];
        state.players[0].graveyard.push({ ...ss, zone: "graveyard" });
        expect(resolveTopOfStack(state)).not.toBeNull();
        expect(state.players[0].hand).toHaveLength(0);
        expect(state.players[1].hand).toHaveLength(0);
    });
});
