// JUD (Judgment) — white card behavior tests (ADR 0043 colour split).
//
// Solitary Confinement (#1130, parent PRD #1058) composes four already-
// shipped primitives, so each clause gets its own assertion here rather than
// relying on the per-Op catalogue sweep alone (the card uses `resolve()`
// only indirectly, via the `upkeepDiscardOrElseTrigger` factory, and adds a
// bespoke `replacementEffects[]` entry — outside the DSL-only per-Op regime,
// per `.claude/rules/gre-development.md` § Card testing convention).

import { describe, it, expect } from "vitest";
import { solitaryConfinement } from "../white";
import { lightningBolt } from "../../lea/red";
import { grizzlyBears } from "../../lea/green";
import { getLegalTargets, NO_TARGETING_SOURCE } from "../../../../gre/rules";
import { playerHasShroud } from "../../../../gre/permanentGuard";
import { advancePhase } from "../../../../gre/phases";
import {
    resolveTopOfStack,
    type CardInstanceState,
    type GameState,
} from "../../../../gre/state";
import {
    applyMayPaySubmit,
    applyPendingChoiceSubmit,
} from "../../../../gre/pendingChoiceSubmit";
import { projectPublicState } from "../../../../gameProjections";
import type { TargetRequirement } from "../../../types";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";

function onBattlefield(
    state: GameState,
    id: string
): CardInstanceState | undefined {
    return state.players.flatMap((p) => p.battlefield).find((c) => c.id === id);
}

function inGraveyard(
    state: GameState,
    id: string
): CardInstanceState | undefined {
    return state.players.flatMap((p) => p.graveyard).find((c) => c.id === id);
}

