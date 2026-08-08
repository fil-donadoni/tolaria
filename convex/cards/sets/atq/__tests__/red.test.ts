// Antiquities (ATQ) — per-card behavior tests for red cards in
// `convex/cards/sets/atq/red.ts` (set split by colour, ADR 0043). Each
// non-trivial card gets a describe block citing the CR section it exercises;
// assertions check external behavior only. Shared test shims live in
// `./helpers`; fixtures in `convex/cards/__tests__/setup.ts`.

import { describe, it, expect } from "vitest";
import {
    ornithopter,
    dragonEngine,
    clayStatue,
    crumble,
    detonate,
    shatterstorm,
    artifactBlast,
    amuletOfKroog,
    goblinArtisans,
    atog,
    orcishMechanics,
    dwarvenWeaponsmith,
} from "..";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import { projectPublicState } from "../../../../gameProjections";
import { resolveTopOfStack, type GameState } from "../../../../gre/state";
import { applyRandomRevealAck } from "../../../../gre/pendingChoiceSubmit";
import {
    getEffectivePower,
    getEffectiveToughness,
} from "../../../../gre/layers";
import { getLegalTargets, NO_TARGETING_SOURCE } from "../../../../gre/rules";
import { resolveActivated, vanilla } from "./helpers";

describe("Detonate ({X}{R} — destroy artifact of mv X, X damage to controller, CR 107.3 / 701.7)", () => {
    it("destroys an artifact with mv X and deals X damage to its controller", () => {
        // Dragon Engine is mv 3 (MTGJSON {3}). X = 3.
        const engine = makeInstance(dragonEngine.id, {
            id: "engine",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [engine] }),
            ],
        });
        const item = pushSpell(state, detonate.id, "p1", [
            { type: "permanent", id: "engine" },
        ]);
        item.chosenX = 3;
        resolveTopOfStack(state);
        expect(
            state.players[1].battlefield.find((c) => c.id === "engine")
        ).toBeUndefined();
        // 3 damage to p2 (the controller).
        expect(state.players[1].life).toBe(17);
    });

    it("getLegalTargets restricts to artifacts whose mv equals the chosen X", () => {
        // Two artifacts: Dragon Engine (mv 3), Clay Statue (mv 4). With X=3,
        // only the mv-3 artifact is legal (mvFilter: { equals: "X" }).
        const engine = makeInstance(dragonEngine.id, {
            id: "engine",
            controllerId: "p2",
            ownerId: "p2",
        });
        const statue = makeInstance(clayStatue.id, {
            id: "statue",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [engine, statue] }),
            ],
        });
        const ids = getLegalTargets(
            state,
            detonate.targetRequirement!,
            NO_TARGETING_SOURCE,
            "p1",
            3
        ).map((t) => t.id);
        expect(ids).toContain("engine");
        expect(ids).not.toContain("statue");
    });

    it("can't be regenerated — a regen shield does not save the target", () => {
        const engine = makeInstance(dragonEngine.id, {
            id: "engine",
            controllerId: "p2",
            ownerId: "p2",
            card: { id: dragonEngine.id, regenerationShields: 1 },
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [engine] }),
            ],
        });
        const item = pushSpell(state, detonate.id, "p1", [
            { type: "permanent", id: "engine" },
        ]);
        item.chosenX = 3;
        resolveTopOfStack(state);
        expect(
            state.players[1].battlefield.find((c) => c.id === "engine")
        ).toBeUndefined();
    });
});

