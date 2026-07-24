import { describe, it, expect } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import { getCardByName } from "../../../index";
import type {
    CardInstanceState,
    GameState,
    StackItem,
} from "../../../../gre/state";
import { resolveTopOfStack } from "../../../../gre/state";
import {
    getEffectivePower,
    getEffectiveToughness,
} from "../../../../gre/layers";
import { mineCollapse, blazingRootwalla, ragavanNimblePilferer } from "../red";

// Mine Collapse — {3}{R} Instant. "If it's your turn, you may sacrifice a
// Mountain rather than pay this spell's mana cost. Mine Collapse deals 5 damage
// to target creature or planeswalker." (CR 118.9 pitch cost — sacrifice a
// Mountain, gated on your-turn; CR 120.1 damage.) The sacrifice leg reuses the
// existing permanent machinery; the dealDamage effect (reused Op) is covered by
// the catalogue smoke sweep. Here we pin the definition + resolve one damage.
describe("Mine Collapse (pitch: sacrifice a Mountain, your turn)", () => {
    const treefolk = getCardByName("Ironroot Treefolk"); // 3/5 — survives 5? no, dies

    it("declares the conditional sacrifice alternative cost", () => {
        expect(mineCollapse.alternativeCosts).toEqual([
            {
                id: "pitch-sacrifice-mountain",
                description: "Sacrifice a Mountain",
                action: "sacrifice",
                count: 1,
                filter: { subtypes: "Mountain" },
                condition: { kind: "your-turn" },
            },
        ]);
        expect(mineCollapse.targetRequirement).toEqual({
            type: ["Creature", "Planeswalker"],
            count: 1,
        });
    });

    it("deals 5 damage to the target creature (lethal to a 3/5)", () => {
        const victim = makeInstance(treefolk.id, {
            id: "v",
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [victim] }),
            ],
        });
        pushSpell(state, mineCollapse.id, "p1", [
            { type: "permanent", id: "v" },
        ]);
        resolveTopOfStack(state);
        // 5 damage ≥ toughness 5 → destroyed by SBA.
        expect(state.players[1].graveyard.some((c) => c.id === "v")).toBe(true);
    });
});

/** Push an activated ability onto the stack (cost assumed paid), then resolve. */
function resolveActivated(
    state: GameState,
    source: CardInstanceState,
    abilityId: string
): void {
    const item: StackItem = {
        ...source,
        zone: "stack",
        castById: source.controllerId,
        abilityId,
        targets: [],
    };
    state.stack.push(item);
    resolveTopOfStack(state);
}

describe("Blazing Rootwalla — Madness {0} + once-per-turn pump (CR 702.35 / 602.5)", () => {
    it("carries Madness {0} and a oncePerTurn pump ability", () => {
        expect(blazingRootwalla.madness).toEqual({});
        const pump = blazingRootwalla.activatedAbilities?.find(
            (a) => a.id === "blazing-rootwalla-pump"
        );
        expect(pump?.oncePerTurn).toBe(true);
    });

    it("gives +2/+0 until end of turn", () => {
        const walla = makeInstance(blazingRootwalla.id, { controllerId: "p1" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [walla] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, walla, "blazing-rootwalla-pump");
        // 1/1 → 3/1.
        expect(getEffectivePower(state, walla)).toBe(3);
        expect(getEffectiveToughness(state, walla)).toBe(1);
    });
});

// ── Fury — targeted trigger + divide-as-you-choose (CR 603.3d / 601.2d, #1193/#1206) ──
import { fury } from "../red";
import { finalizeTargetSelection } from "../../../../game";
import { raiseTriggerTargetSelection } from "../../../../gre/rules";
import type { TargetSelection } from "../../../types";

function furyEtbOnStack(state: GameState, controllerId: string): StackItem {
    const source = makeInstance(fury.id, {
        id: "fury-src",
        controllerId,
        ownerId: controllerId,
        zone: "battlefield",
    });
    const trig: StackItem = {
        ...source,
        id: "fury-trig",
        zone: "stack",
        castById: controllerId,
        triggeredAbilityId: "fury-etb",
        triggerSourceId: source.id,
        triggerEvent: {
            type: "PERMANENT_ENTERED",
            instanceId: source.id,
            controllerId,
            types: ["Creature"],
        } as StackItem["triggerEvent"],
        targets: undefined,
    };
    state.stack.push(trig);
    return trig;
}

describe("Fury — targeted triggered ability with divide-as-you-choose (CR 603.3d / 601.2d, #1193)", () => {
    it("pins the definition (double strike, red evoke, 4-damage divide trigger)", () => {
        expect(fury.staticAbilities).toContain("double strike");
        expect(fury.evoke).toEqual({
            id: "evoke",
            description: "Evoke—Exile a red card from your hand",
            handCost: {
                action: "exile",
                requirements: [{ filter: { color: "R" }, count: 1 }],
            },
        });
        const etb = fury.triggeredAbilities?.find((a) => a.id === "fury-etb");
        expect(etb?.targetRequirement).toEqual({
            type: ["Creature", "Planeswalker"],
            count: { min: 1, max: 4 },
            divideAsChosen: { total: 4 },
        });
    });

    it("raises a divide target choice at announcement, then deals the chosen split", () => {
        const treefolk = getCardByName("Ironroot Treefolk"); // 3/5
        const a = makeInstance(treefolk.id, {
            id: "a",
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
        });
        const b = makeInstance(treefolk.id, {
            id: "b",
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [a, b] }),
            ],
        });
        furyEtbOnStack(state, "p1");

        // CR 603.3d — the targeted trigger raises target selection as it is put
        // on the stack. Divide-as-you-choose ⇒ always a real choice.
        expect(raiseTriggerTargetSelection(state)).toBe(true);
        const pt = state.pendingTarget!;
        expect(pt.kind).toBe("trigger");
        expect(pt.cardInstanceId).toBe("fury-trig");
        expect(pt.divideTotal).toBe(4);

        // Assign 1 to A, 3 to B and finalize (mirrors the divide UI submission).
        pt.selected = [
            { type: "permanent", id: "a" },
            { type: "permanent", id: "b" },
        ] as TargetSelection[];
        pt.divideAmounts = { "permanent:a": 1, "permanent:b": 3 };
        finalizeTargetSelection(state, pt, "p1");

        const trig = state.stack.find((s) => s.id === "fury-trig")!;
        expect(trig.targets).toHaveLength(2);
        expect(trig.targetAmounts).toEqual({
            "permanent:a": 1,
            "permanent:b": 3,
        });

        resolveTopOfStack(state);
        const board = state.players[1].battlefield;
        expect(board.find((c) => c.id === "a")?.damageMarked).toBe(1);
        expect(board.find((c) => c.id === "b")?.damageMarked).toBe(3);
    });

    it("removes the trigger from the stack when no legal target exists (CR 603.3c)", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        furyEtbOnStack(state, "p1");
        // No creatures/planeswalkers anywhere and min 1 required → the trigger
        // is removed from the stack and does nothing (CR 603.3c).
        expect(raiseTriggerTargetSelection(state)).toBe(false);
        expect(state.stack.find((s) => s.id === "fury-trig")).toBeUndefined();
        expect(state.pendingTarget).toBeUndefined();
    });
});

