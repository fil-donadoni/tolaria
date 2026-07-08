// Cluster A — sacrifice-as-activation-cost (filtered, non-self).
// CR 602.1 / 118.5. Integration test for the cost-CHOICE submission path that
// crosses GRE → game.ts → UI. The project has no convex-test harness (ADR
// 0001 / moves-integration.test.ts), so — like activation-flow.test.ts — the
// production mutation handlers (activateAbility, selectActivationCost, and the
// tryAutoCommitPendingActivation commit step) are mirrored here as pure
// functions that drive the REAL exported GRE state functions. They keep the
// same branch order and the same gating the mutations use, so a divergence
// (e.g. forgetting the sacrifice or the mv snapshot) fails this test.

import { describe, it, expect } from "vitest";
import {
    getPlayer,
    getOpponentId,
    isManaCostCovered,
    normalizeManaCost,
    payManaCost,
    commitLandsForCost,
    removePermanentTo,
    resolveTopOfStack,
    type CardInstanceState,
    type GameState,
    type PendingActivation,
    type StackItem,
} from "../state";
import { getDefinition, tryGetDefinition } from "../../cards";
import { matchesPermanentFilter } from "../../cards/filters";
import { isSacrificeSelectionComplete } from "../sacrificeChoice";
import {
    atog,
    ashnodsAltar,
    orcishMechanics,
    sageOfLatNam,
    priestOfYawgmoth,
    dwarvenWeaponsmith,
    gateToPhyrexia,
    ornithopter,
    yotianSoldier,
} from "../../cards/sets/atq";
import { grizzlyBears } from "../../cards/sets/lea";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";

// --- pre-sacrifice mana value (mirror of game.ts sacrificedManaValue) ------
function sacrificedManaValue(perm: CardInstanceState): number {
    const cardId = (perm.card as { id?: string }).id;
    const def = cardId ? tryGetDefinition(cardId) : undefined;
    return def?.manaCost
        ? Object.entries(def.manaCost).reduce<number>(
              (acc, [, v]) => acc + (typeof v === "number" ? v : 0),
              0
          )
        : 0;
}

/** Mirror of activateAbility's no-mana / mana-covered + sacrifice-choice path
 *  for an activated ability with `cost.sacrificeFilter`. Returns the entered
 *  pendingActivation (always pending for a sacrifice-choice cost). */
function activateWithSacrificeCost(
    state: GameState,
    playerId: string,
    cardInstanceId: string,
    abilityId: string,
    targets: StackItem["targets"] = []
): PendingActivation {
    const player = getPlayer(state, playerId);
    const card = player.battlefield.find((c) => c.id === cardInstanceId);
    if (!card) throw new Error("Card not on battlefield");
    const def = getDefinition((card.card as { id: string }).id);
    const ability = def.activatedAbilities?.find((a) => a.id === abilityId);
    if (!ability) throw new Error("Ability not found");

    if (ability.cost.tap && card.isTapped) throw new Error("Already tapped");

    // CR 602.1 / 118.5 — illegal if no matching permanent on the battlefield.
    if (ability.cost.sacrificeFilter) {
        const candidates = player.battlefield.filter((c) =>
            matchesPermanentFilter(c, ability.cost.sacrificeFilter!)
        );
        if (candidates.length === 0) {
            throw new Error("No legal permanent to pay the sacrifice cost");
        }
    }

    const manaCost = ability.cost.mana
        ? normalizeManaCost(ability.cost.mana)
        : undefined;
    const pa: PendingActivation = {
        playerId,
        cardInstanceId: card.id,
        abilityId,
        manaCost: manaCost ?? {},
        tappedLandIds: [],
        tapSource: !!ability.cost.tap,
        sacrificeSource: !!ability.cost.sacrifice,
        ...(ability.cost.sacrificeFilter
            ? {
                  sacrificeSelection: {
                      playerId,
                      reason: def.name,
                      requirements: [
                          {
                              filter: ability.cost.sacrificeFilter,
                              count: 1,
                              snapshot: true,
                          },
                      ],
                      picked: [],
                  },
              }
            : {}),
        ...(targets.length > 0 ? { targets } : {}),
    };
    state.pendingActivation = pa;
    return pa;
}

/** Mirror of tryAutoCommitPendingActivation: gated on the sacrifice pick and
 *  mana coverage. Sacrifices the picked permanent, snapshots its mv, pushes
 *  the ability on the stack, then resolves it. */
