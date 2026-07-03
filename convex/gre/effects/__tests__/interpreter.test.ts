// Effect Script interpreter tests (ADR 0045, issue #800). Per-Op coverage:
// each Op is exercised through the REAL resolution path — a synthetic
// DSL-only card is registered, pushed on the stack and resolved via
// `resolveTopOfStack`, so the compiled script flows through the same
// `getResolveFn` seam as every imperative card (one execution path). Each Op
// also carries a wire-format assertion (`projectPublicState`) per the GRE
// testing convention — a script that mutates fields the projection strips
// would pass the fat-state test and still be broken on the client.

import { describe, it, expect } from "vitest";
import type { CardDefinition, EffectOp } from "../../../cards/types";
import { registerTokenDefinition } from "../../../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../cards/__tests__/setup";
import { resolveTopOfStack } from "../../state";
import {
    applyMayPaySubmit,
    applyPendingChoiceSubmit,
} from "../../pendingChoiceSubmit";
import { compactState, expandState } from "../../serialize";
import { refreshExpectedInput } from "../../expectedInput";
import { projectPublicState } from "../../../gameProjections";
import { fireDelayedTriggers } from "../../phases";
import { INLINE_DELAYED_TRIGGER_ID } from "../interpreter";
import { getEffectivePower, getEffectiveToughness } from "../../layers";

/** Registers a synthetic DSL-only sorcery under a stable test id. Uses the
 *  registry's injection seam (`registerTokenDefinition` — idempotent
 *  `registry.set`) so `pushSpell`/`resolveTopOfStack` hydrate the definition
 *  exactly like a real card. Test-only ids never enter `getAllCards()`, so
 *  the catalogue sweep stays clean. */
function registerScript(
    id: string,
    effects: EffectOp[],
    extra: Partial<CardDefinition> = {}
): string {
    registerTokenDefinition({
        id,
        name: id,
        rarity: "common",
        manaCost: { R: 1 },
        types: ["Sorcery"],
        effects,
        ...extra,
    });
    return id;
}

/** A vanilla 2/5 creature (toughness high enough to survive test burns, so
 *  marked damage stays observable — CR 120.3). */
const BEAR_ID = "test-effects-bear";
registerTokenDefinition({
    id: BEAR_ID,
    name: BEAR_ID,
    rarity: "common",
    manaCost: { X: 1, G: 1 },
    types: ["Creature"],
    subtypes: ["Bear"],
    power: 2,
    toughness: 5,
});

describe("Effect Script Op: dealDamage (CR 120.1)", () => {
    it("deals damage to the announced player target and puts the sorcery in the graveyard", () => {
        const id = registerScript("test-op-dmg-player", [
            { op: "dealDamage", amount: 3, to: { target: 0 } },
        ]);
        const state = makeState();
        pushSpell(state, id, "p1", [{ type: "player", id: "p2" }]);
        resolveTopOfStack(state);
        expect(state.players[1].life).toBe(17);
        // CR 608.2k — a resolved sorcery is put into its owner's graveyard.
        expect(state.players[0].graveyard.map((c) => c.card.id)).toContain(id);
    });

    it("marks damage on the announced creature target (CR 120.3)", () => {
        const id = registerScript("test-op-dmg-creature", [
            { op: "dealDamage", amount: 3, to: { target: 0 } },
        ]);
        const bear = makeInstance(BEAR_ID, { controllerId: "p2", id: "bear1" });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        pushSpell(state, id, "p1", [{ type: "permanent", id: "bear1" }]);
        resolveTopOfStack(state);
        expect(state.players[1].battlefield[0].damageMarked).toBe(3);
    });

    it("resolves relative player recipients (controller / opponent)", () => {
        const id = registerScript("test-op-dmg-relative", [
            { op: "dealDamage", amount: 2, to: { player: "opponent" } },
            { op: "dealDamage", amount: 1, to: { player: "controller" } },
        ]);
        const state = makeState();
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        expect(state.players[1].life).toBe(18);
        expect(state.players[0].life).toBe(19);
    });

    it("skips the Op when the announced target is missing and still runs the rest (CR 608.2b)", () => {
        const id = registerScript("test-op-dmg-missing", [
            { op: "dealDamage", amount: 3, to: { target: 0 } },
            { op: "gainLife", player: "controller", amount: 2 },
        ]);
        const state = makeState();
        pushSpell(state, id, "p1", []); // no target survives to resolution
        expect(() => resolveTopOfStack(state)).not.toThrow();
        expect(state.players[1].life).toBe(20);
        expect(state.players[0].life).toBe(22);
    });

    it("player damage and creature marked damage survive projection (wire format)", () => {
        const id = registerScript("test-op-dmg-wire", [
            { op: "dealDamage", amount: 3, to: { target: 0 } },
            { op: "dealDamage", amount: 2, to: { player: "opponent" } },
        ]);
        const bear = makeInstance(BEAR_ID, { controllerId: "p2", id: "bearW" });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        pushSpell(state, id, "p1", [{ type: "permanent", id: "bearW" }]);
        resolveTopOfStack(state);
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.players[1].life).toBe(18);
        const slimBear = projected.players[1].battlefield.find(
            (c) => c.id === "bearW"
        )!;
        expect(slimBear.damageMarked).toBe(3);
    });
});

