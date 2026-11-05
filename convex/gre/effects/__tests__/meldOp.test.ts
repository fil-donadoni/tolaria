// CR 701.42a / 701.42b / 701.42c / 712.4a (issue #3341) — the `meld` Op, through
// the shipped pair: Urza, Lord Protector's own ability script, run by the real
// interpreter, then the real SBA sweep and the real projection.

import { describe, expect, it } from "vitest";
import {
    getCardByName,
    getDefinition,
    getPermanentManaValueCost,
} from "../../../cards";
import type { ActivatedAbility } from "../../../cards/types";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../../cards/__tests__/setup.helper";
import { meldResultDefinitionId } from "../../../cards/meld";
import { manaValue } from "../../constants";
import { projectPublicState } from "../../../gameProjections";
import { checkStateBasedActions } from "../../sba";
import { applyPendingChoiceSubmit } from "../../pendingChoiceSubmit";
import { loyaltyActivationAllowance } from "../../loyalty";
import { fireDelayedTriggers } from "../../phases";
import { raiseTriggerTargetSelection } from "../../rules";
import { finalizeTargetSelection } from "../../../game";
import {
    mayPayUnitIsEligible,
    resolveTopOfStack,
    restrictionAllowsAbility,
    restrictionAllowsSpell,
    type CardInstanceState,
    type GameState,
    type StackItem,
} from "../../state";

const URZA = getCardByName("Urza, Lord Protector");
const STONE = getCardByName("The Mightstone and Weakstone");
const BEARS = getCardByName("Balduvian Bears").id;
const TWIN_ID = meldResultDefinitionId(URZA.id);

const meldAbility = URZA.activatedAbilities!.find((a) =>
    a.oracleText?.startsWith("{7}")
) as ActivatedAbility;

function urza(over: Partial<CardInstanceState> = {}) {
    return makeInstance(URZA.id, {
        id: "urza",
        controllerId: "p1",
        ownerId: "p1",
        ...over,
    });
}
function stone(over: Partial<CardInstanceState> = {}) {
    return makeInstance(STONE.id, {
        id: "stone",
        controllerId: "p1",
        ownerId: "p1",
        ...over,
    });
}

function board(cards: CardInstanceState[]): GameState {
    return makeState({
        players: [makePlayer("p1", { battlefield: cards }), makePlayer("p2")],
    });
}

/** Put Urza's {7} on the stack and resolve it through the real funnel. */
function resolve(state: GameState): void {
    const source = makeInstance(URZA.id, {
        id: "urza",
        controllerId: "p1",
        ownerId: "p1",
    });
    state.stack.push({
        ...source,
        zone: "stack",
        castById: "p1",
        abilityId: meldAbility.id,
        targets: [],
    });
    resolveTopOfStack(state);
}

