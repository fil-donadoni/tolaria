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
import { projectPublicState } from "../../../gameProjections";

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

describe("Effect Script Op: exile (CR 701.19)", () => {
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