describe("Effect Script Op: draw (CR 121.1)", () => {
    const withLibrary = (owner: "p1" | "p2", n: number) =>
        Array.from({ length: n }, (_, i) =>
            makeInstance(BEAR_ID, {
                id: `lib-${owner}-${i}`,
                controllerId: owner,
                ownerId: owner,
                zone: "library",
            })
        );

    it("the controller draws N cards", () => {
        const id = registerScript("test-op-draw-controller", [
            { op: "draw", player: "controller", count: 2 },
        ]);
        const state = makeState({
            players: [
                makePlayer("p1", { library: withLibrary("p1", 3) }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        expect(state.players[0].hand.length).toBe(2);
        expect(state.players[0].library.length).toBe(1);
    });

    it('an announced player target draws ("target player draws")', () => {
        const id = registerScript(
            "test-op-draw-target",
            [{ op: "draw", player: { target: 0 }, count: 1 }],
            { targetRequirement: { type: "player", count: 1 } }
        );
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { library: withLibrary("p2", 2) }),
            ],
        });
        pushSpell(state, id, "p1", [{ type: "player", id: "p2" }]);
        resolveTopOfStack(state);
        expect(state.players[1].hand.length).toBe(1);
    });

    it("is skipped when the announced target is not a player (CR 608.2b)", () => {
        const id = registerScript("test-op-draw-nonplayer", [
            { op: "draw", player: { target: 0 }, count: 1 },
        ]);
        const bear = makeInstance(BEAR_ID, { controllerId: "p2", id: "bearD" });
        const state = makeState({
            players: [
                makePlayer("p1", { library: withLibrary("p1", 1) }),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        pushSpell(state, id, "p1", [{ type: "permanent", id: "bearD" }]);
        expect(() => resolveTopOfStack(state)).not.toThrow();
        expect(state.players[0].hand.length).toBe(0);
        expect(state.players[1].hand.length).toBe(0);
    });

    it("the drawn hand survives projection (wire format)", () => {
        const id = registerScript("test-op-draw-wire", [
            { op: "draw", player: "controller", count: 2 },
        ]);
        const state = makeState({
            players: [
                makePlayer("p1", { library: withLibrary("p1", 3) }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.players[0].hand.length).toBe(2);
    });
});

describe("Effect Script Op: gainLife (CR 119.3a)", () => {
    it("the selected player gains life", () => {
        const id = registerScript("test-op-gain", [
            { op: "gainLife", player: "controller", amount: 3 },
            { op: "gainLife", player: "opponent", amount: 1 },
        ]);
        const state = makeState();
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(23);
        expect(state.players[1].life).toBe(21);
    });

    it("the life total survives projection (wire format)", () => {
        const id = registerScript("test-op-gain-wire", [
            { op: "gainLife", player: "controller", amount: 3 },
        ]);
        const state = makeState();
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        const projected = projectPublicState(state, 1, "p2");
        expect(projected.players[0].life).toBe(23);
    });
});

describe("Effect Script Op: loseLife (CR 119.3b)", () => {
    it("the selected player loses life (announced player target)", () => {
        const id = registerScript(
            "test-op-lose",
            [{ op: "loseLife", player: { target: 0 }, amount: 2 }],
            { targetRequirement: { type: "player", count: 1 } }
        );
        const state = makeState();
        pushSpell(state, id, "p1", [{ type: "player", id: "p2" }]);
        resolveTopOfStack(state);
        expect(state.players[1].life).toBe(18);
    });

    it("the life total survives projection (wire format)", () => {
        const id = registerScript("test-op-lose-wire", [
            { op: "loseLife", player: "opponent", amount: 2 },
        ]);
        const state = makeState();
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        const projected = projectPublicState(state, 1, "p2");
        expect(projected.players[1].life).toBe(18);
    });
});

describe("Effect Script Op: destroy (CR 701.8)", () => {
    it("destroys the announced creature target (moves it to its owner's graveyard)", () => {
        const id = registerScript("test-op-destroy", [
            { op: "destroy", target: { target: 0 } },
        ]);
        const bear = makeInstance(BEAR_ID, { controllerId: "p2", id: "bearX" });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        pushSpell(state, id, "p1", [{ type: "permanent", id: "bearX" }]);
        resolveTopOfStack(state);
        expect(state.players[1].battlefield.length).toBe(0);
        expect(state.players[1].graveyard.map((c) => c.id)).toContain("bearX");
    });

    it("routes through the replacement layer — an indestructible permanent survives (CR 702.12)", () => {
        const id = registerScript("test-op-destroy-indestructible", [
            { op: "destroy", target: { target: 0 } },
        ]);
        const bear = makeInstance(BEAR_ID, {
            controllerId: "p2",
            id: "bearI",
            staticAbilities: ["indestructible"],
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        pushSpell(state, id, "p1", [{ type: "permanent", id: "bearI" }]);
        resolveTopOfStack(state);
        expect(state.players[1].battlefield.map((c) => c.id)).toContain(
            "bearI"
        );
    });

    it("is a no-op when the announced target is missing (CR 608.2b)", () => {
        const id = registerScript("test-op-destroy-missing", [
            { op: "destroy", target: { target: 0 } },
        ]);
        const state = makeState();
        pushSpell(state, id, "p1", []);
        expect(() => resolveTopOfStack(state)).not.toThrow();
    });

    it("the destruction survives projection (wire format)", () => {
        const id = registerScript("test-op-destroy-wire", [
            { op: "destroy", target: { target: 0 } },
        ]);
        const bear = makeInstance(BEAR_ID, { controllerId: "p2", id: "bearY" });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        pushSpell(state, id, "p1", [{ type: "permanent", id: "bearY" }]);
        resolveTopOfStack(state);
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.players[1].battlefield.length).toBe(0);
        expect(projected.players[1].graveyard.map((c) => c.id)).toContain(
            "bearY"
        );
    });
});

describe("Effect Script Op: exile (CR 701.13)", () => {
    it("exiles the announced creature target to its owner's exile zone", () => {
        const id = registerScript("test-op-exile", [
            { op: "exile", target: { target: 0 } },
        ]);
        const bear = makeInstance(BEAR_ID, { controllerId: "p2", id: "bearE" });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        pushSpell(state, id, "p1", [{ type: "permanent", id: "bearE" }]);
        resolveTopOfStack(state);
        expect(state.players[1].battlefield).toHaveLength(0);
        expect(state.players[1].exile.map((c) => c.id)).toContain("bearE");
        // Exiled, NOT destroyed — nothing in the graveyard.
        expect(state.players[1].graveyard).toHaveLength(0);
    });

    it("is a no-op when the announced target is missing (CR 608.2b)", () => {
        const id = registerScript("test-op-exile-missing", [
            { op: "exile", target: { target: 0 } },
        ]);
        const state = makeState();
        pushSpell(state, id, "p1", []);
        expect(() => resolveTopOfStack(state)).not.toThrow();
    });

    it("the exile survives projection (wire format)", () => {
        const id = registerScript("test-op-exile-wire", [
            { op: "exile", target: { target: 0 } },
        ]);
        const bear = makeInstance(BEAR_ID, {
            controllerId: "p2",
            id: "bearEW",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        pushSpell(state, id, "p1", [{ type: "permanent", id: "bearEW" }]);
        resolveTopOfStack(state);
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.players[1].battlefield).toHaveLength(0);
        expect(projected.players[1].exile.map((c) => c.id)).toContain("bearEW");
    });
});

describe("Effect Script Op: moveZone (CR 400.7, issue #839)", () => {
    // A permanent target → hand: the bounce half (returnToHand, CR 701.10).
    it("returns an announced battlefield permanent to its owner's hand", () => {
        const id = registerScript("test-op-movezone-bounce", [
            { op: "moveZone", target: { target: 0 }, to: "hand" },
        ]);
        const bear = makeInstance(BEAR_ID, {
            controllerId: "p2",
            ownerId: "p2",
            id: "bearMZ",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        pushSpell(state, id, "p1", [{ type: "permanent", id: "bearMZ" }]);
        resolveTopOfStack(state);
        expect(state.players[1].battlefield).toHaveLength(0);
        expect(state.players[1].hand.map((c) => c.id)).toContain("bearMZ");
    });

    // A graveyard-card target → hand: the regrowth half (moveCardById,
    // Raise Dead / Regrowth).
    it("returns an announced graveyard card to its owner's hand", () => {
        const id = registerScript("test-op-movezone-regrowth", [
            { op: "moveZone", target: { target: 0 }, to: "hand" },
        ]);
        const dead = makeInstance(BEAR_ID, {
            controllerId: "p1",
            ownerId: "p1",
            id: "deadMZ",
            zone: "graveyard",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { graveyard: [dead] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, id, "p1", [
            { type: "graveyard-card", id: "deadMZ", playerId: "p1" },
        ]);
        resolveTopOfStack(state);
        // (The resolved sorcery itself lands in p1's graveyard — CR 608.2m —
        // so assert on the moved card by id, not on the graveyard's length.)
        expect(state.players[0].graveyard.map((c) => c.id)).not.toContain(
            "deadMZ"
        );
        expect(state.players[0].hand.map((c) => c.id)).toContain("deadMZ");
    });

    // A graveyard-card target → exile (moveCardById to exile, Grave Robbers).
    it("moves an announced graveyard card to exile", () => {
        const id = registerScript("test-op-movezone-exile", [
            { op: "moveZone", target: { target: 0 }, to: "exile" },
        ]);
        const dead = makeInstance(BEAR_ID, {
            controllerId: "p2",
            ownerId: "p2",
            id: "deadEX",
            zone: "graveyard",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { graveyard: [dead] }),
            ],
        });
        pushSpell(state, id, "p1", [
            { type: "graveyard-card", id: "deadEX", playerId: "p2" },
        ]);
        resolveTopOfStack(state);
        expect(state.players[1].graveyard).toHaveLength(0);
        expect(state.players[1].exile.map((c) => c.id)).toContain("deadEX");
    });

    // A graveyard-card target → battlefield: the reanimation half
    // (returnToBattlefield, Resurrection). Wire-format assertion: both zones
    // are public, so the outcome survives the projection.
    it("reanimates an announced graveyard card to the battlefield (wire format)", () => {
        const id = registerScript("test-op-movezone-reanimate", [
            { op: "moveZone", target: { target: 0 }, to: "battlefield" },
        ]);
        const dead = makeInstance(BEAR_ID, {
            controllerId: "p1",
            ownerId: "p1",
            id: "deadRA",
            zone: "graveyard",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { graveyard: [dead] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, id, "p1", [
            { type: "graveyard-card", id: "deadRA", playerId: "p1" },
        ]);
        resolveTopOfStack(state);
        // (The resolved sorcery itself lands in p1's graveyard — CR 608.2m —
        // so assert on the reanimated card by id, not on graveyard length.)
        expect(state.players[0].graveyard.map((c) => c.id)).not.toContain(
            "deadRA"
        );
        expect(state.players[0].battlefield.map((c) => c.id)).toContain(
            "deadRA"
        );
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.players[0].graveyard.map((c) => c.id)).not.toContain(
            "deadRA"
        );
        expect(projected.players[0].battlefield.map((c) => c.id)).toContain(
            "deadRA"
        );
    });

    // A self-bounce at an ability site: `{ ref: "$source" }` (Blinking Spirit).
    it("returns the source permanent to hand via the implicit $source binding", () => {
        const BLINKER_ID = "test-op-movezone-source";
        registerTokenDefinition({
            id: BLINKER_ID,
            name: BLINKER_ID,
            rarity: "common",
            manaCost: { W: 1 },
            types: ["Creature"],
            subtypes: ["Spirit"],
            power: 2,
            toughness: 2,
            activatedAbilities: [
                {
                    id: "blinker-bounce",
                    oracleText:
                        "{0}: Return this creature to its owner's hand.",
                    cost: { mana: { generic: 0 } },
                    useStack: true,
                    effects: [
                        {
                            op: "moveZone",
                            target: { ref: "$source" },
                            to: "hand",
                        },
                    ],
                },
            ],
        });
        const blinker = makeInstance(BLINKER_ID, {
            id: "blinker1",
            controllerId: "p1",
            ownerId: "p1",
            isSummoningSick: false,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [blinker] }),
                makePlayer("p2"),
            ],
        });
        const src = state.players[0].battlefield[0];
        state.stack.push({
            ...src,
            zone: "stack",
            castById: "p1",
            abilityId: "blinker-bounce",
            targets: [],
        });
        resolveTopOfStack(state);
        expect(state.players[0].battlefield).toHaveLength(0);
        expect(state.players[0].hand.map((c) => c.id)).toContain("blinker1");
    });

    it("is a no-op when the announced target is missing (CR 608.2b)", () => {
        const id = registerScript("test-op-movezone-missing", [
            { op: "moveZone", target: { target: 0 }, to: "hand" },
        ]);
        const state = makeState();
        pushSpell(state, id, "p1", []);
        expect(() => resolveTopOfStack(state)).not.toThrow();
    });
});

describe("Effect Script Op: pump (CR 613.4c, layer 7c, issue #840)", () => {
    // A one-shot pump spell targeting a creature: Giant Growth (+3/+3).
    // Wire-format assertion — the buffed P/T must survive the projection
    // (the layer pipeline runs on the slimmed state the client reads).
    it("pumps an announced creature target and survives the projection (wire format)", () => {
        const id = registerScript("test-op-pump-target", [
            {
                op: "pump",
                target: { target: 0 },
                power: 3,
                toughness: 3,
                duration: { phase: "end-of-turn" },
            },
        ]);
        const bear = makeInstance(BEAR_ID, {
            controllerId: "p2",
            ownerId: "p2",
            id: "bearPump",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        pushSpell(state, id, "p1", [{ type: "permanent", id: "bearPump" }]);
        resolveTopOfStack(state);
        const buffed = state.players[1].battlefield.find(
            (c) => c.id === "bearPump"
        )!;
        // BEAR_ID is a 2/5 → +3/+3 = 5/8.
        expect(getEffectivePower(state, buffed)).toBe(5);
        expect(getEffectiveToughness(state, buffed)).toBe(8);
        // Same assertion after the projection (the class of bug wire-format
        // tests exist to catch — a layer read over stripped state).
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[1].battlefield.find(
            (c) => c.id === "bearPump"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(5);
        expect(getEffectiveToughness(projected, slim)).toBe(8);
    });

    // A negative (shrink) pump — the executor does NOT skip a non-positive
    // value, unlike dealDamage/draw (Weakness, -2/-1).
    it("applies a negative P/T modification (a shrink)", () => {
        const id = registerScript("test-op-pump-shrink", [
            {
                op: "pump",
                target: { target: 0 },
                power: -2,
                toughness: -1,
                duration: { phase: "end-of-turn" },
            },
        ]);
        const bear = makeInstance(BEAR_ID, {
            controllerId: "p2",
            ownerId: "p2",
            id: "bearShrink",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        pushSpell(state, id, "p1", [{ type: "permanent", id: "bearShrink" }]);
        resolveTopOfStack(state);
        const shrunk = state.players[1].battlefield.find(
            (c) => c.id === "bearShrink"
        )!;
        // 2/5 → -2/-1 = 0/4.
        expect(getEffectivePower(state, shrunk)).toBe(0);
        expect(getEffectiveToughness(state, shrunk)).toBe(4);
    });

    // A one-sided pump (+0/+2 — a defensive boost) at an activated-ability
    // site via the implicit `$source` binding (Granite Gargoyle shape).
    it("pumps the source permanent via the implicit $source binding", () => {
        const PUMPER_ID = "test-op-pump-source";
        registerTokenDefinition({
            id: PUMPER_ID,
            name: PUMPER_ID,
            rarity: "common",
            manaCost: { R: 1 },
            types: ["Creature"],
            subtypes: ["Gargoyle"],
            power: 2,
            toughness: 2,
            activatedAbilities: [
                {
                    id: "gargoyle-pump",
                    oracleText:
                        "{R}: This creature gets +0/+2 until end of turn.",
                    cost: { mana: { R: 1 } },
                    useStack: true,
                    effects: [
                        {
                            op: "pump",
                            target: { ref: "$source" },
                            power: 0,
                            toughness: 2,
                            duration: { phase: "end-of-turn" },
                        },
                    ],
                },
            ],
        });
        const pumper = makeInstance(PUMPER_ID, {
            id: "gargoyle1",
            controllerId: "p1",
            ownerId: "p1",
            isSummoningSick: false,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [pumper] }),
                makePlayer("p2"),
            ],
        });
        const src = state.players[0].battlefield[0];
        state.stack.push({
            ...src,
            zone: "stack",
            castById: "p1",
            abilityId: "gargoyle-pump",
            targets: [],
        });
        resolveTopOfStack(state);
        const self = state.players[0].battlefield.find(
            (c) => c.id === "gargoyle1"
        )!;
        // 2/2 → +0/+2 = 2/4.
        expect(getEffectivePower(state, self)).toBe(2);
        expect(getEffectiveToughness(state, self)).toBe(4);
    });

    // A mass pump: forEach over the controller's creatures, each pumped via
    // the per-iteration `{ ref: "$each" }` object binding (Rally / anthem-shot
    // shape).
    it("pumps every member of a forEach set via { ref: $each }", () => {
        const id = registerScript("test-op-pump-foreach", [
            {
                op: "forEach",
                select: {
                    set: "permanents",
                    zone: "battlefield",
                    controller: "controller",
                    filter: { type: "Creature" },
                },
                effects: [
                    {
                        op: "pump",
                        target: { ref: "$each" },
                        power: 1,
                        toughness: 1,
                        duration: { phase: "end-of-turn" },
                    },
                ],
            },
        ]);
        const mine = ["mA", "mB"].map((cid) =>
            makeInstance(BEAR_ID, {
                id: cid,
                controllerId: "p1",
                ownerId: "p1",
            })
        );
        const theirs = makeInstance(BEAR_ID, {
            id: "tA",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: mine }),
                makePlayer("p2", { battlefield: [theirs] }),
            ],
        });
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        for (const cid of ["mA", "mB"]) {
            const c = state.players[0].battlefield.find((x) => x.id === cid)!;
            expect(getEffectivePower(state, c)).toBe(3); // 2/5 → 3/6
            expect(getEffectiveToughness(state, c)).toBe(6);
        }
        // The opponent's creature is outside the controller-scoped set.
        const other = state.players[1].battlefield.find((x) => x.id === "tA")!;
        expect(getEffectivePower(state, other)).toBe(2);
        expect(getEffectiveToughness(state, other)).toBe(5);
    });

    it("is a no-op when the announced target is missing (CR 608.2b)", () => {
        const id = registerScript("test-op-pump-missing", [
            {
                op: "pump",
                target: { target: 0 },
                power: 2,
                toughness: 2,
                duration: { phase: "end-of-turn" },
            },
        ]);
        const state = makeState();
        pushSpell(state, id, "p1", []);
        expect(() => resolveTopOfStack(state)).not.toThrow();
    });
});

describe("Effect Script Op: counters (CR 122, issue #841)", () => {
    // Adding +1/+1 counters to an announced creature target: the counters
    // persist and feed layer 7d, so the effective P/T rises. Wire-format
    // assertion — the counter-driven P/T must survive the projection (the
    // layer pipeline runs on the slimmed state the client reads).
    it("adds +1/+1 counters to an announced target and survives the projection (wire format)", () => {
        const id = registerScript("test-op-counters-add", [
            {
                op: "counters",
                action: "add",
                counter: "+1/+1",
                target: { target: 0 },
                count: 2,
            },
        ]);
        const bear = makeInstance(BEAR_ID, {
            controllerId: "p2",
            ownerId: "p2",
            id: "bearCtr",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        pushSpell(state, id, "p1", [{ type: "permanent", id: "bearCtr" }]);
        resolveTopOfStack(state);
        const buffed = state.players[1].battlefield.find(
            (c) => c.id === "bearCtr"
        )!;
        expect(buffed.counters?.["+1/+1"]).toBe(2);
        // BEAR_ID is a 2/5 → two +1/+1 counters = 4/7.
        expect(getEffectivePower(state, buffed)).toBe(4);
        expect(getEffectiveToughness(state, buffed)).toBe(7);
        // Same assertion after the projection (the wire-format bug class — a
        // layer read over stripped state).
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[1].battlefield.find(
            (c) => c.id === "bearCtr"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(4);
        expect(getEffectiveToughness(projected, slim)).toBe(7);
    });

    // Removing counters clamps to the counters present (CR 122.6) — a -1/-1
    // counter shed via the `remove` action.
    it("removes counters, clamped to those present (CR 122.6)", () => {
        const id = registerScript("test-op-counters-remove", [
            {
                op: "counters",
                action: "remove",
                counter: "-1/-1",
                target: { target: 0 },
                count: 5,
            },
        ]);
        const bear = makeInstance(BEAR_ID, {
            controllerId: "p2",
            ownerId: "p2",
            id: "bearRem",
        });
        // Seed two -1/-1 counters; removing 5 clamps to 2 (all gone).
        bear.counters = { "-1/-1": 2 };
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        pushSpell(state, id, "p1", [{ type: "permanent", id: "bearRem" }]);
        resolveTopOfStack(state);
        const cleared = state.players[1].battlefield.find(
            (c) => c.id === "bearRem"
        )!;
        expect(cleared.counters?.["-1/-1"] ?? 0).toBe(0);
    });

    // A self-counter via the implicit `$source` binding (a permanent putting a
    // counter on itself — a charge-counter accrual on an activated ability).
    it("adds a counter to the source permanent via the implicit $source binding", () => {
        const ACC_ID = "test-op-counters-source";
        registerTokenDefinition({
            id: ACC_ID,
            name: ACC_ID,
            rarity: "common",
            manaCost: { generic: 1 },
            types: ["Artifact"],
            activatedAbilities: [
                {
                    id: "acc-charge",
                    oracleText: "{1}: Put a charge counter on this artifact.",
                    cost: { mana: { generic: 1 } },
                    useStack: true,
                    effects: [
                        {
                            op: "counters",
                            action: "add",
                            counter: "charge",
                            target: { ref: "$source" },
                            count: 1,
                        },
                    ],
                },
            ],
        });
        const acc = makeInstance(ACC_ID, {
            id: "acc1",
            controllerId: "p1",
            ownerId: "p1",
            isSummoningSick: false,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [acc] }),
                makePlayer("p2"),
            ],
        });
        const src = state.players[0].battlefield[0];
        state.stack.push({
            ...src,
            zone: "stack",
            castById: "p1",
            abilityId: "acc-charge",
            targets: [],
        });
        resolveTopOfStack(state);
        const self = state.players[0].battlefield.find((c) => c.id === "acc1")!;
        expect(self.counters?.["charge"]).toBe(1);
    });

    // A mass counter placement: forEach over the controller's creatures, each
    // counter-ed via the per-iteration `{ ref: "$each" }` object binding.
    it("adds a counter to every member of a forEach set via { ref: $each }", () => {
        const id = registerScript("test-op-counters-foreach", [
            {
                op: "forEach",
                select: {
                    set: "permanents",
                    zone: "battlefield",
                    controller: "controller",
                    filter: { type: "Creature" },
                },
                effects: [
                    {
                        op: "counters",
                        action: "add",
                        counter: "+1/+1",
                        target: { ref: "$each" },
                        count: 1,
                    },
                ],
            },
        ]);
        const mine = ["mA", "mB"].map((cid) =>
            makeInstance(BEAR_ID, {
                id: cid,
                controllerId: "p1",
                ownerId: "p1",
            })
        );
        const theirs = makeInstance(BEAR_ID, {
            id: "tA",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: mine }),
                makePlayer("p2", { battlefield: [theirs] }),
            ],
        });
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        for (const cid of ["mA", "mB"]) {
            const c = state.players[0].battlefield.find((x) => x.id === cid)!;
            expect(c.counters?.["+1/+1"]).toBe(1);
            expect(getEffectivePower(state, c)).toBe(3); // 2/5 → 3/6
            expect(getEffectiveToughness(state, c)).toBe(6);
        }
        // The opponent's creature is outside the controller-scoped set.
        const other = state.players[1].battlefield.find((x) => x.id === "tA")!;
        expect(other.counters?.["+1/+1"] ?? 0).toBe(0);
    });

    it("is a no-op when the announced target is missing (CR 608.2b)", () => {
        const id = registerScript("test-op-counters-missing", [
            {
                op: "counters",
                action: "add",
                counter: "+1/+1",
                target: { target: 0 },
                count: 1,
            },
        ]);
        const state = makeState();
        pushSpell(state, id, "p1", []);
        expect(() => resolveTopOfStack(state)).not.toThrow();
    });
});

describe("Effect Script construct: bind + ref (ADR 0045, CR 608.2h)", () => {
    // The Swords to Plowshares shape: bind the exiled creature, then read its
    // snapshotted power/controller after it has changed zone. The snapshot is
    // taken BEFORE the exile, so the ref still resolves (last-known info).
    it("reads a bound object's power AFTER it changed zone (snapshot semantics)", () => {
        const id = registerScript("test-bind-ref-swords", [
            { op: "exile", target: { target: 0 }, bind: "$c" },
            {
                op: "gainLife",
                player: { ref: "$c.controller" },
                amount: { ref: "$c.power" },
            },
        ]);
        const bear = makeInstance(BEAR_ID, {
            controllerId: "p2",
            ownerId: "p2",
            id: "bearB",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        pushSpell(state, id, "p1", [{ type: "permanent", id: "bearB" }]);
        resolveTopOfStack(state);
        // Creature gone, and its controller (p2) gained life = its power (2).
        expect(state.players[1].battlefield).toHaveLength(0);
        expect(state.players[1].exile.map((c) => c.id)).toContain("bearB");
        expect(state.players[1].life).toBe(22);
    });

    it("ref on destroy binding reads the last-known power before the creature died", () => {
        const id = registerScript("test-bind-ref-destroy", [
            { op: "destroy", target: { target: 0 }, bind: "$x" },
            {
                op: "dealDamage",
                to: { player: "controller" },
                amount: { ref: "$x.power" },
            },
        ]);
        const bear = makeInstance(BEAR_ID, {
            controllerId: "p2",
            ownerId: "p2",
            id: "bearK",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        pushSpell(state, id, "p1", [{ type: "permanent", id: "bearK" }]);
        resolveTopOfStack(state);
        // Creature destroyed; controller (p1) took 2 damage (its power).
        expect(state.players[1].graveyard.map((c) => c.id)).toContain("bearK");
        expect(state.players[0].life).toBe(18);
    });

    it("skips the dependent Op when the binding was never captured (target gone, CR 608.2b)", () => {
        const id = registerScript("test-bind-ref-skip", [
            { op: "exile", target: { target: 0 }, bind: "$c" },
            {
                op: "gainLife",
                player: "controller",
                amount: { ref: "$c.power" },
            },
        ]);
        const state = makeState();
        pushSpell(state, id, "p1", []); // no target survives → no snapshot
        expect(() => resolveTopOfStack(state)).not.toThrow();
        expect(state.players[0].life).toBe(20); // no life gained
    });

    it("the bound-ref life gain survives projection (wire format)", () => {
        const id = registerScript("test-bind-ref-wire", [
            { op: "exile", target: { target: 0 }, bind: "$c" },
            {
                op: "gainLife",
                player: { ref: "$c.controller" },
                amount: { ref: "$c.power" },
            },
        ]);
        const bear = makeInstance(BEAR_ID, {
            controllerId: "p2",
            ownerId: "p2",
            id: "bearBW",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        pushSpell(state, id, "p1", [{ type: "permanent", id: "bearBW" }]);
        resolveTopOfStack(state);
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.players[1].life).toBe(22);
    });
});

describe("Effect Script construct: count (ADR 0045, CR 122)", () => {
    const withLibrary = (owner: "p1" | "p2", n: number) =>
        Array.from({ length: n }, (_, i) =>
            makeInstance(BEAR_ID, {
                id: `cnt-lib-${owner}-${i}`,
                controllerId: owner,
                ownerId: owner,
                zone: "library",
            })
        );

    it('draws a card for each creature you control ("for each" count on battlefield)', () => {
        const id = registerScript("test-count-draw", [
            {
                op: "draw",
                player: "controller",
                count: {
                    count: {
                        zone: "battlefield",
                        controller: "controller",
                        filter: { type: "Creature" },
                    },
                },
            },
        ]);
        const creatures = ["c1", "c2", "c3"].map((cid) =>
            makeInstance(BEAR_ID, {
                id: cid,
                controllerId: "p1",
                ownerId: "p1",
            })
        );
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: creatures,
                    library: withLibrary("p1", 5),
                }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        // 3 creatures on the battlefield → draw 3.
        expect(state.players[0].hand).toHaveLength(3);
        expect(state.players[0].library).toHaveLength(2);
    });

    it("counts zero cleanly — an empty set draws nothing", () => {
        const id = registerScript("test-count-zero", [
            {
                op: "draw",
                player: "controller",
                count: {
                    count: {
                        zone: "battlefield",
                        controller: "controller",
                        filter: { type: "Creature" },
                    },
                },
            },
        ]);
        const state = makeState({
            players: [
                makePlayer("p1", { library: withLibrary("p1", 2) }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, id, "p1");
        expect(() => resolveTopOfStack(state)).not.toThrow();
        expect(state.players[0].hand).toHaveLength(0);
    });

    it("deals damage for each card in a graveyard (count on graveyard zone)", () => {
        const id = registerScript("test-count-gy", [
            {
                op: "dealDamage",
                to: { player: "opponent" },
                amount: {
                    count: {
                        zone: "graveyard",
                        controller: "opponent",
                    },
                },
            },
        ]);
        const gy = ["g1", "g2"].map((cid) =>
            makeInstance(BEAR_ID, {
                id: cid,
                controllerId: "p2",
                ownerId: "p2",
                zone: "graveyard",
            })
        );
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2", { graveyard: gy })],
        });
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        // 2 cards in p2's graveyard → 2 damage to p2.
        expect(state.players[1].life).toBe(18);
    });

    it("honours a subtype filter on a graveyard count (subset, not the whole zone)", () => {
        // Regression (PR #817): a graveyard count with a subtype-only filter
        // used to ignore the subtype and count the ENTIRE graveyard. It must
        // count only the matching subtype (CR 205). Register a distinct
        // subtype so the graveyard is genuinely mixed.
        const ZOMBIE_ID = "test-effects-zombie";
        registerTokenDefinition({
            id: ZOMBIE_ID,
            name: ZOMBIE_ID,
            rarity: "common",
            manaCost: { B: 1 },
            types: ["Creature"],
            subtypes: ["Zombie"],
            power: 2,
            toughness: 2,
        });
        const id = registerScript("test-count-gy-subtype", [
            {
                op: "dealDamage",
                to: { player: "opponent" },
                amount: {
                    count: {
                        zone: "graveyard",
                        controller: "opponent",
                        filter: { subtype: "Zombie" },
                    },
                },
            },
        ]);
        // p2's graveyard: 2 Zombies + 3 Bears = 5 cards, but only 2 Zombies.
        const zombies = ["z1", "z2"].map((cid) =>
            makeInstance(ZOMBIE_ID, {
                id: cid,
                controllerId: "p2",
                ownerId: "p2",
                zone: "graveyard",
            })
        );
        const bears = ["b1", "b2", "b3"].map((cid) =>
            makeInstance(BEAR_ID, {
                id: cid,
                controllerId: "p2",
                ownerId: "p2",
                zone: "graveyard",
            })
        );
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { graveyard: [...zombies, ...bears] }),
            ],
        });
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        // Only the 2 Zombies count → 2 damage (NOT 5, the whole graveyard).
        expect(state.players[1].life).toBe(18);
    });
});

describe("Effect Script flat sequencing (CR 608.2c)", () => {
    it("executes Ops in written order — a Sign in Blood-shaped composite applies both", () => {
        const id = registerScript(
            "test-op-composite",
            [
                { op: "draw", player: { target: 0 }, count: 2 },
                { op: "loseLife", player: { target: 0 }, amount: 2 },
            ],
            { targetRequirement: { type: "player", count: 1 } }
        );
        const lib = [0, 1, 2].map((i) =>
            makeInstance(BEAR_ID, {
                id: `libc${i}`,
                controllerId: "p1",
                ownerId: "p1",
                zone: "library",
            })
        );
        const state = makeState({
            players: [makePlayer("p1", { library: lib }), makePlayer("p2")],
        });
        pushSpell(state, id, "p1", [{ type: "player", id: "p1" }]);
        resolveTopOfStack(state);
        expect(state.players[0].hand.length).toBe(2);
        expect(state.players[0].life).toBe(18);
        // wire format: both outcomes survive projection together
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.players[0].hand.length).toBe(2);
        expect(projected.players[0].life).toBe(18);
    });
});

// --- Ability sites (ADR 0045, issue #803) -----------------------------------
// The interpreter resolves triggered- and activated-ability scripts through
// the SAME `runEffectScript` path as spells, with the ability's controller and
// source permanent bound from the resolution context. These push real ability
// stack items (abilityId / triggeredAbilityId) and resolve them.

describe("Effect Script at ability sites (issue #803)", () => {
    // A 3/3 whose ACTIVATED ability's effect is a script: deal damage equal to
    // its own power via the implicit `$source` binding (CR 608.2h) — proving
    // the source permanent's characteristics reach the interpreter.
    const PINGER_ID = "test-ability-pinger";
    registerTokenDefinition({
        id: PINGER_ID,
        name: PINGER_ID,
        rarity: "common",
        manaCost: { R: 1 },
        types: ["Creature"],
        subtypes: ["Wizard"],
        power: 3,
        toughness: 3,
        activatedAbilities: [
            {
                id: "pinger-zap",
                oracleText:
                    "{T}: deals damage equal to its power to any target",
                cost: { tap: true },
                useStack: true,
                targetRequirement: { type: "any", count: 1 },
                effects: [
                    {
                        op: "dealDamage",
                        amount: { ref: "$source.power" },
                        to: { target: 0 },
                    },
                ],
            },
        ],
    });

    // A creature whose TRIGGERED ability's effect is a script: controller gains
    // 2 life. Proves the trigger's controller binds correctly on the shared
    // path (the firing event is not threaded into a script).
    const SHRINE_ID = "test-ability-lifeshrine";
    registerTokenDefinition({
        id: SHRINE_ID,
        name: SHRINE_ID,
        rarity: "common",
        manaCost: { W: 1 },
        types: ["Creature"],
        subtypes: ["Spirit"],
        power: 1,
        toughness: 1,
        triggeredAbilities: [
            {
                id: "lifeshrine-upkeep",
                oracleText: "gain 2 life",
                event: "PHASE_BEGIN",
                matches: () => true,
                effects: [{ op: "gainLife", player: "controller", amount: 2 }],
            },
        ],
    });

    it("activated-ability script binds $source and deals its power to a player (wire format)", () => {
        const pinger = makeInstance(PINGER_ID, {
            id: "pinger1",
            controllerId: "p1",
            ownerId: "p1",
            isSummoningSick: false,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [pinger] }),
                makePlayer("p2"),
            ],
        });
        const src = state.players[0].battlefield[0];
        state.stack.push({
            ...src,
            zone: "stack",
            castById: "p1",
            abilityId: "pinger-zap",
            targets: [{ type: "player", id: "p2" }],
        });
        resolveTopOfStack(state);
        // 3 damage == source power, not a literal.
        expect(state.players[1].life).toBe(17);
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.players[1].life).toBe(17);
    });

    it("activated-ability $source ref reads the LIVE (buffed) power", () => {
        const pinger = makeInstance(PINGER_ID, {
            id: "pinger2",
            controllerId: "p1",
            ownerId: "p1",
            isSummoningSick: false,
            // +2/+2 until end of turn — the ref must read 5, not the printed 3.
            temporaryPTMods: [
                {
                    power: 2,
                    toughness: 2,
                    duration: { phase: "end-of-turn" as const },
                },
            ],
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [pinger] }),
                makePlayer("p2"),
            ],
        });
        const src = state.players[0].battlefield[0];
        state.stack.push({
            ...src,
            zone: "stack",
            castById: "p1",
            abilityId: "pinger-zap",
            targets: [{ type: "player", id: "p2" }],
        });
        resolveTopOfStack(state);
        expect(state.players[1].life).toBe(15);
    });

    it("triggered-ability script resolves through the shared path with controller bound", () => {
        const shrine = makeInstance(SHRINE_ID, {
            id: "shrine1",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [shrine] }),
            ],
        });
        const src = state.players[1].battlefield[0];
        state.stack.push({
            ...src,
            zone: "stack",
            castById: "p2",
            triggeredAbilityId: "lifeshrine-upkeep",
            triggerEvent: {
                type: "PHASE_BEGIN",
                phase: "UPKEEP",
                activePlayerId: "p2",
            },
            triggerSourceId: "shrine1",
        });
        resolveTopOfStack(state);
        // The controller (p2), not the active-player-agnostic default, gains.
        expect(state.players[1].life).toBe(22);
        const projected = projectPublicState(state, 1, "p2");
        expect(projected.players[1].life).toBe(22);
    });
});

