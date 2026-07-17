// Draw-replacement seam (CR 614 / 616.1, ADR 0061). Covers the unified `"draw"`
// ReplacementEvent, the single suspend-capable draw seam (plan/commit), CR 616.1
// ordering by the affected player, the DSL `draw` Op's interactive suspend +
// resume (PRD #779 S2), the wire projection (S5), and serialization (S7). The
// two migrated #735 cards (Zur's Weirding, Enduring Renewal) keep their own
// per-card tests in `sets/ice/__tests__`; here we exercise the seam itself,
// including the `prevent` (Leovold) and `modify-count` (Quantum Riddler) outcome
// shapes no shipping card uses yet (ADR 0061 stories 8 & 16).

import { describe, it, expect } from "vitest";
import type { EffectOp } from "../../cards/types";
import { registerTokenDefinition, getCardByName } from "../../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup";
import {
    buildDrawEvent,
    drawPlanForOutcome,
    commitDrawPlan,
    resolveTopOfStack,
} from "../state";
import { getApplicableDrawReplacements } from "../replacements";
import { applyMayPaySubmit } from "../pendingChoiceSubmit";
import { advancePhase } from "../phases";
import { compactState, expandState } from "../serialize";
import { projectPublicState } from "../../gameProjections";
import { zursWeirding } from "../../cards/sets/ice/blue";
import { enduringRenewal } from "../../cards/sets/ice/white";
import { TREASURE_TOKEN } from "../../cards/sharedTokens";

const bearsId = getCardByName("Balduvian Bears").id;
const plainsId = getCardByName("Plains").id;

function zursInstance(controllerId: string) {
    return makeInstance(zursWeirding.id, {
        controllerId,
        ownerId: controllerId,
    });
}
function enduringInstance(controllerId: string) {
    return makeInstance(enduringRenewal.id, {
        controllerId,
        ownerId: controllerId,
    });
}

describe("draw event payload (CR 121.1, ADR 0061)", () => {
    it("drawIndexThisTurn reads drawnThisTurn (promoted read-side source)", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { drawnThisTurn: ["a", "b"] }),
                makePlayer("p2"),
            ],
        });
        const event = buildDrawEvent(state, "p1", 3, true);
        expect(event).toEqual({
            kind: "draw",
            drawingPlayer: "p1",
            drawIndexThisTurn: 2, // two cards already drawn this turn
            isTurnBasedDrawStepDraw: true,
            requestedCount: 3,
        });
    });

    it("drawIndexThisTurn is 0 for the first draw of the turn", () => {
        const state = makeState();
        expect(buildDrawEvent(state, "p1", 1, false).drawIndexThisTurn).toBe(0);
    });
});

describe("draw-replacement outcomes → plan (CR 614, ADR 0061)", () => {
    const baseCtx = {
        libraryEmpty: false,
        topCardHasType: () => false,
        revealedCardId: "top",
        chooserId: "p2",
        chooserCanAfford: () => true,
        beneficiaryId: "p1",
    };

    it("prevent → no draw (Leovold, story 8)", () => {
        expect(drawPlanForOutcome({ kind: "prevent" }, baseCtx)).toEqual({
            kind: "prevent",
        });
    });

    it("modify-count → draw N+delta (Quantum Riddler, story 16)", () => {
        expect(
            drawPlanForOutcome({ kind: "modify-count", delta: 1 }, baseCtx)
        ).toEqual({ kind: "normal", count: 2 });
        // A -1 delta clamps to 0 (never negative).
        expect(
            drawPlanForOutcome({ kind: "modify-count", delta: -2 }, baseCtx)
        ).toEqual({ kind: "normal", count: 0 });
    });

    it("redirect-to-token → create-token plan for the beneficiary (Hullbreacher)", () => {
        expect(
            drawPlanForOutcome(
                { kind: "redirect-to-token", token: TREASURE_TOKEN, count: 1 },
                baseCtx
            )
        ).toEqual({
            kind: "create-token",
            beneficiaryId: "p1", // the replacement source's controller
            token: TREASURE_TOKEN,
            count: 1,
        });
        // Redirect ignores an empty library (the draw is replaced entirely).
        expect(
            drawPlanForOutcome(
                { kind: "redirect-to-token", token: TREASURE_TOKEN, count: 1 },
                { ...baseCtx, libraryEmpty: true }
            )
        ).toMatchObject({ kind: "create-token", count: 1 });
    });

    it("reveal-type-to-graveyard: creature top → bin, else normal (Enduring Renewal)", () => {
        const outcome = {
            kind: "reveal-type-to-graveyard",
            cardType: "Creature",
        } as const;
        expect(
            drawPlanForOutcome(outcome, {
                ...baseCtx,
                topCardHasType: () => true,
            })
        ).toEqual({ kind: "bin" });
        expect(
            drawPlanForOutcome(outcome, {
                ...baseCtx,
                topCardHasType: () => false,
            })
        ).toEqual({ kind: "normal", count: 1 });
        // Empty library short-circuits to a normal draw (flags hasDrawnFromEmpty).
        expect(
            drawPlanForOutcome(outcome, { ...baseCtx, libraryEmpty: true })
        ).toEqual({ kind: "normal", count: 1 });
    });

    it("reveal-others-may-pay-life: affordable → may-pay-bin (Zur's Weirding)", () => {
        expect(
            drawPlanForOutcome(
                { kind: "reveal-others-may-pay-life", life: 2 },
                baseCtx
            )
        ).toEqual({
            kind: "may-pay-bin",
            chooserId: "p2",
            life: 2,
            revealedCardId: "top",
        });
    });

    it("reveal-others-may-pay-life: CR 119.4 chooser can't afford → normal draw", () => {
        expect(
            drawPlanForOutcome(
                { kind: "reveal-others-may-pay-life", life: 2 },
                { ...baseCtx, chooserCanAfford: () => false }
            )
        ).toEqual({ kind: "normal", count: 1 });
    });
});

