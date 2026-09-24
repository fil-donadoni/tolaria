// khm (Kaldheim) — red behavior tests (ADR 0043 colour split).
//
// Magda, Brazen Outlaw (issue #1333). Every leg rides a shipped primitive —
// the `pt-buff` anthem, `tappedTrigger` + `createToken`, `sacrificeFilterCount`
// (PR #2575) and the `EffectCardFilter.any` search (issue #897) — so these
// tests assert the COMPOSITION the card is: a Dwarf tap makes Treasures, and
// five of those Treasures pay the tutor through the same selection builder and
// sacrifice layer the mutation runs.

import { describe, it, expect } from "vitest";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import { finalizeConfirmAttackers } from "../../../../game";
import type { GameState } from "../../../../gre/state";
import { getPlayer, resolveTopOfStack } from "../../../../gre/state";
import {
    collectTriggers,
    placeTriggersOnStack,
} from "../../../../gre/triggers";
import { getEffectivePower } from "../../../../gre/layers";
import { assertSacrificeFilterCostAffordable } from "../../../../gre/activation";
import { buildActivationSacrificeSelection } from "../../../../gre/activationCostPicks";
import { applySacrificeSelection } from "../../../../gre/sacrificeChoice";
import { applyPendingChoiceSubmit } from "../../../../gre/pendingChoiceSubmit";
import { projectPublicState } from "../../../../gameProjections";
import { getDefinition } from "../../../index";
import type { GameEvent } from "../../../types";

const magda = getDefinition("079e6263-e54c-4899-a336-5315909b9322");
const grizzlyBears = getDefinition("ce2d603a-3231-4a8c-bf39-1617586ea870");
const solRing = getDefinition("c4300d24-1cae-4dd5-be7e-38cc677cf5bd");
const dromar = getDefinition("cfcc3c72-fff5-454c-814c-eb952fd23ba9");

const TAP_TRIGGER = "magda-dwarf-tapped-treasure";
const TUTOR = magda.activatedAbilities![0];

function board(library: string[] = []): GameState {
    const mk = (cardId: string, id: string, controllerId = "p1") =>
        makeInstance(cardId, { id, controllerId, ownerId: controllerId });
    return makeState({
        players: [
            makePlayer("p1", {
                battlefield: [
                    mk(magda.id, "magda"),
                    mk("ea9a38b1-4676-425a-b40d-4fb478966024", "dwarf"),
                    mk(grizzlyBears.id, "bear"),
                ],
                library: library.map((cardId, i) => ({
                    ...mk(cardId, `lib-${i}`),
                    zone: "library",
                })),
            }),
            makePlayer("p2", {
                battlefield: [
                    mk(
                        "ea9a38b1-4676-425a-b40d-4fb478966024",
                        "opp-dwarf",
                        "p2"
                    ),
                ],
            }),
        ],
    });
}

function tapEvent(state: GameState, permanentId: string): GameEvent {
    const card = state.players
        .flatMap((p) => p.battlefield)
        .find((c) => c.id === permanentId)!;
    return {
        type: "PERMANENT_TAPPED",
        permanentId,
        controllerId: card.controllerId,
        permanentTypes: [...card.types],
        permanentSubtypes: [...card.subtypes],
        forMana: false,
    } as GameEvent;
}

/** Runs the real collect → place → resolve path; returns how many Magda
 *  triggers the event produced. */
function tap(state: GameState, permanentId: string): number {
    const triggers = collectTriggers(state, [
        tapEvent(state, permanentId),
    ]).filter((t) => t.triggeredAbilityId === TAP_TRIGGER);
    placeTriggersOnStack(state, triggers);
    for (let i = 0; i < triggers.length; i++) resolveTopOfStack(state);
    return triggers.length;
}

const treasures = (state: GameState) =>
    getPlayer(state, "p1").battlefield.filter((c) =>
        c.subtypes.includes("Treasure")
    );

