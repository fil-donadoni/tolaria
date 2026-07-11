// VIS — per-card behavior tests for green cards in
// `convex/cards/sets/vis/green.ts` (set split by colour, ADR 0043).

import { describe, it, expect } from "vitest";
import { naturalOrder, elephantGrass } from "../green";
import { grizzlyBears } from "../../lea/green";
import { scatheZombies } from "../../lea/black";
import { forest } from "../../lea/colorless";
import { makePlayer, makeState, pushSpell } from "../../../__tests__/setup";
import { makeInstance } from "../../../__tests__/setup";
import {
    resolveTopOfStack,
    getManaSubstitutions,
    normalizeManaCost,
    payManaCost,
    commitLandsForCost,
} from "../../../../gre/state";
import {
    buildAutoTapSources,
    solveSmartAutoTap,
    manaFromPlan,
} from "../../../../gre/autoTap";
import { applyPendingChoiceSubmit } from "../../../../gre/pendingChoiceSubmit";
import { collectAttackManaTax } from "../../../../gre/combat";
import { globalAttackProhibitionReason } from "../../../attackRestrictions";
import { projectPublicState } from "../../../../gameProjections";
import type { GameState } from "../../../../gre/state";

describe("Natural Order (CR 117.9 additional cost / 701.19 / 400.7 / 701.20)", () => {
    it("declares the sacrifice-a-green-creature additional cost", () => {
        expect(naturalOrder.additionalCosts?.sacrificeFilter).toEqual({
            types: "Creature",
            colors: "G",
        });
    });

    it("searches for a green creature card and puts it onto the battlefield", () => {
        const libBear = makeInstance(grizzlyBears.id, {
            id: "bear1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        });
        const libForest = makeInstance(forest.id, {
            id: "forest1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { library: [libBear, libForest] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, naturalOrder.id, "p1");
        expect(resolveTopOfStack(state)).toBeNull(); // suspended on the search
        const head = state.pendingChoices![0];
        // Only the green creature matches — the Forest (a land, no color)
        // does not.
        expect(head.candidateIds).toEqual(["bear1"]);
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["bear1"],
        });
        expect(state.players[0].battlefield.map((c) => c.id)).toContain(
            "bear1"
        );
        expect(state.players[0].library.map((c) => c.id)).toEqual(["forest1"]);
    });
});

// ===========================================================================
// Elephant Grass (CR 508.1c/1g — mana-pay per-attacker attack tax + directed
// colour ban, #1053). Three clauses (see the card comment in ../green.ts):
//   1. cumulative upkeep {1},  2. black creatures can't attack you,
//   3. nonblack creatures pay {2} each to attack you.
// The tax is DIRECTED — only a source controlled by the player BEING attacked
// taxes; the collector `collectAttackManaTax` enforces that. Coverage below
// drives the read-only combat seam and the exact auto-tap enforcement loop
// `confirmAttackers` runs (mirrored here — no convex-test harness, ADR 0001).
// ===========================================================================

/** Builds a DECLARE_ATTACKERS state: p1 (active) attacks with `attackers`;
 *  Elephant Grass is on `taxController` (default p2, the defender). p1 has
 *  `p1Lands` untapped Forests available to pay the mana tax. */
function makeGrassCombat(args: {
    attackers: { id: string; cardId: string }[];
    p1Lands: number;
    taxController?: "p1" | "p2";
}): GameState {
    const attackerInsts = args.attackers.map((a) =>
        makeInstance(a.cardId, {
            id: a.id,
            controllerId: "p1",
            isAttacking: true,
        })
    );
    const lands = Array.from({ length: args.p1Lands }, (_, i) =>
        makeInstance(forest.id, { id: `p1-land-${i}`, controllerId: "p1" })
    );
    const grassOwner = args.taxController ?? "p2";
    const grass = makeInstance(elephantGrass.id, {
        id: "grass",
        controllerId: grassOwner,
    });
    const p1Battlefield = [...attackerInsts, ...lands];
    const p2Battlefield: typeof p1Battlefield = [];
    if (grassOwner === "p1") p1Battlefield.push(grass);
    else p2Battlefield.push(grass);
    return makeState({
        players: [
            makePlayer("p1", { battlefield: p1Battlefield }),
            makePlayer("p2", { battlefield: p2Battlefield }),
        ],
        phase: "DECLARE_ATTACKERS",
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        combat: {
            attackerIds: args.attackers.map((a) => a.id),
            blockerAssignments: {},
            confirmed: false,
            blockersConfirmed: false,
        },
    });
}

/** Mirrors the mana-tax charge loop game.ts `confirmAttackers` runs: for each
 *  charge, auto-tap the payer's mana and pay it. Returns the rejection reason
 *  when a charge is unpayable, else null. */
function payManaTaxSeam(state: GameState): string | null {
    for (const charge of collectAttackManaTax(state)) {
        const payer = state.players.find((p) => p.id === charge.controllerId)!;
        const subs = getManaSubstitutions(state, charge.controllerId);
        const sources = buildAutoTapSources(payer.battlefield);
        const cost = normalizeManaCost(charge.cost);
        const plan = solveSmartAutoTap(payer.manaPool, cost, subs, sources);
        if (plan === null) return charge.reason;
        const tappedIds = new Set(plan.map((s) => s.cardId));
        for (const src of payer.battlefield) {
            if (tappedIds.has(src.id)) src.isTapped = true;
        }
        const produced = manaFromPlan(sources, plan);
        for (const [c, amt] of Object.entries(produced)) {
            if (amt) payer.manaPool[c] = (payer.manaPool[c] ?? 0) + amt;
        }
        payManaCost(payer.manaPool, cost, subs);
        commitLandsForCost(payer, cost);
    }
    return null;
}

describe("Elephant Grass (CR 508.1c/1g — mana attack tax + colour ban, #1053)", () => {
    it("has {G}, cumulative upkeep {1}, and both attack-side statics", () => {
        expect(elephantGrass.manaCost).toEqual({ G: 1 });
        expect(elephantGrass.types).toContain("Enchantment");
        expect(elephantGrass.triggeredAbilities?.[0].id).toBe(
            "elephant-grass-cumulative-upkeep"
        );
        expect(
            elephantGrass.staticEffects?.find(
                (e) => e.kind === "attack-mana-tax"
            )
        ).toBeDefined();
        expect(
            elephantGrass.staticEffects?.find(
                (e) => e.kind === "global-attack-restriction"
            )
        ).toBeDefined();
    });

    it("charges {2} per nonblack attacker, scaling with attacker count", () => {
        const one = makeGrassCombat({
            attackers: [{ id: "g1", cardId: grizzlyBears.id }],
            p1Lands: 4,
        });
        expect(collectAttackManaTax(one)).toEqual([
            { controllerId: "p1", cost: { X: 2 }, reason: expect.any(String) },
        ]);

        const two = makeGrassCombat({
            attackers: [
                { id: "g1", cardId: grizzlyBears.id },
                { id: "g2", cardId: grizzlyBears.id },
            ],
            p1Lands: 4,
        });
        // One {2} charge per taxed attacker (CR 508.1c per-attacker scaling).
        expect(collectAttackManaTax(two)).toHaveLength(2);
    });

    it("does not mana-tax black attackers (clause 2 bars them outright)", () => {
        const state = makeGrassCombat({
            attackers: [{ id: "b1", cardId: scatheZombies.id }],
            p1Lands: 4,
        });
        expect(collectAttackManaTax(state)).toEqual([]);
    });

    it("does not tax when Elephant Grass' controller is the ATTACKER (directed at 'you')", () => {
        const state = makeGrassCombat({
            attackers: [{ id: "g1", cardId: grizzlyBears.id }],
            p1Lands: 4,
            taxController: "p1",
        });
        expect(collectAttackManaTax(state)).toEqual([]);
    });

    it("pays the tax by auto-tapping the attacker's lands when affordable", () => {
        const state = makeGrassCombat({
            attackers: [
                { id: "g1", cardId: grizzlyBears.id },
                { id: "g2", cardId: grizzlyBears.id },
            ],
            p1Lands: 4,
        });
        // {2} × 2 attackers = 4 generic — exactly four Forests.
        expect(payManaTaxSeam(state)).toBeNull();
        const tapped = state.players[0].battlefield.filter(
            (c) => c.id.startsWith("p1-land") && c.isTapped
        );
        expect(tapped).toHaveLength(4);
    });

    it("rejects the declaration when the attacker cannot pay the full tax", () => {
        const state = makeGrassCombat({
            attackers: [
                { id: "g1", cardId: grizzlyBears.id },
                { id: "g2", cardId: grizzlyBears.id },
            ],
            p1Lands: 3, // needs 4
        });
        expect(payManaTaxSeam(state)).toMatch(/Elephant Grass/);
    });

    // Clause 2 is client-visible (grays out the attacker), so the ban must
    // survive the wire projection (frontend-wiring analysis, #1053).
    it("bars a black creature from attacking you — and the ban survives projection", () => {
        const state = makeGrassCombat({
            attackers: [{ id: "b1", cardId: scatheZombies.id }],
            p1Lands: 0,
        });
        const attacker = state.players[0].battlefield.find(
            (c) => c.id === "b1"
        )!;
        expect(globalAttackProhibitionReason(attacker, state)).toMatch(
            /Elephant Grass/
        );
        // Same assertion through the wire projection (the client evaluates this
        // reducer to gray out illegal attackers).
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "b1"
        )!;
        expect(
            globalAttackProhibitionReason(slim as never, projected as never)
        ).toMatch(/Elephant Grass/);
    });

    it("does not bar a nonblack creature via clause 2 (it is taxed, not barred)", () => {
        const state = makeGrassCombat({
            attackers: [{ id: "g1", cardId: grizzlyBears.id }],
            p1Lands: 4,
        });
        const attacker = state.players[0].battlefield.find(
            (c) => c.id === "g1"
        )!;
        expect(globalAttackProhibitionReason(attacker, state)).toBeUndefined();
    });
});
