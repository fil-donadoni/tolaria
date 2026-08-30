// Effect Script Ops: `captureBinding` / `recallCapturedBinding` (issue #2384)
// — the cross-ability last-known-information channel (CR 608.2h / CR 400.7).
//
// An ordinary binding lives for exactly one resolution: it is a
// `collectedChoices` entry on the stack item, gone the moment that item
// finishes. This pair lets ONE ability of a permanent hand a binding row to a
// LATER, SEPARATE ability of the SAME permanent — the Skyclave Apparition
// shape, where an enters-the-battlefield exile and a leaves-the-battlefield
// token creation can be arbitrarily many turns apart and CR 400.7 has by then
// made the exiled card a different object.
//
// Exercised through the REAL path (one execution path, ADR 0045): a synthetic
// DSL-only creature with a real ETB trigger and a real LTB trigger, resolved
// via `resolveTopOfStack`, with the wire-format assertion the per-Op regime
// requires (`projectPublicState`).

import { describe, it, expect } from "vitest";
import type { EffectOp } from "../../../cards/types";
import { registerTokenDefinition } from "../../../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../../cards/__tests__/setup";
import {
    resolveTopOfStack,
    removePermanentTo,
    markEnteredThisTurn,
    processPendingActionTriggers,
} from "../../state";
import type { CardInstanceState, GameState } from "../../state";
import { compactState, expandState } from "../../serialize";
import { collectTriggers } from "../../triggers";
import { projectPublicState } from "../../../gameProjections";
import { enteredTrigger } from "../../../cards/abilities/triggers/enteredTrigger";
import { leftTrigger } from "../../../cards/abilities/triggers/leftTrigger";

/** A 4-mana-value victim, so the recalled `.manaValue` (4) is distinguishable
 *  from every other number in the fixture (CR 202.3). */
const VICTIM_ID = "test-captured-binding-victim";
registerTokenDefinition({
    id: VICTIM_ID,
    name: VICTIM_ID,
    rarity: "common",
    manaCost: { X: 3, G: 1 },
    types: ["Creature"],
    subtypes: ["Bear"],
    power: 2,
    toughness: 2,
});

/** The Skyclave shape, generically: exile-and-remember on entry, read-back on
 *  departure. `etb` / `ltb` are the two scripts under test. */
function registerHost(id: string, etb: EffectOp[], ltb: EffectOp[]): string {
    registerTokenDefinition({
        id,
        name: id,
        rarity: "common",
        manaCost: { X: 1, W: 2 },
        types: ["Creature"],
        subtypes: ["Spirit"],
        power: 2,
        toughness: 2,
        triggeredAbilities: [
            enteredTrigger({
                id: `${id}-etb`,
                oracleText: "test ETB",
                scope: "self",
                targetRequirement: {
                    type: "Creature",
                    count: { min: 0, max: 1 },
                    controller: "opponent",
                },
                effects: etb,
            }),
            leftTrigger({
                id: `${id}-ltb`,
                oracleText: "test LTB",
                scope: "self",
                effects: ltb,
            }),
        ],
    });
    return id;
}

const CAPTURE_ETB: EffectOp[] = [
    { op: "exile", target: { target: 0 }, bind: "$exiled" },
    { op: "captureBinding", ref: "$exiled" },
];

const RECALL_LTB: EffectOp[] = [
    { op: "recallCapturedBinding", bind: "$exiled" },
    {
        op: "createToken",
        token: {
            name: "Illusion",
            types: ["Creature"],
            subtypes: ["Illusion"],
            colors: ["U"],
            power: { ref: "$exiled.manaValue" },
            toughness: { ref: "$exiled.manaValue" },
        },
        controller: { ref: "$exiled.owner" },
    },
];

function setup(hostId: string, withVictim = true) {
    const host = makeInstance(hostId, {
        id: "host",
        controllerId: "p1",
        ownerId: "p1",
    });
    const victim = makeInstance(VICTIM_ID, {
        id: "victim",
        controllerId: "p2",
        ownerId: "p2",
    });
    const state = makeState({
        players: [
            makePlayer("p1", { battlefield: [host] }),
            makePlayer("p2", { battlefield: withVictim ? [victim] : [] }),
        ],
    });
    return { state, host };
}

/** Fires the host's ETB (CR 603.6a) and resolves it, announcing `targetId` (or
 *  nothing, for the declined "up to one"). Targets are set directly on the
 *  collected trigger item — this suite is about the binding channel, not about
 *  the announcement machinery, which `raiseTriggerTargetSelection` owns and the
 *  card-level test exercises. */
function fireEtb(state: GameState, targetId?: string): void {
    const triggers = collectTriggers(state, [
        {
            type: "PERMANENT_ENTERED",
            instanceId: "host",
            controllerId: "p1",
            types: ["Creature"],
        },
    ]);
    expect(triggers).toHaveLength(1);
    triggers[0].targets = targetId ? [{ type: "permanent", id: targetId }] : [];
    state.stack.push(...triggers);
    resolveTopOfStack(state);
}

/** Sends the host to a graveyard and resolves the leave-trigger it fires
 *  (CR 603.10a — leaves-the-battlefield abilities look back in time). */
function fireLtb(state: GameState): void {
    removePermanentTo(state, "host", "graveyard");
    processPendingActionTriggers(state);
    const trig = state.stack.find((s) =>
        s.triggeredAbilityId?.endsWith("-ltb")
    );
    expect(trig).toBeDefined();
    state.stack = state.stack.filter((s) => s.id !== trig!.id);
    state.stack.push(trig!);
    resolveTopOfStack(state);
}