function commitActivation(state: GameState, playerId: string): boolean {
    const pa = state.pendingActivation;
    if (!pa || pa.playerId !== playerId) return false;
    const player = getPlayer(state, playerId);
    if (!isManaCostCovered(player.manaPool, pa.manaCost)) return false;
    if (pa.sacrificeSelection && !isSacrificeSelectionComplete(pa.sacrificeSelection))
        return false;

    const card = player.battlefield.find((c) => c.id === pa.cardInstanceId)!;
    payManaCost(player.manaPool, pa.manaCost);
    commitLandsForCost(player, pa.manaCost);
    if (pa.tapSource) card.isTapped = true;
    if (pa.sacrificeSource) removePermanentTo(state, card.id, "graveyard");

    let snapshot: StackItem["additionalSacrificeSnapshot"];
    const pickedId = pa.sacrificeSelection?.picked[0];
    if (pickedId) {
        const sacrificed = player.battlefield.find((c) => c.id === pickedId)!;
        snapshot = {
            cardInstanceId: sacrificed.id,
            mv: sacrificedManaValue(sacrificed),
        };
        removePermanentTo(state, sacrificed.id, "graveyard");
    }

    const stackItem: StackItem = {
        ...structuredClone(card),
        zone: "stack" as const,
        castById: playerId,
        abilityId: pa.abilityId,
        ...(pa.targets && pa.targets.length > 0 ? { targets: pa.targets } : {}),
        ...(snapshot ? { additionalSacrificeSnapshot: snapshot } : {}),
    };
    state.stack.push(stackItem);
    state.priorityPlayerId = getOpponentId(state, playerId);
    state.pendingActivation = undefined;
    resolveTopOfStack(state);
    return true;
}

/** Mirror of selectActivationCost: validate the pick against the filter, set
 *  pickedId, then attempt commit. */
function selectActivationCost(
    state: GameState,
    playerId: string,
    cardInstanceId: string
): void {
    const pa = state.pendingActivation;
    if (!pa) throw new Error("No ability being activated");
    const sel = pa.sacrificeSelection;
    if (!sel) throw new Error("No sacrifice cost picker");
    if (isSacrificeSelectionComplete(sel))
        throw new Error("Sacrifice cost already paid");
    const player = getPlayer(state, playerId);
    const candidate = player.battlefield.find((c) => c.id === cardInstanceId);
    if (!candidate) throw new Error("Not on your battlefield");
    const req = sel.requirements[0];
    if (!matchesPermanentFilter(candidate, req.filter)) {
        throw new Error("Does not match the sacrifice cost filter");
    }
    sel.picked.push(cardInstanceId);
    commitActivation(state, playerId);
}

