// Duskmourn (DSK) — multicolor behavior tests (ADR 0043 colour split).
//
// Kaito, Bane of Nightmares (issue #3237) — the first card on the CONDITIONAL
// layer-4 type line ("During your turn, as long as Kaito has one or more
// loyalty counters on him, he's a 3/4 Ninja creature and has hexproof"), the
// first planeswalker on Ninjutsu, and the first reader of the per-turn
// life-loss tally ("draw a card for each opponent who lost life this turn").
// Every ability is driven through the real `game.ts` activation path
// (`activateAbilityOnState`) and resolved through `resolveTopOfStack`; the
// board is read back through `projectPublicState` where the client sees it.

import { describe, it, expect } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup.helper";
import {
    beginApplyingStaticEffects,
    loseLifeEmitting,
    resolveTopOfStack,
    gainLifeEmitting,
} from "../../../../gre/state";
import type { CardInstanceState, GameState } from "../../../../gre/state";
import { checkStateBasedActions } from "../../../../gre/sba";
import { applyPendingChoiceSubmit } from "../../../../gre/pendingChoiceSubmit";
import {
    getEffectivePower,
    getEffectiveToughness,
} from "../../../../gre/layers";
import type { LayerStateView } from "../../../../gre/layers";
import { refreshExpectedInput } from "../../../../gre/expectedInput";
import {
    activateAbilityOnState,
    finalizeTargetSelection,
} from "../../../../game";
import { projectPublicState } from "../../../../gameProjections";
import type { PermanentView } from "../../../types";
import { kaitoBaneOfNightmares } from "../multicolor.cards";
import { lightningBolt } from "../../lea/red.cards";
import { grizzlyBears } from "../../lea/green.cards";
import { wrennAndSix } from "../../mh1/multicolor.cards";

const KAITO = kaitoBaneOfNightmares().id;

const view = (state: GameState): LayerStateView =>
    state as unknown as LayerStateView;
const asView = (card: CardInstanceState): PermanentView =>
    card as unknown as PermanentView;

function kaitoInstance(loyalty: number): CardInstanceState {
    return makeInstance(KAITO, {
        id: "kaito",
        controllerId: "p1",
        ownerId: "p1",
        counters: { loyalty },
    });
}

function library(ids: string[]): CardInstanceState[] {
    return ids.map((id) =>
        makeInstance(grizzlyBears().id, {
            id,
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        })
    );
}

/** Kaito on p1's battlefield at `loyalty`, in p1's (or p2's) main phase with
 *  an empty stack — the loyalty-ability window (CR 606.3). */
function board(opts: {
    activePlayerId?: string;
    loyalty?: number;
    p2Battlefield?: CardInstanceState[];
}): { state: GameState; kaito: CardInstanceState } {
    const kaito = kaitoInstance(opts.loyalty ?? 4);
    const active = opts.activePlayerId ?? "p1";
    const state = makeState({
        activePlayerId: active,
        priorityPlayerId: active,
        phase: "PRECOMBAT_MAIN",
        players: [
            makePlayer("p1", {
                battlefield: [kaito],
                library: library(["l1", "l2", "l3", "l4"]),
            }),
            makePlayer("p2", { battlefield: opts.p2Battlefield ?? [] }),
        ],
    });
    beginApplyingStaticEffects(state, kaito);
    checkStateBasedActions(state);
    refreshExpectedInput(state);
    return { state, kaito };
}

function activate(state: GameState, abilityId: string) {
    activateAbilityOnState(state, {
        playerId: "p1",
        cardInstanceId: "kaito",
        abilityId,
    });
}

/** Resolves Kaito's 0 through its surveil choice, keeping both looked-at
 *  cards on top (CR 701.25a — "any number" into the graveyard, here none). */
