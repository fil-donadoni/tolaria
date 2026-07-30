// Planeshift (PLS) — black behavior tests (ADR 0043 colour split, issue #1940).
//
// Warped Devotion reuses `PERMANENT_LEFT` (CR 603.10) via `leftTrigger({
// scope: "any", toZone: "hand" })` plus a new `EVENT_FIELD_REGISTRY` row
// (`PERMANENT_LEFT.ownerId`, ADR 0049) — a genuinely new construct
// combination (a `{ ref: "$event.ownerId" }` read of the LEAVING permanent's
// owner rather than `ctx.controller`) that the auto-generated
// canned-scenario smoke sweep cannot drive: its generator treats ANY
// `{ ref: "$event.*" }` player parameter as "depends on a runtime snapshot"
// and reports an explicit skip (`scenarioGenerator.ts`'s
// `resolveScenarioPlayer`), exactly the signal documented in
// `.claude/rules/gre-development.md` to add a hand-written test — mirroring
// Collapsing Borders' own hand-written test (`inv/__tests__/red.test.ts`)
// for the identical reason. Per the per-Op regime (ADR 0045/0046) this earns
// its own coverage here.

import { describe, it, expect } from "vitest";
import { warpedDevotion, noxiousVapors } from "../black";
import { unsummon, savannahLions, grizzlyBears, island } from "../../lea";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import {
    resolveTopOfStack,
    removePermanentTo,
    processPendingActionTriggers,
    buildSpellContext,
    drawCard,
    emitCardDrawn,
    getPlayer,
    type GameState,
} from "../../../../gre/state";
import { applyPendingChoiceSubmit } from "../../../../gre/pendingChoiceSubmit";
import { applySacrificeSelection } from "../../../../gre/sacrificeChoice";
import { projectPublicState } from "../../../../gameProjections";
import { registerTokenDefinition } from "../../..";

/** Answers the head `pendingChoices` entry (a `choice(kind: "choose-hand-card")`
 *  suspension) with the given card instance id (CR 608.2). */
function submitDiscard(state: GameState, cardInstanceId: string): void {
    const head = state.pendingChoices![0];
    applyPendingChoiceSubmit(state, {
        playerId: head.playerId,
        stackItemId: head.stackItemId,
        step: head.step,
        choiceId: head.choiceId,
        cardInstanceIds: [cardInstanceId],
    });
}

