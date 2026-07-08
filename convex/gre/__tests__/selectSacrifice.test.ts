import { describe, it, expect } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import { getCardByName } from "../../cards/index";
import {
    findActiveSacrificeSelection,
    finalizeConfirmAttackers,
    tryAutoCommitPendingCast,
} from "../../game";
import {
    autoResolveFungible,
    isSacrificeCandidateLegal,
    isSacrificeSelectionComplete,
    applySacrificeSelection,
    type SacrificeSelection,
} from "../sacrificeChoice";
import type { GameState } from "../state";
import { isLand } from "../constants";

// CR 701.21a — selectSacrifice routes the player's pick to whichever action is
// awaiting a sacrifice choice, validates it, and resumes on completion. These
// tests mirror the mutation body (no convex-test harness) against the exported
// helpers.
describe("selectSacrifice dispatch + resume (CR 701.21a)", () => {
    const drought = getCardByName("Drought");
    const zombies = getCardByName("Scathe Zombies");
    const flooded = getCardByName("Flooded Woodlands");
    const bears = getCardByName("Grizzly Bears");
    const mountain = getCardByName("Mountain").id;
    const swampId = getCardByName("Swamp").id;

    function pickAndResumeCast(state: GameState, id: string) {
        const active = findActiveSacrificeSelection(state, "p1");
        expect(active).not.toBeNull();
        expect(isSacrificeCandidateLegal(state, active!.sel, id)).toBe(true);
        active!.sel.picked.push(id);
        if (isSacrificeSelectionComplete(active!.sel)) {
            tryAutoCommitPendingCast(state, "p1");
        }
    }

    it("routes a cast sacrifice pick and rejects an illegal candidate", () => {
        const droughtInst = makeInstance(drought.id, {
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
        });
        const untapped = makeInstance(swampId, {
            id: "swU",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const tapped = makeInstance(swampId, {
            id: "swT",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
            isTapped: true,
        });
        const bearsInst = makeInstance(bears.id, {
            id: "bear",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const zInst = makeInstance(zombies.id, {
            id: "z1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    hand: [zInst],
                    battlefield: [untapped, tapped, bearsInst],
                    manaPool: { W: 0, U: 0, B: 3, R: 0, G: 0, C: 0 },
                }),
                makePlayer("p2", { battlefield: [droughtInst] }),
            ],
            priorityPlayerId: "p1",
            activePlayerId: "p1",
        });
        const sel: SacrificeSelection = {
            playerId: "p1",
            reason: "Drought",
            requirements: [{ filter: { subtypes: ["Swamp"] }, count: 1 }],
            picked: [],
        };
        autoResolveFungible(state, sel); // non-fungible → stays parked
        state.pendingCast = {
            playerId: "p1",
            cardInstanceId: "z1",
            manaCost: {},
            tappedLandIds: [],
            sacrificeSelection: sel,
        } as unknown as NonNullable<GameState["pendingCast"]>;

        const active = findActiveSacrificeSelection(state, "p1");
        expect(active?.container).toBe("cast");
        // A non-Swamp is not a legal sacrifice.
        expect(isSacrificeCandidateLegal(state, active!.sel, "bear")).toBe(
            false
        );
        // A Swamp is; picking the tapped one is honoured (the player's choice).
        pickAndResumeCast(state, "swT");
        expect(state.players[0].battlefield.some((c) => c.id === "swT")).toBe(
            false
        );
        expect(state.players[0].battlefield.some((c) => c.id === "swU")).toBe(
            true
        );
    });

    it("routes and resumes an attack-tax pick (parks, picks, finalizes)", () => {
        const attacker = makeInstance(bears.id, {
            id: "g1",
            controllerId: "p1",
            isAttacking: true,
        });
        const untapped = makeInstance(mountain, {
            id: "land-u",
            controllerId: "p1",
        });
        const tapped = makeInstance(mountain, {
            id: "land-t",
            controllerId: "p1",
            isTapped: true,
        });
        const tax = makeInstance(flooded.id, { id: "tax", controllerId: "p1" });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [attacker, untapped, tapped, tax],
                }),
                makePlayer("p2"),
            ],
            phase: "DECLARE_ATTACKERS",
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            combat: {
                attackerIds: ["g1"],
                blockerAssignments: {},
                confirmed: false,
                blockersConfirmed: false,
            },
        });
        const sel: SacrificeSelection = {
            playerId: "p1",
            reason: "Flooded Woodlands",
            requirements: [{ filter: { types: ["Land"] }, count: 1 }],
            picked: [],
        };
        autoResolveFungible(state, sel);
        expect(isSacrificeSelectionComplete(sel)).toBe(false);
        state.combat!.pendingAttackSacrifice = sel;

        // Mutation body for the attack container: dispatch, validate, pick,
        // apply + finalize on completion.
        const active = findActiveSacrificeSelection(state, "p1");
        expect(active?.container).toBe("attack");
        expect(isSacrificeCandidateLegal(state, active!.sel, "land-u")).toBe(
            true
        );
        active!.sel.picked.push("land-u");
        expect(isSacrificeSelectionComplete(active!.sel)).toBe(true);
        applySacrificeSelection(state, active!.sel);
        state.combat!.pendingAttackSacrifice = undefined;
        finalizeConfirmAttackers(state);

        // The chosen land is gone, the other stays, and combat is confirmed.
        expect(
            state.players[0].battlefield.some((c) => c.id === "land-u")
        ).toBe(false);
        expect(
            state.players[0].battlefield.some((c) => c.id === "land-t")
        ).toBe(true);
        expect(
            state.players[0].graveyard.filter((c) => isLand(c))
        ).toHaveLength(1);
        expect(state.combat!.confirmed).toBe(true);
        // The attacker is now tapped and attacking.
        const g1 = state.players[0].battlefield.find((c) => c.id === "g1");
        expect(g1?.isAttacking).toBe(true);
    });
});