function resolveZero(state: GameState) {
    expect(resolveTopOfStack(state)).toBeNull();
    const head = state.pendingChoices![0];
    expect(head.kind).toBe("order-top");
    expect(head.destination).toBe("graveyard");
    applyPendingChoiceSubmit(state, {
        playerId: head.playerId,
        stackItemId: head.stackItemId,
        step: head.step,
        choiceId: head.choiceId,
        cardInstanceIds: ["l1", "l2"],
        secondZoneIds: [],
    });
}

const handIds = (state: GameState) => state.players[0].hand.map((c) => c.id);

describe("Kaito, Bane of Nightmares — conditional 3/4 Ninja creature (CR 611.3a / 205.1a)", () => {
    it("during your turn he is a 3/4 Ninja creature with hexproof and not a planeswalker", () => {
        const { state, kaito } = board({});
        expect(kaito.types).toEqual(["Creature"]);
        expect(kaito.subtypes).toEqual(["Ninja"]);
        expect(kaito.staticAbilities).toContain("hexproof");
        expect(getEffectivePower(view(state), asView(kaito))).toBe(3);
        expect(getEffectiveToughness(view(state), asView(kaito))).toBe(4);
        // Wire: both seats see the creature (the client draws what it sees).
        for (const viewer of ["p1", "p2"]) {
            const slim = projectPublicState(state, 1, viewer).players[0]
                .battlefield[0];
            expect(slim.types).toEqual(["Creature"]);
            expect(slim.subtypes).toEqual(["Ninja"]);
        }
    });

    it("during the opponent's turn he is a planeswalker, attackable, without hexproof", () => {
        const { state, kaito } = board({ activePlayerId: "p2" });
        expect(kaito.types).toEqual(["Planeswalker"]);
        expect(kaito.subtypes).toEqual(["Kaito"]);
        expect(kaito.staticAbilities ?? []).not.toContain("hexproof");
        const slim = projectPublicState(state, 1, "p2").players[0]
            .battlefield[0];
        expect(slim.types).toEqual(["Planeswalker"]);
    });

    it("damage dealt to him as a creature is marked and removes no loyalty (printed ruling)", () => {
        const { state, kaito } = board({});
        pushSpell(state, lightningBolt().id, "p1", [
            { type: "permanent", id: "kaito" },
        ]);
        resolveTopOfStack(state);
        expect(kaito.damageMarked).toBe(3);
        expect(kaito.counters?.loyalty).toBe(4);
        checkStateBasedActions(state);
        // 3 damage on a 3/4 is not lethal (CR 704.5g).
        expect(state.players[0].battlefield.some((c) => c.id === "kaito")).toBe(
            true
        );
    });

    it("his loyalty abilities stay activatable while he is a creature (CR 606.4)", () => {
        const { state, kaito } = board({});
        activate(state, "kaito-bane-of-nightmares-plus1");
        expect(kaito.counters?.loyalty).toBe(5);
        resolveTopOfStack(state);
        checkStateBasedActions(state);
        // +1 emblem: Kaito is a Ninja creature you control → 4/5 (CR 613.4c).
        expect(state.emblems?.map((e) => e.ownerId)).toEqual(["p1"]);
        expect(getEffectivePower(view(state), asView(kaito))).toBe(4);
        expect(getEffectiveToughness(view(state), asView(kaito))).toBe(5);
    });
});

describe("Kaito, Bane of Nightmares — 0: surveil 2, then draw per opponent who lost life (CR 119.3)", () => {
    it("draws one card when the opponent lost life this turn", () => {
        const { state } = board({});
        loseLifeEmitting(state, "p2", 2);
        activate(state, "kaito-bane-of-nightmares-0");
        resolveZero(state);
        expect(handIds(state)).toEqual(["l1"]);
    });

    it("draws nothing when no opponent lost life — your own loss does not count", () => {
        const { state } = board({});
        loseLifeEmitting(state, "p1", 3);
        activate(state, "kaito-bane-of-nightmares-0");
        resolveZero(state);
        expect(handIds(state)).toEqual([]);
    });

    it("counts a loss even when a larger gain the same turn left the life total higher (printed ruling)", () => {
        const { state } = board({});
        gainLifeEmitting(state, "p2", 2);
        loseLifeEmitting(state, "p2", 1);
        expect(state.players[1].life).toBe(21);
        activate(state, "kaito-bane-of-nightmares-0");
        resolveZero(state);
        expect(handIds(state)).toEqual(["l1"]);
    });

    it("counts damage dealt to the opponent (CR 120.3a)", () => {
        const { state } = board({});
        pushSpell(state, lightningBolt().id, "p1", [
            { type: "player", id: "p2" },
        ]);
        resolveTopOfStack(state);
        expect(state.lifeLostThisTurn?.p2).toBe(3);
        activate(state, "kaito-bane-of-nightmares-0");
        resolveZero(state);
        expect(handIds(state)).toEqual(["l1"]);
    });
});