describe("Shatterstorm (destroy all artifacts, no regen, CR 701.7 / 701.15c)", () => {
    it("destroys every artifact on the battlefield, leaving non-artifacts", () => {
        const a1 = makeInstance(clayStatue.id, {
            id: "a1",
            controllerId: "p1",
            ownerId: "p1",
        });
        const a2 = makeInstance(dragonEngine.id, {
            id: "a2",
            controllerId: "p2",
            ownerId: "p2",
        });
        const creature = vanilla("creature", 2, 2);
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [a1] }),
                makePlayer("p2", { battlefield: [a2, creature] }),
            ],
        });
        pushSpell(state, shatterstorm.id, "p1");
        resolveTopOfStack(state);
        expect(state.players[0].battlefield.find((c) => c.id === "a1")).toBe(
            undefined
        );
        expect(state.players[1].battlefield.find((c) => c.id === "a2")).toBe(
            undefined
        );
        // The non-artifact creature is untouched.
        expect(
            state.players[1].battlefield.find((c) => c.id === "creature")
        ).toBeDefined();
    });

    it("can't be regenerated — artifacts with regen shields still die", () => {
        const a1 = makeInstance(clayStatue.id, {
            id: "a1",
            controllerId: "p1",
            ownerId: "p1",
            card: { id: clayStatue.id, regenerationShields: 1 },
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [a1] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, shatterstorm.id, "p1");
        resolveTopOfStack(state);
        expect(state.players[0].battlefield.find((c) => c.id === "a1")).toBe(
            undefined
        );
    });

    it("spares indestructible artifacts (CR 702.12)", () => {
        const a1 = makeInstance(clayStatue.id, {
            id: "a1",
            controllerId: "p1",
            ownerId: "p1",
            staticAbilities: ["indestructible"],
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [a1] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, shatterstorm.id, "p1");
        resolveTopOfStack(state);
        expect(
            state.players[0].battlefield.find((c) => c.id === "a1")
        ).toBeDefined();
    });
});

describe("Artifact Blast (counter target artifact spell, CR 701.5a / 114.1)", () => {
    it("counters an artifact spell on the stack", () => {
        const state = makeState();
        // p2 casts Clay Statue (an Artifact spell). p1 responds with blast.
        const statueSpell = pushSpell(state, clayStatue.id, "p2");
        pushSpell(state, artifactBlast.id, "p1", [
            { type: "spell", id: statueSpell.id },
        ]);
        resolveTopOfStack(state); // resolve Artifact Blast (top of stack)
        expect(
            state.stack.find((s) => s.id === statueSpell.id)
        ).toBeUndefined();
        // Countered artifact goes to its owner's (p2) graveyard.
        expect(
            state.players[1].graveyard.some((c) => c.id === statueSpell.id)
        ).toBe(true);
    });

    it("getLegalTargets only offers artifact spells, not other spell types", () => {
        const state = makeState();
        const artifactSpell = pushSpell(state, clayStatue.id, "p2");
        const instantSpell = pushSpell(state, crumble.id, "p2", [
            { type: "permanent", id: "nonexistent" },
        ]);
        const ids = getLegalTargets(
            state,
            artifactBlast.targetRequirement!,
            NO_TARGETING_SOURCE,
            "p1"
        ).map((t) => t.id);
        expect(ids).toContain(artifactSpell.id);
        expect(ids).not.toContain(instantSpell.id);
    });
});