// --- choice Op: suspension / resume (CR 608.2 / 101.4, issue #805) ----------
// The interpreter suspends the script when a `choice` Op enqueues a Pending
// Choice and resumes AT that Op when the picks are submitted through the same
// primitive the generic `submitResolutionChoice` mutation drives
// (`applyPendingChoiceSubmit`). Bindings and the Op-index checkpoint live in
// the stack item's persisted fields, so they survive a DB round-trip.

describe("Effect Script Op: choice (CR 608.2 / 101.4, issue #805)", () => {
    const handOf = (owner: "p1" | "p2", ids: string[]) =>
        ids.map((cid) =>
            makeInstance(BEAR_ID, {
                id: cid,
                controllerId: owner,
                ownerId: owner,
                zone: "hand",
            })
        );

    it("suspends with a discard-hand PendingChoice and resumes into the consuming discard Op", () => {
        const id = registerScript(
            "test-op-choice-discard",
            [
                {
                    op: "choice",
                    kind: "discard-hand",
                    player: { target: 0 },
                    zone: "hand",
                    count: 2,
                    prompt: "Discard two cards.",
                    bind: "$picked",
                },
                {
                    op: "discard",
                    player: { target: 0 },
                    cards: { ref: "$picked" },
                },
            ],
            { targetRequirement: { type: "player", count: 1 } }
        );
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { hand: handOf("p2", ["h1", "h2", "h3"]) }),
            ],
        });
        pushSpell(state, id, "p1", [{ type: "player", id: "p2" }]);
        expect(resolveTopOfStack(state)).toBeNull(); // suspended
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("discard-hand");
        expect(head.playerId).toBe("p2");
        expect(head.zone).toBe("hand");
        expect(head.count).toBe(2);
        expect(head.prompt).toBe("Discard two cards.");
        // CR 608.3 — the spell stays on the stack while suspended.
        expect(state.stack).toHaveLength(1);

        applyPendingChoiceSubmit(state, {
            playerId: "p2",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["h1", "h3"],
        });
        expect(state.players[1].hand.map((c) => c.id)).toEqual(["h2"]);
        expect(state.players[1].graveyard.map((c) => c.id).sort()).toEqual([
            "h1",
            "h3",
        ]);
        // Resolution completed: stack empty, choice queue drained, sorcery in
        // its owner's graveyard (CR 608.2k).
        expect(state.stack).toHaveLength(0);
        expect(state.pendingChoices).toBeUndefined();
        expect(state.players[0].graveyard.map((c) => c.card.id)).toContain(id);
    });

    it("clamps the pick count to the available candidates (CR 608.2b / 701.9b)", () => {
        const id = registerScript(
            "test-op-choice-clamp",
            [
                {
                    op: "choice",
                    kind: "discard-hand",
                    player: { target: 0 },
                    zone: "hand",
                    count: 2,
                    prompt: "Discard two cards.",
                    bind: "$picked",
                },
                {
                    op: "discard",
                    player: { target: 0 },
                    cards: { ref: "$picked" },
                },
            ],
            { targetRequirement: { type: "player", count: 1 } }
        );
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { hand: handOf("p2", ["only"]) }),
            ],
        });
        pushSpell(state, id, "p1", [{ type: "player", id: "p2" }]);
        resolveTopOfStack(state);
        const head = state.pendingChoices![0];
        expect(head.count).toBe(1); // clamped: only one card in hand
        applyPendingChoiceSubmit(state, {
            playerId: "p2",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["only"],
        });
        expect(state.players[1].hand).toHaveLength(0);
        expect(state.players[1].graveyard.map((c) => c.id)).toEqual(["only"]);
    });

    it("skips the choice AND the consuming Op when there are no candidates (CR 608.2b)", () => {
        const id = registerScript(
            "test-op-choice-empty",
            [
                {
                    op: "choice",
                    kind: "discard-hand",
                    player: { target: 0 },
                    zone: "hand",
                    count: 2,
                    prompt: "Discard two cards.",
                    bind: "$picked",
                },
                {
                    op: "discard",
                    player: { target: 0 },
                    cards: { ref: "$picked" },
                },
                { op: "gainLife", player: "controller", amount: 1 },
            ],
            { targetRequirement: { type: "player", count: 1 } }
        );
        const state = makeState(); // p2's hand is empty
        pushSpell(state, id, "p1", [{ type: "player", id: "p2" }]);
        const resolved = resolveTopOfStack(state);
        expect(resolved).not.toBeNull(); // never suspended
        expect(state.pendingChoices).toBeUndefined();
        // The rest of the script still ran (CR 608.2b).
        expect(state.players[0].life).toBe(21);
        expect(state.players[0].graveyard.map((c) => c.card.id)).toContain(id);
    });

    it("Ops before the choice never re-run on resume (CR 608.3 checkpoint)", () => {
        const id = registerScript("test-op-choice-checkpoint", [
            { op: "dealDamage", amount: 3, to: { player: "opponent" } },
            {
                op: "choice",
                kind: "discard-hand",
                player: "opponent",
                zone: "hand",
                count: 1,
                prompt: "Discard a card.",
                bind: "$picked",
            },
            {
                op: "discard",
                player: "opponent",
                cards: { ref: "$picked" },
            },
        ]);
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { hand: handOf("p2", ["hx"]) }),
            ],
        });
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        expect(state.players[1].life).toBe(17); // damage applied once
        const head = state.pendingChoices![0];
        applyPendingChoiceSubmit(state, {
            playerId: "p2",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["hx"],
        });
        // Still exactly 3 damage — the dealDamage Op did NOT replay.
        expect(state.players[1].life).toBe(17);
        expect(state.players[1].graveyard.map((c) => c.id)).toEqual(["hx"]);
    });

    it("a snapshot binding taken BEFORE the choice survives the suspension (bind across suspended resolution, CR 608.2h)", () => {
        const id = registerScript(
            "test-op-choice-snapshot",
            [
                { op: "exile", target: { target: 0 }, bind: "$gone" },
                {
                    op: "choice",
                    kind: "discard-hand",
                    player: "controller",
                    zone: "hand",
                    count: 1,
                    prompt: "Discard a card.",
                    bind: "$picked",
                },
                {
                    op: "discard",
                    player: "controller",
                    cards: { ref: "$picked" },
                },
                // Reads the snapshot AFTER the suspension: the exiled bear's
                // controller (p2) gains its power (2). The exile Op ran before
                // the suspension and never re-runs, so the values can only
                // come from the persisted binding (CR 608.2h LKI).
                {
                    op: "gainLife",
                    player: { ref: "$gone.controller" },
                    amount: { ref: "$gone.power" },
                },
            ],
            { targetRequirement: { type: "Creature", count: 1 } }
        );
        const bear = makeInstance(BEAR_ID, { controllerId: "p2", id: "bearS" });
        const state = makeState({
            players: [
                makePlayer("p1", { hand: handOf("p1", ["c1"]) }),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        pushSpell(state, id, "p1", [{ type: "permanent", id: "bearS" }]);
        resolveTopOfStack(state);
        // Suspended AFTER the exile: the bear is already gone.
        expect(state.players[1].battlefield).toHaveLength(0);
        expect(state.players[1].exile.map((c) => c.id)).toEqual(["bearS"]);
        const head = state.pendingChoices![0];
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["c1"],
        });
        // $gone.power (2) gained by $gone.controller (p2) — read from the
        // persisted snapshot after the wait.
        expect(state.players[1].life).toBe(22);
        expect(state.players[0].graveyard.map((c) => c.id)).toContain("c1");
    });

    it("bindings and the checkpoint survive a DB round-trip while suspended (compactState/expandState)", () => {
        const id = registerScript(
            "test-op-choice-roundtrip",
            [
                { op: "exile", target: { target: 0 }, bind: "$gone" },
                {
                    op: "choice",
                    kind: "discard-hand",
                    player: "controller",
                    zone: "hand",
                    count: 1,
                    prompt: "Discard a card.",
                    bind: "$picked",
                },
                {
                    op: "discard",
                    player: "controller",
                    cards: { ref: "$picked" },
                },
                {
                    op: "gainLife",
                    player: { ref: "$gone.controller" },
                    amount: { ref: "$gone.power" },
                },
            ],
            { targetRequirement: { type: "Creature", count: 1 } }
        );
        const bear = makeInstance(BEAR_ID, { controllerId: "p2", id: "bearR" });
        const state = makeState({
            players: [
                makePlayer("p1", { hand: handOf("p1", ["c1"]) }),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        pushSpell(state, id, "p1", [{ type: "permanent", id: "bearR" }]);
        resolveTopOfStack(state);

        // Save / load across the wait — the exact seam a real game crosses
        // between the suspension and the player's submit.
        const revived = expandState(
            JSON.parse(JSON.stringify(compactState(state)))
        );
        const head = revived.pendingChoices![0];
        applyPendingChoiceSubmit(revived, {
            playerId: "p1",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["c1"],
        });
        expect(revived.players[1].life).toBe(22); // snapshot survived the trip
        const p1 = revived.players[0];
        expect(p1.graveyard.map((c) => c.id)).toContain("c1"); // picks did too
        expect(revived.stack).toHaveLength(0);
    });

    it("wire format: the suspended choice and the Expected Input cross the projection", () => {
        const id = registerScript(
            "test-op-choice-wire",
            [
                {
                    op: "choice",
                    kind: "discard-hand",
                    player: { target: 0 },
                    zone: "hand",
                    count: 1,
                    prompt: "Discard a card.",
                    bind: "$picked",
                },
                {
                    op: "discard",
                    player: { target: 0 },
                    cards: { ref: "$picked" },
                },
            ],
            { targetRequirement: { type: "player", count: 1 } }
        );
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { hand: handOf("p2", ["hw"]) }),
            ],
        });
        pushSpell(state, id, "p1", [{ type: "player", id: "p2" }]);
        resolveTopOfStack(state);
        // ADR 0047 — the engine refreshes the Expected Input at the stable
        // point before persisting; mirror that seam here.
        refreshExpectedInput(state);
        const projected = projectPublicState(state, 1, "p2");
        const head = projected.pendingChoices![0];
        expect(head.kind).toBe("discard-hand");
        expect(head.playerId).toBe("p2");
        expect(head.prompt).toBe("Discard a card.");
        expect(head.count).toBe(1);
        // The Expected Input reflects the scripted choice exactly as it does
        // for resolve()-based choices (issue #805 acceptance criterion).
        expect(projected.expectedInput).toEqual({
            kind: "choice",
            playerId: "p2",
            stackItemId: head.stackItemId,
            choiceId: "$picked",
            choiceKind: "discard-hand",
        });
    });

    it("choice at an ACTIVATED-ability site suspends and resumes through the shared path", () => {
        const LOOTER_ID = "test-ability-discarder";
        registerTokenDefinition({
            id: LOOTER_ID,
            name: LOOTER_ID,
            rarity: "common",
            manaCost: { U: 1 },
            types: ["Creature"],
            subtypes: ["Wizard"],
            power: 1,
            toughness: 1,
            activatedAbilities: [
                {
                    id: "discarder-loot",
                    oracleText: "{T}: Discard a card.",
                    cost: { tap: true },
                    useStack: true,
                    effects: [
                        {
                            op: "choice",
                            kind: "discard-hand",
                            player: "controller",
                            zone: "hand",
                            count: 1,
                            prompt: "Discard a card.",
                            bind: "$picked",
                        },
                        {
                            op: "discard",
                            player: "controller",
                            cards: { ref: "$picked" },
                        },
                    ],
                },
            ],
        });
        const looter = makeInstance(LOOTER_ID, {
            id: "looter1",
            controllerId: "p1",
            ownerId: "p1",
            isSummoningSick: false,
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [looter],
                    hand: handOf("p1", ["ha", "hb"]),
                }),
                makePlayer("p2"),
            ],
        });
        const src = state.players[0].battlefield[0];
        state.stack.push({
            ...src,
            zone: "stack",
            castById: "p1",
            abilityId: "discarder-loot",
        });
        expect(resolveTopOfStack(state)).toBeNull(); // suspended
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("discard-hand");
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["hb"],
        });
        expect(state.players[0].hand.map((c) => c.id)).toEqual(["ha"]);
        expect(state.players[0].graveyard.map((c) => c.id)).toEqual(["hb"]);
        expect(state.stack).toHaveLength(0); // ability resolved and popped
    });
});

