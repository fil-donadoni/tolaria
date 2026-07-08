// Mana-ability availability gate (CR 602.5b, issue #947) — an activated mana
// ability whose own `canActivate` precondition currently evaluates false is
// NOT a usable mana source at all: it must not be offered as tappable, and
// any attempt to tap it for mana must be rejected cleanly (never the
// confusing "Invalid mana choice" symptom the bug report described). Chrome
// Mox (convex/cards/sets/mrd/colorless.ts) is the one production mana
// ability that declares `canActivate` today — with no imprinted card it has
// no colour to produce, yet the pre-fix `getActivatedManaAbility` reported it
// as a live mana source regardless.
//
// This suite tests the class-general mechanism (`getActivatedManaAbility`,
// `hasManaAbility`, `getManaTapOptionsDetailed`, `getProducibleManaOptions`)
// rather than Chrome Mox specifically — the fix checks `ability.canActivate`
// on whatever ability it finds, with no card-name special-casing.

import { describe, it, expect } from "vitest";
import {
    getActivatedManaAbility,
    hasManaAbility,
    getManaTapOptionsDetailed,
} from "../constants";
import { getProducibleManaOptions } from "../rules";
import { tapSourceIntoPayment } from "../../game";
import { resolveTopOfStack } from "../state";
import { applyPendingChoiceSubmit } from "../pendingChoiceSubmit";
import type { GameState, StackItem } from "../state";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import { chromeMox, talismanOfProgress } from "../../cards/sets/mrd/colorless";
import { balduvianBears } from "../../cards/sets/ice/green";

function etbEvent(instanceId: string): StackItem["triggerEvent"] {
    return {
        type: "PERMANENT_ENTERED",
        instanceId,
        controllerId: "p1",
        types: ["Artifact"],
    } as StackItem["triggerEvent"];
}

function pushEtbTrigger(
    state: GameState,
    mox: ReturnType<typeof makeInstance>
) {
    state.stack.push({
        ...mox,
        zone: "stack",
        castById: "p1",
        triggeredAbilityId: "chrome-mox-imprint",
        triggerSourceId: mox.id,
        triggerEvent: etbEvent(mox.id),
        targets: [],
    });
    resolveTopOfStack(state);
}

function submitChoice(state: GameState, cardInstanceIds: string[]) {
    const head = state.pendingChoices![0];
    applyPendingChoiceSubmit(state, {
        playerId: head.playerId,
        stackItemId: head.stackItemId,
        step: head.step,
        choiceId: head.choiceId,
        cardInstanceIds,
    });
}

/** Un-imprinted Chrome Mox on an otherwise empty board. */
function makeUnimprintedMox() {
    const mox = makeInstance(chromeMox.id, {
        id: "mox",
        controllerId: "p1",
        ownerId: "p1",
    });
    const player = makePlayer("p1", { battlefield: [mox] });
    const state = makeState({ players: [player, makePlayer("p2")] });
    state.activePlayerId = "p1";
    const moxOnBattlefield = player.battlefield.find((c) => c.id === "mox")!;
    return { player, state, mox: moxOnBattlefield };
}

/** Chrome Mox imprinted with a green card (mirrors the ETB flow exercised in
 *  `convex/cards/sets/mrd/__tests__/colorless.test.ts`). */
function makeImprintedMox() {
    const mox = makeInstance(chromeMox.id, {
        id: "mox",
        controllerId: "p1",
        ownerId: "p1",
    });
    const greenCard = makeInstance(balduvianBears.id, {
        id: "greenCard",
        controllerId: "p1",
        ownerId: "p1",
        zone: "hand",
    });
    const player = makePlayer("p1", { battlefield: [mox], hand: [greenCard] });
    const state = makeState({ players: [player, makePlayer("p2")] });
    state.activePlayerId = "p1";
    pushEtbTrigger(state, mox);
    submitChoice(state, ["greenCard"]);
    const moxOnBattlefield = player.battlefield.find((c) => c.id === "mox")!;
    return { player, state, mox: moxOnBattlefield };
}