// Goblin Artisans (CR 705 coin flip → draw / counter own artifact spell)
describe("Goblin Artisans ({T}: flip → draw / counter own artifact spell)", () => {
    // Seeds verified in arn.test.ts: rngSeed 1 → first flip wins; 7 → loses.
    //
    // The flip is a SUSPENDING `coinFlip` (CR 705.2 / ADR 0023): resolution
    // parks on a `random-reveal` Pending Choice — which is what drives the
    // client's coin-flip animation — and the branch runs only after the ack.
    // A card whose entire text is "Flip a coin" must show the flip.
    /** Acknowledge the head random-reveal choice to resume resolution. */
    function ack(state: GameState) {
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("random-reveal");
        expect(head.randomKind).toBe("coin");
        applyRandomRevealAck(state, {
            playerId: head.playerId,
            stackItemId: head.stackItemId,
            choiceId: head.choiceId,
        });
    }
    it("on a winning flip, draws a card (no counter)", () => {
        const artisans = makeInstance(goblinArtisans.id, {
            id: "artisans",
            controllerId: "p1",
            ownerId: "p1",
        });
        const card = makeInstance(ornithopter.id, {
            id: "lib-card",
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        });
        // An own artifact spell on the stack as the declared target.
        const artifactSpell = makeInstance(amuletOfKroog.id, {
            id: "art-spell",
            controllerId: "p1",
            ownerId: "p1",
            zone: "stack",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [artisans],
                    library: [card],
                    hand: [],
                }),
            ],
            stack: [{ ...artifactSpell, castById: "p1", targets: [] }],
            rngSeed: 1,
        });
        resolveActivated(state, artisans, "goblin-artisans-flip", [
            { type: "spell", id: "art-spell" },
        ]);
        ack(state);
        // Drew the card; the targeted spell is NOT countered (still on stack).
        expect(state.players[0].hand).toHaveLength(1);
        expect(state.stack.some((s) => s.id === "art-spell")).toBe(true);
    });

    it("on a losing flip, counters the targeted own artifact spell (no draw)", () => {
        const artisans = makeInstance(goblinArtisans.id, {
            id: "artisans",
            controllerId: "p1",
            ownerId: "p1",
        });
        const card = makeInstance(ornithopter.id, {
            id: "lib-card",
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        });
        const artifactSpell = makeInstance(amuletOfKroog.id, {
            id: "art-spell",
            controllerId: "p1",
            ownerId: "p1",
            zone: "stack",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [artisans],
                    library: [card],
                    hand: [],
                }),
            ],
            stack: [{ ...artifactSpell, castById: "p1", targets: [] }],
            rngSeed: 7,
        });
        resolveActivated(state, artisans, "goblin-artisans-flip", [
            { type: "spell", id: "art-spell" },
        ]);
        ack(state);
        // Did NOT draw; the targeted artifact spell is countered (off stack).
        expect(state.players[0].hand).toHaveLength(0);
        expect(state.stack.some((s) => s.id === "art-spell")).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// Cluster A — sacrifice-as-activation-cost (filtered, non-self).
// CR 602.1 / 118.5. These tests exercise the ability RESOLUTION on fat state
// (and the wire format where the effect is visible). The cost/choice flow
// (picking + sacrificing + mv snapshot) is exercised end-to-end through the
// mutations in convex/__tests__/sacrifice-cost-activation.test.ts.
// ---------------------------------------------------------------------------

describe("Atog (CR 602.1 — sacrifice an artifact: +2/+2)", () => {
    it("pumps the source +2/+2 until end of turn on resolution", () => {
        const at = makeInstance(atog.id, { id: "atog-1" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [at] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, at, "atog-pump");
        const after = state.players[0].battlefield.find(
            (c) => c.id === "atog-1"
        )!;
        expect(getEffectivePower(state, after)).toBe(3);
        expect(getEffectiveToughness(state, after)).toBe(4);
    });

    it("wire format — pump survives projection", () => {
        const at = makeInstance(atog.id, { id: "atog-1" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [at] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, at, "atog-pump");
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "atog-1"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(3);
        expect(getEffectiveToughness(projected, slim)).toBe(4);
    });
});

describe("Orcish Mechanics (CR 602.1 — {T}, sac artifact: 2 dmg any target)", () => {
    it("deals 2 damage to a target player on resolution", () => {
        const mech = makeInstance(orcishMechanics.id, { id: "mech-1" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [mech] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, mech, "orcish-mechanics-bolt", [
            { type: "player", id: "p2" },
        ]);
        expect(state.players[1].life).toBe(18);
    });
});

describe("Dwarven Weaponsmith (CR 602.5b — upkeep-only +1/+1 counter)", () => {
    it("puts a +1/+1 counter on a target creature on resolution", () => {
        const smith = makeInstance(dwarvenWeaponsmith.id, { id: "smith-1" });
        const target = makeInstance(ornithopter.id, { id: "orn-tgt" });
        const state = makeState({
            phase: "UPKEEP",
            players: [
                makePlayer("p1", { battlefield: [smith, target] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, smith, "dwarven-weaponsmith-counter", [
            { type: "permanent", id: "orn-tgt" },
        ]);
        const after = state.players[0].battlefield.find(
            (c) => c.id === "orn-tgt"
        )!;
        expect(after.counters?.["+1/+1"]).toBe(1);
    });
});