// --- if construct + mayPay / counter Ops (ADR 0045, issue #806) --------------

describe("Effect Script Op: mayPay (CR 117.3a / 118.4, issue #806)", () => {
    it("suspends with a may-pay PendingChoice and binds the outcome true when paid", () => {
        const id = registerScript("test-op-maypay-paid", [
            {
                op: "mayPay",
                player: "opponent",
                cost: { X: 1 },
                prompt: "Pay {1}?",
                bind: "$paid",
            },
            // Fires only when NOT paid — so a paid answer leaves life alone.
            {
                op: "if",
                predicate: { not: { binding: "$paid" } },
                then: [{ op: "loseLife", player: "opponent", amount: 5 }],
            },
        ]);
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { manaPool: { C: 1 } }),
            ],
        });
        pushSpell(state, id, "p1");
        expect(resolveTopOfStack(state)).toBeNull(); // suspended on may-pay
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("may-pay");
        expect(head.playerId).toBe("p2");
        expect(state.stack).toHaveLength(1); // CR 608.3 — stays on the stack
        applyMayPaySubmit(state, { playerId: "p2", accept: true });
        // Paid → predicate `not $paid` is false → loseLife skipped.
        expect(state.players[1].life).toBe(20);
        expect(state.stack).toHaveLength(0);
    });

    it("binds the outcome false when the payment is declined, firing the consequence", () => {
        const id = registerScript("test-op-maypay-declined", [
            {
                op: "mayPay",
                player: "opponent",
                cost: { X: 1 },
                prompt: "Pay {1}?",
                bind: "$paid",
            },
            {
                op: "if",
                predicate: { not: { binding: "$paid" } },
                then: [{ op: "loseLife", player: "opponent", amount: 5 }],
            },
        ]);
        const state = makeState();
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        applyMayPaySubmit(state, { playerId: "p2", accept: false });
        // Declined → predicate true → 5 life lost (base 20).
        expect(state.players[1].life).toBe(15);
        expect(state.stack).toHaveLength(0);
    });
});