describe("getActivatedManaAbility / hasManaAbility gate on canActivate (CR 602.5b, issue #947)", () => {
    it("an un-imprinted Chrome Mox has NO usable mana ability once a state snapshot is supplied", () => {
        const { state, mox } = makeUnimprintedMox();
        expect(getActivatedManaAbility(mox, state)).toBeNull();
        expect(hasManaAbility(mox, state)).toBe(false);
    });

    it("an imprinted Chrome Mox has a usable mana ability producing the imprinted colour", () => {
        const { state, mox } = makeImprintedMox();
        const ability = getActivatedManaAbility(mox, state);
        expect(ability).not.toBeNull();
        expect(ability!.id).toBe("chrome-mox-mana");
        expect(hasManaAbility(mox, state)).toBe(true);
        expect(ability!.getManaChoices!(mox, "p1", [])).toEqual([{ G: 1 }]);
    });

    it("without a state snapshot, the shape-only lookup still finds the ability (canActivate isn't consulted)", () => {
        const { mox } = makeUnimprintedMox();
        // Documented escape hatch — shape-only callers (definition
        // introspection, no board available) don't gate. Every real
        // tap-decision site in game.ts passes `state`.
        expect(getActivatedManaAbility(mox)).not.toBeNull();
    });

    it("the gate is general: a mana ability with no canActivate (Talisman of Progress) is unaffected", () => {
        const rock = makeInstance(talismanOfProgress.id, {
            id: "rock",
            controllerId: "p1",
            ownerId: "p1",
        });
        const player = makePlayer("p1", { battlefield: [rock] });
        const state = makeState({ players: [player, makePlayer("p2")] });
        expect(getActivatedManaAbility(rock, state)).not.toBeNull();
        expect(hasManaAbility(rock, state)).toBe(true);
    });
});

describe("getManaTapOptionsDetailed excludes a canActivate-gated ability (issue #947)", () => {
    it("reports no mana-tap options for an un-imprinted Chrome Mox WITH a board snapshot", () => {
        const { player, state, mox } = makeUnimprintedMox();
        const battlefields = state.players.map((p) => ({
            playerId: p.id,
            battlefield: p.battlefield,
        }));
        expect(getManaTapOptionsDetailed(mox, player.id, battlefields)).toEqual(
            []
        );
    });

    it("reports no mana-tap options for an un-imprinted Chrome Mox WITHOUT a board snapshot (auto-tap planner's snapshot-free path)", () => {
        const { mox } = makeUnimprintedMox();
        // No controllerId/battlefields — mirrors `getProducibleManaOptions`'s
        // requireTap call, which never threads a board snapshot.
        expect(getManaTapOptionsDetailed(mox)).toEqual([]);
    });

    it("reports the imprinted colour once Chrome Mox is imprinted", () => {
        const { player, state, mox } = makeImprintedMox();
        const battlefields = state.players.map((p) => ({
            playerId: p.id,
            battlefield: p.battlefield,
        }));
        const options = getManaTapOptionsDetailed(mox, player.id, battlefields);
        expect(options).toHaveLength(1);
        expect(options[0].mana).toEqual({ G: 1 });
    });
});

describe("getProducibleManaOptions (auto-tap / affordability planner, issue #947)", () => {
    it("reports no producible colours for an un-imprinted Chrome Mox", () => {
        const { mox } = makeUnimprintedMox();
        expect(getProducibleManaOptions(mox).size).toBe(0);
    });

    it("reports the imprinted colour once Chrome Mox is imprinted", () => {
        const { mox } = makeImprintedMox();
        const options = getProducibleManaOptions(mox);
        expect(options.has("G")).toBe(true);
    });
});

describe("tapping a canActivate-gated source rejects cleanly (issue #947)", () => {
    it("tapping an un-imprinted Chrome Mox for mana never throws 'Invalid mana choice'", () => {
        const { player, state, mox } = makeUnimprintedMox();
        let thrown: unknown;
        try {
            tapSourceIntoPayment(state, player, mox, undefined, []);
        } catch (e) {
            thrown = e;
        }
        expect(thrown).toBeInstanceOf(Error);
        expect((thrown as Error).message).not.toMatch(/Invalid mana choice/);
    });

    it("tapping an imprinted Chrome Mox for mana still succeeds (no regression)", () => {
        const { player, state, mox } = makeImprintedMox();
        tapSourceIntoPayment(state, player, mox, 0, []);
        expect(player.manaPool.G).toBe(1);
    });
});