describe("sacrifice-as-cost activation flow (CR 602.1 / 118.5)", () => {
    it("rejects activation when no matching permanent exists", () => {
        const at = makeInstance(atog.id, { id: "atog-1" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [at] }),
                makePlayer("p2"),
            ],
        });
        // Atog needs an artifact to sacrifice; only Atog (a Creature) is here.
        expect(() =>
            activateWithSacrificeCost(state, "p1", "atog-1", "atog-pump")
        ).toThrow(/sacrifice cost/i);
    });

    it("enters pendingActivation with a sacrifice-choice picker (no tap/no mana)", () => {
        const at = makeInstance(atog.id, { id: "atog-1" });
        const orn = makeInstance(ornithopter.id, { id: "orn-1" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [at, orn] }),
                makePlayer("p2"),
            ],
        });
        const pa = activateWithSacrificeCost(
            state,
            "p1",
            "atog-1",
            "atog-pump"
        );
        expect(pa.sacrificeSelection?.requirements).toEqual([
            { filter: { types: "Artifact" }, count: 1, snapshot: true },
        ]);
        expect(pa.sacrificeSelection?.picked).toEqual([]);
        // Mana already covered, but commit is BLOCKED until the pick.
        expect(commitActivation(state, "p1")).toBe(false);
        expect(state.stack).toHaveLength(0);
        // The artifact is still on the battlefield (sacrifice deferred).
        expect(state.players[0].battlefield.some((c) => c.id === "orn-1")).toBe(
            true
        );
    });

    it("rejects a pick that doesn't match the filter", () => {
        const at = makeInstance(atog.id, { id: "atog-1" });
        const orn = makeInstance(ornithopter.id, { id: "orn-1" });
        const lionInst = makeInstance(grizzlyBears.id, { id: "lion-1" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [at, orn, lionInst] }),
                makePlayer("p2"),
            ],
        });
        activateWithSacrificeCost(state, "p1", "atog-1", "atog-pump");
        // A plain (non-artifact) creature does not satisfy "sacrifice an artifact".
        expect(() => selectActivationCost(state, "p1", "lion-1")).toThrow(
            /filter/i
        );
    });

    it("Atog: picking the artifact sacrifices it and pumps +2/+2", () => {
        const at = makeInstance(atog.id, { id: "atog-1" });
        const orn = makeInstance(ornithopter.id, { id: "orn-1" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [at, orn] }),
                makePlayer("p2"),
            ],
        });
        activateWithSacrificeCost(state, "p1", "atog-1", "atog-pump");
        selectActivationCost(state, "p1", "orn-1");
        // The chosen artifact is sacrificed; the ability resolved.
        expect(state.players[0].battlefield.some((c) => c.id === "orn-1")).toBe(
            false
        );
        expect(state.players[0].graveyard.some((c) => c.id === "orn-1")).toBe(
            true
        );
        expect(
            state.players[0].battlefield.some((c) => c.id === "atog-1")
        ).toBe(true);
        expect(state.stack).toHaveLength(0);
    });

    it("Priest of Yawgmoth: snapshots the sacrificed artifact's mv → adds that much {B}", () => {
        const priest = makeInstance(priestOfYawgmoth.id, { id: "priest-1" });
        // Yotian Soldier is a {3} artifact creature → mv 3.
        const soldier = makeInstance(yotianSoldier.id, { id: "soldier-1" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [priest, soldier] }),
                makePlayer("p2"),
            ],
        });
        activateWithSacrificeCost(
            state,
            "p1",
            "priest-1",
            "priest-of-yawgmoth-mana"
        );
        selectActivationCost(state, "p1", "soldier-1");
        expect(state.players[0].manaPool.B).toBe(3);
        // {T} cost was applied at commit.
        expect(
            state.players[0].battlefield.find((c) => c.id === "priest-1")!
                .isTapped
        ).toBe(true);
    });

    it("Ashnod's Altar: sacrifices a creature → adds {C}{C}", () => {
        const altar = makeInstance(ashnodsAltar.id, { id: "altar-1" });
        const lionInst = makeInstance(grizzlyBears.id, { id: "lion-1" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [altar, lionInst] }),
                makePlayer("p2"),
            ],
        });
        activateWithSacrificeCost(state, "p1", "altar-1", "ashnods-altar-mana");
        selectActivationCost(state, "p1", "lion-1");
        expect(state.players[0].manaPool.C).toBe(2);
        expect(state.players[0].graveyard.some((c) => c.id === "lion-1")).toBe(
            true
        );
    });

    it("Orcish Mechanics: tap + sacrifice an artifact → 2 damage to target", () => {
        const mech = makeInstance(orcishMechanics.id, { id: "mech-1" });
        const orn = makeInstance(ornithopter.id, { id: "orn-1" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [mech, orn] }),
                makePlayer("p2"),
            ],
        });
        activateWithSacrificeCost(
            state,
            "p1",
            "mech-1",
            "orcish-mechanics-bolt",
            [{ type: "player", id: "p2" }]
        );
        selectActivationCost(state, "p1", "orn-1");
        expect(state.players[1].life).toBe(18);
        expect(
            state.players[0].battlefield.find((c) => c.id === "mech-1")!
                .isTapped
        ).toBe(true);
        expect(state.players[0].graveyard.some((c) => c.id === "orn-1")).toBe(
            true
        );
    });

    it("Sage of Lat-Nam: tap + sacrifice an artifact → draw", () => {
        const sage = makeInstance(sageOfLatNam.id, { id: "sage-1" });
        const orn = makeInstance(ornithopter.id, { id: "orn-1" });
        const lib = makeInstance(grizzlyBears.id, {
            id: "lib-1",
            zone: "library",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [sage, orn],
                    library: [lib],
                }),
                makePlayer("p2"),
            ],
        });
        activateWithSacrificeCost(
            state,
            "p1",
            "sage-1",
            "sage-of-lat-nam-draw"
        );
        selectActivationCost(state, "p1", "orn-1");
        expect(state.players[0].hand.map((c) => c.id)).toContain("lib-1");
    });

    it("Dwarven Weaponsmith: tap + sacrifice an artifact → +1/+1 counter on target", () => {
        const smith = makeInstance(dwarvenWeaponsmith.id, { id: "smith-1" });
        const orn = makeInstance(ornithopter.id, { id: "orn-1" });
        const lionInst = makeInstance(grizzlyBears.id, { id: "lion-1" });
        const state = makeState({
            phase: "UPKEEP",
            players: [
                makePlayer("p1", {
                    battlefield: [smith, orn, lionInst],
                }),
                makePlayer("p2"),
            ],
        });
        activateWithSacrificeCost(
            state,
            "p1",
            "smith-1",
            "dwarven-weaponsmith-counter",
            [{ type: "permanent", id: "lion-1" }]
        );
        selectActivationCost(state, "p1", "orn-1");
        expect(
            state.players[0].battlefield.find((c) => c.id === "lion-1")!
                .counters?.["+1/+1"]
        ).toBe(1);
    });

    it("Gate to Phyrexia: sacrifice a creature → destroy target artifact", () => {
        const gate = makeInstance(gateToPhyrexia.id, { id: "gate-1" });
        const lionInst = makeInstance(grizzlyBears.id, { id: "lion-1" });
        const oppArtifact = makeInstance(ornithopter.id, {
            id: "art-1",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            phase: "UPKEEP",
            players: [
                makePlayer("p1", { battlefield: [gate, lionInst] }),
                makePlayer("p2", { battlefield: [oppArtifact] }),
            ],
        });
        activateWithSacrificeCost(
            state,
            "p1",
            "gate-1",
            "gate-to-phyrexia-destroy",
            [{ type: "permanent", id: "art-1" }]
        );
        selectActivationCost(state, "p1", "lion-1");
        expect(state.players[0].graveyard.some((c) => c.id === "lion-1")).toBe(
            true
        );
        expect(state.players[1].battlefield.some((c) => c.id === "art-1")).toBe(
            false
        );
    });
});