describe("Solitary Confinement ({2}{W} Enchantment, CR 504/614/615/702.18, #1130)", () => {
    it("is a {2}{W} Enchantment with the modern oracle wording", () => {
        expect(solitaryConfinement.manaCost).toEqual({ X: 2, W: 1 });
        expect(solitaryConfinement.types).toEqual(["Enchantment"]);
        expect(solitaryConfinement.rarity).toBe("rare");
        expect(solitaryConfinement.oracleText).toBe(
            "At the beginning of your upkeep, sacrifice this enchantment unless you discard a card.\nSkip your draw step.\nYou have shroud. (You can't be the target of spells or abilities.)\nPrevent all damage that would be dealt to you."
        );
        expect(solitaryConfinement.id).toBe(
            "e7a8eb7a-eb3f-405e-8f44-d8ea64d76386"
        );
    });

    // --- Clause 2: skip draw step (CR 504/614) ------------------------------
    it("skips the controller's draw step while in play (CR 504.1/614)", () => {
        const confinement = makeInstance(solitaryConfinement.id, {
            id: "confinement",
            controllerId: "p1",
            zone: "battlefield",
        });
        const libraryTop = makeInstance(grizzlyBears.id, {
            id: "top",
            controllerId: "p1",
            zone: "library",
        });
        const state = makeState({
            turn: 2,
            phase: "UPKEEP",
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            players: [
                makePlayer("p1", {
                    battlefield: [confinement],
                    library: [libraryTop],
                }),
                makePlayer("p2"),
            ],
        });
        advancePhase(state); // UPKEEP → DRAW
        expect(state.phase).toBe("DRAW");
        expect(state.players[0].hand).toHaveLength(0);
        expect(state.players[0].library.map((c) => c.id)).toEqual(["top"]);
    });

    // --- Clause 3: player-scoped shroud (CR 702.18 / 115.4, #1128) ----------
    describe("player-scoped shroud", () => {
        it("playerHasShroud is true for the controller, false for the opponent", () => {
            const confinement = makeInstance(solitaryConfinement.id, {
                id: "confinement",
                controllerId: "p1",
            });
            const state = makeState({
                players: [
                    makePlayer("p1", { battlefield: [confinement] }),
                    makePlayer("p2"),
                ],
            });
            expect(playerHasShroud(state, "p1")).toBe(true);
            expect(playerHasShroud(state, "p2")).toBe(false);
        });

        it("getLegalTargets excludes the controller from player candidates", () => {
            const confinement = makeInstance(solitaryConfinement.id, {
                id: "confinement",
                controllerId: "p1",
            });
            const state = makeState({
                players: [
                    makePlayer("p1", { battlefield: [confinement] }),
                    makePlayer("p2"),
                ],
            });
            const req: TargetRequirement = { type: "player", count: 1 };
            expect(getLegalTargets(state, req, NO_TARGETING_SOURCE)).toEqual([
                { type: "player", id: "p2" },
            ]);
        });

        it("shroud exclusion survives the wire-format projection (#1128)", () => {
            const confinement = makeInstance(solitaryConfinement.id, {
                id: "confinement",
                controllerId: "p1",
            });
            const state = makeState({
                players: [
                    makePlayer("p1", { battlefield: [confinement] }),
                    makePlayer("p2"),
                ],
            });
            const projected = projectPublicState(state, 1, "p2");
            expect(playerHasShroud(projected, "p1")).toBe(true);
            expect(playerHasShroud(projected, "p2")).toBe(false);
            const req: TargetRequirement = { type: "player", count: 1 };
            expect(
                getLegalTargets(
                    projected as unknown as GameState,
                    req,
                    NO_TARGETING_SOURCE
                )
            ).toEqual([{ type: "player", id: "p2" }]);
        });
    });

    // --- Clause 4: prevent all damage to the controller (CR 614/615) -------
    describe("prevent all damage that would be dealt to you", () => {
        it("consumes damage a spell would deal to the controller", () => {
            const confinement = makeInstance(solitaryConfinement.id, {
                id: "confinement",
                controllerId: "p1",
                ownerId: "p1",
            });
            const state = makeState({
                players: [
                    makePlayer("p1", { battlefield: [confinement], life: 20 }),
                    makePlayer("p2", { life: 20 }),
                ],
            });
            // Cast directly onto the stack with the target already assigned —
            // mirrors Divine Presence's own test (inv/white.ts): the
            // replacement is exercised at RESOLUTION, independent of the
            // cast-time shroud gate (which lives in game.ts::selectTarget,
            // not in the GRE resolve path).
            pushSpell(state, lightningBolt.id, "p2", [
                { type: "player", id: "p1" },
            ]);
            resolveTopOfStack(state);
            expect(state.players[0].life).toBe(20); // prevented
        });

        it("does not prevent damage dealt to the non-controller", () => {
            const confinement = makeInstance(solitaryConfinement.id, {
                id: "confinement",
                controllerId: "p1",
                ownerId: "p1",
            });
            const state = makeState({
                players: [
                    makePlayer("p1", { battlefield: [confinement], life: 20 }),
                    makePlayer("p2", { life: 20 }),
                ],
            });
            pushSpell(state, lightningBolt.id, "p1", [
                { type: "player", id: "p2" },
            ]);
            resolveTopOfStack(state);
            expect(state.players[1].life).toBe(17); // 20 - 3, unprevented
        });
    });

    // --- Clause 1: upkeep discard-or-sacrifice (CR 603.6a/117.3a/701.8) ----
    describe("upkeep: discard a card or sacrifice (#1129)", () => {
        function resolveUpkeepTrigger(
            state: GameState,
            source: CardInstanceState
        ): void {
            state.stack.push({
                ...source,
                zone: "stack",
                castById: source.controllerId,
                triggeredAbilityId: "solitary-confinement-upkeep",
                triggerSourceId: source.id,
                triggerEvent: {
                    type: "PHASE_BEGIN",
                    phase: "UPKEEP",
                    activePlayerId: source.controllerId,
                } as GameState["stack"][number]["triggerEvent"],
                targets: [],
            });
            resolveTopOfStack(state);
        }

        it("discarding a card pays the cost: the enchantment survives", () => {
            const confinement = makeInstance(solitaryConfinement.id, {
                id: "confinement",
                controllerId: "p1",
                ownerId: "p1",
            });
            const handCard = makeInstance(grizzlyBears.id, {
                id: "hand1",
                controllerId: "p1",
                ownerId: "p1",
                zone: "hand",
            });
            const state = makeState({
                players: [
                    makePlayer("p1", {
                        battlefield: [confinement],
                        hand: [handCard],
                    }),
                    makePlayer("p2"),
                ],
            });
            resolveUpkeepTrigger(state, confinement);
            applyMayPaySubmit(state, { playerId: "p1", accept: true });
            const pick = state.pendingChoices![0];
            applyPendingChoiceSubmit(state, {
                playerId: "p1",
                stackItemId: pick.stackItemId,
                step: pick.step,
                choiceId: pick.choiceId,
                cardInstanceIds: ["hand1"],
            });
            expect(onBattlefield(state, "confinement")).toBeDefined();
            expect(inGraveyard(state, "hand1")).toBeDefined();
        });

        it("declining sacrifices the enchantment instead", () => {
            const confinement = makeInstance(solitaryConfinement.id, {
                id: "confinement",
                controllerId: "p1",
                ownerId: "p1",
            });
            const handCard = makeInstance(grizzlyBears.id, {
                id: "hand1",
                controllerId: "p1",
                ownerId: "p1",
                zone: "hand",
            });
            const state = makeState({
                players: [
                    makePlayer("p1", {
                        battlefield: [confinement],
                        hand: [handCard],
                    }),
                    makePlayer("p2"),
                ],
            });
            resolveUpkeepTrigger(state, confinement);
            applyMayPaySubmit(state, { playerId: "p1", accept: false });
            expect(onBattlefield(state, "confinement")).toBeUndefined();
            expect(inGraveyard(state, "confinement")).toBeDefined();
            // The hand card stayed in hand — never discarded.
            expect(
                state.players[0].hand.find((c) => c.id === "hand1")
            ).toBeDefined();
        });

        it("auto-resolves to sacrifice with an empty hand (no prompt shown)", () => {
            const confinement = makeInstance(solitaryConfinement.id, {
                id: "confinement",
                controllerId: "p1",
                ownerId: "p1",
            });
            const state = makeState({
                players: [
                    makePlayer("p1", { battlefield: [confinement], hand: [] }),
                    makePlayer("p2"),
                ],
            });
            resolveUpkeepTrigger(state, confinement);
            expect(state.pendingChoices ?? []).toHaveLength(0);
            expect(onBattlefield(state, "confinement")).toBeUndefined();
            expect(inGraveyard(state, "confinement")).toBeDefined();
        });
    });
});