// Ragavan, Nimble Pilferer — {R} Legendary Creature — Monkey Pirate, 2/1
// (MH2 138, issue #1527). "Whenever Ragavan deals combat damage to a player,
// create a Treasure token and exile the top card of that player's library.
// Until end of turn, you may cast that card. Dash {1}{R}." The
// impulse-draw-off-an-opponent protocol (Robber of the Rich precedent) +
// Dash (already proven by the synthetic probe in gre/__tests__/dash.test.ts
// and reused by Death-Greeter's Champion, moc/red.ts) — no new Op, so only
// the resolve() closure itself is pinned here per the card testing
// convention.
describe("Ragavan, Nimble Pilferer (combat-damage impulse + Dash, CR 702.109a)", () => {
    it("is a {R} 2/1 Legendary Creature — Monkey Pirate with a dash mana leg", () => {
        expect(ragavanNimblePilferer.manaCost).toEqual({ R: 1 });
        expect(ragavanNimblePilferer.power).toBe(2);
        expect(ragavanNimblePilferer.toughness).toBe(1);
        expect(ragavanNimblePilferer.subtypes).toEqual(["Monkey", "Pirate"]);
        expect(ragavanNimblePilferer.dash).toEqual({
            id: "dash",
            description: "Dash {1}{R}",
            mana: { X: 1, R: 1 },
        });
    });

    function ragavanDealsDamage(state: GameState): void {
        const trig: StackItem = {
            ...state.players[0].battlefield[0],
            id: "ragavan-trig",
            zone: "stack",
            castById: "p1",
            triggeredAbilityId: "ragavan-combat-damage",
            triggerSourceId: "ragavan",
            triggerEvent: {
                type: "DAMAGE_DEALT",
                sourceInstanceId: "ragavan",
                sourceControllerId: "p1",
                target: { type: "player", id: "p2" },
                amount: 2,
                isCombat: true,
            } as StackItem["triggerEvent"],
            targets: [],
        };
        state.stack.push(trig);
        resolveTopOfStack(state);
    }

    it("creates a Treasure, exiles the damaged player's top card, and grants a this-turn cast permission", () => {
        const ragavan = makeInstance(ragavanNimblePilferer.id, {
            id: "ragavan",
            controllerId: "p1",
            ownerId: "p1",
        });
        const oppTop = makeInstance(mineCollapse.id, {
            id: "opp-top",
            ownerId: "p2",
            zone: "library",
        });
        const state = makeState({
            turn: 3,
            players: [
                makePlayer("p1", { battlefield: [ragavan] }),
                makePlayer("p2", { library: [oppTop] }),
            ],
        });
        ragavanDealsDamage(state);

        // A Treasure token entered the battlefield under Ragavan's controller.
        const treasures = state.players[0].battlefield.filter((c) =>
            c.subtypes.includes("Treasure")
        );
        expect(treasures).toHaveLength(1);

        // The DAMAGED player's (p2's) top card is exiled into P2's OWN exile
        // zone (CR 400.7), library now empty.
        expect(state.players[1].library).toHaveLength(0);
        expect(state.players[1].exile).toHaveLength(1);
        const exiled = state.players[1].exile[0];
        expect(exiled.id).toBe("opp-top");

        // Cross-player grant: RAGAVAN's controller (p1) may cast it, "this
        // turn" only (revoked at the CURRENT turn's cleanup).
        expect(exiled.castableFromExileBy).toBe("p1");
        expect(exiled.castableFromExileUntilTurn).toBe(3);

        // CR 406.3 — hidden to the opponent (p2, the exile's own owner),
        // known only to Ragavan's controller (p1).
        expect(exiled.knownTo).toEqual(["p1"]);
    });

    it("no-ops (still creates the Treasure) when the damaged player's library is empty", () => {
        const ragavan = makeInstance(ragavanNimblePilferer.id, {
            id: "ragavan",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [ragavan] }),
                makePlayer("p2", { library: [] }),
            ],
        });
        ragavanDealsDamage(state);
        expect(
            state.players[0].battlefield.some((c) =>
                c.subtypes.includes("Treasure")
            )
        ).toBe(true);
        expect(state.players[1].exile).toHaveLength(0);
    });
});