describe("Warped Devotion (CR 603.2 returned-to-hand trigger, issue #1940)", () => {
    it("fires when an OPPONENT's creature is bounced by a spell, and the OPPONENT (not Warped Devotion's controller) discards", () => {
        const bounced = makeInstance(savannahLions.id, {
            id: "bounced",
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
        });
        const p2Filler = makeInstance(grizzlyBears.id, {
            id: "p2-filler",
            controllerId: "p2",
            ownerId: "p2",
            zone: "hand",
        });
        const devotion = makeInstance(warpedDevotion.id, {
            id: "devotion",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [devotion],
                    library: [makeInstance(unsummon.id, { zone: "library" })],
                }),
                makePlayer("p2", { battlefield: [bounced], hand: [p2Filler] }),
            ],
        });
        const unsummonItem = pushSpell(state, unsummon.id, "p1", [
            { type: "permanent", id: "bounced" },
        ]);
        // Unsummon resolves (moveZone → returnToHand → removePermanentTo,
        // the shared zone-move funnel), which places Warped Devotion's
        // trigger on the stack automatically (resolveTopOfStack drains
        // pendingEvents via processPendingActionTriggers).
        resolveTopOfStack(state);
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].triggeredAbilityId).toBe(
            "warped-devotion-bounce"
        );
        // Warped Devotion's ability resolves; its `choice` Op suspends
        // waiting for the DISCARDING PLAYER's own pick (CR 608.2).
        resolveTopOfStack(state);
        const head = state.pendingChoices![0];
        // The player who must discard is p2 — the RETURNING permanent's
        // owner — even though Warped Devotion's controller is p1. Proves the
        // ability reads `$event.ownerId`, not `ctx.controller`.
        expect(head.playerId).toBe("p2");
        expect(state.players[1].hand.map((c) => c.id).sort()).toEqual(
            ["bounced", "p2-filler"].sort()
        );
        submitDiscard(state, "p2-filler");
        // The bounced creature itself stays in hand (a real discard-a-card
        // choice, not an auto-pick of the just-returned permanent).
        expect(state.players[1].hand.map((c) => c.id)).toEqual(["bounced"]);
        expect(state.players[1].graveyard.map((c) => c.id)).toEqual([
            "p2-filler",
        ]);
        // p1 (Warped Devotion's own controller) never discards — only the
        // resolved Unsummon spell itself sits in their graveyard.
        expect(state.players[0].hand).toHaveLength(0);
        expect(state.players[0].graveyard.map((c) => c.id)).toEqual([
            unsummonItem.id,
        ]);

        // Wire format — same assertions survive the projection (both zones
        // are public here: CR 400.3/ADR 0026 made "bounced" known to all,
        // and a graveyard is always public).
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.players[1].hand).toHaveLength(1);
        expect(
            projected.players[1].graveyard.some((c) => c.id === "p2-filler")
        ).toBe(true);
    });

    it("fires symmetrically when Warped Devotion's OWN controller bounces their own creature — they discard too", () => {
        const bounced = makeInstance(savannahLions.id, {
            id: "self-bounced",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const p1Filler = makeInstance(grizzlyBears.id, {
            id: "p1-filler",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const devotion = makeInstance(warpedDevotion.id, {
            id: "devotion",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [devotion, bounced],
                    hand: [
                        p1Filler,
                        makeInstance(unsummon.id, { zone: "hand" }),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, unsummon.id, "p1", [
            { type: "permanent", id: "self-bounced" },
        ]);
        resolveTopOfStack(state); // Unsummon
        resolveTopOfStack(state); // Warped Devotion — suspends on choice
        expect(state.pendingChoices![0].playerId).toBe("p1");
        submitDiscard(state, "p1-filler");
        expect(
            state.players[0].graveyard.some((c) => c.id === "p1-filler")
        ).toBe(true);
    });

    it("fires once per permanent when one effect returns two permanents simultaneously", () => {
        const bounced1 = makeInstance(savannahLions.id, {
            id: "bounced-1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const bounced2 = makeInstance(grizzlyBears.id, {
            id: "bounced-2",
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
        });
        const devotion = makeInstance(warpedDevotion.id, {
            id: "devotion",
            controllerId: "p1",
            ownerId: "p1",
        });
        const p1Filler = makeInstance(grizzlyBears.id, {
            id: "p1-filler-2",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const p2Filler = makeInstance(savannahLions.id, {
            id: "p2-filler-2",
            controllerId: "p2",
            ownerId: "p2",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [devotion, bounced1],
                    hand: [p1Filler],
                }),
                makePlayer("p2", {
                    battlefield: [bounced2],
                    hand: [p2Filler],
                }),
            ],
        });
        // Simulates a single resolving effect that bounces BOTH permanents in
        // one step (e.g. a "return each creature" sweep) — every
        // battlefield-sourced bounce, single or bulk, funnels through this
        // same `removePermanentTo` primitive, once per permanent moved.
        removePermanentTo(state, "bounced-1", "hand");
        removePermanentTo(state, "bounced-2", "hand");
        processPendingActionTriggers(state);
        // Two firings of the SAME printed ability auto-order in collection
        // order (ADR 0003) — no player ordering choice is owed, they just
        // land on the stack directly.
        expect(state.stack).toHaveLength(2);

        resolveTopOfStack(state);
        let head = state.pendingChoices![0];
        submitDiscard(
            state,
            head.playerId === "p1" ? "p1-filler-2" : "p2-filler-2"
        );

        resolveTopOfStack(state);
        head = state.pendingChoices![0];
        submitDiscard(
            state,
            head.playerId === "p1" ? "p1-filler-2" : "p2-filler-2"
        );

        expect(state.players[0].graveyard.map((c) => c.id)).toContain(
            "p1-filler-2"
        );
        expect(state.players[1].graveyard.map((c) => c.id)).toContain(
            "p2-filler-2"
        );
    });

    it("fires when a permanent is returned to hand as a COST PAYMENT (sacrificeChoice action: return)", () => {
        // `applySacrificeSelection` with `action: "return"` is the exact
        // real-path function backing every return-to-hand alternative /
        // additional cost (Gush/Thwart, Kicker return-costs — CR 118.9 /
        // 701.24). It bounces via `removePermanentTo`, the SAME funnel a
        // spell effect uses, so it fires PERMANENT_LEFT (toZone: "hand")
        // identically — no separate wiring needed for a cost-driven bounce.
        const paidIsland = makeInstance(island.id, {
            id: "island-cost",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const p1Filler = makeInstance(grizzlyBears.id, {
            id: "p1-filler-cost",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const devotion = makeInstance(warpedDevotion.id, {
            id: "devotion",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [devotion, paidIsland],
                    hand: [p1Filler],
                }),
                makePlayer("p2"),
            ],
        });
        applySacrificeSelection(state, {
            playerId: "p1",
            reason: "Gush-style return-to-hand cost",
            requirements: [{ filter: { subtypes: "Island" }, count: 1 }],
            picked: ["island-cost"],
            action: "return",
        });
        processPendingActionTriggers(state);
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].triggeredAbilityId).toBe(
            "warped-devotion-bounce"
        );
        resolveTopOfStack(state);
        expect(state.pendingChoices![0].playerId).toBe("p1");
        submitDiscard(state, "p1-filler-cost");
        expect(
            state.players[0].graveyard.some((c) => c.id === "p1-filler-cost")
        ).toBe(true);
    });

    it("does NOT fire on a real draw (library → hand never touches the battlefield)", () => {
        const devotion = makeInstance(warpedDevotion.id, {
            id: "devotion",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [devotion],
                    library: [
                        makeInstance(savannahLions.id, { zone: "library" }),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        const stackBefore = state.stack.length;
        // Real draw path — the same two calls `commitDrawPlan`'s "normal"
        // case makes: `drawCard` actually moves the card library → hand,
        // `emitCardDrawn` queues the real CARD_DRAWN event. No
        // PERMANENT_LEFT is ever involved — the card was never a
        // battlefield permanent.
        expect(drawCard(getPlayer(state, "p1"))).not.toBeNull();
        emitCardDrawn(state, "p1", 1);
        processPendingActionTriggers(state);
        expect(state.stack).toHaveLength(stackBefore);
        expect(state.pendingChoices ?? []).toHaveLength(0);
    });

    it("does NOT fire on a real graveyard → hand move (e.g. a Regrowth-style effect)", () => {
        const devotion = makeInstance(warpedDevotion.id, {
            id: "devotion",
            controllerId: "p1",
            ownerId: "p1",
        });
        const inGraveyard = makeInstance(savannahLions.id, {
            id: "gy-card",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [devotion],
                    graveyard: [inGraveyard],
                }),
                makePlayer("p2"),
            ],
        });
        const item = pushSpell(state, grizzlyBears.id, "p1");
        const ctx = buildSpellContext(state, item);
        const stackBefore = state.stack.length;
        // Real zone-move path: `moveCardById` routes through
        // `moveCardWithGraveyardReplacement`, NEVER `removePermanentTo` — a
        // graveyard card isn't a battlefield permanent, so PERMANENT_LEFT
        // never fires regardless of destination zone.
        ctx.moveCardById("p1", "gy-card", "graveyard", "hand");
        processPendingActionTriggers(state);
        expect(state.stack).toHaveLength(stackBefore);
        expect(state.pendingChoices ?? []).toHaveLength(0);
        expect(state.players[0].hand.some((c) => c.id === "gy-card")).toBe(
            true
        );
    });
});

// Noxious Vapors — new Op (`chooseCategorized`, issue #1945) → full per-Op
// regime: the interpreter suite (`gre/effects/__tests__/interpreter.test.ts`)
// covers the Op's general shape (hand/battlefield, sweep, bipartite matching,
// both auto-resolve paths); this describe proves the CARD's own script end
// to end through the real resolution path, symmetric across BOTH players in
// one cast (CR 601.2b "each player", APNAP order via `forEach { set:
// "players" }`).
const NV_ARTIFACT_ID = "test-pls-nv-artifact";
registerTokenDefinition({
    id: NV_ARTIFACT_ID,
    name: NV_ARTIFACT_ID,
    rarity: "common",
    manaCost: { X: 1 },
    types: ["Artifact"],
});

describe("Noxious Vapors (CR 601.2b / 701.9, issue #1945)", () => {
    it("each player keeps one card of each colour they hold and discards every other nonland card, in APNAP order", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    hand: [
                        // TWO white creatures — a real "which one" decision
                        // (a single candidate would auto-resolve with no
                        // prompt, per the forced-pick path). Plus a
                        // colourless artifact and a land.
                        makeInstance(savannahLions.id, {
                            id: "p1-white-a",
                            controllerId: "p1",
                            ownerId: "p1",
                            zone: "hand",
                        }),
                        makeInstance(savannahLions.id, {
                            id: "p1-white-b",
                            controllerId: "p1",
                            ownerId: "p1",
                            zone: "hand",
                        }),
                        makeInstance(NV_ARTIFACT_ID, {
                            id: "p1-artifact",
                            controllerId: "p1",
                            ownerId: "p1",
                            zone: "hand",
                        }),
                        makeInstance(island.id, {
                            id: "p1-island-card",
                            controllerId: "p1",
                            ownerId: "p1",
                            zone: "hand",
                        }),
                    ],
                }),
                makePlayer("p2", {
                    hand: [
                        // Green only — p2 has no card of any OTHER colour, a
                        // FORCED (single-candidate) pick that auto-resolves
                        // with no prompt.
                        makeInstance(grizzlyBears.id, {
                            id: "p2-green",
                            controllerId: "p2",
                            ownerId: "p2",
                            zone: "hand",
                        }),
                    ],
                }),
            ],
        });
        pushSpell(state, noxiousVapors.id, "p1");
        // p1's choice is a real decision (two White candidates) — suspends.
        // p2's is FORCED (one card, one colour) and auto-resolves once
        // p1's answer lets the forEach reach it, so only ONE choice is ever
        // raised (CR 608.2b — never prompt for a non-decision).
        expect(resolveTopOfStack(state)).toBeNull();

        // APNAP: the active player (p1, the caster) answers first.
        const head = state.pendingChoices![0];
        expect(head.playerId).toBe("p1");
        expect(head.kind).toBe("choose-categorized");
        expect(head.zone).toBe("hand");
        expect(head.categories).toEqual(
            expect.arrayContaining([
                { label: "White", cardIds: ["p1-white-a", "p1-white-b"] },
            ])
        );
        applyPendingChoiceSubmit(state, {
            playerId: head.playerId,
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["p1-white-a"],
        });

        // p2's forced pick auto-resolved in the same pass — nothing left
        // pending.
        expect(state.pendingChoices ?? []).toHaveLength(0);
        // p1 keeps ONE white creature AND the land (lands are never
        // discarded); the other white creature and the colourless artifact
        // are both swept (nonland, not kept).
        expect(state.players[0].hand.map((c) => c.id).sort()).toEqual(
            ["p1-island-card", "p1-white-a"].sort()
        );
        // The resolved sorcery itself also lands in its owner's graveyard
        // (CR 608.2m, under its OWN generated instance id) alongside the two
        // swept cards — filter it out by DEFINITION id to isolate the sweep.
        const p1GraveyardSweptIds = state.players[0].graveyard
            .filter((c) => c.card.id !== noxiousVapors.id)
            .map((c) => c.id)
            .sort();
        expect(p1GraveyardSweptIds).toEqual(
            ["p1-artifact", "p1-white-b"].sort()
        );
        expect(
            state.players[0].graveyard.some(
                (c) => c.card.id === noxiousVapors.id
            )
        ).toBe(true);
        // p2 keeps their only card (nothing else to sweep).
        expect(state.players[1].hand.map((c) => c.id)).toEqual(["p2-green"]);
        expect(state.players[1].graveyard).toHaveLength(0);

        // Wire format: the projection agrees with the fat state for both
        // viewers (ADR 0045 GRE testing convention).
        const projectedP1 = projectPublicState(state, 1, "p1");
        expect(projectedP1.players[0].hand.map((c) => c?.id).sort()).toEqual(
            ["p1-island-card", "p1-white-a"].sort()
        );
        const projectedSweptIds = projectedP1.players[0].graveyard
            .filter((c) => c.card.id !== noxiousVapors.id)
            .map((c) => c.id)
            .sort();
        expect(projectedSweptIds).toEqual(["p1-artifact", "p1-white-b"].sort());
    });
});