describe("the meld Op (CR 701.42a, Urza, Lord Protector)", () => {
    it("melds the pair into ONE permanent, and the projection ships the combined face", () => {
        const state = board([urza(), stone()]);
        resolve(state);
        const battlefield = state.players[0].battlefield;
        expect(battlefield.map((c) => c.id)).toEqual(["urza"]);
        expect((battlefield[0].card as { id: string }).id).toBe(TWIN_ID);
        expect(battlefield[0].counters?.loyalty).toBe(7);
        // CR 712.8g — 3 + 5.
        expect(manaValue(getPermanentManaValueCost(battlefield[0]))).toBe(8);

        const projected = projectPublicState(state, 1, "p2").players[0]
            .battlefield;
        expect(projected).toHaveLength(1);
        expect((projected[0].card as { id: string }).id).toBe(TWIN_ID);
        expect(projected[0].meldedFrom).toHaveLength(2);
        // The art a client renders: the combined face's own Scryfall card.
        expect(getDefinition(TWIN_ID).imagePrintId).toBe(
            "40a01679-3224-427e-bd1d-b797b0ab68b7"
        );
    });

    it('CR 608.2b — no counterpart: nothing is exiled ("if you both own and control")', () => {
        const state = board([urza()]);
        resolve(state);
        expect(state.players[0].battlefield.map((c) => c.id)).toEqual(["urza"]);
        expect(state.players[0].exile).toEqual([]);
    });

    it("a counterpart you control but do not own: nothing is exiled", () => {
        const state = board([urza(), stone({ ownerId: "p2" })]);
        resolve(state);
        expect(state.players[0].battlefield).toHaveLength(2);
        expect(state.players[0].exile).toEqual([]);
    });

    it("an Urza you control but do not own: nothing is exiled", () => {
        const state = board([urza({ ownerId: "p2" }), stone()]);
        resolve(state);
        expect(state.players[0].battlefield).toHaveLength(2);
    });

    it("the source gone by resolution: nothing happens to the counterpart (CR 608.2b)", () => {
        const state = board([stone()]);
        resolve(state);
        expect(state.players[0].battlefield.map((c) => c.id)).toEqual([
            "stone",
        ]);
    });

    it("a permanent of the right name but the wrong type is no counterpart", () => {
        const state = board([urza(), makeInstance(BEARS, { id: "bears" })]);
        resolve(state);
        expect(state.players[0].battlefield).toHaveLength(2);
    });

    it("CR 701.42b / 701.42c — Fractured Identity's token copy: both exiled, no meld, the token ceases to exist, Urza stays in exile", () => {
        const state = board([urza(), stone({ isToken: true })]);
        resolve(state);
        expect(state.players[0].battlefield).toEqual([]);
        expect(state.players[0].exile.map((c) => c.id).sort()).toEqual([
            "stone",
            "urza",
        ]);
        // CR 704.5d — the exiled token ceases to exist.
        checkStateBasedActions(state);
        expect(state.players[0].exile.map((c) => c.id)).toEqual(["urza"]);
        expect((state.players[0].exile[0].card as { id: string }).id).toBe(
            URZA.id
        );
    });

    it("two owned counterparts raise one pick; a stolen one is not offered", () => {
        const state = board([
            urza(),
            stone(),
            stone({ id: "stone-2" }),
            stone({ id: "stolen", ownerId: "p2" }),
        ]);
        resolve(state);
        const choice = state.pendingChoices?.[0];
        expect(choice?.candidateIds).toEqual(["stone", "stone-2"]);
        // Nothing moves until the answer (the script suspended, CR 608.2).
        expect(state.players[0].battlefield).toHaveLength(4);

        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: choice!.stackItemId,
            step: choice!.step,
            choiceId: choice!.choiceId,
            cardInstanceIds: ["stone-2"],
        });
        const battlefield = state.players[0].battlefield;
        expect(battlefield.map((c) => c.id).sort()).toEqual([
            "stolen",
            "stone",
            "urza",
        ]);
        expect(
            battlefield.find((c) => c.id === "urza")?.meldedFrom?.[1].instanceId
        ).toBe("stone-2");
    });

    it("one owned counterpart beside a stolen one melds with no prompt", () => {
        const state = board([
            urza(),
            stone({ id: "stolen", ownerId: "p2" }),
            stone(),
        ]);
        resolve(state);
        expect(state.pendingChoices ?? []).toEqual([]);
        expect(
            state.players[0].battlefield.find((c) => c.id === "urza")
                ?.meldedFrom
        ).toHaveLength(2);
    });
});