function illusions(state: GameState, playerIndex: number): CardInstanceState[] {
    return state.players[playerIndex].battlefield.filter(
        (c) => c.isToken === true
    );
}

describe("Effect Script Ops: captureBinding / recallCapturedBinding (CR 608.2h)", () => {
    it("carries a binding row from one ability's resolution to a LATER ability of the same source", () => {
        const id = registerHost(
            "test-captured-binding-basic",
            CAPTURE_ETB,
            RECALL_LTB
        );
        const { state } = setup(id);

        fireEtb(state, "victim");
        // The exile happened, and the row is now on the SOURCE permanent — not
        // on the stack item, which is gone.
        expect(state.players[1].exile.map((c) => c.id)).toEqual(["victim"]);
        expect(state.stack).toHaveLength(0);
        const host = state.players[0].battlefield.find((c) => c.id === "host")!;
        expect(host.capturedBindings?.["$exiled"]).toBeDefined();

        fireLtb(state);
        // CR 202.3 — X is the exiled card's mana value (4), and CR 108.3 sends
        // the token to the exiled CARD's owner (p2), not to the ability's
        // controller.
        expect(illusions(state, 0)).toHaveLength(0);
        const tokens = illusions(state, 1);
        expect(tokens).toHaveLength(1);
        expect(tokens[0].power).toBe(4);
        expect(tokens[0].toughness).toBe(4);
        expect(tokens[0].subtypes).toContain("Illusion");
    });

    it("reads the SNAPSHOT, not the card: the exiled card leaving exile does not change the recalled value (CR 400.7)", () => {
        const id = registerHost(
            "test-captured-binding-lki",
            CAPTURE_ETB,
            RECALL_LTB
        );
        const { state } = setup(id);

        fireEtb(state, "victim");
        // A third-party effect moves the exiled card on: by CR 400.7 what lands
        // in the graveyard is a NEW object, and nothing about it is queryable
        // as "the card that was exiled".
        const gone = state.players[1].exile.pop()!;
        gone.zone = "graveyard";
        state.players[1].graveyard.push(gone);
        expect(state.players[1].exile).toHaveLength(0);

        fireLtb(state);
        const tokens = illusions(state, 1);
        expect(tokens).toHaveLength(1);
        expect(tokens[0].power).toBe(4);
    });

    it("captures nothing when the earlier ability bound nothing, so the later reader skips (CR 608.2b)", () => {
        const id = registerHost(
            "test-captured-binding-empty",
            CAPTURE_ETB,
            RECALL_LTB
        );
        const { state } = setup(id, false);

        // "Up to one target" declined / no legal target: `exile` binds nothing,
        // so `captureBinding` has no row to persist.
        fireEtb(state);
        const host = state.players[0].battlefield.find((c) => c.id === "host")!;
        expect(host.capturedBindings).toBeUndefined();

        fireLtb(state);
        expect(illusions(state, 0)).toHaveLength(0);
        expect(illusions(state, 1)).toHaveLength(0);
    });

    it("drops the memory when the source RE-ENTERS the battlefield (CR 400.7 — a new object)", () => {
        const id = registerHost(
            "test-captured-binding-reentry",
            CAPTURE_ETB,
            RECALL_LTB
        );
        const { state } = setup(id);

        fireEtb(state, "victim");
        const host = state.players[0].battlefield.find((c) => c.id === "host")!;
        expect(host.capturedBindings?.["$exiled"]).toBeDefined();

        markEnteredThisTurn(host, state.turn);
        expect(host.capturedBindings).toBeUndefined();

        fireLtb(state);
        expect(illusions(state, 1)).toHaveLength(0);
    });

    it("survives a compact/expand round-trip, so the later ability still reads it after a save", () => {
        const id = registerHost(
            "test-captured-binding-serialize",
            CAPTURE_ETB,
            RECALL_LTB
        );
        const { state } = setup(id);

        fireEtb(state, "victim");
        const reloaded = expandState(compactState(state));
        const host = reloaded.players[0].battlefield.find(
            (c) => c.id === "host"
        )!;
        expect(host.capturedBindings?.["$exiled"]).toEqual(
            state.players[0].battlefield.find((c) => c.id === "host")!
                .capturedBindings!["$exiled"]
        );

        fireLtb(reloaded);
        const tokens = illusions(reloaded, 1);
        expect(tokens).toHaveLength(1);
        expect(tokens[0].power).toBe(4);
    });

    it("the recalled-size token's P/T survives projection (wire format)", () => {
        const id = registerHost(
            "test-captured-binding-wire",
            CAPTURE_ETB,
            RECALL_LTB
        );
        const { state } = setup(id);

        fireEtb(state, "victim");
        fireLtb(state);

        // The projection strips `card.card` to `{ id }` and reshapes zones — a
        // token whose size was computed at resolution must still read 4/4 on
        // the client, for BOTH viewers.
        for (const viewer of ["p1", "p2"]) {
            const projected = projectPublicState(state, 1, viewer);
            const token = projected.players[1].battlefield.find(
                (c) => c.isToken === true
            )!;
            expect(token.power).toBe(4);
            expect(token.toughness).toBe(4);
            expect(token.subtypes).toContain("Illusion");
        }
    });
});