describe("CR 616.1 — multiple applicable draw-replacements ordered by the affected player", () => {
    it("the drawing player's OWN replacement is ordered first", () => {
        // p1 controls Enduring Renewal (controller scope); p2 controls Zur's
        // (all-players scope). A p1 draw is affected by BOTH.
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [enduringInstance("p1")] }),
                makePlayer("p2", { battlefield: [zursInstance("p2")] }),
            ],
        });
        const event = buildDrawEvent(state, "p1", 1, false);
        const applicable = getApplicableDrawReplacements(state, event);
        expect(applicable).toHaveLength(2);
        // CR 616.1c — the affected (drawing) player orders them; own first.
        expect(applicable[0].effect.id).toBe("enduring-renewal-draw");
        expect(applicable[1].effect.id).toBe("zurs-weirding-draw");
    });

    it("a controller-scoped replacement does not apply to an opponent's draw", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [enduringInstance("p1")] }),
                makePlayer("p2"),
            ],
        });
        const event = buildDrawEvent(state, "p2", 1, false);
        expect(getApplicableDrawReplacements(state, event)).toHaveLength(0);
    });
});

describe("commitDrawPlan (CR 614/704.5b, ADR 0061)", () => {
    it("modify-count normal plan draws N cards", () => {
        const lib = [
            makeInstance(plainsId, {
                id: "c1",
                ownerId: "p1",
                zone: "library",
            }),
            makeInstance(plainsId, {
                id: "c2",
                ownerId: "p1",
                zone: "library",
            }),
        ];
        const state = makeState({
            players: [makePlayer("p1", { library: lib }), makePlayer("p2")],
        });
        const drew = commitDrawPlan(state, "p1", { kind: "normal", count: 2 });
        expect(drew).toBe(2);
        expect(state.players[0].hand).toHaveLength(2);
    });

    it("prevent draws nothing and does NOT flag draw-from-empty", () => {
        const state = makeState({
            players: [makePlayer("p1", { library: [] }), makePlayer("p2")],
        });
        const drew = commitDrawPlan(state, "p1", { kind: "prevent" });
        expect(drew).toBe(0);
        expect(state.players[0].hasDrawnFromEmpty).toBeFalsy();
    });

    it("create-token makes tokens for the beneficiary and draws nothing (Hullbreacher)", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    library: [
                        makeInstance(plainsId, {
                            id: "c1",
                            ownerId: "p1",
                            zone: "library",
                        }),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        const drew = commitDrawPlan(state, "p1", {
            kind: "create-token",
            beneficiaryId: "p2",
            token: TREASURE_TOKEN,
            count: 1,
        });
        expect(drew).toBe(0);
        // Drawing player drew nothing; library untouched; no empty-library loss.
        expect(state.players[0].hand).toHaveLength(0);
        expect(state.players[0].library).toHaveLength(1);
        expect(state.players[0].hasDrawnFromEmpty).toBeFalsy();
        // Beneficiary got a Treasure on the battlefield.
        const treasures = state.players[1].battlefield.filter((c) =>
            c.subtypes.includes("Treasure")
        );
        expect(treasures).toHaveLength(1);
    });
});

// --- S2: DSL `draw` Op funnels through the suspend-capable seam ---------------

/** A synthetic sorcery whose only effect is a DSL `draw` Op (registered under a
 *  test id, so the catalogue sweep never sees it). Drives the interactive draw
 *  replacement through the real `resolveTopOfStack` path. */
function registerDrawSpell(id: string, count: number): string {
    registerTokenDefinition({
        id,
        name: id,
        rarity: "common",
        manaCost: { U: 1 },
        types: ["Sorcery"],
        effects: [{ op: "draw", player: "controller", count } as EffectOp],
    });
    return id;
}