describe("Effect Script construct: if (ADR 0045, CR 608.2c, issue #806)", () => {
    it("runs the then branch and skips else on a true binding predicate", () => {
        const id = registerScript("test-if-then", [
            {
                op: "mayPay",
                player: "opponent",
                cost: { X: 1 },
                prompt: "Pay {1}?",
                bind: "$paid",
            },
            {
                op: "if",
                predicate: { binding: "$paid" },
                then: [{ op: "gainLife", player: "controller", amount: 3 }],
                else: [{ op: "gainLife", player: "controller", amount: 9 }],
            },
        ]);
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { manaPool: { C: 1 } }),
            ],
        });
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        applyMayPaySubmit(state, { playerId: "p2", accept: true });
        // Paid → `binding $paid` true → then branch (gain 3).
        expect(state.players[0].life).toBe(23);
    });

    it("runs the else branch when the predicate is false", () => {
        const id = registerScript("test-if-else", [
            {
                op: "mayPay",
                player: "opponent",
                cost: { X: 1 },
                prompt: "Pay {1}?",
                bind: "$paid",
            },
            {
                op: "if",
                predicate: { binding: "$paid" },
                then: [{ op: "gainLife", player: "controller", amount: 3 }],
                else: [{ op: "gainLife", player: "controller", amount: 9 }],
            },
        ]);
        const state = makeState();
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        applyMayPaySubmit(state, { playerId: "p2", accept: false });
        // Declined → false → else branch (gain 9).
        expect(state.players[0].life).toBe(29);
    });

    it("evaluates a comparison predicate against a bound snapshot (CR 107)", () => {
        // A 2/5 bear is exiled and its power (2) snapshotted; the comparison
        // `2 >= 2` fires the then branch.
        const id = registerScript(
            "test-if-comparison",
            [
                { op: "exile", target: { target: 0 }, bind: "$gone" },
                {
                    op: "if",
                    predicate: {
                        left: { ref: "$gone.power" },
                        op: "ge",
                        right: 2,
                    },
                    then: [{ op: "gainLife", player: "controller", amount: 4 }],
                    else: [{ op: "gainLife", player: "controller", amount: 1 }],
                },
            ],
            { targetRequirement: { type: "Creature", count: 1 } }
        );
        const bear = makeInstance(BEAR_ID, { controllerId: "p2", id: "cmpB" });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        pushSpell(state, id, "p1", [{ type: "permanent", id: "cmpB" }]);
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(24); // 2 >= 2 → then (+4)
    });

    it("suspends on a choice Op INSIDE a branch and resumes into the branch (nested suspension)", () => {
        const handOf = (owner: "p1" | "p2", ids: string[]) =>
            ids.map((cid) =>
                makeInstance(BEAR_ID, {
                    id: cid,
                    controllerId: owner,
                    ownerId: owner,
                    zone: "hand",
                })
            );
        const id = registerScript("test-if-branch-suspend", [
            {
                op: "mayPay",
                player: "opponent",
                cost: { X: 1 },
                prompt: "Pay {1}?",
                bind: "$paid",
            },
            {
                // When unpaid, the branch itself suspends on a discard
                // choice, then consumes the picks — a suspension INSIDE a
                // branch (issue #806 acceptance criterion).
                op: "if",
                predicate: { not: { binding: "$paid" } },
                then: [
                    {
                        op: "choice",
                        kind: "discard-hand",
                        player: "opponent",
                        zone: "hand",
                        count: 1,
                        prompt: "Discard a card.",
                        bind: "$picked",
                    },
                    {
                        op: "discard",
                        player: "opponent",
                        cards: { ref: "$picked" },
                    },
                ],
            },
        ]);
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { hand: handOf("p2", ["d1", "d2"]) }),
            ],
        });
        pushSpell(state, id, "p1");
        // First suspension: the may-pay.
        resolveTopOfStack(state);
        expect(state.pendingChoices![0].kind).toBe("may-pay");
        applyMayPaySubmit(state, { playerId: "p2", accept: false });
        // Declined → branch runs → SECOND suspension on the discard choice.
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("discard-hand");
        expect(head.playerId).toBe("p2");
        expect(state.stack).toHaveLength(1); // still resolving
        applyPendingChoiceSubmit(state, {
            playerId: "p2",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["d1"],
        });
        // Branch consumed the pick: d1 discarded, d2 kept, resolution done.
        expect(state.players[1].hand.map((c) => c.id)).toEqual(["d2"]);
        expect(state.players[1].graveyard.map((c) => c.id)).toEqual(["d1"]);
        expect(state.stack).toHaveLength(0);
    });

    it("a paid may-pay skips the whole suspending branch (predicate false)", () => {
        const handOf = (ids: string[]) =>
            ids.map((cid) =>
                makeInstance(BEAR_ID, {
                    id: cid,
                    controllerId: "p2",
                    ownerId: "p2",
                    zone: "hand",
                })
            );
        const id = registerScript("test-if-branch-skipped", [
            {
                op: "mayPay",
                player: "opponent",
                cost: { X: 1 },
                prompt: "Pay {1}?",
                bind: "$paid",
            },
            {
                op: "if",
                predicate: { not: { binding: "$paid" } },
                then: [
                    {
                        op: "choice",
                        kind: "discard-hand",
                        player: "opponent",
                        zone: "hand",
                        count: 1,
                        prompt: "Discard a card.",
                        bind: "$picked",
                    },
                    {
                        op: "discard",
                        player: "opponent",
                        cards: { ref: "$picked" },
                    },
                ],
            },
        ]);
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", {
                    manaPool: { C: 1 },
                    hand: handOf(["k1", "k2"]),
                }),
            ],
        });
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        applyMayPaySubmit(state, { playerId: "p2", accept: true });
        // Paid → branch skipped → no discard choice raised, resolution done.
        expect(state.pendingChoices).toBeUndefined();
        expect(state.players[1].hand.map((c) => c.id)).toEqual(["k1", "k2"]);
        expect(state.stack).toHaveLength(0);
    });

    it("a side-effecting Op BEFORE a suspending Op inside a branch fires EXACTLY ONCE across suspend→resume (CR 608.3, issue #806 double-execution regression)", () => {
        // The regression: the branch is [loseLife 5, choice, discard]. The
        // suspending `choice` sits AFTER a side-effecting `loseLife`. Before the
        // per-Op checkpoint fix, resume replayed the WHOLE `if` — `loseLife`
        // fired a SECOND time (dropping p2 to 10 instead of 15). The pre-order
        // checkpoint must skip the already-completed `loseLife` on resume.
        const handOf = (ids: string[]) =>
            ids.map((cid) =>
                makeInstance(BEAR_ID, {
                    id: cid,
                    controllerId: "p2",
                    ownerId: "p2",
                    zone: "hand",
                })
            );
        const id = registerScript("test-if-branch-preop-once", [
            {
                op: "mayPay",
                player: "opponent",
                cost: { X: 1 },
                prompt: "Pay {1}?",
                bind: "$paid",
            },
            {
                op: "if",
                predicate: { not: { binding: "$paid" } },
                then: [
                    // Side-effecting Op BEFORE the suspending choice.
                    { op: "loseLife", player: "opponent", amount: 5 },
                    {
                        op: "choice",
                        kind: "discard-hand",
                        player: "opponent",
                        zone: "hand",
                        count: 1,
                        prompt: "Discard a card.",
                        bind: "$picked",
                    },
                    {
                        op: "discard",
                        player: "opponent",
                        cards: { ref: "$picked" },
                    },
                ],
            },
        ]);
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { hand: handOf(["e1", "e2"]) }),
            ],
        });
        pushSpell(state, id, "p1");
        // First suspension: the may-pay. loseLife has NOT run yet.
        resolveTopOfStack(state);
        expect(state.pendingChoices![0].kind).toBe("may-pay");
        expect(state.players[1].life).toBe(20);
        applyMayPaySubmit(state, { playerId: "p2", accept: false });
        // Declined → branch runs: loseLife fires ONCE (20 → 15), then the
        // discard choice suspends.
        expect(state.players[1].life).toBe(15);
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("discard-hand");
        expect(state.stack).toHaveLength(1); // still resolving
        applyPendingChoiceSubmit(state, {
            playerId: "p2",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["e1"],
        });
        // The fix: loseLife did NOT replay on resume — p2 is still at 15, not
        // 10. The choice's picked card was discarded and resolution completed.
        expect(state.players[1].life).toBe(15);
        expect(state.players[1].hand.map((c) => c.id)).toEqual(["e2"]);
        expect(state.players[1].graveyard.map((c) => c.id)).toEqual(["e1"]);
        expect(state.stack).toHaveLength(0);
    });

    it("the pre-op-once checkpoint survives a DB round-trip (compact/expand) mid-suspension", () => {
        // Same [loseLife, choice, discard] branch, but the state is serialized
        // and rehydrated WHILE suspended on the discard choice — proving the
        // pre-order checkpoint (resolutionStep) persists and still skips the
        // completed loseLife after a real DB write.
        const handOf = (ids: string[]) =>
            ids.map((cid) =>
                makeInstance(BEAR_ID, {
                    id: cid,
                    controllerId: "p2",
                    ownerId: "p2",
                    zone: "hand",
                })
            );
        const id = registerScript("test-if-branch-preop-roundtrip", [
            {
                op: "mayPay",
                player: "opponent",
                cost: { X: 1 },
                prompt: "Pay {1}?",
                bind: "$paid",
            },
            {
                op: "if",
                predicate: { not: { binding: "$paid" } },
                then: [
                    { op: "loseLife", player: "opponent", amount: 5 },
                    {
                        op: "choice",
                        kind: "discard-hand",
                        player: "opponent",
                        zone: "hand",
                        count: 1,
                        prompt: "Discard a card.",
                        bind: "$picked",
                    },
                    {
                        op: "discard",
                        player: "opponent",
                        cards: { ref: "$picked" },
                    },
                ],
            },
        ]);
        let state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { hand: handOf(["r1", "r2"]) }),
            ],
        });
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        applyMayPaySubmit(state, { playerId: "p2", accept: false });
        expect(state.players[1].life).toBe(15); // loseLife fired once
        // DB round-trip while suspended on the discard choice.
        state = expandState(compactState(state));
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("discard-hand");
        applyPendingChoiceSubmit(state, {
            playerId: "p2",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["r1"],
        });
        // Still 15 — the checkpoint carried across the round-trip, loseLife
        // did not replay.
        expect(state.players[1].life).toBe(15);
        expect(state.players[1].hand.map((c) => c.id)).toEqual(["r2"]);
        expect(state.stack).toHaveLength(0);
    });
});