describe("Kaito, Bane of Nightmares — −2: tap target creature, two stun counters (CR 122.1d)", () => {
    it("taps the target and puts two stun counters on it", () => {
        const bears = makeInstance(grizzlyBears().id, {
            id: "bears",
            controllerId: "p2",
            ownerId: "p2",
        });
        const { state, kaito } = board({ p2Battlefield: [bears] });
        activate(state, "kaito-bane-of-nightmares-minus2");
        // CR 601.2c / 602.2b — the target is chosen, then the loyalty cost
        // is paid as the ability goes on the stack (CR 606.4).
        expect(state.pendingTarget).toBeDefined();
        state.pendingTarget!.selected = [{ type: "permanent", id: "bears" }];
        finalizeTargetSelection(state, state.pendingTarget!, "p1");
        expect(kaito.counters?.loyalty).toBe(2);
        resolveTopOfStack(state);
        expect(bears.isTapped).toBe(true);
        expect(bears.counters?.stun).toBe(2);
    });
});

describe("Kaito, Bane of Nightmares — Ninjutsu {1}{U}{B} (CR 702.49a)", () => {
    it("enters tapped and attacking with his loyalty, a 3/4 Ninja creature on your turn", () => {
        const attacker = {
            id: "a1",
            card: { id: grizzlyBears().id },
            types: ["Creature"],
            subtypes: ["Bear"],
            power: 2,
            toughness: 2,
            staticAbilities: [],
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
            isTapped: true,
            isAttacking: true,
        } as unknown as CardInstanceState;
        const kaito = makeInstance(KAITO, {
            id: "kaito",
            zone: "hand",
            controllerId: "p1",
            ownerId: "p1",
        });
        const walker = makeInstance(wrennAndSix().id, {
            id: "pw-1",
            controllerId: "p2",
            ownerId: "p2",
            counters: { loyalty: 3 },
        });
        const state = makeState({
            phase: "DECLARE_BLOCKERS",
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            players: [
                makePlayer("p1", {
                    battlefield: [attacker],
                    hand: [kaito],
                    manaPool: { W: 0, U: 1, B: 1, R: 0, G: 0, C: 1 },
                }),
                makePlayer("p2", { battlefield: [walker] }),
            ],
            combat: {
                attackerIds: ["a1"],
                confirmed: true,
                blockerAssignments: {},
                blockersConfirmed: true,
            },
        });
        refreshExpectedInput(state);
        activateAbilityOnState(state, {
            playerId: "p1",
            cardInstanceId: "kaito",
            abilityId: "ninjutsu",
        });
        resolveTopOfStack(state);
        checkStateBasedActions(state);
        const onField = state.players[0].battlefield.find(
            (c) => c.id === "kaito"
        )!;
        expect(onField).toBeDefined();
        // CR 306.5b — he enters with his printed loyalty in counters.
        expect(onField.counters?.loyalty).toBe(4);
        expect(onField.isTapped).toBe(true);
        expect(onField.isAttacking).toBe(true);
        expect(state.combat!.attackerIds).toContain("kaito");
        expect(onField.types).toEqual(["Creature"]);
        expect(onField.subtypes).toEqual(["Ninja"]);
    });
});
