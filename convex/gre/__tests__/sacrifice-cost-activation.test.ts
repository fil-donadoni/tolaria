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
import {
    matchesPermanentFilter,
    resolveExcludeSource,
} from "../../cards/filters";
import {
    isSacrificeCandidateLegal,
    isSacrificeSelectionComplete,
    sacrificeCandidates,
} from "../sacrificeChoice";
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
import { legionExtruder } from "../../cards/sets/big/red";
import { orcGeneral } from "../../cards/sets/drk/red";
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
    // Threads the SAME `FilterMatchContext` both `game.ts` activation branches
    // build, including `selfInstanceId` (CR 109.2, issue #2367): without it an
    // `excludeSource` cost ("Sacrifice another artifact") matches nothing and
    // this gate would reject a perfectly legal activation.
    if (ability.cost.sacrificeFilter) {
        const candidates = player.battlefield.filter((c) =>
            matchesPermanentFilter(c, ability.cost.sacrificeFilter!, {
                selfControllerId: player.id,
                selfInstanceId: card.id,
            })
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
                              // The REAL production lowering (CR 109.2, issue
                              // #2367): `buildActivationSacrificeSelection`
                              // bakes `excludeSource` into a concrete
                              // `excludeInstanceIds` entry at exactly this
                              // point, so the requirement that rides on
                              // `pendingActivation` — and reaches the client
                              // picker — already names the source. Identity for
                              // every filter without the flag.
                              filter: resolveExcludeSource(
                                  ability.cost.sacrificeFilter,
                                  card.id
                              ),
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
    if (
        pa.sacrificeSelection &&
        !isSacrificeSelectionComplete(pa.sacrificeSelection)
    )
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
    // The REAL server gate behind `selectSacrifice` (`gre/sacrificeChoice.ts`),
    // not a re-implementation: it re-derives the candidate set from the
    // requirement's own filter, which is why the `excludeSource` lowering above
    // is what makes a self-naming pick illegal here.
    if (!isSacrificeCandidateLegal(state, sel, cardInstanceId)) {
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

// ---------------------------------------------------------------------------
// "Sacrifice ANOTHER <filter>" — self-exclusion in an activation cost
// (CR 109.2 / 602.1, issue #2367)
//
// `cost.sacrificeFilter` is a STATIC `PermanentFilter` shared by every instance
// of a card, so "another" has no instance id to write into
// `excludeInstanceIds`. `PermanentFilter.excludeSource` is the deferred form:
// the matcher resolves it against `ctx.selfInstanceId`, and
// `resolveExcludeSource` lowers it to a concrete id when the activation's
// sacrifice requirement is built. Before this, both shipped "another" costs —
// Legion Extruder and Orc General, the latter carrying an inert
// `excludeInstanceIds: []` and a comment CLAIMING the exclusion was enforced —
// let the source pay its own cost by sacrificing itself.
// ---------------------------------------------------------------------------
describe('"sacrifice another" activation cost self-exclusion (CR 109.2, issue #2367)', () => {
    it("Legion Extruder: NOT activatable when the only artifact on the board is itself", () => {
        const extruder = makeInstance(legionExtruder.id, { id: "extruder-1" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [extruder] }),
                makePlayer("p2"),
            ],
        });
        expect(() =>
            activateWithSacrificeCost(
                state,
                "p1",
                "extruder-1",
                "legion-extruder-make-golem"
            )
        ).toThrow(/sacrifice cost/i);
    });

    it("Legion Extruder: activatable with a SECOND artifact, and the source is not among the offered picks", () => {
        const extruder = makeInstance(legionExtruder.id, { id: "extruder-1" });
        const orn = makeInstance(ornithopter.id, { id: "orn-1" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [extruder, orn] }),
                makePlayer("p2"),
            ],
        });
        const pa = activateWithSacrificeCost(
            state,
            "p1",
            "extruder-1",
            "legion-extruder-make-golem"
        );
        const req = pa.sacrificeSelection!.requirements[0];
        // The offered pick set, straight from the REAL candidate scan every
        // consumer (auto-resolve, the client picker's server twin, the Brain)
        // reads — the source must not be in it.
        const offered = sacrificeCandidates(state, "p1", req.filter).map(
            (c) => c.id
        );
        expect(offered).toEqual(["orn-1"]);
        expect(offered).not.toContain("extruder-1");
    });

    it("Legion Extruder: the server's own pick gate rejects naming the source, accepts the other artifact", () => {
        const extruder = makeInstance(legionExtruder.id, { id: "extruder-1" });
        const orn = makeInstance(ornithopter.id, { id: "orn-1" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [extruder, orn] }),
                makePlayer("p2"),
            ],
        });
        activateWithSacrificeCost(
            state,
            "p1",
            "extruder-1",
            "legion-extruder-make-golem"
        );
        expect(() => selectActivationCost(state, "p1", "extruder-1")).toThrow(
            /filter/i
        );
        // Still on the battlefield — the illegal pick changed nothing.
        expect(
            state.players[0].battlefield.some((c) => c.id === "extruder-1")
        ).toBe(true);
    });

    it("Legion Extruder: full path — pick the other artifact, sacrifice it, create the 3/3 Golem", () => {
        const extruder = makeInstance(legionExtruder.id, { id: "extruder-1" });
        const orn = makeInstance(ornithopter.id, { id: "orn-1" });
        const state = makeState({
            phase: "PRECOMBAT_MAIN",
            players: [
                makePlayer("p1", {
                    battlefield: [extruder, orn],
                    manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 2 },
                }),
                makePlayer("p2"),
            ],
        });
        activateWithSacrificeCost(
            state,
            "p1",
            "extruder-1",
            "legion-extruder-make-golem"
        );
        selectActivationCost(state, "p1", "orn-1");
        expect(state.players[0].battlefield.some((c) => c.id === "orn-1")).toBe(
            false
        );
        // The source paid {T}, survived, and made the token.
        expect(
            state.players[0].battlefield.find((c) => c.id === "extruder-1")!
                .isTapped
        ).toBe(true);
        const golem = state.players[0].battlefield.find((c) =>
            c.subtypes?.includes("Golem")
        );
        expect(golem).toBeDefined();
        expect(golem!.power).toBe(3);
        expect(golem!.toughness).toBe(3);
        expect(golem!.types).toEqual(
            expect.arrayContaining(["Artifact", "Creature"])
        );
    });

    it("Orc General: an Orc General alone cannot sacrifice ITSELF to its own cost (bug-class regression)", () => {
        // Orc General is itself an Orc, so before issue #2367 its
        // `{ types: "Creature", subtypes: ["Orc", "Goblin"] }` cost matched the
        // source and the ability was activatable — and self-payable — on an
        // otherwise empty board.
        const general = makeInstance(orcGeneral.id, { id: "general-1" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [general] }),
                makePlayer("p2"),
            ],
        });
        expect(() =>
            activateWithSacrificeCost(
                state,
                "p1",
                "general-1",
                "orc-general-pump"
            )
        ).toThrow(/sacrifice cost/i);
    });

    it("Orc General: with a second Orc, the pump resolves and the source is never the victim", () => {
        const general = makeInstance(orcGeneral.id, { id: "general-1" });
        const grunt = makeInstance(orcGeneral.id, { id: "grunt-1" });
        const state = makeState({
            phase: "PRECOMBAT_MAIN",
            players: [
                makePlayer("p1", { battlefield: [general, grunt] }),
                makePlayer("p2"),
            ],
        });
        const pa = activateWithSacrificeCost(
            state,
            "p1",
            "general-1",
            "orc-general-pump"
        );
        expect(
            sacrificeCandidates(
                state,
                "p1",
                pa.sacrificeSelection!.requirements[0].filter
            ).map((c) => c.id)
        ).toEqual(["grunt-1"]);
        selectActivationCost(state, "p1", "grunt-1");
        expect(
            state.players[0].battlefield.some((c) => c.id === "general-1")
        ).toBe(true);
        expect(state.players[0].graveyard.some((c) => c.id === "grunt-1")).toBe(
            true
        );
    });
});