// --- forEach construct (ADR 0045, issue #807) --------------------------------
// The FOURTH and final structural construct: the grammar (bind/ref/if/forEach)
// is now closed. These cover the per-Op-suite treacherous compositions named
// by the PRD: choice-inside-forEach with suspension per iteration (APNAP,
// CR 101.4), bindings surviving across iterations and suspensions, and the
// frozen member set (CR 608.2i) with members leaving mid-iteration
// (CR 608.2b). forEach composes onto the #806 pre-order cursor: each iteration
// re-walks the body, so a body choice resumes at its exact (iteration, Op).

describe("Effect Script construct: forEach — permanent sets (ADR 0045 / CR 608.2i, issue #807)", () => {
    const GOBLIN_ID = "test-foreach-goblin";
    registerTokenDefinition({
        id: GOBLIN_ID,
        name: GOBLIN_ID,
        rarity: "common",
        manaCost: { R: 1 },
        types: ["Creature"],
        subtypes: ["Goblin"],
        power: 1,
        toughness: 1,
    });

    it("destroys every creature on BOTH battlefields (sweep, no controller scope) — wire format", () => {
        const id = registerScript("test-foreach-sweep", [
            {
                op: "forEach",
                select: {
                    set: "permanents",
                    zone: "battlefield",
                    filter: { type: "Creature" },
                },
                effects: [{ op: "destroy", target: { ref: "$each" } }],
            },
        ]);
        const mine = makeInstance(BEAR_ID, { controllerId: "p1", id: "swpA" });
        const theirs = ["swpB", "swpC"].map((cid) =>
            makeInstance(BEAR_ID, {
                id: cid,
                controllerId: "p2",
                ownerId: "p2",
            })
        );
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [mine] }),
                makePlayer("p2", { battlefield: theirs }),
            ],
        });
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        expect(state.players[0].battlefield).toHaveLength(0);
        expect(state.players[1].battlefield).toHaveLength(0);
        expect(state.players[0].graveyard.map((c) => c.id)).toContain("swpA");
        expect(state.players[1].graveyard.map((c) => c.id).sort()).toEqual([
            "swpB",
            "swpC",
        ]);
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.players[0].battlefield).toHaveLength(0);
        expect(projected.players[1].battlefield).toHaveLength(0);
    });

    it("honours the subtype filter — only matching members are selected (CR 205)", () => {
        const id = registerScript("test-foreach-filter", [
            {
                op: "forEach",
                select: {
                    set: "permanents",
                    zone: "battlefield",
                    filter: { type: "Creature", subtype: "Goblin" },
                },
                effects: [{ op: "destroy", target: { ref: "$each" } }],
            },
        ]);
        const goblin = makeInstance(GOBLIN_ID, {
            controllerId: "p2",
            id: "gobF",
        });
        const bear = makeInstance(BEAR_ID, { controllerId: "p2", id: "bearF" });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [goblin, bear] }),
            ],
        });
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        expect(state.players[1].battlefield.map((c) => c.id)).toEqual([
            "bearF",
        ]);
        expect(state.players[1].graveyard.map((c) => c.id)).toEqual(["gobF"]);
    });

    it("honours the controller scope — only that player's permanents iterate (CR 109.5)", () => {
        const id = registerScript("test-foreach-controller", [
            {
                op: "forEach",
                select: {
                    set: "permanents",
                    zone: "battlefield",
                    controller: "opponent",
                    filter: { type: "Creature" },
                },
                effects: [{ op: "destroy", target: { ref: "$each" } }],
            },
        ]);
        const mine = makeInstance(BEAR_ID, { controllerId: "p1", id: "ctlA" });
        const theirs = makeInstance(BEAR_ID, {
            controllerId: "p2",
            id: "ctlB",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [mine] }),
                makePlayer("p2", { battlefield: [theirs] }),
            ],
        });
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        expect(state.players[0].battlefield.map((c) => c.id)).toEqual(["ctlA"]);
        expect(state.players[1].battlefield).toHaveLength(0);
    });

    it("routes each destroy through the replacement layer — indestructible members survive (CR 702.12)", () => {
        const id = registerScript("test-foreach-indestructible", [
            {
                op: "forEach",
                select: {
                    set: "permanents",
                    zone: "battlefield",
                    filter: { type: "Creature" },
                },
                effects: [{ op: "destroy", target: { ref: "$each" } }],
            },
        ]);
        const tough = makeInstance(BEAR_ID, {
            controllerId: "p2",
            id: "indF",
            staticAbilities: ["indestructible"],
        });
        const soft = makeInstance(BEAR_ID, { controllerId: "p2", id: "sftF" });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [tough, soft] }),
            ],
        });
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        expect(state.players[1].battlefield.map((c) => c.id)).toEqual(["indF"]);
        expect(state.players[1].graveyard.map((c) => c.id)).toEqual(["sftF"]);
    });

    it("binds $each per iteration — value refs read the member's snapshot ($each.power / $each.controller, CR 608.2h)", () => {
        const id = registerScript("test-foreach-each-refs", [
            {
                op: "forEach",
                select: {
                    set: "permanents",
                    zone: "battlefield",
                    filter: { type: "Creature" },
                },
                effects: [
                    {
                        op: "dealDamage",
                        amount: { ref: "$each.power" },
                        to: { player: { ref: "$each.controller" } },
                    },
                ],
            },
        ]);
        const mine = makeInstance(BEAR_ID, { controllerId: "p1", id: "refA" });
        const theirs = makeInstance(BEAR_ID, {
            controllerId: "p2",
            id: "refB",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [mine] }),
                makePlayer("p2", { battlefield: [theirs] }),
            ],
        });
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(18);
        expect(state.players[1].life).toBe(18);
    });

    it("skips a frozen-set member that left the battlefield before its iteration (CR 608.2b)", () => {
        const id = registerScript(
            "test-foreach-member-left",
            [
                {
                    op: "forEach",
                    select: {
                        set: "permanents",
                        zone: "battlefield",
                        filter: { type: "Creature" },
                    },
                    effects: [
                        { op: "destroy", target: { target: 0 } },
                        { op: "destroy", target: { ref: "$each" } },
                    ],
                },
            ],
            { targetRequirement: { type: "Creature", count: 1 } }
        );
        const bears = ["mlA", "mlB"].map((cid) =>
            makeInstance(BEAR_ID, {
                id: cid,
                controllerId: "p2",
                ownerId: "p2",
            })
        );
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: bears }),
            ],
        });
        pushSpell(state, id, "p1", [{ type: "permanent", id: "mlB" }]);
        expect(() => resolveTopOfStack(state)).not.toThrow();
        expect(state.players[1].battlefield).toHaveLength(0);
        expect(state.players[1].graveyard.map((c) => c.id).sort()).toEqual([
            "mlA",
            "mlB",
        ]);
    });
});