describe("Urza, Planeswalker on the battlefield (CR 606.3, CR 712.8g)", () => {
    function walker(): { state: GameState; melded: CardInstanceState } {
        const state = board([urza(), stone()]);
        resolve(state);
        return {
            state,
            melded: state.players[0].battlefield.find((c) => c.id === "urza")!,
        };
    }

    it("CR 606.3 — its loyalty abilities may be activated twice each turn", () => {
        const { melded } = walker();
        expect(loyaltyActivationAllowance(melded)).toBe(2);
    });

    it("-10 destroys every nonland permanent but what it just made indestructible", () => {
        const opposing = makeInstance(BEARS, {
            id: "their-bears",
            controllerId: "p2",
            ownerId: "p2",
        });
        const myBears = makeInstance(BEARS, { id: "my-bears" });
        const myStone = stone({ id: "my-stone" });
        const { state, melded } = walker();
        state.players[0].battlefield.push(myBears, myStone);
        state.players[1].battlefield.push(opposing);
        const minusTen = getDefinition(TWIN_ID).activatedAbilities!.find((a) =>
            a.oracleText?.startsWith("-10")
        )!;
        state.stack.push({
            ...melded,
            zone: "stack",
            castById: "p1",
            abilityId: minusTen.id,
            targets: [],
        });
        resolveTopOfStack(state);
        // "my-stone" stays an artifact you control, the walker a planeswalker
        // you control.
        expect(state.players[0].battlefield.map((c) => c.id).sort()).toEqual([
            "my-stone",
            "urza",
        ]);
        expect(state.players[1].battlefield).toEqual([]);
    });

    it("Flickerwisp exiles it and returns BOTH cards front face up (CR 712.14, CR 712.21c)", () => {
        const flickerwisp = getCardByName("Flickerwisp");
        const wisp = makeInstance(flickerwisp.id, {
            id: "wisp",
            controllerId: "p1",
            ownerId: "p1",
        });
        const { state } = walker();
        // A second legal target, or the announcement resolves with no prompt.
        const decoy = makeInstance(BEARS, { id: "decoy" });
        state.players[0].battlefield.push(wisp, decoy);
        state.stack.push({
            ...wisp,
            zone: "stack",
            castById: "p1",
            triggeredAbilityId: "flickerwisp-etb",
            triggerSourceId: wisp.id,
            triggerEvent: {
                type: "PERMANENT_ENTERED",
                instanceId: wisp.id,
                controllerId: "p1",
                types: ["Creature"],
            } as StackItem["triggerEvent"],
            targets: undefined,
        });
        expect(raiseTriggerTargetSelection(state)).toBe(true);
        state.pendingTarget!.selected = [{ type: "permanent", id: "urza" }];
        finalizeTargetSelection(
            state,
            state.pendingTarget!,
            state.pendingTarget!.playerId
        );
        resolveTopOfStack(state);
        expect(state.players[0].exile.map((c) => c.id).sort()).toEqual([
            "stone",
            "urza",
        ]);
        fireDelayedTriggers(state, "next-end-step");
        while (state.stack.length > 0) resolveTopOfStack(state);
        const returned = state.players[0].battlefield
            .filter((c) => c.id !== "wisp" && c.id !== "decoy")
            .map((c) => (c.card as { id: string }).id)
            .sort();
        expect(returned).toEqual([URZA.id, STONE.id].sort());
    });
});

describe('"This mana can\'t be spent to cast nonartifact spells" (CR 106.6)', () => {
    it("pays for an artifact spell and refuses any other spell", () => {
        expect(
            restrictionAllowsSpell("not-nonartifact-spell", ["Artifact"])
        ).toBe(true);
        expect(
            restrictionAllowsSpell("not-nonartifact-spell", [
                "Artifact",
                "Creature",
            ])
        ).toBe(true);
        expect(
            restrictionAllowsSpell("not-nonartifact-spell", ["Instant"])
        ).toBe(false);
    });

    it("pays a may-pay leg, which is no spell, unlike the Workshop's permission", () => {
        const unit = (
            restriction: "not-nonartifact-spell" | "artifact-spell"
        ) => ({
            color: "C",
            amount: 2,
            restriction,
        });
        expect(
            mayPayUnitIsEligible(unit("not-nonartifact-spell"), undefined)
        ).toBe(true);
        expect(mayPayUnitIsEligible(unit("artifact-spell"), undefined)).toBe(
            false
        );
    });

    it("pays for ANY ability, unlike the Workshop's permission", () => {
        expect(
            restrictionAllowsAbility("not-nonartifact-spell", ["Creature"])
        ).toBe(true);
        expect(restrictionAllowsAbility("artifact-spell", ["Creature"])).toBe(
            false
        );
    });
});