describe("Magda, Brazen Outlaw — anthem (CR 613.4c)", () => {
    it("gives OTHER Dwarves you control +1/+0, never Magda, a non-Dwarf or an opponent's Dwarf", () => {
        const state = board();
        const find = (id: string) =>
            state.players
                .flatMap((p) => p.battlefield)
                .find((c) => c.id === id)!;
        expect(getEffectivePower(state, find("dwarf"))).toBe(2);
        expect(getEffectivePower(state, find("magda"))).toBe(2);
        expect(getEffectivePower(state, find("bear"))).toBe(2);
        expect(getEffectivePower(state, find("opp-dwarf"))).toBe(1);

        // Wire format — the anthem survives the projection the client reads.
        const projected = projectPublicState(state, 1, "p1");
        const slimDwarf = projected.players[0].battlefield.find(
            (c) => c.id === "dwarf"
        )!;
        expect(getEffectivePower(projected, slimDwarf)).toBe(2);

        getPlayer(state, "p1").battlefield = getPlayer(
            state,
            "p1"
        ).battlefield.filter((c) => c.id !== "magda");
        expect(getEffectivePower(state, find("dwarf"))).toBe(1);
    });
});

describe("Magda, Brazen Outlaw — Dwarf tap makes a Treasure (CR 701.26a / 111.10a)", () => {
    it("a Dwarf you control — Magda included — creates exactly one Treasure", () => {
        const state = board();
        expect(tap(state, "dwarf")).toBe(1);
        expect(tap(state, "magda")).toBe(1);
        expect(treasures(state)).toHaveLength(2);
        expect(treasures(state)[0]).toMatchObject({
            types: ["Artifact"],
            isToken: true,
        });
        // The token carries its own mana ability (issue #1191) — the primitive
        // the stub was waiting on, encoded in the synthetic definition id.
        expect(treasures(state)[0].card?.id).toContain("treasure-token-mana");
    });

    it("an opponent's Dwarf or your non-Dwarf does not trigger", () => {
        const state = board();
        expect(tap(state, "opp-dwarf")).toBe(0);
        expect(tap(state, "bear")).toBe(0);
        expect(treasures(state)).toHaveLength(0);
    });
});

describe("Magda, Brazen Outlaw — attack taps through the real declaration path (CR 508.1f / 701.26a)", () => {
    /** Declares `ids` as attackers and runs the same finalize the
     *  `confirmAttackers` mutation does. */
    function declare(state: GameState, ids: string[]): void {
        state.phase = "DECLARE_ATTACKERS";
        state.activePlayerId = "p1";
        state.priorityPlayerId = "p1";
        state.combat = {
            attackerIds: ids,
            confirmed: false,
            blockerAssignments: {},
            blockersConfirmed: false,
        };
        finalizeConfirmAttackers(state);
    }
    const magdaTriggers = (state: GameState) =>
        state.stack.filter((s) => s.triggeredAbilityId === TAP_TRIGGER);

    it("Magda + another Dwarf attacking put two triggers on the stack, then make two Treasures", () => {
        const state = board();
        declare(state, ["magda", "dwarf"]);
        expect(magdaTriggers(state)).toHaveLength(2);
        expect(state.priorityPlayerId).toBe("p1");
        while (state.stack.length > 0) resolveTopOfStack(state);
        expect(treasures(state)).toHaveLength(2);
        // exactly one tap event per real transition, none left queued
        expect(state.pendingEvents ?? []).toHaveLength(0);
    });

    it("a vigilance Dwarf makes no Treasure; a non-Dwarf attacker makes none", () => {
        const state = board();
        getPlayer(state, "p1").battlefield.find(
            (c) => c.id === "dwarf"
        )!.staticAbilities = ["vigilance"];
        declare(state, ["dwarf", "bear"]);
        expect(magdaTriggers(state)).toHaveLength(0);
        while (state.stack.length > 0) resolveTopOfStack(state);
        expect(treasures(state)).toHaveLength(0);
    });
});