describe("Effect Script construct: forEach — player sets, APNAP choice composition (CR 101.4, issue #807)", () => {
    const SAC_EFFECTS: EffectOp[] = [
        {
            op: "forEach",
            select: { set: "players" },
            effects: [
                {
                    op: "choice",
                    kind: "sacrifice-permanents",
                    player: { ref: "$each" },
                    zone: "battlefield",
                    filter: { type: "Creature" },
                    count: 1,
                    prompt: "Choose a creature to sacrifice.",
                    bind: "$sac",
                },
                { op: "sacrifice", permanents: { ref: "$sac" } },
            ],
        },
    ];

    const bothWithBears = () =>
        makeState({
            players: [
                makePlayer("p1", {
                    battlefield: ["sacA1", "sacA2"].map((cid) =>
                        makeInstance(BEAR_ID, { id: cid, controllerId: "p1" })
                    ),
                }),
                makePlayer("p2", {
                    battlefield: ["sacB1"].map((cid) =>
                        makeInstance(BEAR_ID, {
                            id: cid,
                            controllerId: "p2",
                            ownerId: "p2",
                        })
                    ),
                }),
            ],
        });

    it("suspends per iteration in APNAP order — active player first, per-iteration apply (CR 101.4)", () => {
        const id = registerScript("test-foreach-apnap", SAC_EFFECTS);
        const state = bothWithBears(); // activePlayerId: p1
        pushSpell(state, id, "p2"); // CONTROLLER is p2 — APNAP ignores it
        expect(resolveTopOfStack(state)).toBeNull(); // suspended on p1's pick
        expect(state.pendingChoices).toHaveLength(1); // one prompt at a time
        let head = state.pendingChoices![0];
        const firstChoiceId = head.choiceId;
        expect(head.kind).toBe("sacrifice-permanents");
        expect(head.playerId).toBe("p1"); // ACTIVE player first (CR 101.4)
        expect(head.count).toBe(1);
        expect(state.stack).toHaveLength(1); // CR 608.3 — stays on the stack

        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["sacA2"],
        });
        // p1's sacrifice applied BEFORE p2 is prompted (per-iteration apply).
        expect(state.players[0].battlefield.map((c) => c.id)).toEqual([
            "sacA1",
        ]);
        expect(state.players[0].graveyard.map((c) => c.id)).toEqual(["sacA2"]);
        expect(state.pendingChoices).toHaveLength(1);
        head = state.pendingChoices![0];
        expect(head.playerId).toBe("p2"); // then the non-active player
        // Distinct iteration-scoped choice ids — iteration 1 never re-reads
        // iteration 0's persisted picks (the re-prompt treachery).
        expect(head.choiceId).not.toBe(firstChoiceId);

        applyPendingChoiceSubmit(state, {
            playerId: "p2",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["sacB1"],
        });
        expect(state.players[1].battlefield).toHaveLength(0);
        // p2's graveyard: the sacrificed bear + the resolved sorcery (cast by
        // p2, CR 608.2k).
        expect(state.players[1].graveyard.map((c) => c.id)).toContain("sacB1");
        expect(state.stack).toHaveLength(0); // resolution completed
        expect(state.pendingChoices).toBeUndefined();
    });

    it("APNAP order follows the ACTIVE player, not the controller (CR 101.4)", () => {
        const id = registerScript("test-foreach-apnap-flip", SAC_EFFECTS);
        const state = makeState({
            activePlayerId: "p2",
            priorityPlayerId: "p2",
            players: [
                makePlayer("p1", {
                    battlefield: [
                        makeInstance(BEAR_ID, {
                            id: "flipA",
                            controllerId: "p1",
                        }),
                    ],
                }),
                makePlayer("p2", {
                    battlefield: [
                        makeInstance(BEAR_ID, {
                            id: "flipB",
                            controllerId: "p2",
                            ownerId: "p2",
                        }),
                    ],
                }),
            ],
        });
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        expect(state.pendingChoices![0].playerId).toBe("p2");
    });

    it("skips a player with no legal picks entirely — no prompt, no sacrifice (CR 608.2b)", () => {
        const id = registerScript("test-foreach-apnap-empty", SAC_EFFECTS);
        const state = makeState({
            players: [
                makePlayer("p1"), // no creatures — never prompted
                makePlayer("p2", {
                    battlefield: [
                        makeInstance(BEAR_ID, {
                            id: "onlyB",
                            controllerId: "p2",
                            ownerId: "p2",
                        }),
                    ],
                }),
            ],
        });
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        expect(state.pendingChoices).toHaveLength(1);
        const head = state.pendingChoices![0];
        expect(head.playerId).toBe("p2"); // p1's iteration was skipped
        applyPendingChoiceSubmit(state, {
            playerId: "p2",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["onlyB"],
        });
        expect(state.players[1].battlefield).toHaveLength(0);
        expect(state.stack).toHaveLength(0);
    });

    it("an outer binding stays readable in EVERY iteration, across suspensions (bind across iterations, CR 608.2h)", () => {
        const id = registerScript(
            "test-foreach-outer-bind",
            [
                { op: "exile", target: { target: 0 }, bind: "$c" },
                {
                    op: "forEach",
                    select: { set: "players" },
                    effects: [
                        {
                            op: "choice",
                            kind: "discard-hand",
                            player: { ref: "$each" },
                            zone: "hand",
                            count: 1,
                            prompt: "Discard a card.",
                            bind: "$toss",
                        },
                        {
                            op: "discard",
                            player: { ref: "$each" },
                            cards: { ref: "$toss" },
                        },
                        {
                            op: "dealDamage",
                            amount: { ref: "$c.power" },
                            to: { player: { ref: "$each" } },
                        },
                    ],
                },
            ],
            { targetRequirement: { type: "Creature", count: 1 } }
        );
        const bear = makeInstance(BEAR_ID, { controllerId: "p2", id: "obB" });
        const handFor = (owner: "p1" | "p2", cid: string) => [
            makeInstance(BEAR_ID, {
                id: cid,
                controllerId: owner,
                ownerId: owner,
                zone: "hand",
            }),
        ];
        const state = makeState({
            players: [
                makePlayer("p1", { hand: handFor("p1", "obH1") }),
                makePlayer("p2", {
                    battlefield: [bear],
                    hand: handFor("p2", "obH2"),
                }),
            ],
        });
        pushSpell(state, id, "p1", [{ type: "permanent", id: "obB" }]);
        resolveTopOfStack(state);
        let head = state.pendingChoices![0];
        expect(head.playerId).toBe("p1");
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["obH1"],
        });
        // $c.power (2) hit p1 after its discard — outer bind read post-resume.
        expect(state.players[0].life).toBe(18);
        head = state.pendingChoices![0];
        expect(head.playerId).toBe("p2");
        applyPendingChoiceSubmit(state, {
            playerId: "p2",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["obH2"],
        });
        expect(state.players[1].life).toBe(18);
        expect(state.players[0].graveyard.map((c) => c.id)).toContain("obH1");
        expect(state.players[1].graveyard.map((c) => c.id)).toContain("obH2");
        expect(state.stack).toHaveLength(0);
    });

    it("the frozen set, cursor and per-iteration bindings survive a DB round-trip mid-construct (compactState/expandState)", () => {
        const id = registerScript("test-foreach-roundtrip", SAC_EFFECTS);
        const state = bothWithBears();
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        const head0 = state.pendingChoices![0];
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: head0.stackItemId,
            step: head0.step,
            choiceId: head0.choiceId,
            cardInstanceIds: ["sacA1"],
        });
        const revived = expandState(
            JSON.parse(JSON.stringify(compactState(state)))
        );
        const head = revived.pendingChoices![0];
        expect(head.playerId).toBe("p2");
        applyPendingChoiceSubmit(revived, {
            playerId: "p2",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["sacB1"],
        });
        expect(revived.players[0].graveyard.map((c) => c.id)).toContain(
            "sacA1"
        );
        expect(revived.players[1].graveyard.map((c) => c.id)).toEqual([
            "sacB1",
        ]);
        expect(revived.stack).toHaveLength(0);
    });

    it("the set is determined ONCE at construct entry — objects arriving mid-construct are not iterated (CR 608.2i)", () => {
        const id = registerScript("test-foreach-frozen-set", [
            {
                op: "forEach",
                select: {
                    set: "permanents",
                    zone: "battlefield",
                    filter: { type: "Creature" },
                },
                effects: [
                    {
                        op: "choice",
                        kind: "discard-hand",
                        player: "controller",
                        zone: "hand",
                        count: 1,
                        prompt: "Discard a card.",
                        bind: "$fee",
                    },
                    {
                        op: "discard",
                        player: "controller",
                        cards: { ref: "$fee" },
                    },
                    { op: "destroy", target: { ref: "$each" } },
                ],
            },
        ]);
        const members = ["fzA", "fzB"].map((cid) =>
            makeInstance(BEAR_ID, {
                id: cid,
                controllerId: "p2",
                ownerId: "p2",
            })
        );
        const hand = ["fzH1", "fzH2"].map((cid) =>
            makeInstance(BEAR_ID, {
                id: cid,
                controllerId: "p1",
                ownerId: "p1",
                zone: "hand",
            })
        );
        const state = makeState({
            players: [
                makePlayer("p1", { hand }),
                makePlayer("p2", { battlefield: members }),
            ],
        });
        pushSpell(state, id, "p1");
        resolveTopOfStack(state); // suspended in iteration 0
        // A latecomer enters while the construct is suspended.
        state.players[1].battlefield.push(
            makeInstance(BEAR_ID, {
                id: "fzLate",
                controllerId: "p2",
                ownerId: "p2",
            })
        );
        for (const pick of ["fzH1", "fzH2"]) {
            const head = state.pendingChoices![0];
            applyPendingChoiceSubmit(state, {
                playerId: "p1",
                stackItemId: head.stackItemId,
                step: head.step,
                choiceId: head.choiceId,
                cardInstanceIds: [pick],
            });
        }
        // Both frozen members died; the latecomer was never in the set.
        expect(state.players[1].battlefield.map((c) => c.id)).toEqual([
            "fzLate",
        ]);
        expect(state.players[1].graveyard.map((c) => c.id).sort()).toEqual([
            "fzA",
            "fzB",
        ]);
        expect(state.stack).toHaveLength(0);
    });

    it("wire format: the mid-forEach suspended choice and the Expected Input cross the projection", () => {
        const id = registerScript("test-foreach-wire", SAC_EFFECTS);
        const state = bothWithBears();
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        refreshExpectedInput(state); // ADR 0047 persistence-seam refresh
        const projected = projectPublicState(state, 1, "p1");
        const head = projected.pendingChoices![0];
        expect(head.kind).toBe("sacrifice-permanents");
        expect(head.playerId).toBe("p1");
        expect(head.count).toBe(1);
        expect(projected.expectedInput).toEqual({
            kind: "choice",
            playerId: "p1",
            stackItemId: head.stackItemId,
            choiceId: head.choiceId, // the iteration-scoped binding name
            choiceKind: "sacrifice-permanents",
        });
    });
});