describe("DSL draw Op under Zur's Weirding (CR 614, #1250 — effect-draw suspension)", () => {
    function stateCastingDraw(id: string, p2Life = 20) {
        // p1 casts the draw spell; p2 controls Zur's and decides the pay.
        const top = makeInstance(bearsId, {
            id: "p1-top",
            ownerId: "p1",
            zone: "library",
        });
        const top2 = makeInstance(plainsId, {
            id: "p1-top2",
            ownerId: "p1",
            zone: "library",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { library: [top, top2] }),
                makePlayer("p2", {
                    life: p2Life,
                    battlefield: [zursInstance("p2")],
                }),
            ],
        });
        pushSpell(state, id, "p1");
        return state;
    }

    it("suspends on a may-pay choice for the other player, then bins when paid", () => {
        const id = registerDrawSpell("test-draw-op-zurs-pay", 1);
        const state = stateCastingDraw(id);
        expect(resolveTopOfStack(state)).toBeNull(); // suspended
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("may-pay");
        expect(head.playerId).toBe("p2");
        expect(state.stack).toHaveLength(1); // CR 608.3 — still resolving
        applyMayPaySubmit(state, { playerId: "p2", accept: true });
        // Paid → revealed card binned, p1 drew nothing.
        expect(state.players[0].graveyard.map((c) => c.id)).toContain("p1-top");
        expect(state.players[0].hand).toHaveLength(0);
        expect(state.players[1].life).toBe(18); // p2 paid 2 life
        expect(state.stack).toHaveLength(0);
    });

    it("draws the revealed card when the payment is declined", () => {
        const id = registerDrawSpell("test-draw-op-zurs-decline", 1);
        const state = stateCastingDraw(id);
        resolveTopOfStack(state);
        applyMayPaySubmit(state, { playerId: "p2", accept: false });
        expect(state.players[0].hand.map((c) => c.id)).toContain("p1-top");
        expect(state.players[1].life).toBe(20);
        expect(state.stack).toHaveLength(0);
    });

    it("a two-card draw suspends and resumes PER CARD (replay-safe loop)", () => {
        const id = registerDrawSpell("test-draw-op-zurs-two", 2);
        const state = stateCastingDraw(id);
        // First card: suspend, decline → p1 draws p1-top.
        resolveTopOfStack(state);
        expect(state.pendingChoices![0].kind).toBe("may-pay");
        applyMayPaySubmit(state, { playerId: "p2", accept: false });
        // Second card: suspends again (a fresh may-pay), pay → bin p1-top2.
        expect(state.pendingChoices?.[0]?.kind).toBe("may-pay");
        applyMayPaySubmit(state, { playerId: "p2", accept: true });
        // Exactly one card drawn (the first), one binned (the second); no double-draw.
        expect(state.players[0].hand.map((c) => c.id)).toEqual(["p1-top"]);
        expect(state.players[0].graveyard.map((c) => c.id)).toContain(
            "p1-top2"
        );
        expect(state.players[1].life).toBe(18); // paid once
        expect(state.stack).toHaveLength(0);
    });
});

// --- S5: wire projection ------------------------------------------------------

describe("draw-replacement pending choice survives projectPublicState (S5)", () => {
    it("the draw-step choice + revealed card cross the wire", () => {
        const top = makeInstance(bearsId, {
            id: "p1-top",
            ownerId: "p1",
            zone: "library",
        });
        const state = makeState({
            turn: 2,
            phase: "UPKEEP",
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            players: [
                makePlayer("p1", { library: [top] }),
                makePlayer("p2", { battlefield: [zursInstance("p2")] }),
            ],
        });
        advancePhase(state); // → DRAW step raises the draw-replacement choice
        expect(state.pendingChoices?.[0].kind).toBe("draw-replacement");
        // "they reveal it": the would-be-drawn card is known to the payer on the
        // fat state (before projection strips raw knownTo).
        const fatTop = state.players[0].library.find((c) => c.id === "p1-top")!;
        expect(fatTop.knownTo).toContain("p2");

        // The choice contract the affordance reads survives the wire: kind,
        // chooser, revealed card id, and the life cost all cross projection.
        const projected = projectPublicState(state, 1, "p2");
        const head = projected.pendingChoices?.[0];
        expect(head?.kind).toBe("draw-replacement");
        expect(head?.playerId).toBe("p2");
        expect(head?.cardInstanceId).toBe("p1-top");
        expect(head?.cost).toEqual({ life: 2 });
    });
});

// --- S7: serialization drift --------------------------------------------------

describe("draw-replacement pending choice round-trips through serialize (S7)", () => {
    it("compact → expand preserves the choice", () => {
        const state = makeState({
            pendingChoices: [
                {
                    stackItemId: "",
                    step: 0,
                    choiceId: "draw-replacement-p1",
                    playerId: "p2",
                    zoneOwnerId: "p1",
                    kind: "draw-replacement",
                    cardInstanceId: "p1-top",
                    cost: { life: 2 },
                    count: 1,
                    prompt: "You may pay 2 life…",
                },
            ],
        });
        const round = expandState(compactState(state));
        expect(round.pendingChoices?.[0]).toMatchObject({
            kind: "draw-replacement",
            playerId: "p2",
            zoneOwnerId: "p1",
            cardInstanceId: "p1-top",
            cost: { life: 2 },
        });
    });
});