describe("Magda, Brazen Outlaw — Sacrifice five Treasures: tutor (CR 118.3 / 701.21a / 701.23)", () => {
    function withTreasures(n: number, library: string[] = []) {
        const state = board(library);
        for (let i = 0; i < n; i++) tap(state, "dwarf");
        expect(treasures(state)).toHaveLength(n);
        return state;
    }
    const source = (state: GameState) =>
        getPlayer(state, "p1").battlefield.find((c) => c.id === "magda")!;

    it("is unpayable with four Treasures, payable with five", () => {
        const four = withTreasures(4);
        expect(() =>
            assertSacrificeFilterCostAffordable(
                four,
                getPlayer(four, "p1"),
                source(four),
                TUTOR
            )
        ).toThrow();
        const five = withTreasures(5);
        expect(() =>
            assertSacrificeFilterCostAffordable(
                five,
                getPlayer(five, "p1"),
                source(five),
                TUTOR
            )
        ).not.toThrow();
    });

    function payWithChosenFive(state: GameState): string[] {
        const p1 = getPlayer(state, "p1");
        const selection = buildActivationSacrificeSelection(
            state,
            TUTOR,
            source(state),
            p1,
            magda.name
        )!;
        expect(selection.requirements[0].count).toBe(5);
        // Every Treasure is the same object, so the layer auto-resolves the
        // pick rather than prompting (ADR 0003 / issue #2244) — and it reaches
        // only for Treasures, never Magda or the Bear.
        expect(selection.picked).toHaveLength(5);
        const treasureIds = new Set(treasures(state).map((c) => c.id));
        expect(selection.picked.every((id) => treasureIds.has(id))).toBe(true);
        // Overriding it proves the layer sacrifices exactly what it is handed:
        // the LAST five, not the first.
        const picked = treasures(state)
            .slice(-5)
            .map((c) => c.id);
        selection.picked = picked;
        applySacrificeSelection(state, selection);
        state.stack.push({
            ...source(state),
            zone: "stack",
            castById: "p1",
            abilityId: TUTOR.id,
            targets: [],
        });
        return picked;
    }

    it("with six Treasures the chosen five go to the graveyard and the found artifact or Dragon enters", () => {
        const state = withTreasures(6, [
            grizzlyBears.id,
            solRing.id,
            dromar.id,
        ]);
        const firstTreasure = treasures(state)[0].id;
        const picked = payWithChosenFive(state);
        expect(treasures(state).map((c) => c.id)).toEqual([firstTreasure]);
        expect(picked).not.toContain(firstTreasure);

        expect(resolveTopOfStack(state)).toBeNull();
        const head = state.pendingChoices![0];
        // `any: [Artifact, Dragon]` — the Bears is not offered.
        expect([...(head.candidateIds ?? [])].sort()).toEqual([
            "lib-1",
            "lib-2",
        ]);
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["lib-2"],
        });
        const p1 = getPlayer(state, "p1");
        expect(p1.battlefield.some((c) => c.id === "lib-2")).toBe(true);
        expect(p1.library.map((c) => c.id).sort()).toEqual(["lib-0", "lib-1"]);
        // Wire format — the tutored permanent is on the board the client reads.
        const projected = projectPublicState(state, 1, "p1");
        expect(
            projected.players[0].battlefield.some((c) => c.id === "lib-2")
        ).toBe(true);
    });

    it("finding nothing is legal and still shuffles (CR 701.23b)", () => {
        const state = withTreasures(5, [grizzlyBears.id, solRing.id]);
        payWithChosenFive(state);
        const counterBefore = state.rngCounter;
        expect(resolveTopOfStack(state)).toBeNull();
        const head = state.pendingChoices![0];
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: [],
        });
        const p1 = getPlayer(state, "p1");
        expect(p1.library).toHaveLength(2);
        expect(p1.battlefield.some((c) => c.id.startsWith("lib-"))).toBe(false);
        expect(state.rngCounter).toBeGreaterThan(counterBefore);
    });
});