// The delayedTrigger Op (CR 603.7, ADR 0048, issue #838) grants a delayed
// triggered ability with an INLINE body: the Op resolves each `capture`
// value to a serializable id at SCHEDULING time (persisted in the instance
// payload), the body Op list rides on the instance, and at FIRE time the
// payload is re-bound as the body's initial binding environment before the
// interpreter runs the body directly — no card-def lookup. These tests drive
// the REAL path end to end: schedule via `resolveTopOfStack`, fire via
// `fireDelayedTriggers` (the same phase-boundary function the engine calls),
// resolve the fired trigger via `resolveTopOfStack` again.
describe("Effect Script Op: delayedTrigger (CR 603.7)", () => {
    it("captures a target slot at scheduling and destroys it when the trigger fires at the next end step", () => {
        const id = registerScript("test-op-delayed-target", [
            {
                op: "delayedTrigger",
                timing: "next-end-step",
                oracleText:
                    "At the beginning of the next end step, destroy it.",
                capture: { $it: { target: 0 } },
                effects: [{ op: "destroy", target: { ref: "$it" } }],
            },
        ]);
        const bear = makeInstance(BEAR_ID, { controllerId: "p2", id: "dtb1" });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        pushSpell(state, id, "p1", [{ type: "permanent", id: "dtb1" }]);
        resolveTopOfStack(state);
        // CR 603.7a — the instance is queued, self-contained (inline body +
        // captured payload), controlled by the scheduler (CR 113.7).
        expect(state.delayedTriggers).toHaveLength(1);
        const inst = state.delayedTriggers![0];
        expect(inst.timing).toBe("next-end-step");
        expect(inst.controller).toBe("p1");
        expect(inst.triggerId).toBe(INLINE_DELAYED_TRIGGER_ID);
        expect(inst.payload).toEqual({ $it: "dtb1" });
        expect(inst.effects).toEqual([
            { op: "destroy", target: { ref: "$it" } },
        ]);
        expect(inst.oracleText).toBe(
            "At the beginning of the next end step, destroy it."
        );
        // Nothing happens before the boundary — and a non-matching boundary
        // does not consume the instance (CR 603.7d fires exactly once, at ITS
        // boundary).
        fireDelayedTriggers(state, "next-upkeep");
        expect(state.stack).toHaveLength(0);
        expect(state.delayedTriggers).toHaveLength(1);
        // The matching boundary fires it onto the stack; resolving it runs
        // the inline body through the interpreter (no card-def lookup).
        fireDelayedTriggers(state, "next-end-step");
        expect(state.delayedTriggers).toBeUndefined();
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].delayedEffects).toEqual(inst.effects);
        resolveTopOfStack(state);
        expect(state.stack).toHaveLength(0);
        expect(state.players[1].battlefield).toHaveLength(0);
        expect(state.players[1].graveyard.map((c) => c.id)).toEqual(["dtb1"]);
    });

    it("skips the body Op when the captured permanent left before the trigger fired (CR 608.2b)", () => {
        const id = registerScript("test-op-delayed-gone", [
            {
                op: "delayedTrigger",
                timing: "next-end-step",
                oracleText:
                    "At the beginning of the next end step, destroy it.",
                capture: { $it: { target: 0 } },
                effects: [{ op: "destroy", target: { ref: "$it" } }],
            },
        ]);
        const bear = makeInstance(BEAR_ID, { controllerId: "p2", id: "dtg1" });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        pushSpell(state, id, "p1", [{ type: "permanent", id: "dtg1" }]);
        resolveTopOfStack(state);
        // The captured creature leaves before the boundary.
        state.players[1].battlefield = [];
        state.players[1].graveyard.push({ ...bear, zone: "graveyard" });
        fireDelayedTriggers(state, "next-end-step");
        expect(() => resolveTopOfStack(state)).not.toThrow();
        // Exactly the one death that already happened — the body's destroy
        // skipped (uncaptured binding, CR 608.2b), no double-destroy.
        expect(state.players[1].graveyard.map((c) => c.id)).toEqual(["dtg1"]);
        expect(state.stack).toHaveLength(0);
    });

    it("captures a binding ref ($source) at an ability site — the Rocket Launcher shape", () => {
        // "{2}: ... deals 1 damage to any target. Destroy ~ at the beginning
        // of the next end step." — capture the ability's own source through
        // the implicit $source snapshot binding.
        const LAUNCHER_ID = "test-delayed-launcher";
        registerTokenDefinition({
            id: LAUNCHER_ID,
            name: LAUNCHER_ID,
            rarity: "common",
            manaCost: { X: 4 },
            types: ["Artifact"],
            activatedAbilities: [
                {
                    id: "launcher-ping",
                    oracleText:
                        "{2}: Deal 1 damage to any target. Destroy this at the beginning of the next end step.",
                    cost: { mana: { X: 2 } },
                    useStack: true,
                    targetRequirement: { type: "any", count: 1 },
                    effects: [
                        { op: "dealDamage", amount: 1, to: { target: 0 } },
                        {
                            op: "delayedTrigger",
                            timing: "next-end-step",
                            oracleText:
                                "Destroy this artifact at the beginning of the next end step.",
                            capture: { $self: { ref: "$source" } },
                            effects: [
                                { op: "destroy", target: { ref: "$self" } },
                            ],
                        },
                    ],
                },
            ],
        });
        const launcher = makeInstance(LAUNCHER_ID, {
            id: "launcher1",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [launcher] }),
                makePlayer("p2"),
            ],
        });
        state.stack.push({
            ...state.players[0].battlefield[0],
            zone: "stack",
            castById: "p1",
            abilityId: "launcher-ping",
            targets: [{ type: "player", id: "p2" }],
        });
        resolveTopOfStack(state);
        expect(state.players[1].life).toBe(19);
        expect(state.delayedTriggers).toHaveLength(1);
        // $source's snapshot id — the source permanent's instance id.
        expect(state.delayedTriggers![0].payload).toEqual({
            $self: "launcher1",
        });
        // The fired trigger destroys the source itself.
        fireDelayedTriggers(state, "next-end-step");
        resolveTopOfStack(state);
        expect(state.players[0].battlefield).toHaveLength(0);
        expect(state.players[0].graveyard.map((c) => c.id)).toEqual([
            "launcher1",
        ]);
    });

    it("re-binds a player capture (.controller ref) as a player binding at fire time", () => {
        // "Exile target creature. At the beginning of the next end step, its
        // controller loses 2 life." — the controller crosses the boundary as
        // a `.controller` property capture (CR 608.2h LKI at scheduling).
        const id = registerScript("test-op-delayed-player", [
            { op: "exile", target: { target: 0 }, bind: "$c" },
            {
                op: "delayedTrigger",
                timing: "next-end-step",
                oracleText:
                    "At the beginning of the next end step, its controller loses 2 life.",
                capture: { $p: { ref: "$c.controller" } },
                effects: [{ op: "loseLife", player: { ref: "$p" }, amount: 2 }],
            },
        ]);
        const bear = makeInstance(BEAR_ID, { controllerId: "p2", id: "dtp1" });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        pushSpell(state, id, "p1", [{ type: "permanent", id: "dtp1" }]);
        resolveTopOfStack(state);
        expect(state.delayedTriggers![0].payload).toEqual({ $p: "p2" });
        fireDelayedTriggers(state, "next-end-step");
        resolveTopOfStack(state);
        expect(state.players[1].life).toBe(18);
    });

    it("fires a next-upkeep cantrip body for the scheduling controller — the Urza's Bauble shape (CR 603.7d)", () => {
        const id = registerScript("test-op-delayed-upkeep", [
            {
                op: "delayedTrigger",
                timing: "next-upkeep",
                oracleText:
                    "At the beginning of the next turn's upkeep, draw a card.",
                effects: [{ op: "draw", player: "controller", count: 1 }],
            },
        ]);
        const library = [
            makeInstance(BEAR_ID, {
                id: "dtl1",
                controllerId: "p1",
                ownerId: "p1",
                zone: "library",
            }),
        ];
        const state = makeState({
            players: [makePlayer("p1", { library }), makePlayer("p2")],
        });
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        expect(state.delayedTriggers![0].timing).toBe("next-upkeep");
        // No targetPlayerId — the very next upkeep fires it, whoever's turn.
        expect(state.delayedTriggers![0].targetPlayerId).toBeUndefined();
        fireDelayedTriggers(state, "next-upkeep");
        resolveTopOfStack(state);
        // "controller" resolves to the delayed trigger's controller — the
        // scheduling spell's caster (CR 113.7).
        expect(state.players[0].hand.map((c) => c.id)).toEqual(["dtl1"]);
    });

    it("scopes a player-gated timing to the resolved targetPlayer (CR 505)", () => {
        const id = registerScript("test-op-delayed-mainphase", [
            {
                op: "delayedTrigger",
                timing: "next-main-phase",
                oracleText:
                    "At the beginning of your next main phase, lose 1 life.",
                targetPlayer: "controller",
                effects: [{ op: "loseLife", player: "controller", amount: 1 }],
            },
        ]);
        const state = makeState();
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        expect(state.delayedTriggers![0].targetPlayerId).toBe("p1");
        // The other player's main phase does not consume it (CR 505 — the
        // scheduling player's own main phase only).
        state.activePlayerId = "p2";
        fireDelayedTriggers(state, "next-main-phase");
        expect(state.delayedTriggers).toHaveLength(1);
        state.activePlayerId = "p1";
        fireDelayedTriggers(state, "next-main-phase");
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(19);
    });

    it("wire format: the queued instance and the fired stack item survive projection and the DB round-trip", () => {
        const id = registerScript("test-op-delayed-wire", [
            {
                op: "delayedTrigger",
                timing: "next-end-step",
                oracleText:
                    "At the beginning of the next end step, destroy it.",
                capture: { $it: { target: 0 } },
                effects: [{ op: "destroy", target: { ref: "$it" } }],
            },
        ]);
        const bear = makeInstance(BEAR_ID, { controllerId: "p2", id: "dtw1" });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        pushSpell(state, id, "p1", [{ type: "permanent", id: "dtw1" }]);
        resolveTopOfStack(state);
        // Projection: PublicGameState passes `delayedTriggers` through whole
        // — the inline body and payload must reach the client untouched.
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.delayedTriggers).toEqual(state.delayedTriggers);
        // DB round-trip while queued (the instance rides the persisted
        // `delayedTriggers` GameState key — drift guard covered).
        const reloaded = expandState(compactState(state));
        expect(reloaded.delayedTriggers).toEqual(state.delayedTriggers);
        // Fire, then round-trip + project the fired stack item: the inline
        // body must survive a save while awaiting priority (serialize.ts
        // compact/expand) and reach the client on the wire.
        fireDelayedTriggers(state, "next-end-step");
        const reloadedFired = expandState(compactState(state));
        expect(reloadedFired.stack[0].delayedEffects).toEqual(
            state.stack[0].delayedEffects
        );
        const projectedFired = projectPublicState(state, 2, "p1");
        expect(projectedFired.stack[0].delayedEffects).toEqual(
            state.stack[0].delayedEffects
        );
        // The reloaded state resolves identically (replay determinism).
        resolveTopOfStack(reloadedFired);
        expect(reloadedFired.players[1].graveyard.map((c) => c.id)).toEqual([
            "dtw1",
        ]);
    });
});
