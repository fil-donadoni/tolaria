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
import {
    getCardByName,
    getDefinition,
    registerTokenDefinition,
} from "../../../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../cards/__tests__/setup";
import {
    resolveTopOfStack,
    removePermanentTo,
    exileWithAttachments,
} from "../../state";
import type { CardInstanceState, GameState, StackItem } from "../../state";
import {
    applyMayPaySubmit,
    applyNameCardSubmit,
    applyPendingChoiceSubmit,
    applyRandomRevealAck,
} from "../../pendingChoiceSubmit";
import { compactState, expandState } from "../../serialize";
import { refreshExpectedInput } from "../../expectedInput";
import { projectPublicState } from "../../../gameProjections";
import {
    fireDelayedTriggers,
    finalizeCleanup,
    applyAllCombatDamage,
} from "../../phases";
import {
    checkConditionalControlChanges,
    checkStateBasedActions,
} from "../../sba";
import { collectTriggers, placeTriggersOnStack } from "../../triggers";
import { INLINE_DELAYED_TRIGGER_ID } from "../interpreter";
import { getEffectivePower, getEffectiveToughness } from "../../layers";
import {
    registerEmblemDefinition,
    SORIN_LORD_OF_INNISTRAD_EMBLEM_ID,
} from "../../../cards/emblems";
import type { GameEvent } from "../../../cards/types";
import { backupTrigger } from "../../../cards/abilities/triggers/backupTrigger";
import { spellCastTrigger } from "../../../cards/abilities/triggers/spellCastTrigger";

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

/** A black instant (issue #1287 — `excludeColor` filter tests: hand cards
 *  derive colors from `manaCost` via `getColorsFromCost`). */
const BLACK_CARD_ID = "test-effects-black-instant";
registerTokenDefinition({
    id: BLACK_CARD_ID,
    name: BLACK_CARD_ID,
    rarity: "common",
    manaCost: { X: 1, B: 1 },
    types: ["Instant"],
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

describe("Effect Script value grammar: X (chosen cost, CR 107.3 / 601.2b, issue #852)", () => {
    // `{ X: true }` is the fifth EffectValue member — a thin skin over
    // SpellContext.getX() (the value announced for {X} at cast time,
    // snapshotted on the stack item as chosenX). It is NOT an Op and NOT a new
    // structural construct (ADR 0045 stays closed). Exercised here across every
    // Op that reads an EffectValue and might carry X: dealDamage (Earthquake /
    // Drain Life), gainLife (Stream of Life), draw (Braingeyser), pump (Howl
    // from Beyond +X/+0). One resolveValue execution path serves them all.

    const withLibrary = (owner: "p1" | "p2", n: number) =>
        Array.from({ length: n }, (_, i) =>
            makeInstance(BEAR_ID, {
                id: `xlib-${owner}-${i}`,
                controllerId: owner,
                ownerId: owner,
                zone: "library",
            })
        );

    it("dealDamage with amount X deals the chosen X to the target (Earthquake-style)", () => {
        const id = registerScript("test-x-dealdamage", [
            { op: "dealDamage", amount: { X: true }, to: { target: 0 } },
        ]);
        const state = makeState();
        const item = pushSpell(state, id, "p1", [{ type: "player", id: "p2" }]);
        item.chosenX = 4;
        resolveTopOfStack(state);
        expect(state.players[1].life).toBe(16);
    });

    it("gainLife with amount X gains the chosen X (Stream of Life-style)", () => {
        const id = registerScript("test-x-gainlife", [
            { op: "gainLife", player: { target: 0 }, amount: { X: true } },
        ]);
        const state = makeState();
        const item = pushSpell(state, id, "p1", [{ type: "player", id: "p1" }]);
        item.chosenX = 5;
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(25);
    });

    it("draw with count X draws the chosen X cards (Braingeyser-style)", () => {
        const id = registerScript("test-x-draw", [
            { op: "draw", player: "controller", count: { X: true } },
        ]);
        const state = makeState({
            players: [
                makePlayer("p1", { library: withLibrary("p1", 6) }),
                makePlayer("p2"),
            ],
        });
        const item = pushSpell(state, id, "p1");
        item.chosenX = 3;
        resolveTopOfStack(state);
        expect(state.players[0].hand.length).toBe(3);
        expect(state.players[0].library.length).toBe(3);
    });

    it("X reads back 0 when no X was announced (getX default, CR 107.3)", () => {
        const id = registerScript("test-x-zero", [
            { op: "dealDamage", amount: { X: true }, to: { target: 0 } },
        ]);
        const state = makeState();
        pushSpell(state, id, "p1", [{ type: "player", id: "p2" }]); // no chosenX
        resolveTopOfStack(state);
        // getX() → 0, and the damage executor skips a non-positive amount.
        expect(state.players[1].life).toBe(20);
    });

    it("pump with power X is a +X/+0 buff that survives projection (Howl from Beyond, wire format)", () => {
        const id = registerScript("test-x-pump", [
            {
                op: "pump",
                target: { target: 0 },
                power: { X: true },
                toughness: 0,
                duration: { phase: "end-of-turn" },
            },
        ]);
        const bear = makeInstance(BEAR_ID, {
            controllerId: "p2",
            ownerId: "p2",
            id: "bearX",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        const item = pushSpell(state, id, "p1", [
            { type: "permanent", id: "bearX" },
        ]);
        item.chosenX = 3;
        resolveTopOfStack(state);
        const buffed = state.players[1].battlefield.find(
            (c) => c.id === "bearX"
        )!;
        // BEAR_ID is a 2/5 → +3/+0 = 5/5.
        expect(getEffectivePower(state, buffed)).toBe(5);
        expect(getEffectiveToughness(state, buffed)).toBe(5);
        // Same assertion after the projection — X folds in at resolution, so
        // the buff is already baked into the temporary modifier the layer
        // pipeline reads over the slimmed client state.
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[1].battlefield.find(
            (c) => c.id === "bearX"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(5);
        expect(getEffectiveToughness(projected, slim)).toBe(5);
    });

    it("dealDamage with X survives projection (wire format)", () => {
        const id = registerScript("test-x-dmg-wire", [
            { op: "dealDamage", amount: { X: true }, to: { target: 0 } },
        ]);
        const state = makeState();
        const item = pushSpell(state, id, "p1", [{ type: "player", id: "p2" }]);
        item.chosenX = 6;
        resolveTopOfStack(state);
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.players[1].life).toBe(14);
    });
});

describe("Effect Script value grammar: counters (counter count, CR 122.6, issue #1015)", () => {
    // `{ counters: { of, type } }` is the SIXTH EffectValue member — a thin skin
    // over SpellContext.getCounterCount (the number of counters of a type on a
    // selected object). It is NOT an Op and NOT a new structural construct
    // (ADR 0045 stays closed). `of` resolves through the SAME resolveObjectRef
    // path every object-acting Op uses. Exercised across every combination it
    // participates in: the ability-site `$source`, an announced `{ target: N }`
    // slot at a spell site, and the per-iteration `$each` inside a forEach — the
    // last both as a direct value (gainLife) and as a comparison operand inside
    // an `if` predicate (the Powder Keg-shaped MV/count-matched sweep, #997).
    // One resolveValue execution path serves them all. Carries a wire-format
    // assertion (projectPublicState) per the new-construct test regime.

    it("reads the source's counter count at an ability site ($source, gainLife)", () => {
        const SRC = "test-counters-source-gainlife";
        registerTokenDefinition({
            id: SRC,
            name: SRC,
            rarity: "common",
            manaCost: { generic: 1 },
            types: ["Artifact"],
            activatedAbilities: [
                {
                    id: "src-gain",
                    oracleText:
                        "{1}: You gain life equal to the charge counters on this.",
                    cost: { mana: { generic: 1 } },
                    useStack: true,
                    effects: [
                        {
                            op: "gainLife",
                            player: "controller",
                            amount: {
                                counters: {
                                    of: { ref: "$source" },
                                    type: "charge",
                                },
                            },
                        },
                    ],
                },
            ],
        });
        const src = makeInstance(SRC, {
            id: "src1",
            controllerId: "p1",
            ownerId: "p1",
            isSummoningSick: false,
            counters: { charge: 3 },
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [src] }),
                makePlayer("p2"),
            ],
        });
        const s = state.players[0].battlefield[0];
        state.stack.push({
            ...s,
            zone: "stack",
            castById: "p1",
            abilityId: "src-gain",
            targets: [],
        });
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(23); // 20 + 3 charge counters
    });

    it("reads a targeted permanent's counter count (target N, gainLife) and survives projection (wire format)", () => {
        const id = registerScript("test-counters-target-gainlife", [
            {
                op: "gainLife",
                player: "controller",
                amount: { counters: { of: { target: 0 }, type: "+1/+1" } },
            },
        ]);
        const bear = makeInstance(BEAR_ID, {
            id: "ctB",
            controllerId: "p2",
            ownerId: "p2",
            counters: { "+1/+1": 4 },
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        pushSpell(state, id, "p1", [{ type: "permanent", id: "ctB" }]);
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(24); // 20 + 4 counters on the target
        // Wire format: the counter tally the value read must survive the
        // projection — slimCard preserves the instance's `counters` map (a
        // board-visible field), so a client-side re-read would see the same 4.
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.players[0].life).toBe(24);
        const slimTarget = projected.players[1].battlefield.find(
            (c) => c.id === "ctB"
        )!;
        expect(slimTarget.counters?.["+1/+1"]).toBe(4);
    });

    it("sums the per-iteration counter count across a forEach set ($each, gainLife)", () => {
        const id = registerScript("test-counters-each-gainlife", [
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
                        op: "gainLife",
                        player: "controller",
                        amount: {
                            counters: { of: { ref: "$each" }, type: "charge" },
                        },
                    },
                ],
            },
        ]);
        const a = makeInstance(BEAR_ID, {
            id: "eA",
            controllerId: "p1",
            ownerId: "p1",
            counters: { charge: 2 },
        });
        const b = makeInstance(BEAR_ID, {
            id: "eB",
            controllerId: "p1",
            ownerId: "p1",
            counters: { charge: 3 },
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [a, b] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(25); // 20 + (2 + 3) charge counters
    });

    it("compares the counter count inside an if predicate over a forEach set (Powder Keg-shaped sweep)", () => {
        // "Destroy each creature with 3+ +1/+1 counters on it" — the value is the
        // `right`/`left` operand of an `if` comparison, resolved per iteration
        // via `$each`. Mirrors Powder Keg's MV-matched sweep structure (#997)
        // without needing the manaValue snapshot: the counter count IS the test.
        const id = registerScript("test-counters-each-predicate", [
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
                        op: "if",
                        predicate: {
                            left: {
                                counters: {
                                    of: { ref: "$each" },
                                    type: "+1/+1",
                                },
                            },
                            op: "ge",
                            right: 3,
                        },
                        then: [{ op: "destroy", target: { ref: "$each" } }],
                    },
                ],
            },
        ]);
        const hi = makeInstance(BEAR_ID, {
            id: "hi",
            controllerId: "p1",
            ownerId: "p1",
            counters: { "+1/+1": 3 },
        });
        const lo = makeInstance(BEAR_ID, {
            id: "lo",
            controllerId: "p1",
            ownerId: "p1",
            counters: { "+1/+1": 1 },
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [hi, lo] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        const bf = state.players[0].battlefield;
        expect(bf.find((c) => c.id === "hi")).toBeUndefined(); // 3 counters → destroyed
        expect(bf.find((c) => c.id === "lo")).toBeDefined(); // 1 counter → survives
        expect(state.players[0].graveyard.some((c) => c.id === "hi")).toBe(
            true
        );
    });

    it("resolves to undefined (Op skipped) when the selected object is gone (CR 608.2b)", () => {
        const id = registerScript("test-counters-missing", [
            {
                op: "gainLife",
                player: "controller",
                amount: { counters: { of: { target: 0 }, type: "+1/+1" } },
            },
        ]);
        const state = makeState();
        pushSpell(state, id, "p1", []); // no announced target
        resolveTopOfStack(state);
        // getCounterCount is never reached — the value is unresolvable, so the
        // gainLife amount folds to a skip (no life gained).
        expect(state.players[0].life).toBe(20);
    });

    it("reads $source's LAST-KNOWN count after it was sacrificed as a cost (CR 608.2g, Powder Keg #997)", () => {
        // An activated ability whose source is SACRIFICED as a cost has left
        // the battlefield by resolution, so the battlefield-scoped
        // resolveObjectRef returns undefined for `$source`. The `counters`
        // EffectValue falls back to `ctx.getCounterCount` via
        // `ctx.sourceInstanceId`, which reads the pre-sacrifice count off the
        // resolving stack item's snapshot (last-known information). Without the
        // fallback the value would be unresolvable and the effect skipped —
        // Powder Keg would destroy nothing.
        const SRC = "test-counters-sacrificed-source";
        registerTokenDefinition({
            id: SRC,
            name: SRC,
            rarity: "common",
            manaCost: { generic: 1 },
            types: ["Artifact"],
            activatedAbilities: [
                {
                    id: "src-detonate",
                    oracleText:
                        "{T}, Sacrifice this: You gain life equal to the fuse counters on this.",
                    cost: { tap: true, sacrifice: true },
                    useStack: true,
                    effects: [
                        {
                            op: "gainLife",
                            player: "controller",
                            amount: {
                                counters: {
                                    of: { ref: "$source" },
                                    type: "fuse",
                                },
                            },
                        },
                    ],
                },
            ],
        });
        const src = makeInstance(SRC, {
            id: "src-sac",
            controllerId: "p1",
            ownerId: "p1",
            isSummoningSick: false,
            counters: { fuse: 3 },
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [src] }),
                makePlayer("p2"),
            ],
        });
        // Push the ability snapshot (retains the counters), then pay the
        // sacrifice cost by removing the source from the battlefield.
        const onBoard = state.players[0].battlefield[0];
        state.stack.push({
            ...structuredClone(onBoard),
            zone: "stack",
            isTapped: true,
            castById: "p1",
            abilityId: "src-detonate",
            targets: [],
        });
        removePermanentTo(state, "src-sac", "graveyard", "sacrifice");
        expect(
            state.players[0].battlefield.some((c) => c.id === "src-sac")
        ).toBe(false); // gone before resolution
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(23); // 20 + 3 (last-known) fuse counters
    });
});

describe("Effect Script construct: forEach { set: 'graveyard' } (bulk graveyard-set move, CR 404 / 400.7, issue #1056)", () => {
    // A NEW forEach selector shape — iterate every card matching a filter in one
    // or more graveyards with no per-card choice, each member reanimated by a
    // `moveZone { ref: "$each" } → battlefield`. Replenish's "return all
    // enchantment cards from your graveyard to the battlefield"; the mass
    // (controller-omitted) variant is Living Death. New construct combination →
    // full test regime (interpreter unit + wire-format assertion). Registered
    // once for the whole block.
    const ENCH_ID = "test-effects-enchantment";
    registerTokenDefinition({
        id: ENCH_ID,
        name: ENCH_ID,
        rarity: "common",
        manaCost: { W: 1 },
        types: ["Enchantment"],
    });
    const replenishScript: EffectOp[] = [
        {
            op: "forEach",
            select: {
                set: "graveyard",
                controller: "controller",
                filter: { type: "Enchantment" },
            },
            effects: [
                { op: "moveZone", target: { ref: "$each" }, to: "battlefield" },
            ],
        },
    ];
    const gyEnchant = (id: string, owner: "p1" | "p2") =>
        makeInstance(ENCH_ID, {
            id,
            controllerId: owner,
            ownerId: owner,
            zone: "graveyard",
        });

    it("returns ALL matching enchantments from the controller's graveyard at once, leaving non-matches (Replenish)", () => {
        const id = registerScript("test-foreach-gy-replenish", replenishScript);
        const nonEnch = makeInstance(BEAR_ID, {
            id: "gy-creature",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    graveyard: [
                        gyEnchant("ench-a", "p1"),
                        nonEnch,
                        gyEnchant("ench-b", "p1"),
                    ],
                }),
                makePlayer("p2", { graveyard: [gyEnchant("ench-p2", "p2")] }),
            ],
        });
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        const bf = state.players[0].battlefield.map((c) => c.id);
        expect(bf).toContain("ench-a"); // both enchantments returned
        expect(bf).toContain("ench-b");
        // The non-enchantment stays in the graveyard (filter excludes it).
        expect(
            state.players[0].graveyard.some((c) => c.id === "gy-creature")
        ).toBe(true);
        // Only the CONTROLLER's graveyard is swept — p2's enchantment untouched.
        expect(state.players[1].graveyard.some((c) => c.id === "ench-p2")).toBe(
            true
        );
        expect(
            state.players[1].battlefield.some((c) => c.id === "ench-p2")
        ).toBe(false);
        // Reanimated enchantments no longer sit in the graveyard.
        expect(
            state.players[0].graveyard.some(
                (c) => c.id === "ench-a" || c.id === "ench-b"
            )
        ).toBe(false);
    });

    it("returned enchantments survive projection onto the controller's battlefield (wire format)", () => {
        const id = registerScript(
            "test-foreach-gy-replenish-wire",
            replenishScript
        );
        const state = makeState({
            players: [
                makePlayer("p1", {
                    graveyard: [
                        gyEnchant("wire-a", "p1"),
                        gyEnchant("wire-b", "p1"),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        const projected = projectPublicState(state, 1, "p1");
        const bf = projected.players[0].battlefield.map((c) => c.id);
        expect(bf).toContain("wire-a");
        expect(bf).toContain("wire-b");
        expect(
            projected.players[0].graveyard.some(
                (c) => c.id === "wire-a" || c.id === "wire-b"
            )
        ).toBe(false);
    });

    it("mass variant (controller omitted) sweeps EVERY player's graveyard in APNAP order (Living Death-shaped)", () => {
        const id = registerScript("test-foreach-gy-mass", [
            {
                op: "forEach",
                select: { set: "graveyard", filter: { type: "Enchantment" } },
                effects: [
                    {
                        op: "moveZone",
                        target: { ref: "$each" },
                        to: "battlefield",
                    },
                ],
            },
        ]);
        const state = makeState({
            players: [
                makePlayer("p1", { graveyard: [gyEnchant("mass-p1", "p1")] }),
                makePlayer("p2", { graveyard: [gyEnchant("mass-p2", "p2")] }),
            ],
        });
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        // Each card returns under ITS OWN owner's control (CR 400.7 / 800.4a).
        expect(
            state.players[0].battlefield.some((c) => c.id === "mass-p1")
        ).toBe(true);
        expect(
            state.players[1].battlefield.some((c) => c.id === "mass-p2")
        ).toBe(true);
    });

    it("skips a frozen-set member that left the graveyard after selection (CR 608.2b / 608.2i)", () => {
        // The member set is frozen once at construct entry (CR 608.2i). A member
        // no longer in any graveyard when its iteration runs resolves to no owner
        // → `$each` stays uncaptured → the body `moveZone` skips it (CR 608.2b),
        // while the surviving member still reanimates. Injected via a pre-noted
        // frozen set (the reserved `#forEach:<pos>:set` key, pos 0 for this
        // top-level construct) so the stale id is deterministic without needing a
        // card to remove it mid-run.
        const id = registerScript("test-foreach-gy-stale", replenishScript);
        const state = makeState({
            players: [
                makePlayer("p1", {
                    graveyard: [gyEnchant("ench-live", "p1")],
                }),
                makePlayer("p2"),
            ],
        });
        const item = pushSpell(state, id, "p1");
        item.collectedChoices = {
            "#forEach:0:set": ["ench-live", "ghost-not-in-any-graveyard"],
        };
        resolveTopOfStack(state);
        expect(
            state.players[0].battlefield.some((c) => c.id === "ench-live")
        ).toBe(true); // surviving member reanimated
        expect(
            state.players[0].battlefield.some(
                (c) => c.id === "ghost-not-in-any-graveyard"
            )
        ).toBe(false); // stale member skipped, no crash
    });

    it("empty graveyard set is a no-op (CR 608.2b)", () => {
        const id = registerScript("test-foreach-gy-empty", replenishScript);
        const state = makeState({
            players: [
                makePlayer("p1", {
                    graveyard: [
                        makeInstance(BEAR_ID, {
                            id: "only-creature",
                            controllerId: "p1",
                            ownerId: "p1",
                            zone: "graveyard",
                        }),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        expect(state.players[0].battlefield).toHaveLength(0);
        expect(
            state.players[0].graveyard.some((c) => c.id === "only-creature")
        ).toBe(true);
    });
});

describe("Effect Script construct: forEach { set: 'graveyard' }, simultaneous (CR 400.7 / 614-batch, issue #1094)", () => {
    // The BATCHED twin of the sequential sweep above: `simultaneous: true`
    // bypasses the per-member `runOpList` walk entirely and hands the WHOLE
    // frozen member set to `SpellContext.returnGraveyardSetToBattlefield` in
    // ONE call — every reanimated permanent stages onto the battlefield (and
    // a reanimated Aura resolves its CR 303.4c host) BEFORE any of them runs
    // its grant-application / ETB pass. This is Replenish's REAL shape
    // (`convex/cards/sets/uds/white.ts`). New construct combination → full
    // test regime (interpreter unit + wire-format assertion).
    const ENCH_ID = "test-effects-simul-enchantment";
    registerTokenDefinition({
        id: ENCH_ID,
        name: ENCH_ID,
        rarity: "common",
        manaCost: { W: 1 },
        types: ["Enchantment"],
    });
    // An Aura fixture (CR 303.4c) — needs a legal host to enter at all.
    const AURA_ID = "test-effects-simul-aura";
    registerTokenDefinition({
        id: AURA_ID,
        name: AURA_ID,
        rarity: "common",
        manaCost: { W: 1 },
        types: ["Enchantment"],
        subtypes: ["Aura"],
        targetRequirement: { type: "Creature", count: 1 },
    });
    // An ENCHANTMENT CREATURE fixture — matched by Replenish's Enchantment
    // filter (so it's swept into the SAME batch) AND a legal creature host
    // for the Aura above. This is the "Opalescence-style enchantment that is
    // also a creature" host the CR 303.4c / 400.7 simultaneity is about.
    const ENCH_CREATURE_ID = "test-effects-simul-ench-creature";
    registerTokenDefinition({
        id: ENCH_CREATURE_ID,
        name: ENCH_CREATURE_ID,
        rarity: "common",
        manaCost: { W: 2 },
        types: ["Enchantment", "Creature"],
        power: 2,
        toughness: 2,
    });
    // Two mutually-granting enchantment creatures (issue #1094 regression):
    // each pushes a keyword + an activated + a triggered grant onto every
    // OTHER creature. Reanimated together in one batch, each must receive the
    // other's grants EXACTLY ONCE (grantedActivated/grantedTriggered have no
    // dedup guard — a naive per-member finish pass double-applied every
    // batch→batch cross-grant).
    const grantsTo = (kwSelf: string) => ({
        staticEffects: [
            {
                kind: "keyword-grant" as const,
                keyword: kwSelf,
                applies: (
                    t: { id: string; types: readonly string[] },
                    s: { id: string }
                ) => t.id !== s.id && t.types.includes("Creature"),
            },
            {
                kind: "activated-grant" as const,
                abilityId: `${kwSelf}-act`,
                applies: (
                    t: { id: string; types: readonly string[] },
                    s: { id: string }
                ) => t.id !== s.id && t.types.includes("Creature"),
            },
            {
                kind: "triggered-grant" as const,
                abilityId: `${kwSelf}-trig`,
                applies: (
                    t: { id: string; types: readonly string[] },
                    s: { id: string }
                ) => t.id !== s.id && t.types.includes("Creature"),
            },
        ],
    });
    const GRANTER_A_ID = "test-effects-simul-granter-a";
    registerTokenDefinition({
        id: GRANTER_A_ID,
        name: GRANTER_A_ID,
        rarity: "common",
        manaCost: { W: 2 },
        types: ["Enchantment", "Creature"],
        power: 1,
        toughness: 1,
        ...grantsTo("flying"),
    });
    const GRANTER_B_ID = "test-effects-simul-granter-b";
    registerTokenDefinition({
        id: GRANTER_B_ID,
        name: GRANTER_B_ID,
        rarity: "common",
        manaCost: { W: 2 },
        types: ["Enchantment", "Creature"],
        power: 1,
        toughness: 1,
        ...grantsTo("trample"),
    });
    const simultaneousReplenishScript: EffectOp[] = [
        {
            op: "forEach",
            select: {
                set: "graveyard",
                controller: "controller",
                filter: { type: "Enchantment" },
            },
            simultaneous: true,
            effects: [
                { op: "moveZone", target: { ref: "$each" }, to: "battlefield" },
            ],
        },
    ];
    const gyCard = (cardId: string, id: string, owner: "p1" | "p2" = "p1") =>
        makeInstance(cardId, {
            id,
            controllerId: owner,
            ownerId: owner,
            zone: "graveyard",
        });

    it("returns ALL matching enchantments from the graveyard at once, same external result as the sequential sweep", () => {
        const id = registerScript(
            "test-foreach-gy-simul-basic",
            simultaneousReplenishScript
        );
        const state = makeState({
            players: [
                makePlayer("p1", {
                    graveyard: [
                        gyCard(ENCH_ID, "s-ench-a"),
                        gyCard(ENCH_ID, "s-ench-b"),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        const bf = state.players[0].battlefield.map((c) => c.id);
        expect(bf).toContain("s-ench-a");
        expect(bf).toContain("s-ench-b");
        // Both enchantments left the graveyard (only the resolved sorcery,
        // which lands there per CR 608.2f, may remain).
        expect(
            state.players[0].graveyard.some(
                (c) => c.id === "s-ench-a" || c.id === "s-ench-b"
            )
        ).toBe(false);
    });

    it("a reanimated Aura attaches to an enchantment-creature reanimated in the SAME simultaneous event (CR 303.4c / 400.7) — the batching proof", () => {
        // The whole point of the batch primitive: the Aura's CR 303.4
        // host-legality check must see a creature that's ALSO being
        // reanimated by this exact sweep (here an enchantment creature, which
        // Replenish's Enchantment filter also returns) — not just permanents
        // already on the battlefield beforehand. The sequential per-member
        // `moveZone` path never even attempted attachment for a
        // bulk-reanimated Aura (it entered unattached, at the mercy of the
        // CR 704.5m SBA regardless of host availability) — this is a
        // genuinely new, CR-correct capability the batching unlocks.
        const id = registerScript(
            "test-foreach-gy-simul-aura-attach",
            simultaneousReplenishScript
        );
        const state = makeState({
            players: [
                makePlayer("p1", {
                    graveyard: [
                        gyCard(AURA_ID, "s-aura"),
                        gyCard(ENCH_CREATURE_ID, "s-ench-creature"),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        const host = state.players[0].battlefield.find(
            (c) => c.id === "s-ench-creature"
        );
        const aura = state.players[0].battlefield.find(
            (c) => c.id === "s-aura"
        );
        expect(host).toBeDefined();
        expect(aura).toBeDefined();
        expect(aura?.attachedTo).toBe("s-ench-creature");

        // Wire format: the attachment survives projection.
        const projected = projectPublicState(state, 1, "p1");
        const slimAura = projected.players[0].battlefield.find(
            (c) => c.id === "s-aura"
        );
        expect(slimAura?.attachedTo).toBe("s-ench-creature");
    });

    it("an Aura with NO legal host anywhere — not even among its reanimating siblings — stays in the graveyard (CR 303.4c)", () => {
        const id = registerScript(
            "test-foreach-gy-simul-aura-no-host",
            simultaneousReplenishScript
        );
        const state = makeState({
            players: [
                makePlayer("p1", {
                    graveyard: [gyCard(AURA_ID, "s-aura-orphan")],
                }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        expect(
            state.players[0].battlefield.some((c) => c.id === "s-aura-orphan")
        ).toBe(false);
        expect(
            state.players[0].graveyard.some((c) => c.id === "s-aura-orphan")
        ).toBe(true);
    });

    it("an Aura also attaches to a PRE-EXISTING battlefield creature, not just a same-event sibling", () => {
        const id = registerScript(
            "test-foreach-gy-simul-aura-preexisting",
            simultaneousReplenishScript
        );
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        makeInstance(BEAR_ID, {
                            id: "already-there",
                            controllerId: "p1",
                            ownerId: "p1",
                        }),
                    ],
                    graveyard: [gyCard(AURA_ID, "s-aura-2")],
                }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        const aura = state.players[0].battlefield.find(
            (c) => c.id === "s-aura-2"
        );
        expect(aura?.attachedTo).toBe("already-there");
    });

    it("a controller override on the body moveZone redirects the WHOLE batch (Hymn-of-Rebirth-shaped)", () => {
        const id = registerScript("test-foreach-gy-simul-controller", [
            {
                op: "forEach",
                select: {
                    set: "graveyard",
                    controller: "controller",
                    filter: { type: "Enchantment" },
                },
                simultaneous: true,
                effects: [
                    {
                        op: "moveZone",
                        target: { ref: "$each" },
                        to: "battlefield",
                        controller: "opponent",
                    },
                ],
            },
        ]);
        const state = makeState({
            players: [
                makePlayer("p1", {
                    graveyard: [gyCard(ENCH_ID, "s-redirect")],
                }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        expect(
            state.players[1].battlefield.some((c) => c.id === "s-redirect")
        ).toBe(true);
        expect(
            state.players[0].battlefield.some((c) => c.id === "s-redirect")
        ).toBe(false);
    });

    it("skips a frozen-set member that left the graveyard after selection (CR 608.2b / 608.2i)", () => {
        const id = registerScript(
            "test-foreach-gy-simul-stale",
            simultaneousReplenishScript
        );
        const state = makeState({
            players: [
                makePlayer("p1", {
                    graveyard: [gyCard(ENCH_ID, "s-ench-live")],
                }),
                makePlayer("p2"),
            ],
        });
        const item = pushSpell(state, id, "p1");
        item.collectedChoices = {
            "#forEach:0:set": ["s-ench-live", "ghost-not-in-any-graveyard"],
        };
        resolveTopOfStack(state);
        expect(
            state.players[0].battlefield.some((c) => c.id === "s-ench-live")
        ).toBe(true);
        expect(
            state.players[0].battlefield.some(
                (c) => c.id === "ghost-not-in-any-graveyard"
            )
        ).toBe(false);
    });

    it("empty graveyard set is a no-op (CR 608.2b)", () => {
        const id = registerScript(
            "test-foreach-gy-simul-empty",
            simultaneousReplenishScript
        );
        const state = makeState({
            players: [
                makePlayer("p1", {
                    graveyard: [
                        makeInstance(BEAR_ID, {
                            id: "only-creature-simul",
                            controllerId: "p1",
                            ownerId: "p1",
                            zone: "graveyard",
                        }),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        expect(state.players[0].battlefield).toHaveLength(0);
    });

    it("returned enchantments survive projection onto the controller's battlefield (wire format)", () => {
        const id = registerScript(
            "test-foreach-gy-simul-wire",
            simultaneousReplenishScript
        );
        const state = makeState({
            players: [
                makePlayer("p1", {
                    graveyard: [gyCard(ENCH_ID, "s-wire-a")],
                }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        const projected = projectPublicState(state, 1, "p1");
        const bf = projected.players[0].battlefield.map((c) => c.id);
        expect(bf).toContain("s-wire-a");
    });

    it("applies mutual cross-grants among batch members EXACTLY ONCE — no double-apply (CR 611.2, issue #1094 regression)", () => {
        // Two enchantment creatures each grant a keyword + activated +
        // triggered ability to every OTHER creature. Reanimated in one batch,
        // A receives B's grants and vice versa; each grant must land once. The
        // pre-fix per-member finish pass ran applyExistingGrantsTo AND
        // applySourceStaticEffects for every member, applying each batch→batch
        // cross-grant twice (a granted trigger would then fire twice).
        const id = registerScript(
            "test-foreach-gy-simul-mutual-grant",
            simultaneousReplenishScript
        );
        const state = makeState({
            players: [
                makePlayer("p1", {
                    graveyard: [
                        gyCard(GRANTER_A_ID, "g-a"),
                        gyCard(GRANTER_B_ID, "g-b"),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        const a = state.players[0].battlefield.find((c) => c.id === "g-a")!;
        const b = state.players[0].battlefield.find((c) => c.id === "g-b")!;
        expect(a).toBeDefined();
        expect(b).toBeDefined();

        // A got B's grants once; B got A's grants once (and NOT their own).
        const count = <T>(arr: readonly T[], pred: (x: T) => boolean) =>
            arr.filter(pred).length;
        // keyword-grant duplication (staticAbilities + grantedStaticAbilities).
        expect(count(a.staticAbilities, (k) => k === "trample")).toBe(1);
        expect(count(a.staticAbilities, (k) => k === "flying")).toBe(0);
        expect(count(b.staticAbilities, (k) => k === "flying")).toBe(1);
        expect(
            count(
                a.grantedStaticAbilities ?? [],
                (g) => g.ability === "trample"
            )
        ).toBe(1);
        expect(
            count(b.grantedStaticAbilities ?? [], (g) => g.ability === "flying")
        ).toBe(1);
        // activated-grant duplication (grantedActivatedAbilities).
        expect(
            count(
                a.grantedActivatedAbilities ?? [],
                (g) => g.abilityId === "trample-act"
            )
        ).toBe(1);
        expect(
            count(
                b.grantedActivatedAbilities ?? [],
                (g) => g.abilityId === "flying-act"
            )
        ).toBe(1);
        // triggered-grant duplication (grantedTriggeredAbilities) — the
        // "granted trigger fires twice" class.
        expect(
            count(
                a.grantedTriggeredAbilities ?? [],
                (g) => g.abilityId === "trample-trig"
            )
        ).toBe(1);
        expect(
            count(
                b.grantedTriggeredAbilities ?? [],
                (g) => g.abilityId === "flying-trig"
            )
        ).toBe(1);
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

// New-Op permanent test (Urza's Bauble): the private "look at a card at random
// in target player's hand" Op (CR 701.18a). Interpreter unit path + the
// mandatory wire-format assertion — a private look grants knowledge to the
// looker ALONE, and BOTH the `knownTo` grant and the reveal dialog must survive
// (and stay scoped) through `projectPublicState`.
describe("Effect Script Op: lookRandomHand (CR 701.18a look, Urza's Bauble)", () => {
    const lookScript = () =>
        registerScript(
            "test-op-lookrandomhand",
            [{ op: "lookRandomHand", player: { target: 0 } }],
            { targetRequirement: { type: "player", count: 1 } }
        );

    it("grants PRIVATE knowledge of the picked card to the looker alone + enqueues a look dialog", () => {
        const id = lookScript();
        const secret = makeInstance(BLACK_CARD_ID, {
            id: "p2-secret",
            controllerId: "p2",
            ownerId: "p2",
            zone: "hand",
        });
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2", { hand: [secret] })],
        });
        pushSpell(state, id, "p1", [{ type: "player", id: "p2" }]);
        resolveTopOfStack(state);
        // CR 701.18a — the looker (controller p1) knows the card; nobody else.
        expect(state.players[1].hand[0].knownTo).toEqual(["p1"]);
        // The transient look dialog is addressed to the looker alone.
        expect(state.pendingReveals).toHaveLength(1);
        expect(state.pendingReveals![0]).toMatchObject({
            audience: ["p1"],
            kind: "look",
            cards: [{ instanceId: "p2-secret", cardId: BLACK_CARD_ID }],
        });
    });

    it("the private look survives projection but never leaks to the other seat (wire format)", () => {
        const id = lookScript();
        const secret = makeInstance(BLACK_CARD_ID, {
            id: "p2-secret",
            controllerId: "p2",
            ownerId: "p2",
            zone: "hand",
        });
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2", { hand: [secret] })],
        });
        pushSpell(state, id, "p1", [{ type: "player", id: "p2" }]);
        resolveTopOfStack(state);
        // The looker sees the real card in the opponent's (p2's) hand and the
        // look dialog crosses the wire.
        const forLooker = projectPublicState(state, 1, "p1");
        expect(forLooker.players[1].hand[0]?.card.id).toBe(BLACK_CARD_ID);
        expect(forLooker.pendingReveals).toHaveLength(1);
        // The other seat (p2) sees no look dialog — a private look must not leak.
        const forOther = projectPublicState(state, 1, "p2");
        expect(forOther.pendingReveals ?? []).toHaveLength(0);
    });

    it("picks exactly one card from a multi-card hand; the rest stay hidden", () => {
        const id = lookScript();
        const hand = [0, 1, 2].map((i) =>
            makeInstance(BLACK_CARD_ID, {
                id: `p2-h${i}`,
                controllerId: "p2",
                ownerId: "p2",
                zone: "hand",
            })
        );
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2", { hand })],
        });
        pushSpell(state, id, "p1", [{ type: "player", id: "p2" }]);
        resolveTopOfStack(state);
        const known = state.players[1].hand.filter((c) =>
            c.knownTo?.includes("p1")
        );
        expect(known).toHaveLength(1);
        expect(state.pendingReveals).toHaveLength(1);
    });

    it("is a no-op on an empty hand (CR 608.2b)", () => {
        const id = lookScript();
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2", { hand: [] })],
        });
        pushSpell(state, id, "p1", [{ type: "player", id: "p2" }]);
        expect(() => resolveTopOfStack(state)).not.toThrow();
        expect(state.pendingReveals ?? []).toHaveLength(0);
    });
});

// issue #985 — the `count` value construct generalized with a `name` filter
// (CR 201.2) and an `acrossAllPlayers` scope (CR 122 "in all graveyards"),
// consumed by `draw` for a dynamic count (Accumulated Knowledge). This is the
// new construct usage's permanent test: the interpreter unit path + a
// wire-format assertion through `projectPublicState`.
describe("Effect Script value grammar: count by name across all graveyards (CR 122 / 201.2, issue #985)", () => {
    // A card whose registry NAME is "Accumulated Knowledge", so graveyard
    // copies are counted by the name filter (getGraveyardCards reads the def).
    const AK_NAME = "Accumulated Knowledge";
    const AK_CARD_ID = "test-count-ak-named";
    registerTokenDefinition({
        id: AK_CARD_ID,
        name: AK_NAME,
        rarity: "common",
        manaCost: { X: 1, U: 1 },
        types: ["Instant"],
    });
    // A differently-named card that must NOT inflate the count.
    const OTHER_ID = "test-count-other-named";
    registerTokenDefinition({
        id: OTHER_ID,
        name: "Some Other Instant",
        rarity: "common",
        manaCost: { X: 1, U: 1 },
        types: ["Instant"],
    });

    const gyCopies = (owner: "p1" | "p2", cardId: string, n: number) =>
        Array.from({ length: n }, (_, i) =>
            makeInstance(cardId, {
                id: `gy-${cardId.slice(-3)}-${owner}-${i}`,
                controllerId: owner,
                ownerId: owner,
                zone: "graveyard",
            })
        );

    const bigLibrary = (owner: "p1" | "p2", n: number) =>
        Array.from({ length: n }, (_, i) =>
            makeInstance(BEAR_ID, {
                id: `aklib-${owner}-${i}`,
                controllerId: owner,
                ownerId: owner,
                zone: "library",
            })
        );

    // The Accumulated Knowledge script: draw 1, then draw one per copy in ANY
    // graveyard (name-filtered, all-players scope).
    const akEffects: EffectOp[] = [
        { op: "draw", player: "controller", count: 1 },
        {
            op: "draw",
            player: "controller",
            count: {
                count: {
                    zone: "graveyard",
                    acrossAllPlayers: true,
                    filter: { name: AK_NAME },
                },
            },
        },
    ];

    it("draws 1 with no matching cards in any graveyard", () => {
        const id = registerScript("test-count-ak-zero", akEffects);
        const state = makeState({
            players: [
                makePlayer("p1", { library: bigLibrary("p1", 5) }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        expect(state.players[0].hand.length).toBe(1);
    });

    it("draws 2 with one copy in the controller's graveyard", () => {
        const id = registerScript("test-count-ak-one", akEffects);
        const state = makeState({
            players: [
                makePlayer("p1", {
                    library: bigLibrary("p1", 5),
                    graveyard: gyCopies("p1", AK_CARD_ID, 1),
                }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        expect(state.players[0].hand.length).toBe(2);
    });

    it("sums copies across ALL graveyards (CR 122), ignoring other names", () => {
        const id = registerScript("test-count-ak-all", akEffects);
        const state = makeState({
            players: [
                makePlayer("p1", {
                    library: bigLibrary("p1", 6),
                    // 1 AK + 1 non-AK (the non-AK must not count).
                    graveyard: [
                        ...gyCopies("p1", AK_CARD_ID, 1),
                        ...gyCopies("p1", OTHER_ID, 1),
                    ],
                }),
                makePlayer("p2", {
                    // 2 AK in the OPPONENT's graveyard also count.
                    graveyard: gyCopies("p2", AK_CARD_ID, 2),
                }),
            ],
        });
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        // draw 1 + (1 + 2) matching copies = 4.
        expect(state.players[0].hand.length).toBe(4);
    });

    it("the dynamic-count draw survives projection (wire format)", () => {
        const id = registerScript("test-count-ak-wire", akEffects);
        const state = makeState({
            players: [
                makePlayer("p1", {
                    library: bigLibrary("p1", 6),
                    graveyard: gyCopies("p1", AK_CARD_ID, 1),
                }),
                makePlayer("p2", {
                    graveyard: gyCopies("p2", AK_CARD_ID, 1),
                }),
            ],
        });
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        // draw 1 + 2 matching copies = 3 on the fat state…
        expect(state.players[0].hand.length).toBe(3);
        // …and the same count survives the wire projection (the caster sees
        // their own hand).
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.players[0].hand.length).toBe(3);
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

// New Op (issue #697, Cube CAP Energy) → full per-Op regime: interpreter
// coverage of the construct combinations it participates in (controller /
// opponent player refs, accumulation across two Ops in one script), plus a
// wire-format assertion through projectPublicState (energy is a player scalar
// that must survive the wire, like poisonCounters). `getEnergy` is a thin
// declarative skin over `SpellContext.addEnergy` (the dedicated
// PlayerState.energyCounters scalar). This is the Op's permanent test,
// inherited free by every later energy card.
describe("Effect Script Op: getEnergy (CR 122.1)", () => {
    it("the selected player gets energy counters, accumulating", () => {
        const id = registerScript("test-op-energy", [
            { op: "getEnergy", player: "controller", amount: 3 },
            { op: "getEnergy", player: "controller", amount: 2 },
            { op: "getEnergy", player: "opponent", amount: 1 },
        ]);
        const state = makeState();
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        expect(state.players[0].energyCounters).toBe(5);
        expect(state.players[1].energyCounters).toBe(1);
    });

    it("the energy total survives projection (wire format)", () => {
        const id = registerScript("test-op-energy-wire", [
            { op: "getEnergy", player: "controller", amount: 4 },
        ]);
        const state = makeState();
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        const projected = projectPublicState(state, 1, "p2");
        expect(projected.players[0].energyCounters).toBe(4);
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

// New Op (issue #686, Time Warp) → full per-Op regime: interpreter coverage
// of the construct combinations it participates in (announced player slot,
// controller, opponent), plus a wire-format assertion through
// projectPublicState. `extraTurn` is a thin declarative skin over the
// already-shipped `SpellContext.takeExtraTurn` primitive Time Walk's
// pre-DSL `resolve()` closure already exercises (lea/blue.ts) — the CR 500.7
// turn-advance mechanics themselves (LIFO queue, `advanceTurn` pop) are
// already covered by `phases.test.ts` / `lea/__tests__/blue.test.ts`; this
// suite covers only the new Op's player-ref resolution and wire survival.
describe("Effect Script Op: extraTurn (CR 500.7, issue #686)", () => {
    it("schedules the announced target player for an extra turn", () => {
        const id = registerScript(
            "test-op-extra-turn-target",
            [{ op: "extraTurn", player: { target: 0 } }],
            { targetRequirement: { type: "player", count: 1 } }
        );
        const state = makeState();
        pushSpell(state, id, "p1", [{ type: "player", id: "p2" }]);
        expect(state.extraTurns).toBeUndefined();
        resolveTopOfStack(state);
        expect(state.extraTurns).toEqual(["p2"]);
    });

    it("schedules the resolving controller for an extra turn (player: controller)", () => {
        const id = registerScript("test-op-extra-turn-controller", [
            { op: "extraTurn", player: "controller" },
        ]);
        const state = makeState();
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        expect(state.extraTurns).toEqual(["p1"]);
    });

    it("is a no-op when the announced target is not a player (CR 608.2b)", () => {
        const id = registerScript("test-op-extra-turn-nonplayer", [
            { op: "extraTurn", player: { target: 0 } },
        ]);
        const bear = makeInstance(BEAR_ID, {
            controllerId: "p2",
            id: "bearExtraTurn",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        pushSpell(state, id, "p1", [
            { type: "permanent", id: "bearExtraTurn" },
        ]);
        expect(() => resolveTopOfStack(state)).not.toThrow();
        expect(state.extraTurns).toBeUndefined();
    });

    it("survives projection (wire format) — extraTurns is spread verbatim onto PublicGameState", () => {
        const id = registerScript("test-op-extra-turn-wire", [
            { op: "extraTurn", player: "controller" },
        ]);
        const state = makeState();
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        const projected = projectPublicState(state, 1, "p2");
        expect(projected.extraTurns).toEqual(["p1"]);
    });
});

// New Op (issue #1057) → full per-Op regime: interpreter coverage of the
// construct combinations it participates in (controller / opponent / announced
// player slot), plus a wire-format assertion through projectPublicState.
describe("Effect Script Op: restrictCasting (CR 601.3a, issue #1057)", () => {
    it("adds the opponent to state.cannotCastSpellsThisTurn (Xantid Swarm's defending-player lock)", () => {
        const id = registerScript("test-op-restrict-opp", [
            { op: "restrictCasting", player: "opponent" },
        ]);
        const state = makeState();
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        expect(state.cannotCastSpellsThisTurn).toEqual([
            { playerId: "p2", cardTypes: undefined },
        ]);
    });

    it("locks the announced player target", () => {
        const id = registerScript(
            "test-op-restrict-target",
            [{ op: "restrictCasting", player: { target: 0 } }],
            { targetRequirement: { type: "player", count: 1 } }
        );
        const state = makeState();
        pushSpell(state, id, "p1", [{ type: "player", id: "p1" }]);
        resolveTopOfStack(state);
        expect(state.cannotCastSpellsThisTurn).toEqual([
            { playerId: "p1", cardTypes: undefined },
        ]);
    });

    it("is idempotent — a second resolution does not duplicate the id", () => {
        const id = registerScript("test-op-restrict-idem", [
            { op: "restrictCasting", player: "controller" },
        ]);
        const state = makeState();
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        expect(state.cannotCastSpellsThisTurn).toEqual([
            { playerId: "p1", cardTypes: undefined },
        ]);
    });

    it("the cast lock survives projection (wire format)", () => {
        const id = registerScript("test-op-restrict-wire", [
            { op: "restrictCasting", player: "opponent" },
        ]);
        const state = makeState();
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        const projected = projectPublicState(state, 1, "p2");
        expect(projected.cannotCastSpellsThisTurn).toEqual([
            { playerId: "p2", cardTypes: undefined },
        ]);
    });

    // issue #1124 (Abeyance) — the optional `cardTypes` filter narrows the
    // lock to the listed card types instead of every spell.
    it("with cardTypes, locks only the listed types (Abeyance: instant/sorcery)", () => {
        const id = registerScript("test-op-restrict-typed", [
            {
                op: "restrictCasting",
                player: "opponent",
                cardTypes: ["Instant", "Sorcery"],
            },
        ]);
        const state = makeState();
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        expect(state.cannotCastSpellsThisTurn).toEqual([
            { playerId: "p2", cardTypes: ["Instant", "Sorcery"] },
        ]);
    });

    it("a blanket lock (no cardTypes) always wins over a narrower one for the same player", () => {
        const id = registerScript("test-op-restrict-widen", [
            {
                op: "restrictCasting",
                player: "opponent",
                cardTypes: ["Instant"],
            },
            { op: "restrictCasting", player: "opponent" },
        ]);
        const state = makeState();
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        expect(state.cannotCastSpellsThisTurn).toEqual([
            { playerId: "p2", cardTypes: undefined },
        ]);
    });
});

// New Op (issue #1124) → full per-Op regime: interpreter coverage of the
// construct combinations it participates in (opponent / announced player
// slot), plus a wire-format assertion through projectPublicState.
describe("Effect Script Op: restrictActivation (CR 602.1 / 605.1a, issue #1124)", () => {
    it("adds the opponent to state.cannotActivateAbilitiesThisTurn (Abeyance)", () => {
        const id = registerScript("test-op-restrict-act-opp", [
            { op: "restrictActivation", player: "opponent" },
        ]);
        const state = makeState();
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        expect(state.cannotActivateAbilitiesThisTurn).toEqual(["p2"]);
    });

    it("locks the announced player target", () => {
        const id = registerScript(
            "test-op-restrict-act-target",
            [{ op: "restrictActivation", player: { target: 0 } }],
            { targetRequirement: { type: "player", count: 1 } }
        );
        const state = makeState();
        pushSpell(state, id, "p1", [{ type: "player", id: "p1" }]);
        resolveTopOfStack(state);
        expect(state.cannotActivateAbilitiesThisTurn).toEqual(["p1"]);
    });

    it("is idempotent — a second resolution does not duplicate the id", () => {
        const id = registerScript("test-op-restrict-act-idem", [
            { op: "restrictActivation", player: "controller" },
        ]);
        const state = makeState();
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        expect(state.cannotActivateAbilitiesThisTurn).toEqual(["p1"]);
    });

    it("the activation lock survives projection (wire format)", () => {
        const id = registerScript("test-op-restrict-act-wire", [
            { op: "restrictActivation", player: "opponent" },
        ]);
        const state = makeState();
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        const projected = projectPublicState(state, 1, "p2");
        expect(projected.cannotActivateAbilitiesThisTurn).toEqual(["p2"]);
    });
});

// New Op (issue #1149) → full per-Op regime: interpreter coverage of the
// construct combinations it participates in (default zones / narrowed zones /
// maxManaValue / idempotent merge), plus a wire-format assertion through
// projectPublicState.
describe("Effect Script Op: grantGraveyardPlay (CR 305.1-analog / 601, issue #1149)", () => {
    it("grants the controller a broad (land + spell) graveyard-cast permission by default (Yawgmoth's Will)", () => {
        const id = registerScript("test-op-grant-gy-broad", [
            { op: "grantGraveyardPlay", player: "controller" },
        ]);
        const state = makeState();
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        expect(state.graveyardPlayPermissionThisTurn).toEqual([
            {
                playerId: "p1",
                zones: ["land", "spell"],
                maxManaValue: undefined,
            },
        ]);
    });

    it("narrows to the declared zones when provided", () => {
        const id = registerScript("test-op-grant-gy-narrow", [
            { op: "grantGraveyardPlay", player: "opponent", zones: ["land"] },
        ]);
        const state = makeState();
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        expect(state.graveyardPlayPermissionThisTurn).toEqual([
            { playerId: "p2", zones: ["land"], maxManaValue: undefined },
        ]);
    });

    it("carries an optional maxManaValue cap on the spell half", () => {
        const id = registerScript("test-op-grant-gy-mv", [
            {
                op: "grantGraveyardPlay",
                player: "controller",
                zones: ["spell"],
                maxManaValue: 3,
            },
        ]);
        const state = makeState();
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        expect(state.graveyardPlayPermissionThisTurn).toEqual([
            { playerId: "p1", zones: ["spell"], maxManaValue: 3 },
        ]);
    });

    it("is idempotent per player — a second grant UNIONS zones, and an unlimited maxManaValue wins over a narrower one", () => {
        const id = registerScript("test-op-grant-gy-idem", [
            {
                op: "grantGraveyardPlay",
                player: "controller",
                zones: ["spell"],
                maxManaValue: 3,
            },
            { op: "grantGraveyardPlay", player: "controller", zones: ["land"] },
        ]);
        const state = makeState();
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        expect(state.graveyardPlayPermissionThisTurn).toEqual([
            {
                playerId: "p1",
                zones: ["spell", "land"],
                maxManaValue: undefined,
            },
        ]);
    });

    it("locks the announced player target", () => {
        const id = registerScript(
            "test-op-grant-gy-target",
            [{ op: "grantGraveyardPlay", player: { target: 0 } }],
            { targetRequirement: { type: "player", count: 1 } }
        );
        const state = makeState();
        pushSpell(state, id, "p1", [{ type: "player", id: "p2" }]);
        resolveTopOfStack(state);
        expect(state.graveyardPlayPermissionThisTurn).toEqual([
            {
                playerId: "p2",
                zones: ["land", "spell"],
                maxManaValue: undefined,
            },
        ]);
    });

    it("the permission survives projection (wire format)", () => {
        const id = registerScript("test-op-grant-gy-wire", [
            { op: "grantGraveyardPlay", player: "controller" },
        ]);
        const state = makeState();
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.graveyardPlayPermissionThisTurn).toEqual([
            {
                playerId: "p1",
                zones: ["land", "spell"],
                maxManaValue: undefined,
            },
        ]);
    });
});

// New Op (issue #1145 / #1149) → full per-Op regime: interpreter coverage of
// the construct combinations it participates in, plus a wire-format
// assertion through projectPublicState.
describe("Effect Script Op: armGraveyardRedirect (CR 614, issue #1145 / #1149)", () => {
    it("arms the controller's turn-scoped graveyard-bound redirect", () => {
        const id = registerScript("test-op-arm-gy-redirect", [
            { op: "armGraveyardRedirect", player: "controller" },
        ]);
        const state = makeState();
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        expect(state.graveyardBoundRedirectThisTurn).toEqual([
            { ownerId: "p1" },
        ]);
    });

    it("locks the announced player target", () => {
        const id = registerScript(
            "test-op-arm-gy-redirect-target",
            [{ op: "armGraveyardRedirect", player: { target: 0 } }],
            { targetRequirement: { type: "player", count: 1 } }
        );
        const state = makeState();
        pushSpell(state, id, "p1", [{ type: "player", id: "p2" }]);
        resolveTopOfStack(state);
        expect(state.graveyardBoundRedirectThisTurn).toEqual([
            { ownerId: "p2" },
        ]);
    });

    it("the redirect grant survives projection (wire format)", () => {
        const id = registerScript("test-op-arm-gy-redirect-wire", [
            { op: "armGraveyardRedirect", player: "controller" },
        ]);
        const state = makeState();
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.graveyardBoundRedirectThisTurn).toEqual([
            { ownerId: "p1" },
        ]);
    });
});

describe("Effect Script Op: addMana (CR 106.1, issue #850)", () => {
    it("adds fixed mana to the controller's pool by default (a ritual — Dark Ritual)", () => {
        const id = registerScript("test-op-addmana-ritual", [
            { op: "addMana", mana: { B: 3 } },
        ]);
        const state = makeState();
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        expect(state.players[0].manaPool.B).toBe(3);
        // The opponent's pool is untouched.
        expect(state.players[1].manaPool.B ?? 0).toBe(0);
    });

    it("accumulates onto mana already floating in the pool (CR 106.4)", () => {
        const id = registerScript("test-op-addmana-accumulate", [
            { op: "addMana", mana: { R: 1 } },
        ]);
        const state = makeState({
            players: [
                makePlayer("p1", { manaPool: { R: 2, G: 1 } }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        expect(state.players[0].manaPool.R).toBe(3);
        expect(state.players[0].manaPool.G).toBe(1);
    });

    it("adds a multi-colour amount in one Op", () => {
        const id = registerScript("test-op-addmana-multi", [
            { op: "addMana", mana: { W: 1, U: 2, C: 1 } },
        ]);
        const state = makeState();
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        expect(state.players[0].manaPool).toMatchObject({ W: 1, U: 2, C: 1 });
    });

    it("adds to an announced player target's pool", () => {
        const id = registerScript(
            "test-op-addmana-target",
            [{ op: "addMana", mana: { C: 2 }, player: { target: 0 } }],
            { targetRequirement: { type: "player", count: 1 } }
        );
        const state = makeState();
        pushSpell(state, id, "p1", [{ type: "player", id: "p2" }]);
        resolveTopOfStack(state);
        expect(state.players[1].manaPool.C).toBe(2);
        expect(state.players[0].manaPool.C ?? 0).toBe(0);
    });

    it("skips the Op when the announced recipient is missing and still runs the rest (CR 608.2b)", () => {
        const id = registerScript(
            "test-op-addmana-missing",
            [
                { op: "addMana", mana: { B: 2 }, player: { target: 0 } },
                { op: "gainLife", player: "controller", amount: 1 },
            ],
            { targetRequirement: { type: "player", count: 1 } }
        );
        const state = makeState();
        pushSpell(state, id, "p1", []); // no target survives to resolution
        expect(() => resolveTopOfStack(state)).not.toThrow();
        expect(state.players[0].manaPool.B ?? 0).toBe(0);
        expect(state.players[0].life).toBe(21);
    });

    it("the added mana survives projection (wire format)", () => {
        const id = registerScript("test-op-addmana-wire", [
            { op: "addMana", mana: { B: 3 } },
        ]);
        const state = makeState();
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.players[0].manaPool.B).toBe(3);
    });
});

describe("Effect Script Op: coinFlip (CR 705, issue #851)", () => {
    // The first flip drawn from the seeded PRNG (rng.ts): seed 1 lands WIN
    // (heads — the flipping player wins), seed 7 lands LOSE (tails). Probed from
    // sample(seed, 1) and matching the Goblin Lyre per-card test.
    const WIN_SEED = 1;
    const LOSE_SEED = 7;

    /** Acks the head random-reveal so the engine resumes into the taken branch
     *  (the chooser's client auto-acks in production). */
    function ackReveal(state: GameState): void {
        const head = state.pendingChoices![0];
        applyRandomRevealAck(state, {
            playerId: head.playerId,
            stackItemId: head.stackItemId,
            choiceId: head.choiceId,
        });
    }

    const handOf = (owner: "p1" | "p2", ids: string[]) =>
        ids.map((cid) =>
            makeInstance(BEAR_ID, {
                id: cid,
                controllerId: owner,
                ownerId: owner,
                zone: "hand",
            })
        );

    const winLossScript: EffectOp[] = [
        {
            op: "coinFlip",
            win: {
                consequence: "Gain 3 life.",
                effects: [{ op: "gainLife", player: "controller", amount: 3 }],
            },
            loss: {
                consequence: "Lose 3 life.",
                effects: [{ op: "loseLife", player: "controller", amount: 3 }],
            },
        },
    ];

    it("suspends for the reveal, then runs the WIN branch on heads (CR 705.2)", () => {
        const id = registerScript("test-op-coin-win", winLossScript);
        const state = makeState({ rngSeed: WIN_SEED });
        pushSpell(state, id, "p1");
        // CR 705.2 / ADR 0023 — the flip PAUSES to reveal before applying.
        expect(resolveTopOfStack(state)).toBeNull();
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("random-reveal");
        expect(head.randomKind).toBe("coin");
        expect(head.realized?.face).toBe("WIN");
        // CR 608.3 — the spell stays on the stack while suspended.
        expect(state.stack).toHaveLength(1);
        ackReveal(state);
        expect(state.players[0].life).toBe(23);
    });

    it("runs the LOSS branch on tails", () => {
        const id = registerScript("test-op-coin-lose", winLossScript);
        const state = makeState({ rngSeed: LOSE_SEED });
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        expect(state.pendingChoices![0].realized?.face).toBe("LOSE");
        ackReveal(state);
        expect(state.players[0].life).toBe(17);
    });

    it("runs every Op in the taken branch, in order (multi-op nested descent)", () => {
        const id = registerScript("test-op-coin-multi", [
            {
                op: "coinFlip",
                win: {
                    consequence: "Gain 2, burn the opponent for 1.",
                    effects: [
                        { op: "gainLife", player: "controller", amount: 2 },
                        {
                            op: "dealDamage",
                            amount: 1,
                            to: { player: "opponent" },
                        },
                    ],
                },
                loss: {
                    consequence: "Lose 1 life.",
                    effects: [
                        { op: "loseLife", player: "controller", amount: 1 },
                    ],
                },
            },
        ]);
        const state = makeState({ rngSeed: WIN_SEED });
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        ackReveal(state);
        expect(state.players[0].life).toBe(22);
        expect(state.players[1].life).toBe(19);
    });

    it("flips with an announced target player (the flipper acks) and acts on the win branch (CR 705.1)", () => {
        const id = registerScript(
            "test-op-coin-target",
            [
                {
                    op: "coinFlip",
                    player: { target: 0 },
                    win: {
                        consequence: "Target player gains 5.",
                        effects: [
                            {
                                op: "gainLife",
                                player: { target: 0 },
                                amount: 5,
                            },
                        ],
                    },
                    loss: {
                        consequence: "Target player loses 5.",
                        effects: [
                            {
                                op: "loseLife",
                                player: { target: 0 },
                                amount: 5,
                            },
                        ],
                    },
                },
            ],
            { targetRequirement: { type: "player", count: 1 } }
        );
        const state = makeState({ rngSeed: WIN_SEED });
        pushSpell(state, id, "p1", [{ type: "player", id: "p2" }]);
        resolveTopOfStack(state);
        // CR 705.1 — the flipping player (the announced target) reveals/acks.
        expect(state.pendingChoices![0].playerId).toBe("p2");
        ackReveal(state);
        expect(state.players[1].life).toBe(25);
    });

    it("skips the flip entirely when the flipper is gone, and still runs the rest (CR 608.2b)", () => {
        const id = registerScript(
            "test-op-coin-missing",
            [
                {
                    op: "coinFlip",
                    player: { target: 0 },
                    win: {
                        consequence: "Gain 3.",
                        effects: [
                            {
                                op: "gainLife",
                                player: "controller",
                                amount: 3,
                            },
                        ],
                    },
                    loss: {
                        consequence: "Lose 3.",
                        effects: [
                            {
                                op: "loseLife",
                                player: "controller",
                                amount: 3,
                            },
                        ],
                    },
                },
                { op: "gainLife", player: "controller", amount: 2 },
            ],
            { targetRequirement: { type: "player", count: 1 } }
        );
        const state = makeState({ rngSeed: WIN_SEED });
        pushSpell(state, id, "p1", []); // no target survives to resolution
        expect(() => resolveTopOfStack(state)).not.toThrow();
        // No reveal enqueued (the flip never happened)…
        expect(state.pendingChoices ?? []).toHaveLength(0);
        // …and the following Op still ran (branch skipped, not the whole script).
        expect(state.players[0].life).toBe(22);
    });

    it("a suspending Op inside the taken branch resumes through the coinFlip WITHOUT re-rolling (CR 608.3)", () => {
        const id = registerScript(
            "test-op-coin-nested-suspend",
            [
                {
                    op: "coinFlip",
                    win: {
                        consequence: "Target player discards two.",
                        effects: [
                            {
                                op: "choice",
                                kind: "discard-hand",
                                player: { target: 0 },
                                zone: "hand",
                                count: 2,
                                prompt: "Discard two cards.",
                                bind: "$d",
                            },
                            {
                                op: "discard",
                                player: { target: 0 },
                                cards: { ref: "$d" },
                            },
                        ],
                    },
                    loss: {
                        consequence: "Gain 1 life.",
                        effects: [
                            {
                                op: "gainLife",
                                player: "controller",
                                amount: 1,
                            },
                        ],
                    },
                },
            ],
            { targetRequirement: { type: "player", count: 1 } }
        );
        const state = makeState({
            rngSeed: WIN_SEED,
            players: [
                makePlayer("p1"),
                makePlayer("p2", { hand: handOf("p2", ["h1", "h2", "h3"]) }),
            ],
        });
        pushSpell(state, id, "p1", [{ type: "player", id: "p2" }]);
        // First suspension: the coin reveal.
        resolveTopOfStack(state);
        expect(state.pendingChoices![0].kind).toBe("random-reveal");
        ackReveal(state);
        // Resuming runs the win branch, whose nested choice suspends in turn.
        const choiceHead = state.pendingChoices![0];
        expect(choiceHead.kind).toBe("discard-hand");
        applyPendingChoiceSubmit(state, {
            playerId: "p2",
            stackItemId: choiceHead.stackItemId,
            step: choiceHead.step,
            choiceId: choiceHead.choiceId,
            cardInstanceIds: ["h1", "h2"],
        });
        // The discard resolved through the branch…
        expect(state.players[1].hand.map((c) => c.id)).toEqual(["h3"]);
        // …and the re-walk NEVER enqueued a second coin reveal (no re-roll).
        expect(state.pendingChoices ?? []).toHaveLength(0);
    });

    it("the win-branch outcome survives projection (wire format)", () => {
        const id = registerScript("test-op-coin-wire", [
            {
                op: "coinFlip",
                win: {
                    consequence: "Burn the opponent for 2.",
                    effects: [
                        {
                            op: "dealDamage",
                            amount: 2,
                            to: { player: "opponent" },
                        },
                    ],
                },
                loss: {
                    consequence: "Gain 1 life.",
                    effects: [
                        { op: "gainLife", player: "controller", amount: 1 },
                    ],
                },
            },
        ]);
        const state = makeState({ rngSeed: WIN_SEED });
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        ackReveal(state);
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.players[1].life).toBe(18);
    });
});

describe("Effect Script Op: coinFlipSync (CR 705, issue #1281)", () => {
    // Same seeded PRNG as `coinFlip` (both draw through `SpellContext.flipCoin`
    // — `requestCoinFlip` just wraps the identical call): seed 1 → WIN, seed 7
    // → LOSE.
    const WIN_SEED = 1;
    const LOSE_SEED = 7;

    const handOf = (owner: "p1" | "p2", ids: string[]) =>
        ids.map((cid) =>
            makeInstance(BEAR_ID, {
                id: cid,
                controllerId: owner,
                ownerId: owner,
                zone: "hand",
            })
        );

    const winLossScript: EffectOp[] = [
        {
            op: "coinFlipSync",
            win: {
                consequence: "Gain 3 life.",
                effects: [{ op: "gainLife", player: "controller", amount: 3 }],
            },
            loss: {
                consequence: "Lose 3 life.",
                effects: [{ op: "loseLife", player: "controller", amount: 3 }],
            },
        },
    ];

    it("resolves the WIN branch INLINE, with no reveal-ack suspension (CR 705.2)", () => {
        const id = registerScript("test-op-coinsync-win", winLossScript);
        const state = makeState({ rngSeed: WIN_SEED });
        pushSpell(state, id, "p1");
        // No suspend — the whole Op (flip + branch) completes in one pass.
        resolveTopOfStack(state);
        expect(state.pendingChoices ?? []).toHaveLength(0);
        expect(state.stack).toHaveLength(0);
        expect(state.players[0].life).toBe(23);
    });

    it("resolves the LOSS branch INLINE on tails", () => {
        const id = registerScript("test-op-coinsync-lose", winLossScript);
        const state = makeState({ rngSeed: LOSE_SEED });
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        expect(state.pendingChoices ?? []).toHaveLength(0);
        expect(state.players[0].life).toBe(17);
    });

    it("runs every Op in the taken branch, in order (multi-op nested descent)", () => {
        const id = registerScript("test-op-coinsync-multi", [
            {
                op: "coinFlipSync",
                win: {
                    consequence: "Gain 2, burn the opponent for 1.",
                    effects: [
                        { op: "gainLife", player: "controller", amount: 2 },
                        {
                            op: "dealDamage",
                            amount: 1,
                            to: { player: "opponent" },
                        },
                    ],
                },
                loss: {
                    consequence: "Lose 1 life.",
                    effects: [
                        { op: "loseLife", player: "controller", amount: 1 },
                    ],
                },
            },
        ]);
        const state = makeState({ rngSeed: WIN_SEED });
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(22);
        expect(state.players[1].life).toBe(19);
    });

    it("flips with an announced target player and acts on the win branch (CR 705.1)", () => {
        const id = registerScript(
            "test-op-coinsync-target",
            [
                {
                    op: "coinFlipSync",
                    player: { target: 0 },
                    win: {
                        consequence: "Target player gains 5.",
                        effects: [
                            {
                                op: "gainLife",
                                player: { target: 0 },
                                amount: 5,
                            },
                        ],
                    },
                    loss: {
                        consequence: "Target player loses 5.",
                        effects: [
                            {
                                op: "loseLife",
                                player: { target: 0 },
                                amount: 5,
                            },
                        ],
                    },
                },
            ],
            { targetRequirement: { type: "player", count: 1 } }
        );
        const state = makeState({ rngSeed: WIN_SEED });
        pushSpell(state, id, "p1", [{ type: "player", id: "p2" }]);
        resolveTopOfStack(state);
        expect(state.pendingChoices ?? []).toHaveLength(0);
        expect(state.players[1].life).toBe(25);
    });

    it("skips the flip entirely when the flipper is gone, and still runs the rest (CR 608.2b)", () => {
        const id = registerScript(
            "test-op-coinsync-missing",
            [
                {
                    op: "coinFlipSync",
                    player: { target: 0 },
                    win: {
                        consequence: "Gain 3.",
                        effects: [
                            {
                                op: "gainLife",
                                player: "controller",
                                amount: 3,
                            },
                        ],
                    },
                    loss: {
                        consequence: "Lose 3.",
                        effects: [
                            {
                                op: "loseLife",
                                player: "controller",
                                amount: 3,
                            },
                        ],
                    },
                },
                { op: "gainLife", player: "controller", amount: 2 },
            ],
            { targetRequirement: { type: "player", count: 1 } }
        );
        const state = makeState({ rngSeed: WIN_SEED });
        pushSpell(state, id, "p1", []); // no target survives to resolution
        expect(() => resolveTopOfStack(state)).not.toThrow();
        expect(state.pendingChoices ?? []).toHaveLength(0);
        // …and the following Op still ran (branch skipped, not the whole script).
        expect(state.players[0].life).toBe(22);
    });

    it("a suspending Op inside the taken branch resumes through the coinFlipSync WITHOUT re-flipping (CR 608.3)", () => {
        const id = registerScript(
            "test-op-coinsync-nested-suspend",
            [
                {
                    op: "coinFlipSync",
                    win: {
                        consequence: "Target player discards two.",
                        effects: [
                            {
                                op: "choice",
                                kind: "discard-hand",
                                player: { target: 0 },
                                zone: "hand",
                                count: 2,
                                prompt: "Discard two cards.",
                                bind: "$d",
                            },
                            {
                                op: "discard",
                                player: { target: 0 },
                                cards: { ref: "$d" },
                            },
                        ],
                    },
                    loss: {
                        consequence: "Gain 1 life.",
                        effects: [
                            {
                                op: "gainLife",
                                player: "controller",
                                amount: 1,
                            },
                        ],
                    },
                },
            ],
            { targetRequirement: { type: "player", count: 1 } }
        );
        const state = makeState({
            rngSeed: WIN_SEED,
            players: [
                makePlayer("p1"),
                makePlayer("p2", { hand: handOf("p2", ["h1", "h2", "h3"]) }),
            ],
        });
        pushSpell(state, id, "p1", [{ type: "player", id: "p2" }]);
        // The nested `choice` suspends — NO coin-flip Pending Choice is ever
        // enqueued (coinFlipSync has no reveal-ack step at all).
        resolveTopOfStack(state);
        const choiceHead = state.pendingChoices![0];
        expect(choiceHead.kind).toBe("discard-hand");
        applyPendingChoiceSubmit(state, {
            playerId: "p2",
            stackItemId: choiceHead.stackItemId,
            step: choiceHead.step,
            choiceId: choiceHead.choiceId,
            cardInstanceIds: ["h1", "h2"],
        });
        // The discard resolved through the branch (the win branch was taken —
        // re-descending on resume never re-flipped into a different branch)…
        expect(state.players[1].hand.map((c) => c.id)).toEqual(["h3"]);
        expect(state.pendingChoices ?? []).toHaveLength(0);
    });

    it("the win-branch outcome survives projection (wire format)", () => {
        const id = registerScript("test-op-coinsync-wire", [
            {
                op: "coinFlipSync",
                win: {
                    consequence: "Burn the opponent for 2.",
                    effects: [
                        {
                            op: "dealDamage",
                            amount: 2,
                            to: { player: "opponent" },
                        },
                    ],
                },
                loss: {
                    consequence: "Gain 1 life.",
                    effects: [
                        { op: "gainLife", player: "controller", amount: 1 },
                    ],
                },
            },
        ]);
        const state = makeState({ rngSeed: WIN_SEED });
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        const projected = projectPublicState(state, 1, "p1");
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

describe("Effect Script value grammar: isPermanentCard (CR 205/110.1, issue #1311)", () => {
    // `.isPermanentCard` is a NEW ref property (SNAP_IS_PERMANENT_CARD) — a
    // thin skin over SpellContext.isPermanentCard, captured at `bind` time
    // (mirrors SNAP_MANA_VALUE's own pre-move capture, since the object may
    // have already left its original zone by the time a later ref reads it)
    // so an `if` predicate can read "was the exiled card a permanent card"
    // (CR 205, 110.1). First user: Lion Sash's "Exile target card from a
    // graveyard. If it was a permanent card, put a +1/+1 counter on this
    // permanent" (issue #1311).

    it("reads true for a permanent-card graveyard target (the guarded branch runs)", () => {
        const id = registerScript("test-value-ispermanentcard-true", [
            {
                op: "moveZone",
                target: { target: 0 },
                to: "exile",
                bind: "$exiled",
            },
            {
                op: "if",
                predicate: {
                    left: { ref: "$exiled.isPermanentCard" },
                    op: "eq",
                    right: 1,
                },
                then: [{ op: "gainLife", player: "controller", amount: 3 }],
            },
        ]);
        const dead = makeInstance(BEAR_ID, {
            controllerId: "p1",
            ownerId: "p1",
            id: "deadPermTrue",
            zone: "graveyard",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { graveyard: [dead] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, id, "p1", [
            { type: "graveyard-card", id: "deadPermTrue", playerId: "p1" },
        ]);
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(23); // 20 + 3
        expect(state.players[0].exile.map((c) => c.id)).toContain(
            "deadPermTrue"
        );
    });

    it("reads false for a non-permanent-card graveyard target (the guarded branch is skipped)", () => {
        const id = registerScript("test-value-ispermanentcard-false", [
            {
                op: "moveZone",
                target: { target: 0 },
                to: "exile",
                bind: "$exiled",
            },
            {
                op: "if",
                predicate: {
                    left: { ref: "$exiled.isPermanentCard" },
                    op: "eq",
                    right: 1,
                },
                then: [{ op: "gainLife", player: "controller", amount: 3 }],
            },
        ]);
        const dead = makeInstance(BLACK_CARD_ID, {
            controllerId: "p1",
            ownerId: "p1",
            id: "deadPermFalse",
            zone: "graveyard",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { graveyard: [dead] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, id, "p1", [
            { type: "graveyard-card", id: "deadPermFalse", playerId: "p1" },
        ]);
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(20); // unchanged — an Instant isn't a permanent card
    });

    it("the permanent-card branch's outcome survives projection (wire format)", () => {
        const id = registerScript("test-value-ispermanentcard-wire", [
            {
                op: "moveZone",
                target: { target: 0 },
                to: "exile",
                bind: "$exiled",
            },
            {
                op: "if",
                predicate: {
                    left: { ref: "$exiled.isPermanentCard" },
                    op: "eq",
                    right: 1,
                },
                then: [{ op: "gainLife", player: "controller", amount: 3 }],
            },
        ]);
        const dead = makeInstance(BEAR_ID, {
            controllerId: "p1",
            ownerId: "p1",
            id: "deadPermWire",
            zone: "graveyard",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { graveyard: [dead] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, id, "p1", [
            { type: "graveyard-card", id: "deadPermWire", playerId: "p1" },
        ]);
        resolveTopOfStack(state);
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.players[0].life).toBe(23);
    });
});

describe("Effect Script Op: attach / unattach (CR 701.3, ADR 0065, issue #1311)", () => {
    // Reconfigure's two activated abilities (CR 702.151a) are a thin
    // declarative skin over SpellContext.attachTo / detachFrom — the
    // generalized (Aura OR Equipment) counterpart of `reattachAura`. A
    // synthetic Equipment-shaped creature exercises both directions plus the
    // CR 702.151b "isn't a creature while attached" type-remove effect.
    const RECONFIG_ID = "test-op-reconfigure";
    registerTokenDefinition({
        id: RECONFIG_ID,
        name: RECONFIG_ID,
        rarity: "common",
        manaCost: { generic: 1 },
        types: ["Artifact", "Creature"],
        subtypes: ["Equipment"],
        power: 1,
        toughness: 1,
        staticEffects: [
            {
                kind: "type-remove",
                applies: (target, source) =>
                    target.id === source.id && !!source.attachedTo,
                types: ["Creature"],
            },
        ],
        activatedAbilities: [
            {
                id: "reconfig-attach",
                oracleText: "test attach",
                cost: {},
                useStack: true,
                targetRequirement: { type: "Creature", count: 1 },
                effects: [{ op: "attach", target: { target: 0 } }],
            },
            {
                id: "reconfig-unattach",
                oracleText: "test unattach",
                cost: {},
                useStack: true,
                effects: [{ op: "unattach" }],
            },
        ],
    });

    it("attach sets $source.attachedTo to the announced target and $source stops being a creature (CR 701.3a, 702.151b)", () => {
        const equip = makeInstance(RECONFIG_ID, {
            id: "equip1",
            controllerId: "p1",
        });
        const bear = makeInstance(BEAR_ID, {
            id: "bearAttach",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [equip, bear] }),
                makePlayer("p2"),
            ],
        });
        const src = state.players[0].battlefield[0];
        state.stack.push({
            ...src,
            zone: "stack",
            castById: "p1",
            abilityId: "reconfig-attach",
            targets: [{ type: "permanent", id: "bearAttach" }],
        });
        resolveTopOfStack(state);
        const found = state.players[0].battlefield.find(
            (c) => c.id === "equip1"
        )!;
        expect(found.attachedTo).toBe("bearAttach");
        expect(found.types).not.toContain("Creature");
        expect(found.types).toContain("Artifact");
    });

    it("attach then unattach round-trips attachedTo and the Creature type (CR 701.3d, 702.151b)", () => {
        const equip = makeInstance(RECONFIG_ID, {
            id: "equip2",
            controllerId: "p1",
        });
        const bear = makeInstance(BEAR_ID, {
            id: "bearRound",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [equip, bear] }),
                makePlayer("p2"),
            ],
        });
        state.stack.push({
            ...state.players[0].battlefield[0],
            zone: "stack",
            castById: "p1",
            abilityId: "reconfig-attach",
            targets: [{ type: "permanent", id: "bearRound" }],
        });
        resolveTopOfStack(state);
        let found = state.players[0].battlefield.find(
            (c) => c.id === "equip2"
        )!;
        expect(found.attachedTo).toBe("bearRound");
        expect(found.types).not.toContain("Creature");

        state.stack.push({
            ...found,
            zone: "stack",
            castById: "p1",
            abilityId: "reconfig-unattach",
            targets: [],
        });
        resolveTopOfStack(state);
        found = state.players[0].battlefield.find((c) => c.id === "equip2")!;
        expect(found.attachedTo).toBeUndefined();
        expect(found.types).toContain("Creature");
    });

    it("unattach is a no-op when $source isn't attached (CR 608.2b)", () => {
        const equip = makeInstance(RECONFIG_ID, {
            id: "equip3",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [equip] }),
                makePlayer("p2"),
            ],
        });
        state.stack.push({
            ...state.players[0].battlefield[0],
            zone: "stack",
            castById: "p1",
            abilityId: "reconfig-unattach",
            targets: [],
        });
        expect(() => resolveTopOfStack(state)).not.toThrow();
        const found = state.players[0].battlefield.find(
            (c) => c.id === "equip3"
        )!;
        expect(found.attachedTo).toBeUndefined();
        expect(found.types).toContain("Creature");
    });

    it("the attach outcome survives projection (wire format) — attachedTo and the stripped Creature type", () => {
        const equip = makeInstance(RECONFIG_ID, {
            id: "equip4",
            controllerId: "p1",
        });
        const bear = makeInstance(BEAR_ID, {
            id: "bearWire",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [equip, bear] }),
                makePlayer("p2"),
            ],
        });
        state.stack.push({
            ...state.players[0].battlefield[0],
            zone: "stack",
            castById: "p1",
            abilityId: "reconfig-attach",
            targets: [{ type: "permanent", id: "bearWire" }],
        });
        resolveTopOfStack(state);
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "equip4"
        )!;
        expect(slim.attachedTo).toBe("bearWire");
        expect(slim.types).not.toContain("Creature");
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

    // `bind` + `ref.manaValue` (issue #680) — Reanimate: "Put target creature
    // card from a graveyard onto the battlefield under your control. You
    // lose life equal to that card's mana value." The snapshot is taken
    // BEFORE the reanimation (CR 608.2h last-known information), so the
    // later `loseLife` reads the card's mana value even though by then it's
    // a battlefield permanent under a (possibly) different id context.
    it("snapshots a reanimated graveyard card's mana value for a later ref (Reanimate's life-loss clause)", () => {
        const id = registerScript("test-op-movezone-bind-manavalue", [
            {
                op: "moveZone",
                target: { target: 0 },
                to: "battlefield",
                bind: "$reanimated",
            },
            {
                op: "loseLife",
                player: "controller",
                amount: { ref: "$reanimated.manaValue" },
            },
        ]);
        // BEAR_ID's manaCost is { X: 1, G: 1 } → mana value 2 (CR 202.3).
        const dead = makeInstance(BEAR_ID, {
            controllerId: "p1",
            ownerId: "p1",
            id: "deadMV",
            zone: "graveyard",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { graveyard: [dead] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, id, "p1", [
            { type: "graveyard-card", id: "deadMV", playerId: "p1" },
        ]);
        resolveTopOfStack(state);
        expect(state.players[0].battlefield.map((c) => c.id)).toContain(
            "deadMV"
        );
        // 20 (base) - 2 (Bear's mana value) = 18.
        expect(state.players[0].life).toBe(18);
    });

    // `controller` (issue #680) — Reanimate targets "a graveyard" (ANY
    // player's, CR 601.2c) and reanimates "under YOUR control" — a
    // cross-graveyard reanimation where the caster differs from the card's
    // owner (Hymn of Rebirth's `resolve()` precedent, now DSL-expressible).
    // Wire-format assertion: both zones are public.
    it("reanimates a graveyard card under an explicit controller override (cross-graveyard reanimation)", () => {
        const id = registerScript("test-op-movezone-controller-override", [
            {
                op: "moveZone",
                target: { target: 0 },
                to: "battlefield",
                controller: "controller",
            },
        ]);
        // p2 OWNS the card; p1 casts the spell and reanimates it.
        const dead = makeInstance(BEAR_ID, {
            controllerId: "p2",
            ownerId: "p2",
            id: "deadXG",
            zone: "graveyard",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { graveyard: [dead] }),
            ],
        });
        pushSpell(state, id, "p1", [
            { type: "graveyard-card", id: "deadXG", playerId: "p2" },
        ]);
        resolveTopOfStack(state);
        expect(state.players[1].graveyard.map((c) => c.id)).not.toContain(
            "deadXG"
        );
        // Under p1's control (the caster), NOT p2's (the owner).
        const entered = state.players[0].battlefield.find(
            (c) => c.id === "deadXG"
        );
        expect(entered).toBeDefined();
        expect(entered!.controllerId).toBe("p1");
        expect(entered!.ownerId).toBe("p2");
        const projected = projectPublicState(state, 1, "p1");
        const projectedEntered = projected.players[0].battlefield.find(
            (c) => c.id === "deadXG"
        );
        expect(projectedEntered).toBeDefined();
    });
});

// The `cards`-shaped moveZone (issue #677): the SEARCH half of a tutor/fetch
// effect, consuming a `choice(zone: "library")` Op's picks — a library card
// has no announced-target form (CR 601.2b, hidden zone), so `resolveObjectRef`
// does not apply. Covers both the tutor pattern (library → hand, unfiltered)
// and the fetchland pattern (library → battlefield, filtered by type) — the
// Op's permanent test per the DSL testing regime (every future tutor/fetch
// card reuses this coverage for free).
const LAND_ID = "test-effects-land";
registerTokenDefinition({
    id: LAND_ID,
    name: LAND_ID,
    rarity: "common",
    types: ["Land"],
    subtypes: ["Plains"],
});
// A NON-basic land sharing the same subtype as a basic Plains — proves a
// `supertype: "Basic"` filter (issue #677 — Fabled Passage / Prismatic Vista's
// "search for a BASIC land card") excludes it even though its subtype/type
// alone would match.
const NONBASIC_LAND_ID = "test-effects-nonbasic-land";
registerTokenDefinition({
    id: NONBASIC_LAND_ID,
    name: NONBASIC_LAND_ID,
    rarity: "rare",
    types: ["Land"],
    subtypes: ["Plains"],
});
const BASIC_LAND_ID = "test-effects-basic-land";
registerTokenDefinition({
    id: BASIC_LAND_ID,
    name: BASIC_LAND_ID,
    rarity: "common",
    supertypes: ["Basic"],
    types: ["Land"],
    subtypes: ["Plains"],
});

describe("Effect Script Op: moveZone — cards/player shape (CR 400.7, issue #677)", () => {
    const libraryOf = (owner: "p1" | "p2", ids: string[], cardId = BEAR_ID) =>
        ids.map((cid) =>
            makeInstance(cardId, {
                id: cid,
                controllerId: owner,
                ownerId: owner,
                zone: "library",
            })
        );

    it("moves the choice-picked library card into the searching player's hand, then shuffles (tutor pattern)", () => {
        const id = registerScript("test-op-movezone-tutor", [
            {
                op: "choice",
                kind: "search-library",
                player: "controller",
                zone: "library",
                count: 1,
                prompt: "Search your library for a card.",
                bind: "$picked",
            },
            {
                op: "moveZone",
                cards: { ref: "$picked" },
                player: "controller",
                from: "library",
                to: "hand",
            },
            { op: "libraryLook", action: "shuffle", player: "controller" },
        ]);
        const lib = libraryOf("p1", ["lib1", "lib2", "lib3"]);
        const state = makeState({
            players: [makePlayer("p1", { library: lib }), makePlayer("p2")],
        });
        pushSpell(state, id, "p1");
        expect(resolveTopOfStack(state)).toBeNull(); // suspended on the search
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("search-library");
        expect(head.zone).toBe("library");
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["lib2"],
        });
        // Moved out of the library into the hand.
        expect(state.players[0].library.map((c) => c.id)).not.toContain("lib2");
        expect(state.players[0].hand.map((c) => c.id)).toContain("lib2");
        expect(state.players[0].library).toHaveLength(2);
        // Resolution completed (the trailing shuffle ran without a further
        // suspension) and the sorcery landed in its owner's graveyard.
        expect(state.stack).toHaveLength(0);
        expect(state.players[0].graveyard.map((c) => c.card.id)).toContain(id);
    });

    it("moves the choice-picked library card onto the battlefield, filtered by type (fetchland pattern)", () => {
        const id = registerScript("test-op-movezone-fetch", [
            {
                op: "choice",
                kind: "search-library",
                player: "controller",
                zone: "library",
                filter: { type: "Land" },
                count: 1,
                prompt: "Search your library for a land card.",
                bind: "$picked",
            },
            {
                op: "moveZone",
                cards: { ref: "$picked" },
                player: "controller",
                from: "library",
                to: "battlefield",
            },
            { op: "libraryLook", action: "shuffle", player: "controller" },
            { op: "loseLife", player: "controller", amount: 1 },
        ]);
        const lib = [
            ...libraryOf("p1", ["bear1", "bear2"]),
            ...libraryOf("p1", ["plains1"], LAND_ID),
        ];
        const state = makeState({
            players: [
                makePlayer("p1", { library: lib, life: 20 }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, id, "p1");
        expect(resolveTopOfStack(state)).toBeNull(); // suspended on the search
        const head = state.pendingChoices![0];
        // The filter precomputed a candidateIds allow-list — only the land is
        // eligible, even though the search-space is the whole (hidden) library.
        expect(head.candidateIds).toEqual(["plains1"]);
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["plains1"],
        });
        expect(state.players[0].library.map((c) => c.id)).not.toContain(
            "plains1"
        );
        expect(state.players[0].battlefield.map((c) => c.id)).toContain(
            "plains1"
        );
        expect(state.players[0].life).toBe(19);
        expect(state.stack).toHaveLength(0);
    });

    it("skips the search-and-move (and every downstream Op) when there are no matching candidates (CR 608.2b)", () => {
        const id = registerScript("test-op-movezone-nomatch", [
            {
                op: "choice",
                kind: "search-library",
                player: "controller",
                zone: "library",
                filter: { type: "Land" },
                count: 1,
                prompt: "Search your library for a land card.",
                bind: "$picked",
            },
            {
                op: "moveZone",
                cards: { ref: "$picked" },
                player: "controller",
                from: "library",
                to: "battlefield",
            },
        ]);
        const lib = libraryOf("p1", ["bear1", "bear2"]);
        const state = makeState({
            players: [makePlayer("p1", { library: lib }), makePlayer("p2")],
        });
        pushSpell(state, id, "p1");
        // No lands in the library — the choice finds zero candidates and is
        // skipped entirely (no PendingChoice raised), so resolution completes
        // synchronously without a search prompt.
        expect(() => resolveTopOfStack(state)).not.toThrow();
        expect(state.pendingChoices).toBeUndefined();
        expect(state.players[0].library).toHaveLength(2);
        expect(state.players[0].battlefield).toHaveLength(0);
    });

    // Wire format (GRE testing convention): the searching player's hand and
    // battlefield are public zones, so the tutor/fetch outcome must survive
    // `projectPublicState` exactly as observed on the fat state.
    it("the moved card survives projection to both hand and battlefield destinations (wire format)", () => {
        const id = registerScript("test-op-movezone-wire", [
            {
                op: "choice",
                kind: "search-library",
                player: "controller",
                zone: "library",
                filter: { type: "Land" },
                count: 1,
                prompt: "Search your library for a land card.",
                bind: "$picked",
            },
            {
                op: "moveZone",
                cards: { ref: "$picked" },
                player: "controller",
                from: "library",
                to: "battlefield",
            },
        ]);
        const lib = [
            ...libraryOf("p1", ["bear1"]),
            ...libraryOf("p1", ["plainsWire"], LAND_ID),
        ];
        const state = makeState({
            players: [makePlayer("p1", { library: lib }), makePlayer("p2")],
        });
        pushSpell(state, id, "p1");
        expect(resolveTopOfStack(state)).toBeNull(); // suspended on the search
        const head = state.pendingChoices![0];
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["plainsWire"],
        });
        expect(state.players[0].battlefield.map((c) => c.id)).toContain(
            "plainsWire"
        );
        const projected = projectPublicState(state, 1, "p2");
        expect(projected.players[0].battlefield.map((c) => c.id)).toContain(
            "plainsWire"
        );
    });

    // `filter.supertype` (issue #677): a "search for a BASIC land card"
    // restriction (Fabled Passage, Prismatic Vista) excludes a nonbasic land
    // sharing the same subtype — a plain type/subtype filter would wrongly
    // admit it.
    it("restricts the search-library candidates by supertype (basic-land-only fetch)", () => {
        const id = registerScript("test-op-movezone-supertype", [
            {
                op: "choice",
                kind: "search-library",
                player: "controller",
                zone: "library",
                filter: { supertype: "Basic" },
                count: 1,
                prompt: "Search your library for a basic land card.",
                bind: "$picked",
            },
            {
                op: "moveZone",
                cards: { ref: "$picked" },
                player: "controller",
                from: "library",
                to: "battlefield",
            },
        ]);
        const lib = [
            ...libraryOf("p1", ["nonbasic1"], NONBASIC_LAND_ID),
            ...libraryOf("p1", ["basic1"], BASIC_LAND_ID),
        ];
        const state = makeState({
            players: [makePlayer("p1", { library: lib }), makePlayer("p2")],
        });
        pushSpell(state, id, "p1");
        expect(resolveTopOfStack(state)).toBeNull(); // suspended on the search
        const head = state.pendingChoices![0];
        // Only the basic land is eligible — the nonbasic Plains-subtype land
        // is excluded even though it shares the subtype.
        expect(head.candidateIds).toEqual(["basic1"]);
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["basic1"],
        });
        expect(state.players[0].battlefield.map((c) => c.id)).toContain(
            "basic1"
        );
    });

    // `filter.subtype` as an ARRAY (issue #677): OR-within-the-field — a
    // fetchland's "a Forest or Island card" (any ONE of the two subtypes is
    // eligible, not both).
    it("restricts the search-library candidates by an array of subtypes (fetchland OR pattern)", () => {
        const FOREST_ID = "test-effects-forest";
        registerTokenDefinition({
            id: FOREST_ID,
            name: FOREST_ID,
            rarity: "common",
            types: ["Land"],
            subtypes: ["Forest"],
        });
        const id = registerScript("test-op-choice-subtype-array", [
            {
                op: "choice",
                kind: "search-library",
                player: "controller",
                zone: "library",
                filter: { subtype: ["Forest", "Island"] },
                count: 1,
                prompt: "Search your library for a Forest or Island card.",
                bind: "$picked",
            },
            {
                op: "moveZone",
                cards: { ref: "$picked" },
                player: "controller",
                from: "library",
                to: "battlefield",
            },
        ]);
        const lib = [
            ...libraryOf("p1", ["bear1"]),
            ...libraryOf("p1", ["forest1"], FOREST_ID),
            ...libraryOf("p1", ["plains1"], LAND_ID),
        ];
        const state = makeState({
            players: [makePlayer("p1", { library: lib }), makePlayer("p2")],
        });
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        // The Forest matches (one of the two OR'd subtypes); the Bear and the
        // Plains do not.
        expect(state.pendingChoices![0].candidateIds).toEqual(["forest1"]);
    });

    // `filter.color` (issue #677) — Natural Order's "a green creature card".
    it("restricts the search-library candidates by color", () => {
        const COLORLESS_CREATURE_ID = "test-effects-colorless-creature";
        registerTokenDefinition({
            id: COLORLESS_CREATURE_ID,
            name: COLORLESS_CREATURE_ID,
            rarity: "common",
            manaCost: { X: 2 },
            types: ["Creature"],
            subtypes: ["Golem"],
            power: 2,
            toughness: 2,
        });
        const GREEN_CREATURE_ID = "test-effects-green-creature";
        registerTokenDefinition({
            id: GREEN_CREATURE_ID,
            name: GREEN_CREATURE_ID,
            rarity: "common",
            manaCost: { G: 2 },
            types: ["Creature"],
            subtypes: ["Beast"],
            power: 3,
            toughness: 3,
        });
        const id = registerScript("test-op-choice-color", [
            {
                op: "choice",
                kind: "search-library",
                player: "controller",
                zone: "library",
                filter: { type: "Creature", color: "G" },
                count: 1,
                prompt: "Search your library for a green creature card.",
                bind: "$picked",
            },
            {
                op: "moveZone",
                cards: { ref: "$picked" },
                player: "controller",
                from: "library",
                to: "battlefield",
            },
        ]);
        const lib = [
            ...libraryOf("p1", ["colorless1"], COLORLESS_CREATURE_ID), // no green — doesn't match
            ...libraryOf("p1", ["green1"], GREEN_CREATURE_ID),
        ];
        const state = makeState({
            players: [makePlayer("p1", { library: lib }), makePlayer("p2")],
        });
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        expect(state.pendingChoices![0].candidateIds).toEqual(["green1"]);
    });

    // `filter.manaValueAtMost` (issue #677, a FIXED literal ceiling) —
    // Spellseeker's "mana value 2 or less".
    it("restricts the search-library candidates by a fixed mana-value ceiling", () => {
        const CHEAP_SORCERY_ID = "test-effects-cheap-sorcery";
        registerTokenDefinition({
            id: CHEAP_SORCERY_ID,
            name: CHEAP_SORCERY_ID,
            rarity: "common",
            manaCost: { X: 2 },
            types: ["Sorcery"],
        });
        const EXPENSIVE_SORCERY_ID = "test-effects-expensive-sorcery";
        registerTokenDefinition({
            id: EXPENSIVE_SORCERY_ID,
            name: EXPENSIVE_SORCERY_ID,
            rarity: "common",
            manaCost: { X: 5 },
            types: ["Sorcery"],
        });
        const id = registerScript("test-op-choice-manavalue", [
            {
                op: "choice",
                kind: "search-library",
                player: "controller",
                zone: "library",
                filter: { type: "Sorcery", manaValueAtMost: 2 },
                count: 1,
                prompt: "Search your library for a sorcery card with mana value 2 or less.",
                bind: "$picked",
            },
            {
                op: "moveZone",
                cards: { ref: "$picked" },
                player: "controller",
                from: "library",
                to: "hand",
            },
        ]);
        const lib = [
            ...libraryOf("p1", ["cheap1"], CHEAP_SORCERY_ID),
            ...libraryOf("p1", ["expensive1"], EXPENSIVE_SORCERY_ID),
        ];
        const state = makeState({
            players: [makePlayer("p1", { library: lib }), makePlayer("p2")],
        });
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        expect(state.pendingChoices![0].candidateIds).toEqual(["cheap1"]);
    });

    // `filter.manaValueAtMost: { X: true }` (issue #898) — a DYNAMIC ceiling
    // (Green Sun's Zenith's "mana value X or less"), resolved via
    // `ctx.getX()` at resolution through the same `resolveValue` path every
    // other `EffectXValue` site uses. Mirrors the fixed-ceiling test above
    // but reads the chosen X off the stack item instead of a literal.
    it("restricts the search-library candidates by a DYNAMIC mana-value ceiling ({ X: true }, Green Sun's Zenith)", () => {
        const CHEAP_SORCERY_ID = "test-effects-x-cheap-sorcery";
        registerTokenDefinition({
            id: CHEAP_SORCERY_ID,
            name: CHEAP_SORCERY_ID,
            rarity: "common",
            manaCost: { X: 2 },
            types: ["Sorcery"],
        });
        const EXPENSIVE_SORCERY_ID = "test-effects-x-expensive-sorcery";
        registerTokenDefinition({
            id: EXPENSIVE_SORCERY_ID,
            name: EXPENSIVE_SORCERY_ID,
            rarity: "common",
            manaCost: { X: 5 },
            types: ["Sorcery"],
        });
        const id = registerScript("test-op-choice-manavalue-x", [
            {
                op: "choice",
                kind: "search-library",
                player: "controller",
                zone: "library",
                filter: { type: "Sorcery", manaValueAtMost: { X: true } },
                count: { min: 0, max: 1 },
                prompt: "Search your library for a sorcery card with mana value X or less.",
                bind: "$picked",
            },
            {
                op: "moveZone",
                cards: { ref: "$picked" },
                player: "controller",
                from: "library",
                to: "hand",
            },
        ]);
        const lib = [
            ...libraryOf("p1", ["xcheap1"], CHEAP_SORCERY_ID),
            ...libraryOf("p1", ["xexpensive1"], EXPENSIVE_SORCERY_ID),
        ];
        const state = makeState({
            players: [makePlayer("p1", { library: lib }), makePlayer("p2")],
        });
        const item = pushSpell(state, id, "p1");
        item.chosenX = 3;
        resolveTopOfStack(state);
        expect(state.pendingChoices![0].candidateIds).toEqual(["xcheap1"]);
    });

    // The chosen X ceiling of 0 (issue #898) — `getX()` defaults to 0 (CR
    // 107.3) when no X was announced, so an UNANNOUNCED X excludes every
    // card with a positive mana value, mirroring "X reads back 0 when no X
    // was announced" for a plain `EffectValue` site.
    it("a dynamic mana-value ceiling with no chosen X excludes every positive-mana-value card (getX default)", () => {
        const CHEAP_SORCERY_ID = "test-effects-x0-cheap-sorcery";
        registerTokenDefinition({
            id: CHEAP_SORCERY_ID,
            name: CHEAP_SORCERY_ID,
            rarity: "common",
            manaCost: { X: 2 },
            types: ["Sorcery"],
        });
        const id = registerScript("test-op-choice-manavalue-x-zero", [
            {
                op: "choice",
                kind: "search-library",
                player: "controller",
                zone: "library",
                filter: { type: "Sorcery", manaValueAtMost: { X: true } },
                count: { min: 0, max: 1 },
                prompt: "Search your library for a sorcery card with mana value X or less.",
                bind: "$picked",
            },
            {
                op: "moveZone",
                cards: { ref: "$picked" },
                player: "controller",
                from: "library",
                to: "hand",
            },
        ]);
        const lib = [...libraryOf("p1", ["x0cheap1"], CHEAP_SORCERY_ID)];
        const state = makeState({
            players: [makePlayer("p1", { library: lib }), makePlayer("p2")],
        });
        pushSpell(state, id, "p1"); // no chosenX
        const resolved = resolveTopOfStack(state);
        // Zero candidates + `count: { min: 0, ... }` auto-resolves without
        // suspending (CR 608.2b — mirrors "skips the choice AND the
        // consuming Op when there are no candidates" above); the card never
        // moves out of the library.
        expect(resolved).not.toBeNull();
        expect(state.pendingChoices).toBeUndefined();
        expect(state.players[0].library.map((c) => c.id)).toEqual(["x0cheap1"]);
        expect(state.players[0].hand.length).toBe(0);
    });

    // `filter.any` (issue #897) — OR ACROSS filter dimensions, distinct from
    // the OR-WITHIN-a-field arrays `type`/`subtype`/`color` already support
    // (issue #677). Magda, Brazen Outlaw's "an artifact or Dragon card":
    // `type: "Artifact"` OR `subtype: "Dragon"` — two DIFFERENT fields, not
    // one array on either. Covers a match via EACH clause plus a non-match
    // (neither clause satisfied), and re-asserts through `projectPublicState`
    // per the new-construct wire-format mandate.
    it("restricts the search-library candidates by a disjunctive any clause (type OR subtype, issue #897)", () => {
        const ARTIFACT_ID = "test-effects-any-artifact";
        registerTokenDefinition({
            id: ARTIFACT_ID,
            name: ARTIFACT_ID,
            rarity: "common",
            manaCost: { X: 2 },
            types: ["Artifact"],
        });
        const DRAGON_ID = "test-effects-any-dragon";
        registerTokenDefinition({
            id: DRAGON_ID,
            name: DRAGON_ID,
            rarity: "common",
            manaCost: { X: 4, R: 2 },
            types: ["Creature"],
            subtypes: ["Dragon"],
            power: 4,
            toughness: 4,
        });
        const BEAR_ID = "test-effects-any-bear";
        registerTokenDefinition({
            id: BEAR_ID,
            name: BEAR_ID,
            rarity: "common",
            manaCost: { G: 2 },
            types: ["Creature"],
            subtypes: ["Bear"],
            power: 2,
            toughness: 2,
        });
        const id = registerScript("test-op-choice-any", [
            {
                op: "choice",
                kind: "search-library",
                player: "controller",
                zone: "library",
                filter: { any: [{ type: "Artifact" }, { subtype: "Dragon" }] },
                count: 1,
                prompt: "Search your library for an artifact or Dragon card.",
                bind: "$picked",
            },
            {
                op: "moveZone",
                cards: { ref: "$picked" },
                player: "controller",
                from: "library",
                to: "battlefield",
            },
        ]);
        const lib = [
            ...libraryOf("p1", ["artifact1"], ARTIFACT_ID),
            ...libraryOf("p1", ["dragon1"], DRAGON_ID),
            ...libraryOf("p1", ["bear1"], BEAR_ID), // neither clause — excluded
        ];
        const state = makeState({
            players: [makePlayer("p1", { library: lib }), makePlayer("p2")],
        });
        pushSpell(state, id, "p1");
        expect(resolveTopOfStack(state)).toBeNull(); // suspended on the search
        // Both the artifact (matches `type`) and the Dragon (matches
        // `subtype`) are eligible; the Bear matches neither clause.
        expect(state.pendingChoices![0].candidateIds!.slice().sort()).toEqual([
            "artifact1",
            "dragon1",
        ]);
        const projected = projectPublicState(state, 1, "p1");
        expect(
            projected.pendingChoices![0].candidateIds!.slice().sort()
        ).toEqual(["artifact1", "dragon1"]);
    });

    // `count: { min: 0, max: N }` (issue #677) — an OPTIONAL / "up to N"
    // search (Stoneforge Mystic's "you may search…", Brightglass Gearhulk's
    // "up to two"). The player may submit FEWER than `max` (down to `min`).
    it("allows submitting fewer than max picks under a { min, max } count range", () => {
        const id = registerScript("test-op-choice-range", [
            {
                op: "choice",
                kind: "search-library",
                player: "controller",
                zone: "library",
                filter: { subtype: "Equipment" },
                count: { min: 0, max: 2 },
                prompt: "Search your library for up to two Equipment cards.",
                bind: "$picked",
            },
            {
                op: "moveZone",
                cards: { ref: "$picked" },
                player: "controller",
                from: "library",
                to: "hand",
            },
        ]);
        const EQUIPMENT_ID = "test-effects-equipment";
        registerTokenDefinition({
            id: EQUIPMENT_ID,
            name: EQUIPMENT_ID,
            rarity: "common",
            manaCost: { X: 1 },
            types: ["Artifact"],
            subtypes: ["Equipment"],
        });
        const lib = libraryOf("p1", ["eq1", "eq2", "eq3"], EQUIPMENT_ID);
        const state = makeState({
            players: [makePlayer("p1", { library: lib }), makePlayer("p2")],
        });
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        const head = state.pendingChoices![0];
        // The clamped range is passed straight to the choice's count.
        expect(head.count).toEqual({ min: 0, max: 2 });
        // Declining down to ZERO is legal — no picks, and the moveZone Op
        // consuming an empty picks array is a no-op.
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: [],
        });
        expect(state.players[0].hand).toHaveLength(0);
        expect(state.players[0].library).toHaveLength(3);
    });

    // `from: "hand"` (issue #677) — Stoneforge Mystic's second ability, "you
    // may put an Equipment card from your hand onto the battlefield".
    it("moves a choice-picked HAND card onto the battlefield (hand-source pattern)", () => {
        const EQUIPMENT_ID = "test-effects-equipment-hand";
        registerTokenDefinition({
            id: EQUIPMENT_ID,
            name: EQUIPMENT_ID,
            rarity: "common",
            manaCost: { X: 1 },
            types: ["Artifact"],
            subtypes: ["Equipment"],
        });
        const id = registerScript("test-op-movezone-hand-source", [
            {
                op: "choice",
                kind: "choose-hand-card",
                player: "controller",
                zone: "hand",
                filter: { subtype: "Equipment" },
                count: { min: 0, max: 1 },
                prompt: "Put an Equipment card from your hand onto the battlefield.",
                bind: "$picked",
            },
            {
                op: "moveZone",
                cards: { ref: "$picked" },
                player: "controller",
                from: "hand",
                to: "battlefield",
            },
        ]);
        const equip = makeInstance(EQUIPMENT_ID, {
            id: "equipHand1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const state = makeState({
            players: [makePlayer("p1", { hand: [equip] }), makePlayer("p2")],
        });
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("choose-hand-card");
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["equipHand1"],
        });
        expect(state.players[0].hand).toHaveLength(0);
        expect(state.players[0].battlefield.map((c) => c.id)).toContain(
            "equipHand1"
        );
    });

    // `bind` on the `cards` shape (issue #1151, closing #1120 gap 3) — the
    // hand-source move had no way to snapshot the permanent that just
    // entered for a follow-up Op (Cauldron Dance's hand-side clause, Sneak
    // Attack's haste grant). `bind` snapshots it exactly like the
    // announced-target shape's `bind` already does, unblocking a chained
    // `grantAbility` on the SPECIFIC creature that entered from hand.
    it("captures the just-entered permanent via `bind` for a chained grantAbility (Sneak Attack's haste grant)", () => {
        const id = registerScript("test-op-movezone-hand-source-bind", [
            {
                op: "choice",
                kind: "choose-hand-card",
                player: "controller",
                zone: "hand",
                filter: { type: "Creature" },
                count: { min: 0, max: 1 },
                prompt: "Put a creature card from your hand onto the battlefield.",
                bind: "$picked",
            },
            {
                op: "moveZone",
                cards: { ref: "$picked" },
                player: "controller",
                from: "hand",
                to: "battlefield",
                bind: "$sneak",
            },
            {
                op: "grantAbility",
                ability: "haste",
                target: { ref: "$sneak" },
                duration: { phase: "end-of-turn" },
            },
        ]);
        const creature = makeInstance(BEAR_ID, {
            id: "handCreature1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const state = makeState({
            players: [makePlayer("p1", { hand: [creature] }), makePlayer("p2")],
        });
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        const head = state.pendingChoices![0];
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["handCreature1"],
        });
        const entered = state.players[0].battlefield.find(
            (c) => c.id === "handCreature1"
        )!;
        expect(entered).toBeDefined();
        // The bind resolved to THIS specific permanent, not a fresh choice.
        expect(entered.staticAbilities).toContain("haste");
    });

    // Declining the "you may" choice (count min: 0) leaves nothing bound —
    // `bind` on an unresolved picks list is a no-op, not a crash (CR 608.2b).
    it("is a no-op for `bind` when the choice picked nothing (declined 'you may')", () => {
        const id = registerScript("test-op-movezone-hand-source-bind-decline", [
            {
                op: "choice",
                kind: "choose-hand-card",
                player: "controller",
                zone: "hand",
                filter: { type: "Creature" },
                count: { min: 0, max: 1 },
                prompt: "Put a creature card from your hand onto the battlefield.",
                bind: "$picked",
            },
            {
                op: "moveZone",
                cards: { ref: "$picked" },
                player: "controller",
                from: "hand",
                to: "battlefield",
                bind: "$sneak",
            },
            {
                op: "grantAbility",
                ability: "haste",
                target: { ref: "$sneak" },
                duration: { phase: "end-of-turn" },
            },
        ]);
        const creature = makeInstance(BEAR_ID, {
            id: "handCreatureDecline1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const state = makeState({
            players: [makePlayer("p1", { hand: [creature] }), makePlayer("p2")],
        });
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        const head = state.pendingChoices![0];
        expect(() =>
            applyPendingChoiceSubmit(state, {
                playerId: "p1",
                stackItemId: head.stackItemId,
                step: head.step,
                choiceId: head.choiceId,
                cardInstanceIds: [],
            })
        ).not.toThrow();
        expect(state.players[0].hand.map((c) => c.id)).toContain(
            "handCreatureDecline1"
        );
        expect(state.players[0].battlefield).toHaveLength(0);
    });

    // `from: "graveyard"` (issue #680) — the self-selection pick pattern
    // ("each player puts A CREATURE CARD FROM THEIR GRAVEYARD onto the
    // battlefield", Exhume), distinct from the `target`-shape's announced
    // target (a `choice` Op's picks are a self-selection, not a spell
    // target). `to: "battlefield"` routes through `returnToBattlefield`
    // (owner control) — the same primitive Hell's Caretaker's `resolve()`
    // uses for a target-based reanimation. Wire-format assertion: both zones
    // are public, so the outcome survives the projection.
    it("reanimates a choice-picked GRAVEYARD card onto the battlefield (graveyard-source pattern, wire format)", () => {
        const id = registerScript("test-op-movezone-graveyard-source-bf", [
            {
                op: "choice",
                kind: "choose-graveyard-card",
                player: "controller",
                zone: "graveyard",
                filter: { type: "Creature" },
                count: 1,
                prompt: "Put a creature card from your graveyard onto the battlefield.",
                bind: "$picked",
            },
            {
                op: "moveZone",
                cards: { ref: "$picked" },
                player: "controller",
                from: "graveyard",
                to: "battlefield",
            },
        ]);
        const dead = makeInstance(BEAR_ID, {
            id: "deadGYtoBF",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { graveyard: [dead] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        const head = state.pendingChoices![0];
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["deadGYtoBF"],
        });
        expect(state.players[0].graveyard.map((c) => c.id)).not.toContain(
            "deadGYtoBF"
        );
        expect(state.players[0].battlefield.map((c) => c.id)).toContain(
            "deadGYtoBF"
        );
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.players[0].battlefield.map((c) => c.id)).toContain(
            "deadGYtoBF"
        );
    });

    // `from: "graveyard"`, `to: "hand"` (issue #680) — the plain-move half
    // (Eternal Witness's "you may return target card from your graveyard to
    // your hand"), falling through the existing generic `moveCardById`
    // branch (unchanged by this generalization — only the `battlefield`
    // destination needed new wiring).
    it("returns a choice-picked GRAVEYARD card to hand (graveyard-source pattern)", () => {
        const id = registerScript("test-op-movezone-graveyard-source-hand", [
            {
                op: "choice",
                kind: "choose-graveyard-card",
                player: "controller",
                zone: "graveyard",
                count: { min: 0, max: 1 },
                prompt: "You may return target card from your graveyard to your hand.",
                bind: "$picked",
            },
            {
                op: "moveZone",
                cards: { ref: "$picked" },
                player: "controller",
                from: "graveyard",
                to: "hand",
            },
        ]);
        const dead = makeInstance(BEAR_ID, {
            id: "deadGYtoHand",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { graveyard: [dead] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        const head = state.pendingChoices![0];
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["deadGYtoHand"],
        });
        expect(state.players[0].graveyard.map((c) => c.id)).not.toContain(
            "deadGYtoHand"
        );
        expect(state.players[0].hand.map((c) => c.id)).toContain(
            "deadGYtoHand"
        );
    });
});

// issue #1279 — the THIRD moveZone shape: a bulk whole-zone move (no
// `target`, no `cards`). The permanent test for the new shape (per
// gre-development.md's "a card introducing a new Op/construct-usage earns it
// a permanent test") — every card currently in `from` moves to `to` with no
// per-card selection, a thin skin over `SpellContext.moveZone`. Unblocks
// Timetwister / Echo of Eons's "shuffles their hand and graveyard into their
// library" and Wheel of Fortune-adjacent hand-exile idioms.
describe("Effect Script Op: moveZone — whole-zone bulk shape (CR 400.7, issue #1279)", () => {
    const handOf = (owner: "p1" | "p2", ids: string[]) =>
        ids.map((cid) =>
            makeInstance(BEAR_ID, {
                id: cid,
                controllerId: owner,
                ownerId: owner,
            })
        );
    const graveyardOf = (owner: "p1" | "p2", ids: string[]) =>
        ids.map((cid) =>
            makeInstance(BEAR_ID, {
                id: cid,
                controllerId: owner,
                ownerId: owner,
                zone: "graveyard",
            })
        );

    it("moves every hand/graveyard card into the library with no selection, then shuffle+draw (Timetwister composition)", () => {
        const id = registerScript("test-op-movezone-bulk-timetwister", [
            {
                op: "forEach",
                select: { set: "players" },
                effects: [
                    {
                        op: "moveZone",
                        player: { ref: "$each" },
                        from: "hand",
                        to: "library",
                    },
                    {
                        op: "moveZone",
                        player: { ref: "$each" },
                        from: "graveyard",
                        to: "library",
                    },
                    {
                        op: "libraryLook",
                        action: "shuffle",
                        player: { ref: "$each" },
                    },
                    { op: "draw", player: { ref: "$each" }, count: 3 },
                ],
            },
        ]);
        const state = makeState({
            players: [
                makePlayer("p1", {
                    hand: handOf("p1", ["h1", "h2"]),
                    graveyard: graveyardOf("p1", ["g1"]),
                    library: handOf("p1", ["l1", "l2", "l3", "l4"]).map(
                        (c) => ({
                            ...c,
                            zone: "library" as const,
                        })
                    ),
                }),
                makePlayer("p2", {
                    hand: handOf("p2", ["h3"]),
                    library: handOf("p2", ["l5", "l6", "l7"]).map((c) => ({
                        ...c,
                        zone: "library" as const,
                    })),
                }),
            ],
        });
        const stackItem = pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        // Both players' hands and graveyards are swept — nothing left behind
        // except the resolved sorcery itself, which lands in ITS caster's
        // graveyard normally (CR 608.2h — it was on the stack, not in a hand/
        // graveyard the bulk move swept, throughout resolution).
        expect(state.players[0].hand).toHaveLength(3); // drew 3 fresh
        expect(state.players[0].graveyard.map((c) => c.id)).toEqual([
            stackItem.id,
        ]);
        expect(state.players[0].hand.map((c) => c.id)).not.toEqual(
            expect.arrayContaining(["h1", "h2"])
        );
        expect(state.players[1].hand).toHaveLength(3); // clamped to library size (3)
        // Every original card (hand + graveyard + library) ends up shuffled
        // back into the library minus what got redrawn.
        expect(
            state.players[0].library.length + state.players[0].hand.length
        ).toBe(7); // 2 hand + 1 graveyard + 4 library, none lost
        expect(state.stack).toHaveLength(0);
    });

    it("moves the whole hand to exile with no selection — the equivalent whole-hand exile mode (issue #1279)", () => {
        const id = registerScript("test-op-movezone-bulk-exile-hand", [
            {
                op: "moveZone",
                player: "controller",
                from: "hand",
                to: "exile",
            },
        ]);
        const state = makeState({
            players: [
                makePlayer("p1", { hand: handOf("p1", ["eh1", "eh2", "eh3"]) }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        expect(state.players[0].hand).toHaveLength(0);
        expect(state.players[0].exile.map((c) => c.id).sort()).toEqual([
            "eh1",
            "eh2",
            "eh3",
        ]);
    });

    it("is a no-op when `from === to` — the underlying primitive's own guard", () => {
        const id = registerScript("test-op-movezone-bulk-samezone", [
            {
                op: "moveZone",
                player: "controller",
                from: "hand",
                to: "hand",
            },
        ]);
        const state = makeState({
            players: [
                makePlayer("p1", { hand: handOf("p1", ["same1"]) }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        expect(state.players[0].hand.map((c) => c.id)).toEqual(["same1"]);
    });

    it("the whole-hand exile survives projection (wire format)", () => {
        const id = registerScript("test-op-movezone-bulk-wire", [
            {
                op: "moveZone",
                player: "controller",
                from: "hand",
                to: "exile",
            },
        ]);
        const state = makeState({
            players: [
                makePlayer("p1", { hand: handOf("p1", ["w1", "w2"]) }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.players[0].hand).toHaveLength(0);
        expect(projected.players[0].exile.map((c) => c.id).sort()).toEqual([
            "w1",
            "w2",
        ]);
    });
});

// issue #1279 — the bulk whole-hand `discard` shape (`cards` omitted). The
// permanent test for the new shape: every card currently in hand is
// discarded with no selection, through the same `discardCard` choke point
// (Library of Leng replacement, CARD_DISCARDED triggers, madness eligibility)
// the picks-based shape already uses. Unblocks Wheel of Fortune / Anje's
// Ravager's "discards their hand".
describe("Effect Script Op: discard — bulk whole-hand shape (CR 701.9, issue #1279)", () => {
    const handOf = (owner: "p1" | "p2", ids: string[]) =>
        ids.map((cid) =>
            makeInstance(BEAR_ID, {
                id: cid,
                controllerId: owner,
                ownerId: owner,
            })
        );

    it("discards every card in hand with no selection, then draws (Wheel of Fortune composition)", () => {
        const id = registerScript("test-op-discard-bulk-wheel", [
            {
                op: "forEach",
                select: { set: "players" },
                effects: [
                    { op: "discard", player: { ref: "$each" } },
                    { op: "draw", player: { ref: "$each" }, count: 2 },
                ],
            },
        ]);
        const state = makeState({
            players: [
                makePlayer("p1", {
                    hand: handOf("p1", ["d1", "d2"]),
                    library: handOf("p1", ["l1", "l2"]).map((c) => ({
                        ...c,
                        zone: "library" as const,
                    })),
                }),
                makePlayer("p2", {
                    hand: handOf("p2", ["d3"]),
                    library: handOf("p2", ["l3", "l4"]).map((c) => ({
                        ...c,
                        zone: "library" as const,
                    })),
                }),
            ],
        });
        const stackItem = pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        // p1's graveyard holds the two discarded cards PLUS the resolved
        // sorcery itself (its caster's own graveyard, landing there normally
        // after resolution completes — CR 608.2h).
        expect(state.players[0].graveyard.map((c) => c.id).sort()).toEqual(
            ["d1", "d2", stackItem.id].sort()
        );
        expect(state.players[1].graveyard.map((c) => c.id)).toEqual(["d3"]);
        expect(state.players[0].hand.map((c) => c.id).sort()).toEqual([
            "l1",
            "l2",
        ]);
        expect(state.players[1].hand.map((c) => c.id).sort()).toEqual([
            "l3",
            "l4",
        ]);
        expect(state.stack).toHaveLength(0);
    });

    it("is a no-op loop on an empty hand (CR 608.2b — nothing to discard)", () => {
        const id = registerScript("test-op-discard-bulk-empty", [
            { op: "discard", player: "controller" },
        ]);
        const state = makeState({
            players: [makePlayer("p1", { hand: [] }), makePlayer("p2")],
        });
        const stackItem = pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        expect(state.players[0].hand).toHaveLength(0);
        // Only the resolved sorcery itself lands in the graveyard — the
        // empty-hand discard loop had nothing to discard.
        expect(state.players[0].graveyard.map((c) => c.id)).toEqual([
            stackItem.id,
        ]);
        expect(state.stack).toHaveLength(0);
    });

    it("the bulk discard survives projection (wire format)", () => {
        const id = registerScript("test-op-discard-bulk-wire", [
            { op: "discard", player: "controller" },
        ]);
        const state = makeState({
            players: [
                makePlayer("p1", { hand: handOf("p1", ["dw1", "dw2"]) }),
                makePlayer("p2"),
            ],
        });
        const stackItem = pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.players[0].hand).toHaveLength(0);
        expect(projected.players[0].graveyard.map((c) => c.id).sort()).toEqual(
            ["dw1", "dw2", stackItem.id].sort()
        );
    });
});

// issue #1125 — the tutor-to-top template: choice(search-library) →
// libraryLook(shuffle) → moveZone(cards, from: "library", to: "library-top").
// The permanent test for the new destination (per gre-development.md's "a
// card introducing a new Op/construct-usage earns it a permanent test" —
// `library-top` is new vocabulary on an already-registered Op). Mirrors
// Vampiric Tutor / Mystical Tutor / Imperial Seal / Sterling Grove's shared
// oracle-text shape: "Search your library for a card, then shuffle and put
// that card on top."
describe("Effect Script Op: moveZone — library-top destination (CR 401.4, issue #1125)", () => {
    const libraryOf = (owner: "p1" | "p2", ids: string[]) =>
        ids.map((cid) =>
            makeInstance(BEAR_ID, {
                id: cid,
                controllerId: owner,
                ownerId: owner,
                zone: "library",
            })
        );

    const tutorToTopScript = (scriptId: string): string =>
        registerScript(scriptId, [
            {
                op: "choice",
                kind: "search-library",
                player: "controller",
                zone: "library",
                count: { min: 0, max: 1 },
                prompt: "Search your library for a card.",
                bind: "$picked",
            },
            { op: "libraryLook", action: "shuffle", player: "controller" },
            {
                op: "moveZone",
                cards: { ref: "$picked" },
                player: "controller",
                from: "library",
                to: "library-top",
            },
        ]);

    it("shuffles the library, then places the searched card on top — multiset preserved, found card is the new top", () => {
        const id = tutorToTopScript("test-op-movezone-library-top");
        const lib = libraryOf("p1", [
            "found1",
            "other1",
            "other2",
            "other3",
            "other4",
            "other5",
        ]);
        const before = lib.map((c) => c.id);
        const state = makeState({
            players: [makePlayer("p1", { library: lib }), makePlayer("p2")],
        });
        pushSpell(state, id, "p1");
        expect(resolveTopOfStack(state)).toBeNull(); // suspended on the search
        const head = state.pendingChoices![0];
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["found1"],
        });
        const after = state.players[0].library.map((c) => c.id);
        // Multiset preserved (CR 701.20 randomizes order, never adds/removes).
        expect([...after].sort()).toEqual([...before].sort());
        // The searched card is now the very top of the library.
        expect(after[0]).toBe("found1");
        // The searcher placed it there deliberately — they know the top card
        // (ADR 0026 self-knowledge, mirrors orderTop's "kept cards stay
        // known"), even though the rest of the shuffled library is unknown.
        const top = state.players[0].library[0];
        expect(top.knownTo).toEqual(["p1"]);
        expect(state.players[0].library[1].knownTo ?? []).toEqual([]);
        expect(state.stack).toHaveLength(0);
        expect(state.pendingChoices).toBeUndefined();
    });

    it("fail-to-find (0 picked): the library is still shuffled, nothing is relocated", () => {
        const id = tutorToTopScript("test-op-movezone-library-top-fail");
        const lib = libraryOf("p1", ["a", "b", "c", "d", "e", "f"]);
        const before = lib.map((c) => c.id);
        const state = makeState({
            players: [makePlayer("p1", { library: lib }), makePlayer("p2")],
        });
        pushSpell(state, id, "p1");
        expect(resolveTopOfStack(state)).toBeNull();
        const head = state.pendingChoices![0];
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: [],
        });
        const after = state.players[0].library.map((c) => c.id);
        expect([...after].sort()).toEqual([...before].sort());
        expect(state.stack).toHaveLength(0);
    });

    // Wire format (mandatory, GRE testing convention): the searcher's own
    // projection must show the new top card face-up (ADR 0026 self-
    // knowledge survives the projection); the opponent's projection must
    // still only show `{ count }` — the tutored card's identity never
    // crosses to a non-knower.
    it("the tutored top card survives projection: known to the searcher, hidden count-only to the opponent", () => {
        const id = tutorToTopScript("test-op-movezone-library-top-wire");
        const lib = libraryOf("p1", ["found2", "x1", "x2", "x3"]);
        const state = makeState({
            players: [makePlayer("p1", { library: lib }), makePlayer("p2")],
        });
        pushSpell(state, id, "p1");
        expect(resolveTopOfStack(state)).toBeNull();
        const head = state.pendingChoices![0];
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["found2"],
        });
        expect(state.players[0].library[0].id).toBe("found2");

        // Self-view: the searcher sees their own known top card.
        const selfView = projectPublicState(state, 0, "p1");
        expect(selfView.players[0].library.count).toBe(4);
        expect(
            selfView.players[0].library.known.some(
                (k) => k.index === 0 && k.card.id === "found2"
            )
        ).toBe(true);

        // Opponent view: hidden — count only, no `known` entries leak the
        // searcher's tutored card.
        const oppView = projectPublicState(state, 1, "p2");
        expect(oppView.players[0].library.count).toBe(4);
        expect(oppView.players[0].library.known).toEqual([]);
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

describe("Effect Script value grammar: negate (signed value negation, issue #926)", () => {
    // `{ negate: <value> }` is NOT a tenth EffectValue grammar member and NOT
    // a new Op / structural construct (ADR 0045 stays closed) — it is scoped
    // to the SIGNED value grammar (`EffectSignedValue`, `isSignedEffectValue`),
    // today only `pump`'s power/toughness. Unblocks "-X/-X" style pump amounts
    // driven off a non-negative-by-nature value member (Toxic Deluge's
    // pay-X-life additional cost, CR 118.4 — "All creatures get -X/-X until
    // end of turn"). Exercised here: a single-target -X/-X pump (the direct
    // Toxic Deluge shape), a mass -X/-X across EVERY player's creatures via
    // forEach (Toxic Deluge's actual scope), and the CR 608.2b skip when the
    // wrapped value is itself unresolvable.

    it("negate wraps X for a -X/-X pump on an announced target (Toxic Deluge single-target shape)", () => {
        const id = registerScript("test-negate-x-pump-target", [
            {
                op: "pump",
                target: { target: 0 },
                power: { negate: { X: true } },
                toughness: { negate: { X: true } },
                duration: { phase: "end-of-turn" },
            },
        ]);
        const bear = makeInstance(BEAR_ID, {
            controllerId: "p2",
            ownerId: "p2",
            id: "bearNegX",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        const item = pushSpell(state, id, "p1", [
            { type: "permanent", id: "bearNegX" },
        ]);
        item.chosenX = 3;
        resolveTopOfStack(state);
        const shrunk = state.players[1].battlefield.find(
            (c) => c.id === "bearNegX"
        )!;
        // BEAR_ID is a 2/5 → -3/-3 = -1/2.
        expect(getEffectivePower(state, shrunk)).toBe(-1);
        expect(getEffectiveToughness(state, shrunk)).toBe(2);
        // Wire-format assertion — the negated buff is baked into the
        // temporary modifier at resolution time, so it must survive the
        // projection identically (the layer pipeline reads over the
        // slimmed client state).
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[1].battlefield.find(
            (c) => c.id === "bearNegX"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(-1);
        expect(getEffectiveToughness(projected, slim)).toBe(2);
    });

    it("negate wraps X across a forEach mass pump — every player's creatures get -X/-X (Toxic Deluge)", () => {
        const id = registerScript("test-negate-x-pump-foreach", [
            {
                op: "forEach",
                // No `controller` — every player's battlefield (Toxic
                // Deluge hits ALL creatures, not just the caster's).
                select: {
                    set: "permanents",
                    zone: "battlefield",
                    filter: { type: "Creature" },
                },
                effects: [
                    {
                        op: "pump",
                        target: { ref: "$each" },
                        power: { negate: { X: true } },
                        toughness: { negate: { X: true } },
                        duration: { phase: "end-of-turn" },
                    },
                ],
            },
        ]);
        const mine = makeInstance(BEAR_ID, {
            id: "mDeluge",
            controllerId: "p1",
            ownerId: "p1",
        });
        const theirs = makeInstance(BEAR_ID, {
            id: "tDeluge",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [mine] }),
                makePlayer("p2", { battlefield: [theirs] }),
            ],
        });
        const item = pushSpell(state, id, "p1");
        item.chosenX = 2;
        resolveTopOfStack(state);
        for (const [pIdx, cid] of [
            [0, "mDeluge"],
            [1, "tDeluge"],
        ] as const) {
            const c = state.players[pIdx].battlefield.find(
                (x) => x.id === cid
            )!;
            // BEAR_ID is a 2/5 → -2/-2 = 0/3, on BOTH sides.
            expect(getEffectivePower(state, c)).toBe(0);
            expect(getEffectiveToughness(state, c)).toBe(3);
        }
        // Wire-format assertion from each side's own viewpoint.
        const p1View = projectPublicState(state, 0, "p1");
        const p2View = projectPublicState(state, 1, "p2");
        const mineSlim = p1View.players[0].battlefield.find(
            (c) => c.id === "mDeluge"
        )!;
        const theirsSlim = p2View.players[1].battlefield.find(
            (c) => c.id === "tDeluge"
        )!;
        expect(getEffectivePower(p1View, mineSlim)).toBe(0);
        expect(getEffectiveToughness(p1View, mineSlim)).toBe(3);
        expect(getEffectivePower(p2View, theirsSlim)).toBe(0);
        expect(getEffectiveToughness(p2View, theirsSlim)).toBe(3);
    });

    it("negate wraps a counters count for a -N/-N pump", () => {
        const id = registerScript("test-negate-counters-pump", [
            {
                op: "pump",
                target: { target: 0 },
                power: {
                    negate: { counters: { of: { target: 0 }, type: "fuse" } },
                },
                toughness: 0,
                duration: { phase: "end-of-turn" },
            },
        ]);
        const bear = makeInstance(BEAR_ID, {
            controllerId: "p2",
            ownerId: "p2",
            id: "bearNegCtr",
            counters: { fuse: 2 },
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        pushSpell(state, id, "p1", [{ type: "permanent", id: "bearNegCtr" }]);
        resolveTopOfStack(state);
        const shrunk = state.players[1].battlefield.find(
            (c) => c.id === "bearNegCtr"
        )!;
        // BEAR_ID is a 2/5 with 2 fuse counters → -2/+0 = 0/5.
        expect(getEffectivePower(state, shrunk)).toBe(0);
        expect(getEffectiveToughness(state, shrunk)).toBe(5);
    });

    it("skips the pump when the negated value is itself unresolvable (CR 608.2b)", () => {
        const id = registerScript("test-negate-missing", [
            {
                op: "pump",
                target: { target: 0 },
                power: {
                    negate: { counters: { of: { target: 1 }, type: "fuse" } },
                },
                toughness: 0,
                duration: { phase: "end-of-turn" },
            },
        ]);
        const bear = makeInstance(BEAR_ID, {
            controllerId: "p2",
            ownerId: "p2",
            id: "bearNegMissing",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        // Only ONE target is announced (slot 0) — slot 1 (what `negate`'s
        // `counters.of` reads) is unresolvable, so resolveValue returns
        // undefined and the pump executor skips rather than throwing.
        pushSpell(state, id, "p1", [
            { type: "permanent", id: "bearNegMissing" },
        ]);
        expect(() => resolveTopOfStack(state)).not.toThrow();
        const unchanged = state.players[1].battlefield.find(
            (c) => c.id === "bearNegMissing"
        )!;
        expect(getEffectivePower(state, unchanged)).toBe(2);
        expect(getEffectiveToughness(state, unchanged)).toBe(5);
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

describe("Effect Script Op: tapUntap (CR 701.26, issue #842)", () => {
    // Tapping an announced permanent target: `isTapped` flips false→true, and
    // that state must survive the projection (the client reads tap state off
    // the slimmed wire state — a permanent's tap status is board-visible).
    it("taps an announced target and survives the projection (wire format)", () => {
        const id = registerScript("test-op-tapuntap-tap", [
            { op: "tapUntap", action: "tap", target: { target: 0 } },
        ]);
        const bear = makeInstance(BEAR_ID, {
            controllerId: "p2",
            ownerId: "p2",
            id: "bearTap",
            isTapped: false,
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        pushSpell(state, id, "p1", [{ type: "permanent", id: "bearTap" }]);
        resolveTopOfStack(state);
        const tapped = state.players[1].battlefield.find(
            (c) => c.id === "bearTap"
        )!;
        expect(tapped.isTapped).toBe(true);
        // Same assertion after the projection — tap state is board-visible and
        // must not be stripped on the way to the client.
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[1].battlefield.find(
            (c) => c.id === "bearTap"
        )!;
        expect(slim.isTapped).toBe(true);
    });

    // Untapping an announced target: seed it tapped, `untap` flips it back.
    it("untaps an announced target (CR 701.26b)", () => {
        const id = registerScript("test-op-tapuntap-untap", [
            { op: "tapUntap", action: "untap", target: { target: 0 } },
        ]);
        const bear = makeInstance(BEAR_ID, {
            controllerId: "p2",
            ownerId: "p2",
            id: "bearUntap",
            isTapped: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        pushSpell(state, id, "p1", [{ type: "permanent", id: "bearUntap" }]);
        resolveTopOfStack(state);
        const untapped = state.players[1].battlefield.find(
            (c) => c.id === "bearUntap"
        )!;
        expect(untapped.isTapped).toBe(false);
    });

    // A self-tap via the implicit `$source` binding — a permanent tapping
    // itself as part of an activated ability's effect.
    it("taps the source permanent via the implicit $source binding", () => {
        const TAPPER_ID = "test-op-tapuntap-source";
        registerTokenDefinition({
            id: TAPPER_ID,
            name: TAPPER_ID,
            rarity: "common",
            manaCost: { generic: 1 },
            types: ["Artifact"],
            activatedAbilities: [
                {
                    id: "self-tap",
                    oracleText: "{1}: Tap this artifact.",
                    cost: { mana: { generic: 1 } },
                    useStack: true,
                    effects: [
                        {
                            op: "tapUntap",
                            action: "tap",
                            target: { ref: "$source" },
                        },
                    ],
                },
            ],
        });
        const tapper = makeInstance(TAPPER_ID, {
            id: "tapper1",
            controllerId: "p1",
            ownerId: "p1",
            isSummoningSick: false,
            isTapped: false,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [tapper] }),
                makePlayer("p2"),
            ],
        });
        const src = state.players[0].battlefield[0];
        state.stack.push({
            ...src,
            zone: "stack",
            castById: "p1",
            abilityId: "self-tap",
            targets: [],
        });
        resolveTopOfStack(state);
        const self = state.players[0].battlefield.find(
            (c) => c.id === "tapper1"
        )!;
        expect(self.isTapped).toBe(true);
    });

    // A mass tap: forEach over the opponent's creatures, each tapped via the
    // per-iteration `{ ref: "$each" }` object binding.
    it("taps every member of a forEach set via { ref: $each }", () => {
        const id = registerScript("test-op-tapuntap-foreach", [
            {
                op: "forEach",
                select: {
                    set: "permanents",
                    zone: "battlefield",
                    controller: "opponent",
                    filter: { type: "Creature" },
                },
                effects: [
                    {
                        op: "tapUntap",
                        action: "tap",
                        target: { ref: "$each" },
                    },
                ],
            },
        ]);
        const theirs = ["tA", "tB"].map((cid) =>
            makeInstance(BEAR_ID, {
                id: cid,
                controllerId: "p2",
                ownerId: "p2",
                isTapped: false,
            })
        );
        const mine = makeInstance(BEAR_ID, {
            id: "mA",
            controllerId: "p1",
            ownerId: "p1",
            isTapped: false,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [mine] }),
                makePlayer("p2", { battlefield: theirs }),
            ],
        });
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        for (const cid of ["tA", "tB"]) {
            const c = state.players[1].battlefield.find((x) => x.id === cid)!;
            expect(c.isTapped).toBe(true);
        }
        // The caster's own creature is outside the opponent-scoped set.
        const own = state.players[0].battlefield.find((x) => x.id === "mA")!;
        expect(own.isTapped).toBe(false);
    });

    it("is a no-op when the announced target is missing (CR 608.2b)", () => {
        const id = registerScript("test-op-tapuntap-missing", [
            { op: "tapUntap", action: "tap", target: { target: 0 } },
        ]);
        const state = makeState();
        pushSpell(state, id, "p1", []);
        expect(() => resolveTopOfStack(state)).not.toThrow();
    });
});

describe("Effect Script Op: grantAbility (CR 611.1b / 613.1f, layer 6, issue #843)", () => {
    // Granting a keyword to an announced target: the keyword appears in the
    // creature's `staticAbilities`, and that must survive the projection (the
    // client reads a creature's keywords off the slimmed wire state — a
    // granted ability is board-visible, e.g. an evasion keyword changes how
    // blocks are shown).
    it("grants a keyword to an announced target and survives the projection (wire format)", () => {
        const id = registerScript("test-op-grantability-target", [
            {
                op: "grantAbility",
                ability: "flying",
                target: { target: 0 },
                duration: { phase: "end-of-turn" },
            },
        ]);
        const bear = makeInstance(BEAR_ID, {
            controllerId: "p2",
            ownerId: "p2",
            id: "bearGrant",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        pushSpell(state, id, "p1", [{ type: "permanent", id: "bearGrant" }]);
        resolveTopOfStack(state);
        const granted = state.players[1].battlefield.find(
            (c) => c.id === "bearGrant"
        )!;
        expect(granted.staticAbilities).toContain("flying");
        // Same assertion after the projection — a granted keyword is
        // board-visible and must not be stripped on the way to the client.
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[1].battlefield.find(
            (c) => c.id === "bearGrant"
        )!;
        expect(slim.staticAbilities).toContain("flying");
    });

    // The grant expires at the declared phase boundary (CR 611.2 / 514.2):
    // walking to CLEANUP splices the keyword back out.
    it("expires at the cleanup step (CR 611.2 / 514.2)", () => {
        const id = registerScript("test-op-grantability-expire", [
            {
                op: "grantAbility",
                ability: "trample",
                target: { target: 0 },
                duration: { phase: "end-of-turn" },
            },
        ]);
        const bear = makeInstance(BEAR_ID, {
            controllerId: "p1",
            ownerId: "p1",
            id: "bearExpire",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bear] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, id, "p1", [{ type: "permanent", id: "bearExpire" }]);
        resolveTopOfStack(state);
        const granted = state.players[0].battlefield.find(
            (c) => c.id === "bearExpire"
        )!;
        expect(granted.staticAbilities).toContain("trample");
        state.phase = "CLEANUP";
        finalizeCleanup(state);
        expect(granted.staticAbilities).not.toContain("trample");
    });

    // A self-grant via the implicit `$source` binding — a permanent granting
    // itself an ability as part of an activated ability's effect.
    it("grants to the source permanent via the implicit $source binding", () => {
        const GRANTER_ID = "test-op-grantability-source";
        registerTokenDefinition({
            id: GRANTER_ID,
            name: GRANTER_ID,
            rarity: "common",
            manaCost: { generic: 1 },
            types: ["Creature"],
            power: 1,
            toughness: 1,
            activatedAbilities: [
                {
                    id: "self-grant",
                    oracleText:
                        "{1}: This creature gains flying until end of turn.",
                    cost: { mana: { generic: 1 } },
                    useStack: true,
                    effects: [
                        {
                            op: "grantAbility",
                            ability: "flying",
                            target: { ref: "$source" },
                            duration: { phase: "end-of-turn" },
                        },
                    ],
                },
            ],
        });
        const granter = makeInstance(GRANTER_ID, {
            id: "granter1",
            controllerId: "p1",
            ownerId: "p1",
            isSummoningSick: false,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [granter] }),
                makePlayer("p2"),
            ],
        });
        const src = state.players[0].battlefield[0];
        state.stack.push({
            ...src,
            zone: "stack",
            castById: "p1",
            abilityId: "self-grant",
            targets: [],
        });
        resolveTopOfStack(state);
        const self = state.players[0].battlefield.find(
            (c) => c.id === "granter1"
        )!;
        expect(self.staticAbilities).toContain("flying");
    });

    // A mass grant: forEach over the controller's creatures, each granted the
    // keyword via the per-iteration `{ ref: "$each" }` object binding.
    it("grants to every member of a forEach set via { ref: $each }", () => {
        const id = registerScript("test-op-grantability-foreach", [
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
                        op: "grantAbility",
                        ability: "haste",
                        target: { ref: "$each" },
                        duration: { phase: "end-of-turn" },
                    },
                ],
            },
        ]);
        const mine = ["gA", "gB"].map((cid) =>
            makeInstance(BEAR_ID, {
                id: cid,
                controllerId: "p1",
                ownerId: "p1",
            })
        );
        const theirs = makeInstance(BEAR_ID, {
            id: "tG",
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
        for (const cid of ["gA", "gB"]) {
            const c = state.players[0].battlefield.find((x) => x.id === cid)!;
            expect(c.staticAbilities).toContain("haste");
        }
        // The opponent's creature is outside the controller-scoped set.
        const other = state.players[1].battlefield.find((x) => x.id === "tG")!;
        expect(other.staticAbilities).not.toContain("haste");
    });

    it("is a no-op when the announced target is missing (CR 608.2b)", () => {
        const id = registerScript("test-op-grantability-missing", [
            {
                op: "grantAbility",
                ability: "flying",
                target: { target: 0 },
                duration: { phase: "end-of-turn" },
            },
        ]);
        const state = makeState();
        pushSpell(state, id, "p1", []);
        expect(() => resolveTopOfStack(state)).not.toThrow();
    });
});

describe("Effect Script Op: addSubtype (CR 613.1d, layer 4, issue #1194)", () => {
    // Adding a subtype to an announced target: the subtype appears in the
    // creature's `subtypes`, and — because it changes the creature's TYPE
    // LINE — must survive the projection (the client reads a permanent's
    // subtypes off the slimmed wire state).
    it("adds a subtype to an announced target and survives the projection (wire format)", () => {
        const id = registerScript("test-op-addsubtype-target", [
            { op: "addSubtype", target: { target: 0 }, subtype: "Angel" },
        ]);
        const bear = makeInstance(BEAR_ID, {
            controllerId: "p2",
            ownerId: "p2",
            id: "bearSubtype",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        pushSpell(state, id, "p1", [{ type: "permanent", id: "bearSubtype" }]);
        resolveTopOfStack(state);
        const granted = state.players[1].battlefield.find(
            (c) => c.id === "bearSubtype"
        )!;
        expect(granted.subtypes).toContain("Angel");
        expect(granted.subtypes).toContain("Bear"); // "in addition to" — printed subtype kept
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[1].battlefield.find(
            (c) => c.id === "bearSubtype"
        )!;
        expect(slim.subtypes).toContain("Angel");
        expect(slim.subtypes).toContain("Bear");
    });

    // CR 611.2c — the effect is generated by a RESOLVING ability, so it does
    // NOT depend on any source staying on the battlefield. There is no
    // "granting" permanent here at all (a synthetic script standing in for a
    // triggered ability's effect body); the subtype simply never expires.
    it("does not expire at a phase boundary (indefinite, CR 611.2c)", () => {
        const id = registerScript("test-op-addsubtype-indefinite", [
            { op: "addSubtype", target: { target: 0 }, subtype: "Angel" },
        ]);
        const bear = makeInstance(BEAR_ID, {
            controllerId: "p1",
            ownerId: "p1",
            id: "bearIndefinite",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bear] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, id, "p1", [
            { type: "permanent", id: "bearIndefinite" },
        ]);
        resolveTopOfStack(state);
        state.phase = "CLEANUP";
        finalizeCleanup(state);
        const granted = state.players[0].battlefield.find(
            (c) => c.id === "bearIndefinite"
        )!;
        expect(granted.subtypes).toContain("Angel");
    });

    // Idempotent: adding an already-present subtype does not duplicate it.
    it("is idempotent when the subtype is already present", () => {
        const id = registerScript("test-op-addsubtype-idempotent", [
            { op: "addSubtype", target: { target: 0 }, subtype: "Bear" },
        ]);
        const bear = makeInstance(BEAR_ID, {
            controllerId: "p1",
            ownerId: "p1",
            id: "bearAlready",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bear] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, id, "p1", [{ type: "permanent", id: "bearAlready" }]);
        resolveTopOfStack(state);
        const granted = state.players[0].battlefield.find(
            (c) => c.id === "bearAlready"
        )!;
        expect(granted.subtypes.filter((s) => s === "Bear").length).toBe(1);
    });

    it("is a no-op when the announced target is missing (CR 608.2b)", () => {
        const id = registerScript("test-op-addsubtype-missing", [
            { op: "addSubtype", target: { target: 0 }, subtype: "Angel" },
        ]);
        const state = makeState();
        pushSpell(state, id, "p1", []);
        expect(() => resolveTopOfStack(state)).not.toThrow();
    });
});

describe("Effect Script Op: setColor (CR 613.1e, layer 5, issue #1083)", () => {
    // Sets colorOverride on an announced target and MUST survive the
    // projection (the client renders a color-override overlay off the
    // slimmed wire state — `board-battlefield-card.tsx`'s `colorOverride`
    // read, pre-existing frontend wiring shared with the resolve()-based
    // lace cards).
    it("sets colorOverride on an announced target and survives the projection (wire format)", () => {
        const id = registerScript("test-op-setcolor-target", [
            {
                op: "setColor",
                target: { target: 0 },
                colors: ["R"],
                duration: { phase: "end-of-turn" },
            },
        ]);
        const bear = makeInstance(BEAR_ID, {
            controllerId: "p2",
            ownerId: "p2",
            id: "bearSetColor",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        pushSpell(state, id, "p1", [{ type: "permanent", id: "bearSetColor" }]);
        resolveTopOfStack(state);
        const granted = state.players[1].battlefield.find(
            (c) => c.id === "bearSetColor"
        )!;
        expect(granted.colorOverride).toEqual(["R"]);
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[1].battlefield.find(
            (c) => c.id === "bearSetColor"
        )!;
        expect(
            (slim as unknown as { colorOverride?: string[] }).colorOverride
        ).toEqual(["R"]);
    });

    // `duration` reverts the override at the declared phase boundary (CR
    // 611.2 / 514.2, issue #1065's duration-scoped setColorOverride).
    it("reverts colorOverride at the cleanup step (CR 611.2 / 514.2)", () => {
        const id = registerScript("test-op-setcolor-expire", [
            {
                op: "setColor",
                target: { target: 0 },
                colors: ["G"],
                duration: { phase: "end-of-turn" },
            },
        ]);
        const bear = makeInstance(BEAR_ID, {
            controllerId: "p1",
            ownerId: "p1",
            id: "bearSetColorExpire",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bear] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, id, "p1", [
            { type: "permanent", id: "bearSetColorExpire" },
        ]);
        resolveTopOfStack(state);
        const granted = state.players[0].battlefield.find(
            (c) => c.id === "bearSetColorExpire"
        )!;
        expect(granted.colorOverride).toEqual(["G"]);
        state.phase = "CLEANUP";
        finalizeCleanup(state);
        expect(granted.colorOverride ?? []).toEqual([]);
    });

    // A self-color-change via the implicit `$source` binding — Rainbow
    // Crow / Tidal Visionary / Metathran Transport's activated-ability shape.
    it("sets the source permanent's own color via the implicit $source binding", () => {
        const SELF_COLOR_ID = "test-op-setcolor-source";
        registerTokenDefinition({
            id: SELF_COLOR_ID,
            name: SELF_COLOR_ID,
            rarity: "common",
            manaCost: { generic: 1 },
            types: ["Creature"],
            power: 1,
            toughness: 1,
            activatedAbilities: [
                {
                    id: "self-color",
                    oracleText:
                        "{1}: This creature becomes blue until end of turn.",
                    cost: { mana: { generic: 1 } },
                    useStack: true,
                    effects: [
                        {
                            op: "setColor",
                            target: { ref: "$source" },
                            colors: ["U"],
                            duration: { phase: "end-of-turn" },
                        },
                    ],
                },
            ],
        });
        const src = makeInstance(SELF_COLOR_ID, {
            id: "selfColor1",
            controllerId: "p1",
            ownerId: "p1",
            isSummoningSick: false,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [src] }),
                makePlayer("p2"),
            ],
        });
        const inst = state.players[0].battlefield[0];
        state.stack.push({
            ...inst,
            zone: "stack",
            castById: "p1",
            abilityId: "self-color",
            targets: [],
        });
        resolveTopOfStack(state);
        const self = state.players[0].battlefield.find(
            (c) => c.id === "selfColor1"
        )!;
        expect(self.colorOverride).toEqual(["U"]);
    });

    // Sway of Illusion's shape: ONE color choice applied to EVERY member of
    // the new `forEach { set: "targets" }` selector (issue #1083) — the
    // variable-N "any number of target creatures" companion to a fixed
    // `{ target: N }` slot.
    it('applies to every member of a forEach { set: "targets" } selector', () => {
        const id = registerScript("test-op-setcolor-foreach-targets", [
            {
                op: "forEach",
                select: { set: "targets" },
                effects: [
                    {
                        op: "setColor",
                        target: { ref: "$each" },
                        colors: ["B"],
                        duration: { phase: "end-of-turn" },
                    },
                ],
            },
        ]);
        const bear1 = makeInstance(BEAR_ID, {
            controllerId: "p1",
            ownerId: "p1",
            id: "swayBear1",
        });
        const bear2 = makeInstance(BEAR_ID, {
            controllerId: "p1",
            ownerId: "p1",
            id: "swayBear2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bear1, bear2] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, id, "p1", [
            { type: "permanent", id: "swayBear1" },
            { type: "permanent", id: "swayBear2" },
        ]);
        resolveTopOfStack(state);
        expect(
            state.players[0].battlefield.find((c) => c.id === "swayBear1")!
                .colorOverride
        ).toEqual(["B"]);
        expect(
            state.players[0].battlefield.find((c) => c.id === "swayBear2")!
                .colorOverride
        ).toEqual(["B"]);
    });

    // "Any number" declined down to zero (Sway of Illusion's "you may cast
    // this and choose to target zero creatures") — the forEach set is empty
    // and the Op runs zero iterations without error.
    it('is a no-op over an empty forEach { set: "targets" } (any-number decline)', () => {
        const id = registerScript("test-op-setcolor-foreach-targets-empty", [
            {
                op: "forEach",
                select: { set: "targets" },
                effects: [
                    {
                        op: "setColor",
                        target: { ref: "$each" },
                        colors: ["B"],
                        duration: { phase: "end-of-turn" },
                    },
                ],
            },
        ]);
        const state = makeState();
        pushSpell(state, id, "p1", []);
        expect(() => resolveTopOfStack(state)).not.toThrow();
    });

    it("is a no-op when the announced target is missing (CR 608.2b)", () => {
        const id = registerScript("test-op-setcolor-missing", [
            {
                op: "setColor",
                target: { target: 0 },
                colors: ["W"],
                duration: { phase: "end-of-turn" },
            },
        ]);
        const state = makeState();
        pushSpell(state, id, "p1", []);
        expect(() => resolveTopOfStack(state)).not.toThrow();
    });
});

describe("Effect Script Op: setSubtype (CR 305.7, layer 4, issue #1083)", () => {
    // Replaces a target land's subtypes for a duration — Dream Thrush's
    // "target land becomes the basic land type of your choice until end of
    // turn". Wire format matters — the client reads a land's mana-producing
    // subtype off the slimmed wire state.
    it("replaces a target land's subtypes and survives the projection (wire format)", () => {
        const id = registerScript("test-op-setsubtype-target", [
            {
                op: "setSubtype",
                target: { target: 0 },
                subtypes: ["Island"],
                duration: { phase: "end-of-turn" },
            },
        ]);
        const swamp = makeInstance(SWAMP_ID, {
            controllerId: "p2",
            ownerId: "p2",
            id: "swampSetSubtype",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [swamp] }),
            ],
        });
        pushSpell(state, id, "p1", [
            { type: "permanent", id: "swampSetSubtype" },
        ]);
        resolveTopOfStack(state);
        const changed = state.players[1].battlefield.find(
            (c) => c.id === "swampSetSubtype"
        )!;
        expect(changed.subtypes).toEqual(["Island"]);
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[1].battlefield.find(
            (c) => c.id === "swampSetSubtype"
        )!;
        expect(slim.subtypes).toEqual(["Island"]);
    });

    // `duration` reverts to the captured printed subtypes at the phase
    // boundary (CR 305.7 / 611.2 — mirrors `setSubtypesUntil`'s own
    // Orcish Farmer / Slimy Kavu behavior).
    it("reverts to the printed subtypes at the cleanup step (CR 305.7 / 611.2)", () => {
        const id = registerScript("test-op-setsubtype-expire", [
            {
                op: "setSubtype",
                target: { target: 0 },
                subtypes: ["Forest"],
                duration: { phase: "end-of-turn" },
            },
        ]);
        const swamp = makeInstance(SWAMP_ID, {
            controllerId: "p1",
            ownerId: "p1",
            id: "swampSetSubtypeExpire",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [swamp] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, id, "p1", [
            { type: "permanent", id: "swampSetSubtypeExpire" },
        ]);
        resolveTopOfStack(state);
        const changed = state.players[0].battlefield.find(
            (c) => c.id === "swampSetSubtypeExpire"
        )!;
        expect(changed.subtypes).toEqual(["Forest"]);
        state.phase = "CLEANUP";
        finalizeCleanup(state);
        expect(changed.subtypes).toEqual(["Swamp"]);
    });

    it("is a no-op when the announced target is missing (CR 608.2b)", () => {
        const id = registerScript("test-op-setsubtype-missing", [
            {
                op: "setSubtype",
                target: { target: 0 },
                subtypes: ["Island"],
                duration: { phase: "end-of-turn" },
            },
        ]);
        const state = makeState();
        pushSpell(state, id, "p1", []);
        expect(() => resolveTopOfStack(state)).not.toThrow();
    });
});

describe("EffectCardFilter.manaValueEquals (issue #1083)", () => {
    // Metathran Aerostat's "a creature card with mana value X from your
    // hand" — the DYNAMIC exact match, resolved via `ctx.getX()` at
    // resolution (the same `resolveValue` path `manaValueAtMost` uses).
    // Mirrors the pre-existing `manaValueAtMost: { X: true }` test above.
    it("filters a hand-card choice to cards with mana value EXACTLY X (dynamic)", () => {
        const CREATURE_MV3_ID = "test-effects-mv-equals-creature3";
        registerTokenDefinition({
            id: CREATURE_MV3_ID,
            name: CREATURE_MV3_ID,
            rarity: "common",
            manaCost: { X: 3 },
            types: ["Creature"],
        });
        const CREATURE_MV2_ID = "test-effects-mv-equals-creature2";
        registerTokenDefinition({
            id: CREATURE_MV2_ID,
            name: CREATURE_MV2_ID,
            rarity: "common",
            manaCost: { X: 2 },
            types: ["Creature"],
        });
        const id = registerScript("test-op-choice-manavalue-equals", [
            {
                op: "choice",
                kind: "choose-hand-card",
                player: "controller",
                zone: "hand",
                filter: { type: "Creature", manaValueEquals: { X: true } },
                count: { min: 0, max: 1 },
                prompt: "Put a creature card with mana value X onto the battlefield.",
                bind: "$picked",
            },
            {
                op: "moveZone",
                cards: { ref: "$picked" },
                player: "controller",
                from: "hand",
                to: "battlefield",
            },
        ]);
        const match = makeInstance(CREATURE_MV3_ID, {
            id: "mvEqualsMatch",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const nonMatch = makeInstance(CREATURE_MV2_ID, {
            id: "mvEqualsNonMatch",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { hand: [match, nonMatch] }),
                makePlayer("p2"),
            ],
        });
        const item = pushSpell(state, id, "p1");
        item.chosenX = 3;
        resolveTopOfStack(state);
        // A mana value of 2 does NOT satisfy "exactly 3" — unlike
        // `manaValueAtMost`, the ceiling variant, only the exact match
        // candidate is offered.
        expect(state.pendingChoices![0].candidateIds).toEqual([
            "mvEqualsMatch",
        ]);
    });

    it("filters candidates to an exact FIXED mana value (non-dynamic)", () => {
        const id = registerScript("test-op-choice-manavalue-equals-fixed", [
            {
                op: "choice",
                kind: "choose-hand-card",
                player: "controller",
                zone: "hand",
                filter: { manaValueEquals: 2 },
                count: { min: 0, max: 1 },
                prompt: "Choose a card with mana value exactly 2.",
                bind: "$picked",
            },
        ]);
        const mv2 = makeInstance(BEAR_ID, {
            id: "mvEqualsFixedBear",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const state = makeState({
            players: [makePlayer("p1", { hand: [mv2] }), makePlayer("p2")],
        });
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        expect(state.pendingChoices![0].candidateIds).toEqual([
            "mvEqualsFixedBear",
        ]);
    });
});

describe("Effect Script Op: animate (CR 208.2 / 611.1, issue #1317)", () => {
    // A LAND (not the BEAR_ID creature fixture) becomes a creature — the
    // canonical Earthbend N shape (Badgermole Cub, tla/green.ts): base 0/0,
    // subtype "Elemental", haste granted, no `duration` (CR 611.2b —
    // indefinite). Effective P/T is asserted AFTER a follow-up `counters` Op
    // (issue #841, already-exercised) puts a +1/+1 counter on it, mirroring
    // the real card's two-Op composition and proving the layer 7c counter
    // contribution stacks on the animate Op's base 7a P/T (CR 613.4).
    it("turns a land into a 0/0-plus-counter creature with haste, still a land, indefinitely — and survives the projection (wire format)", () => {
        const id = registerScript("test-op-animate-earthbend", [
            {
                op: "animate",
                target: { target: 0 },
                power: 0,
                toughness: 0,
                subtype: "Elemental",
                grantedAbilities: ["haste"],
            },
            {
                op: "counters",
                action: "add",
                counter: "+1/+1",
                count: 1,
                target: { target: 0 },
            },
        ]);
        const land = makeInstance(BEAR_ID, {
            id: "earthbentLand",
            controllerId: "p1",
            ownerId: "p1",
            types: ["Land"],
            subtypes: ["Forest"],
            power: undefined,
            toughness: undefined,
            staticAbilities: [],
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [land] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, id, "p1", [
            { type: "permanent", id: "earthbentLand" },
        ]);
        resolveTopOfStack(state);
        const animated = state.players[0].battlefield.find(
            (c) => c.id === "earthbentLand"
        )!;
        // CR 208.2 — "still a land": Creature is ADDED, Land is kept.
        expect(animated.types).toContain("Creature");
        expect(animated.types).toContain("Land");
        expect(animated.subtypes).toContain("Elemental");
        expect(animated.subtypes).toContain("Forest"); // printed subtype kept
        expect(animated.staticAbilities).toContain("haste");
        expect(animated.counters?.["+1/+1"]).toBe(1);
        // 7a base (0/0) + 7c counter (+1/+1) = 1/1 (CR 613.4).
        expect(getEffectivePower(state, animated)).toBe(1);
        expect(getEffectiveToughness(state, animated)).toBe(1);

        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "earthbentLand"
        )!;
        expect(slim.types).toContain("Creature");
        expect(slim.types).toContain("Land");
        expect(slim.subtypes).toContain("Elemental");
        expect(slim.staticAbilities).toContain("haste");
        expect(getEffectivePower(projected, slim)).toBe(1);
        expect(getEffectiveToughness(projected, slim)).toBe(1);
    });

    // CR 611.2b — no `duration` means the animation is INDEFINITE: it must
    // NOT revert at a CLEANUP phase boundary, unlike a Mishra's-Factory-style
    // temporary animation.
    it("does not revert at a phase boundary when duration is omitted (indefinite, CR 611.2b)", () => {
        const id = registerScript("test-op-animate-indefinite", [
            { op: "animate", target: { target: 0 }, power: 0, toughness: 0 },
        ]);
        const land = makeInstance(BEAR_ID, {
            id: "earthbentIndefinite",
            controllerId: "p1",
            ownerId: "p1",
            types: ["Land"],
            subtypes: [],
            power: undefined,
            toughness: undefined,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [land] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, id, "p1", [
            { type: "permanent", id: "earthbentIndefinite" },
        ]);
        // Put a +1/+1 counter directly (bypassing the script) so a 0/0 base
        // doesn't die to the toughness-0 SBA before CLEANUP is reached.
        resolveTopOfStack(state);
        const before = state.players[0].battlefield.find(
            (c) => c.id === "earthbentIndefinite"
        )!;
        before.counters = { "+1/+1": 1 };
        state.phase = "CLEANUP";
        finalizeCleanup(state);
        const after = state.players[0].battlefield.find(
            (c) => c.id === "earthbentIndefinite"
        )!;
        expect(after.types).toContain("Creature");
        expect(after.animation).toBeDefined();
    });

    it("is a no-op when the announced target is missing (CR 608.2b)", () => {
        const id = registerScript("test-op-animate-missing", [
            { op: "animate", target: { target: 0 }, power: 0, toughness: 0 },
        ]);
        const state = makeState();
        pushSpell(state, id, "p1", []);
        expect(() => resolveTopOfStack(state)).not.toThrow();
    });
});

describe("Effect Script Op: libraryLook (CR 701.20, issue #844)", () => {
    // A library of N distinct-id cards, each carrying persistent knowledge so a
    // shuffle's knowledge-clearing (ADR 0026) is observable — that clearing is
    // the deterministic proof the shuffle primitive ran (a no-op would leave it).
    const withKnownLibrary = (owner: "p1" | "p2", n: number) =>
        Array.from({ length: n }, (_, i) =>
            makeInstance(BEAR_ID, {
                id: `lib-${owner}-${i}`,
                controllerId: owner,
                ownerId: owner,
                zone: "library",
                knownTo: [owner],
            })
        );

    // The controller's library is shuffled: the multiset of cards is preserved
    // (CR 701.20 randomizes order, never adds/removes), the order is permuted
    // (rngSeed is fixed at 0, so the permutation is deterministic), and every
    // card's persistent knowledge is cleared (ADR 0026 — an unwitnessed reorder).
    it("shuffles the controller's library — multiset preserved, order permuted, knowledge cleared", () => {
        const id = registerScript("test-op-librarylook-controller", [
            { op: "libraryLook", action: "shuffle", player: "controller" },
        ]);
        const lib = withKnownLibrary("p1", 8);
        const before = lib.map((c) => c.id);
        const state = makeState({
            players: [makePlayer("p1", { library: lib }), makePlayer("p2")],
        });
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        const after = state.players[0].library.map((c) => c.id);
        // Same cards (multiset), none lost or gained.
        expect([...after].sort()).toEqual([...before].sort());
        // Reordered (deterministic under the fixed rngSeed).
        expect(after).not.toEqual(before);
        // Knowledge cleared — the proof the shuffle actually ran (CR 701.20 /
        // ADR 0026).
        for (const c of state.players[0].library) {
            expect(c.knownTo ?? []).toEqual([]);
        }
    });

    // The player is an announced target slot ("target player shuffles their
    // library"): the referenced player's library is the one randomized.
    it("shuffles an announced target player's library", () => {
        const id = registerScript(
            "test-op-librarylook-target",
            [{ op: "libraryLook", action: "shuffle", player: { target: 0 } }],
            { targetRequirement: { type: "player", count: 1 } }
        );
        const lib = withKnownLibrary("p2", 8);
        const before = lib.map((c) => c.id);
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2", { library: lib })],
        });
        pushSpell(state, id, "p1", [{ type: "player", id: "p2" }]);
        resolveTopOfStack(state);
        const after = state.players[1].library.map((c) => c.id);
        expect([...after].sort()).toEqual([...before].sort());
        expect(after).not.toEqual(before);
    });

    // forEach over players → per-player shuffle (`{ ref: "$each" }` player ref):
    // BOTH libraries are randomized in one script (Timetwister's "each player
    // shuffles their library" shape).
    it("shuffles every player's library via a forEach $each player ref", () => {
        const id = registerScript("test-op-librarylook-foreach", [
            {
                op: "forEach",
                select: { set: "players" },
                effects: [
                    {
                        op: "libraryLook",
                        action: "shuffle",
                        player: { ref: "$each" },
                    },
                ],
            },
        ]);
        const lib1 = withKnownLibrary("p1", 8);
        const lib2 = withKnownLibrary("p2", 8);
        const before1 = lib1.map((c) => c.id);
        const before2 = lib2.map((c) => c.id);
        const state = makeState({
            players: [
                makePlayer("p1", { library: lib1 }),
                makePlayer("p2", { library: lib2 }),
            ],
        });
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        const after1 = state.players[0].library.map((c) => c.id);
        const after2 = state.players[1].library.map((c) => c.id);
        expect([...after1].sort()).toEqual([...before1].sort());
        expect([...after2].sort()).toEqual([...before2].sort());
        expect(after1).not.toEqual(before1);
        expect(after2).not.toEqual(before2);
    });

    // CR 608.2b — a non-player announced target (a permanent) resolves to no
    // player, so the Op is skipped without throwing and no library changes.
    it("is skipped when the announced target is not a player (CR 608.2b)", () => {
        const id = registerScript("test-op-librarylook-nonplayer", [
            { op: "libraryLook", action: "shuffle", player: { target: 0 } },
        ]);
        const bear = makeInstance(BEAR_ID, {
            controllerId: "p2",
            ownerId: "p2",
            id: "bearLL",
        });
        const lib = withKnownLibrary("p1", 4);
        const before = lib.map((c) => c.id);
        const state = makeState({
            players: [
                makePlayer("p1", { library: lib }),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        pushSpell(state, id, "p1", [{ type: "permanent", id: "bearLL" }]);
        expect(() => resolveTopOfStack(state)).not.toThrow();
        // Nothing shuffled — order and knowledge untouched.
        expect(state.players[0].library.map((c) => c.id)).toEqual(before);
    });

    // Wire format (GRE testing convention): the library is projected to the
    // controller as a full ordered list and to the opponent as `{ count }`
    // (hidden). A shuffle preserves the count on both sides — it never leaks the
    // opponent's order and never changes the card total.
    it("the shuffled library survives projection with its count intact (wire format)", () => {
        const id = registerScript("test-op-librarylook-wire", [
            { op: "libraryLook", action: "shuffle", player: "controller" },
        ]);
        const lib = withKnownLibrary("p1", 8);
        const state = makeState({
            players: [makePlayer("p1", { library: lib }), makePlayer("p2")],
        });
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        // Owner's view: full library, count preserved.
        const own = projectPublicState(state, 1, "p1");
        const ownLib = own.players[0].library as unknown as { count: number };
        expect(ownLib.count).toBe(8);
        // Opponent's view: the same library is a hidden `{ count }`, still 8.
        const opp = projectPublicState(state, 1, "p2");
        const oppLib = opp.players[0].library as unknown as { count: number };
        expect(oppLib.count).toBe(8);
    });
});

describe("Effect Script Op: shuffleSelfIntoLibrary (CR 608.2 / 701.24, issue #898)", () => {
    // The resolving spell shuffles ITSELF into its owner's library instead of
    // the graveyard (Green Sun's Zenith). Proof of the redirect: the card is
    // NOT in the graveyard, IS in the library (multiset +1), and the library
    // was actually shuffled (knowledge cleared — same proof `libraryLook`
    // uses, ADR 0026).
    it("shuffles the resolving spell into its owner's library instead of the graveyard", () => {
        const id = registerScript("test-op-shuffleself", [
            { op: "shuffleSelfIntoLibrary" },
        ]);
        const lib = Array.from({ length: 6 }, (_, i) =>
            makeInstance(BEAR_ID, {
                id: `shuffleself-lib-${i}`,
                controllerId: "p1",
                ownerId: "p1",
                zone: "library",
                knownTo: ["p1"],
            })
        );
        const state = makeState({
            players: [makePlayer("p1", { library: lib }), makePlayer("p2")],
        });
        const item = pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        // Not in the graveyard (the normal CR 608.2m destination is skipped).
        expect(state.players[0].graveyard.find((c) => c.id === item.id)).toBe(
            undefined
        );
        // In the library — multiset grew by exactly the resolved card.
        expect(state.players[0].library.length).toBe(7);
        const self = state.players[0].library.find((c) => c.id === item.id);
        expect(self).toBeDefined();
        // The shuffle actually ran: every OTHER card's persistent knowledge
        // was cleared too (ADR 0026 — an unwitnessed reorder), same proof
        // `libraryLook`'s test uses.
        for (const c of state.players[0].library) {
            expect(c.knownTo ?? []).toEqual([]);
        }
    });

    // A copy of the spell (CR 707.10) ceases to exist on resolution instead of
    // being shuffled anywhere — mirrors `exileSelf`'s copy no-op exactly.
    it("does not shuffle a COPY of the spell into the library (CR 707.10 — a copy ceases to exist)", () => {
        const id = registerScript("test-op-shuffleself-copy", [
            { op: "shuffleSelfIntoLibrary" },
        ]);
        const state = makeState();
        const item = pushSpell(state, id, "p1");
        item.isCopy = true;
        const before = state.players[0].library.length;
        resolveTopOfStack(state);
        expect(state.players[0].library.length).toBe(before);
        expect(
            state.players[0].graveyard.find((c) => c.id === item.id)
        ).toBeUndefined();
    });

    // Wire format (mandatory for a new Op, `.claude/rules/gre-development.md`):
    // the library's projected `{ count }` reflects the redirected card on
    // both the owner's and the opponent's view.
    it("the self-shuffled library survives projection with its grown count (wire format)", () => {
        const id = registerScript("test-op-shuffleself-wire", [
            { op: "shuffleSelfIntoLibrary" },
        ]);
        const lib = Array.from({ length: 4 }, (_, i) =>
            makeInstance(BEAR_ID, {
                id: `shuffleself-wire-lib-${i}`,
                controllerId: "p1",
                ownerId: "p1",
                zone: "library",
            })
        );
        const state = makeState({
            players: [makePlayer("p1", { library: lib }), makePlayer("p2")],
        });
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        const own = projectPublicState(state, 1, "p1");
        const ownLib = own.players[0].library as unknown as { count: number };
        expect(ownLib.count).toBe(5);
        const opp = projectPublicState(state, 1, "p2");
        const oppLib = opp.players[0].library as unknown as { count: number };
        expect(oppLib.count).toBe(5);
    });
});

describe("Effect Script Op: preventDamage (CR 615, issue #845)", () => {
    // "next-n" on an announced creature target, exercised end-to-end: the Op
    // registers a shield of 3, then a same-resolution dealDamage of 5 to the
    // same creature is absorbed down to 2 marked (CR 615.1, consumed per event).
    it("next-n: shields the announced creature so incoming damage is absorbed", () => {
        const id = registerScript("test-op-prevent-creature", [
            {
                op: "preventDamage",
                mode: "next-n",
                to: { target: 0 },
                amount: 3,
                duration: { phase: "end-of-turn" },
            },
            { op: "dealDamage", amount: 5, to: { target: 0 } },
        ]);
        const bear = makeInstance(BEAR_ID, { controllerId: "p2", id: "pdb1" });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        pushSpell(state, id, "p1", [{ type: "permanent", id: "pdb1" }]);
        resolveTopOfStack(state);
        // 5 damage − 3 prevented = 2 marked (CR 615.1); the shield is spent.
        expect(state.players[1].battlefield[0].damageMarked).toBe(2);
        expect(state.targetPreventionShields ?? []).toEqual([]);
    });

    // "next-n" on a relative player (`{ player: … }`), end-to-end: the shield on
    // the opponent absorbs 2 of an incoming 3, so they lose only 1 life.
    it("next-n: shields a relative player so incoming damage is reduced", () => {
        const id = registerScript("test-op-prevent-player", [
            {
                op: "preventDamage",
                mode: "next-n",
                to: { player: "opponent" },
                amount: 2,
                duration: { phase: "end-of-turn" },
            },
            { op: "dealDamage", amount: 3, to: { player: "opponent" } },
        ]);
        const state = makeState();
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        // 3 damage − 2 prevented = 1 lost → 20 − 1 = 19.
        expect(state.players[1].life).toBe(19);
    });

    // "next-n" via the implicit `$source` binding — a permanent shielding itself
    // from its activated ability (Rock Hydra / Balduvian Hydra / Rasputin).
    it("next-n: shields the source permanent via the implicit $source binding", () => {
        const SHIELDER_ID = "test-op-prevent-source";
        registerTokenDefinition({
            id: SHIELDER_ID,
            name: SHIELDER_ID,
            rarity: "common",
            manaCost: { generic: 1 },
            types: ["Artifact"],
            activatedAbilities: [
                {
                    id: "self-shield",
                    oracleText: "{1}: Prevent the next 1 damage to this.",
                    cost: { mana: { generic: 1 } },
                    useStack: true,
                    effects: [
                        {
                            op: "preventDamage",
                            mode: "next-n",
                            to: { ref: "$source" },
                            amount: 1,
                            duration: { phase: "end-of-turn" },
                        },
                    ],
                },
            ],
        });
        const src = makeInstance(SHIELDER_ID, {
            id: "shielder1",
            controllerId: "p1",
            ownerId: "p1",
            isSummoningSick: false,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [src] }),
                makePlayer("p2"),
            ],
        });
        state.stack.push({
            ...state.players[0].battlefield[0],
            zone: "stack",
            castById: "p1",
            abilityId: "self-shield",
            targets: [],
        });
        resolveTopOfStack(state);
        // A one-charge shield on the source is registered (CR 615.1).
        expect(state.targetPreventionShields).toEqual([
            {
                targetType: "permanent",
                targetId: "shielder1",
                remaining: 1,
                duration: { phase: "end-of-turn" },
            },
        ]);
    });

    // "all-combat" — the turn-scoped global Fog flag (CR 615, Fog / Darkness /
    // Holy Day). No target, no duration; cleared at CLEANUP.
    it("all-combat: sets the turn-scoped combat-damage prevention flag", () => {
        const id = registerScript("test-op-prevent-allcombat", [
            { op: "preventDamage", mode: "all-combat" },
        ]);
        const state = makeState();
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        expect(state.preventAllCombatDamageThisTurn).toBe(true);
    });

    // "combat-to-and-by" — a per-instance two-way combat shield on the announced
    // target (CR 615, Maze of Ith / Ebony Horse / Elvish Scout / Goblin Snowman).
    it("combat-to-and-by: registers a two-way combat shield on the target", () => {
        const id = registerScript("test-op-prevent-toandby", [
            {
                op: "preventDamage",
                mode: "combat-to-and-by",
                target: { target: 0 },
                duration: { phase: "end-of-turn" },
            },
        ]);
        const bear = makeInstance(BEAR_ID, { controllerId: "p2", id: "pdc1" });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        pushSpell(state, id, "p1", [{ type: "permanent", id: "pdc1" }]);
        resolveTopOfStack(state);
        expect(state.combatDamageImmunity).toEqual([
            { instanceId: "pdc1", duration: { phase: "end-of-turn" } },
        ]);
    });

    // CR 608.2b — an announced target that is missing at resolution resolves to
    // no object, so the Op is skipped without throwing and no shield is armed.
    it("next-n is skipped when the announced target is missing (CR 608.2b)", () => {
        const id = registerScript("test-op-prevent-missing", [
            {
                op: "preventDamage",
                mode: "next-n",
                to: { target: 0 },
                amount: 1,
                duration: { phase: "end-of-turn" },
            },
        ]);
        const state = makeState();
        pushSpell(state, id, "p1", []);
        expect(() => resolveTopOfStack(state)).not.toThrow();
        expect(state.targetPreventionShields).toBeUndefined();
    });

    // Wire format (GRE testing convention): the shield's observable outcome —
    // the reduced damage marked on the creature — must survive the projection to
    // PublicGameState (the projection strips fat fields; the marked-damage read
    // must still hold on the slim card the client sees).
    it("the absorbed damage marked on the creature survives projection (wire format)", () => {
        const id = registerScript("test-op-prevent-wire", [
            {
                op: "preventDamage",
                mode: "next-n",
                to: { target: 0 },
                amount: 3,
                duration: { phase: "end-of-turn" },
            },
            { op: "dealDamage", amount: 5, to: { target: 0 } },
        ]);
        const bear = makeInstance(BEAR_ID, { controllerId: "p2", id: "pdw1" });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        pushSpell(state, id, "p1", [{ type: "permanent", id: "pdw1" }]);
        resolveTopOfStack(state);
        expect(state.players[1].battlefield[0].damageMarked).toBe(2);
        // Same value on the projected (slim) card the client receives.
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[1].battlefield.find(
            (c) => c.id === "pdw1"
        )!;
        expect(slim.damageMarked).toBe(2);
    });
});

describe("Effect Script Op: regenerate (CR 701.15, issue #846)", () => {
    // Announced-target regenerate (Death Ward / Niall Silvain): the Op stacks a
    // single regeneration shield on the announced creature (CR 701.15a).
    it("stacks a regeneration shield on the announced creature target", () => {
        const id = registerScript("test-op-regen-target", [
            { op: "regenerate", target: { target: 0 } },
        ]);
        const bear = makeInstance(BEAR_ID, { controllerId: "p2", id: "rg1" });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        pushSpell(state, id, "p1", [{ type: "permanent", id: "rg1" }]);
        resolveTopOfStack(state);
        expect(state.players[1].battlefield[0].regenerationShields).toBe(1);
    });

    // End-to-end shield consumption (CR 614.5 / 701.15a): the shield replaces
    // the next destroy with "heal marked damage, tap, remove from combat", so
    // the shielded creature SURVIVES the destroy and the shield is spent.
    it("the shield replaces the next destroy — the creature survives, is tapped, damage healed", () => {
        const id = registerScript("test-op-regen-consume", [
            { op: "regenerate", target: { target: 0 } },
            { op: "destroy", target: { target: 0 } },
        ]);
        const bear = makeInstance(BEAR_ID, {
            controllerId: "p2",
            id: "rg2",
            damageMarked: 2,
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        pushSpell(state, id, "p1", [{ type: "permanent", id: "rg2" }]);
        resolveTopOfStack(state);
        // Destroy replaced by the regen rider — the creature is still on the
        // battlefield (CR 701.15a).
        const survivor = state.players[1].battlefield.find(
            (c) => c.id === "rg2"
        );
        expect(survivor).toBeDefined();
        expect(survivor!.isTapped).toBe(true);
        expect(survivor!.damageMarked).toBeUndefined();
        // The single shield was spent (CR 614.5).
        expect(survivor!.regenerationShields).toBeUndefined();
    });

    // Self-regenerate via the implicit `$source` binding — a permanent shielding
    // itself from its own activated ability (Drudge Skeletons / Sedge Troll /
    // Clay Statue "{cost}: Regenerate this creature").
    it("shields the source permanent via the implicit $source binding", () => {
        const SHIELDER_ID = "test-op-regen-source";
        registerTokenDefinition({
            id: SHIELDER_ID,
            name: SHIELDER_ID,
            rarity: "common",
            manaCost: { B: 1 },
            types: ["Creature"],
            subtypes: ["Skeleton"],
            power: 1,
            toughness: 1,
            activatedAbilities: [
                {
                    id: "self-regen",
                    oracleText: "{B}: Regenerate this creature.",
                    cost: { mana: { B: 1 } },
                    useStack: true,
                    effects: [{ op: "regenerate", target: { ref: "$source" } }],
                },
            ],
        });
        const src = makeInstance(SHIELDER_ID, {
            id: "regenSrc1",
            controllerId: "p1",
            ownerId: "p1",
            isSummoningSick: false,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [src] }),
                makePlayer("p2"),
            ],
        });
        state.stack.push({
            ...state.players[0].battlefield[0],
            zone: "stack",
            castById: "p1",
            abilityId: "self-regen",
            targets: [],
        });
        resolveTopOfStack(state);
        expect(state.players[0].battlefield[0].regenerationShields).toBe(1);
    });

    // CR 608.2b — an announced target missing at resolution resolves to no
    // object, so the Op is skipped without throwing and no shield is armed.
    it("is skipped when the announced target is missing (CR 608.2b)", () => {
        const id = registerScript("test-op-regen-missing", [
            { op: "regenerate", target: { target: 0 } },
        ]);
        const state = makeState();
        pushSpell(state, id, "p1", []);
        expect(() => resolveTopOfStack(state)).not.toThrow();
    });

    // Wire format (GRE testing convention): the shield's observable outcome —
    // the regenerated creature surviving a destroy — must survive the projection
    // to PublicGameState (the projection strips fat fields; the survivor and its
    // tapped state must still read on the slim card the client sees).
    it("the regenerated survivor survives projection (wire format)", () => {
        const id = registerScript("test-op-regen-wire", [
            { op: "regenerate", target: { target: 0 } },
            { op: "destroy", target: { target: 0 } },
        ]);
        const bear = makeInstance(BEAR_ID, { controllerId: "p2", id: "rgw1" });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        pushSpell(state, id, "p1", [{ type: "permanent", id: "rgw1" }]);
        resolveTopOfStack(state);
        expect(
            state.players[1].battlefield.find((c) => c.id === "rgw1")
        ).toBeDefined();
        // Same survivor on the projected (slim) state the client receives.
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[1].battlefield.find(
            (c) => c.id === "rgw1"
        );
        expect(slim).toBeDefined();
        expect(slim!.isTapped).toBe(true);
    });
});

describe("Effect Script Op: createToken (CR 111 / 701.7, issue #847)", () => {
    const waspSpec = (): EffectOp => ({
        op: "createToken",
        token: {
            name: "Wasp",
            types: ["Artifact", "Creature"],
            subtypes: ["Insect"],
            power: 1,
            toughness: 1,
            staticAbilities: ["flying"],
        },
        controller: "controller",
    });

    // The Hive / Master of the Hunt shape: a spec-driven token creation puts a
    // brand-new permanent on the controller's battlefield (CR 111 / 707.1).
    it("creates one token on the controller's battlefield (default count 1)", () => {
        const id = registerScript("test-op-token-one", [waspSpec()]);
        const state = makeState();
        pushSpell(state, id, "p1", []);
        resolveTopOfStack(state);
        const tokens = state.players[0].battlefield.filter((c) => c.isToken);
        expect(tokens).toHaveLength(1);
        const wasp = tokens[0];
        expect(wasp.power).toBe(1);
        expect(wasp.toughness).toBe(1);
        expect(wasp.types).toEqual(["Artifact", "Creature"]);
        expect(wasp.subtypes).toContain("Insect");
        expect(wasp.staticAbilities).toContain("flying");
        // CR 111.5 — a freshly created creature token has summoning sickness.
        expect(wasp.isSummoningSick).toBe(true);
    });

    // Icatian Town / Goblin Warrens shape: a literal `count` creates that many
    // identical tokens in one Op (CR 707.1 — "create N tokens").
    it("creates `count` tokens when a literal count is given", () => {
        const id = registerScript("test-op-token-count", [
            {
                op: "createToken",
                token: {
                    name: "Citizen",
                    types: ["Creature"],
                    subtypes: ["Citizen"],
                    power: 1,
                    toughness: 1,
                    colors: ["W"],
                },
                controller: "controller",
                count: 4,
            },
        ]);
        const state = makeState();
        pushSpell(state, id, "p1", []);
        resolveTopOfStack(state);
        expect(
            state.players[0].battlefield.filter((c) => c.isToken)
        ).toHaveLength(4);
    });

    // The `controller` player ref routes the tokens: "opponent" hands them to
    // the other seat (CR 111.2 — the token's controller is who the effect says).
    it("routes tokens to a relative player (opponent)", () => {
        const id = registerScript("test-op-token-opponent", [
            {
                op: "createToken",
                token: {
                    name: "Goblin",
                    types: ["Creature"],
                    subtypes: ["Goblin"],
                    power: 1,
                    toughness: 1,
                    colors: ["R"],
                },
                controller: "opponent",
                count: 2,
            },
        ]);
        const state = makeState();
        pushSpell(state, id, "p1", []);
        resolveTopOfStack(state);
        expect(
            state.players[0].battlefield.filter((c) => c.isToken)
        ).toHaveLength(0);
        expect(
            state.players[1].battlefield.filter((c) => c.isToken)
        ).toHaveLength(2);
    });

    // Ability site (Boris Devilboon / The Hive): the Op works identically when
    // driven from an activated ability's `effects[]` — same interpreter path.
    it("creates a token from an activated ability's effects[]", () => {
        const MAKER_ID = "test-op-token-maker";
        registerTokenDefinition({
            id: MAKER_ID,
            name: MAKER_ID,
            rarity: "common",
            manaCost: { X: 1 },
            types: ["Artifact"],
            activatedAbilities: [
                {
                    id: "make-wasp",
                    oracleText: "{T}: Create a Wasp.",
                    cost: { tap: true },
                    useStack: true,
                    effects: [waspSpec()],
                },
            ],
        });
        const src = makeInstance(MAKER_ID, {
            id: "maker1",
            controllerId: "p1",
            ownerId: "p1",
            isSummoningSick: false,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [src] }),
                makePlayer("p2"),
            ],
        });
        state.stack.push({
            ...state.players[0].battlefield[0],
            zone: "stack",
            castById: "p1",
            abilityId: "make-wasp",
            targets: [],
        });
        resolveTopOfStack(state);
        expect(
            state.players[0].battlefield.filter((c) => c.isToken)
        ).toHaveLength(1);
    });

    // Wire format (GRE testing convention): the created token — its identity is
    // a synthesized definition, its characteristics live on the instance — must
    // survive projection to PublicGameState so the client renders it (the
    // projection strips card.card to { id } but keeps instance P/T, types and
    // keyword abilities).
    it("the created token projects correctly to the client view (wire format)", () => {
        const id = registerScript("test-op-token-wire", [waspSpec()]);
        const state = makeState();
        pushSpell(state, id, "p1", []);
        resolveTopOfStack(state);
        const token = state.players[0].battlefield.find((c) => c.isToken)!;
        expect(token).toBeDefined();

        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === token.id
        )!;
        expect(slim).toBeDefined();
        expect(slim.isToken).toBe(true);
        expect(slim.power).toBe(1);
        expect(slim.toughness).toBe(1);
        expect(slim.types).toEqual(["Artifact", "Creature"]);
        expect(slim.staticAbilities).toContain("flying");
    });
});

// CR 707.2 (issue #1191) — a `createToken` token spec may carry token-scoped
// `activatedAbilities[]` (Investigate's Clue: "{2}, Sacrifice this token:
// Draw a card."). New capability of the EXISTING `createToken` Op, not a new
// Op — see `convex/cards/abilities/tokens/clueToken.ts` for the shared spec
// Tireless Tracker (soi/green.ts) uses.
describe("Effect Script Op: createToken with token.activatedAbilities (CR 707.2, issue #1191)", () => {
    const clueSpec = (): EffectOp => ({
        op: "createToken",
        token: {
            name: "Clue",
            types: ["Artifact"],
            subtypes: ["Clue"],
            activatedAbilities: [
                {
                    id: "sacrifice-draw",
                    oracleText: "{2}, Sacrifice this token: Draw a card.",
                    cost: { mana: { generic: 2 }, sacrifice: true },
                    useStack: true,
                    effects: [{ op: "draw", player: "controller", count: 1 }],
                },
            ],
        },
        controller: "controller",
    });

    it("creates a token whose synthesized CardDefinition carries the activated ability", () => {
        const id = registerScript("test-op-token-clue", [clueSpec()]);
        const state = makeState();
        pushSpell(state, id, "p1", []);
        resolveTopOfStack(state);
        const clue = state.players[0].battlefield.find((c) => c.isToken)!;
        expect(clue).toBeDefined();
        expect(clue.types).toEqual(["Artifact"]);
        expect(clue.subtypes).toContain("Clue");
        const def = getDefinition((clue.card as { id: string }).id);
        expect(def.activatedAbilities).toHaveLength(1);
        expect(def.activatedAbilities![0]).toMatchObject({
            id: "sacrifice-draw",
            oracleText: "{2}, Sacrifice this token: Draw a card.",
            cost: { mana: { generic: 2 }, sacrifice: true },
            useStack: true,
        });
    });

    // The ability's own `effects[]` resolves through the SAME interpreter path
    // as any other activated ability (mirrors the "creates a token from an
    // activated ability's effects[]" test above, in reverse: here the TOKEN is
    // the ability's source). Cost payment (the {2} mana + self-sacrifice) is
    // paid by `game.ts`'s `activateAbility` BEFORE the stack item exists —
    // out of scope for this GRE-only resolution test, exactly like every
    // other `cost.sacrifice` ability's GRE test in the catalogue (e.g.
    // Mishra's Bauble, csp/colorless.test.ts).
    it("activating the Clue's sac-draw ability draws a card for the controller (CR 701.16a)", () => {
        const id = registerScript("test-op-token-clue-activate", [clueSpec()]);
        const state = makeState({
            players: [
                makePlayer("p1", {
                    library: [
                        makeInstance(BEAR_ID, {
                            id: "clue-lib-0",
                            controllerId: "p1",
                            ownerId: "p1",
                            zone: "library",
                        }),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, id, "p1", []);
        resolveTopOfStack(state);
        const clue = state.players[0].battlefield.find((c) => c.isToken)!;
        const handBefore = state.players[0].hand.length;
        state.stack.push({
            ...clue,
            zone: "stack",
            castById: "p1",
            abilityId: "sacrifice-draw",
            targets: [],
        });
        resolveTopOfStack(state);
        expect(state.players[0].hand.length).toBe(handBefore + 1);
    });

    // Wire format (GRE testing convention): the created Clue's identity is a
    // synthesized definition; the projection strips `card.card` to `{ id }`
    // but the id itself is content-derived and decodes back into the SAME
    // activated ability client-side (see `tokenRegistry.test.ts` for the
    // dedicated client-rehydration round-trip via `maybeSynthesizeToken`).
    it("the created Clue projects correctly to the client view (wire format)", () => {
        const id = registerScript("test-op-token-clue-wire", [clueSpec()]);
        const state = makeState();
        pushSpell(state, id, "p1", []);
        resolveTopOfStack(state);
        const clue = state.players[0].battlefield.find((c) => c.isToken)!;

        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === clue.id
        )!;
        expect(slim).toBeDefined();
        expect(slim.isToken).toBe(true);
        expect(slim.types).toEqual(["Artifact"]);
        const def = getDefinition((slim.card as { id: string }).id);
        expect(def.activatedAbilities).toHaveLength(1);
        expect(def.activatedAbilities![0].id).toBe("sacrifice-draw");
    });
});

// CR 111 / 701.3 (issue #1202) — `createToken`'s `bind` field snapshots the
// just-created token so a follow-up Op (`attach`) can act on it directly,
// with NO announced-target form: the token didn't exist before this Op ran
// (CR 601.2b). New capability of the EXISTING `createToken` Op (mirrors
// `destroy`/`exile`/`moveZone`'s own `bind`, "generalize, don't add"), not a
// new Op — Cori-Steel Cutter's "create a 1/1 white Monk creature token with
// prowess. You may attach this Equipment to it." (tdm/red.ts).
describe("Effect Script Op: createToken bind + attach (CR 111 / 701.3, issue #1202)", () => {
    const EQUIP_ID = "test-op-createtoken-bind-equip";
    registerTokenDefinition({
        id: EQUIP_ID,
        name: EQUIP_ID,
        rarity: "common",
        manaCost: { generic: 1, R: 1 },
        types: ["Artifact"],
        subtypes: ["Equipment"],
        activatedAbilities: [
            {
                id: "make-monk-and-maybe-attach",
                oracleText:
                    "Create a 1/1 white Monk creature token with prowess. You may attach this Equipment to it.",
                cost: {},
                useStack: true,
                effects: [
                    {
                        op: "createToken",
                        token: {
                            name: "Monk",
                            types: ["Creature"],
                            subtypes: ["Monk"],
                            power: 1,
                            toughness: 1,
                            colors: ["W"],
                            staticAbilities: ["prowess"],
                        },
                        controller: "controller",
                        bind: "$monk",
                    },
                    {
                        op: "mayPay",
                        player: "controller",
                        bind: "$attachIt",
                        prompt: "Attach to the Monk token?",
                    },
                    {
                        op: "if",
                        predicate: { binding: "$attachIt" },
                        then: [{ op: "attach", target: { ref: "$monk" } }],
                    },
                ],
            },
        ],
    });

    function activate(state: GameState, sourceId: string): void {
        const src = state.players[0].battlefield.find(
            (c) => c.id === sourceId
        )!;
        state.stack.push({
            ...src,
            zone: "stack",
            castById: "p1",
            abilityId: "make-monk-and-maybe-attach",
            targets: [],
        });
    }

    it("binds the just-created token so `attach` reads it via `{ ref }` (accepted)", () => {
        const equip = makeInstance(EQUIP_ID, {
            id: "bindEquip1",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [equip] }),
                makePlayer("p2"),
            ],
        });
        activate(state, "bindEquip1");
        expect(resolveTopOfStack(state)).toBeNull(); // suspended on may-pay
        applyMayPaySubmit(state, { playerId: "p1", accept: true });

        const monk = state.players[0].battlefield.find(
            (c) => c.isToken && c.subtypes?.includes("Monk")
        )!;
        expect(monk).toBeDefined();
        const foundEquip = state.players[0].battlefield.find(
            (c) => c.id === "bindEquip1"
        )!;
        expect(foundEquip.attachedTo).toBe(monk.id);
    });

    it("does NOT attach when the may-pay decision is declined (CR 608.2b optional action)", () => {
        const equip = makeInstance(EQUIP_ID, {
            id: "bindEquip2",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [equip] }),
                makePlayer("p2"),
            ],
        });
        activate(state, "bindEquip2");
        resolveTopOfStack(state);
        applyMayPaySubmit(state, { playerId: "p1", accept: false });

        const monk = state.players[0].battlefield.find(
            (c) => c.isToken && c.subtypes?.includes("Monk")
        )!;
        expect(monk).toBeDefined(); // the token is still created either way
        const foundEquip = state.players[0].battlefield.find(
            (c) => c.id === "bindEquip2"
        )!;
        expect(foundEquip.attachedTo).toBeUndefined();
    });

    it("the bound attach outcome survives projection (wire format)", () => {
        const equip = makeInstance(EQUIP_ID, {
            id: "bindEquip3",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [equip] }),
                makePlayer("p2"),
            ],
        });
        activate(state, "bindEquip3");
        resolveTopOfStack(state);
        applyMayPaySubmit(state, { playerId: "p1", accept: true });

        const monk = state.players[0].battlefield.find(
            (c) => c.isToken && c.subtypes?.includes("Monk")
        )!;
        const projected = projectPublicState(state, 1, "p1");
        const slimEquip = projected.players[0].battlefield.find(
            (c) => c.id === "bindEquip3"
        )!;
        expect(slimEquip.attachedTo).toBe(monk.id);
        const slimMonk = projected.players[0].battlefield.find(
            (c) => c.id === monk.id
        )!;
        expect(slimMonk.staticAbilities).toContain("prowess");
    });
});

// CR 111.9 / 122.1 (issue #1210) — a `createToken` token spec may carry
// `entersWith.counters` (counters the token is created WITH). New capability
// of the EXISTING `createToken` Op, not a new Op — mirrors
// `CardDefinition.entersWith.counters` (a non-token permanent's own ETB
// counters) reused rather than invented.
describe("Effect Script Op: createToken with token.entersWith (CR 111.9 / 122.1, issue #1210)", () => {
    it("stamps a literal count of counters onto the created token", () => {
        const id = registerScript("test-op-token-enterswith-literal", [
            {
                op: "createToken",
                token: {
                    name: "Incubator",
                    types: ["Artifact"],
                    entersWith: { counters: [{ type: "+1/+1", count: 3 }] },
                },
                controller: "controller",
            },
        ]);
        const state = makeState();
        pushSpell(state, id, "p1", []);
        resolveTopOfStack(state);
        const token = state.players[0].battlefield.find((c) => c.isToken)!;
        expect(token.counters).toEqual({ "+1/+1": 3 });
    });

    // The Incubate-N shape's dynamism (CR 701.53 — "with N +1/+1 counters",
    // N possibly computed rather than fixed): the counter count is a `count`
    // construct (CR 122 counting), not a literal — resolved by the
    // `createToken` Op executor before the spec reaches
    // `SpellContext.createToken`, exactly like every other Op's
    // `EffectValue` field.
    it("resolves a dynamic (count construct) counter count", () => {
        const id = registerScript("test-op-token-enterswith-dynamic", [
            {
                op: "createToken",
                token: {
                    name: "Incubator",
                    types: ["Artifact"],
                    entersWith: {
                        counters: [
                            {
                                type: "+1/+1",
                                count: {
                                    count: {
                                        zone: "graveyard",
                                        controller: "controller",
                                    },
                                },
                            },
                        ],
                    },
                },
                controller: "controller",
            },
        ]);
        const gy1 = makeInstance(BEAR_ID, {
            id: "gybear1",
            controllerId: "p1",
            zone: "graveyard",
        });
        const gy2 = makeInstance(BEAR_ID, {
            id: "gybear2",
            controllerId: "p1",
            zone: "graveyard",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { graveyard: [gy1, gy2] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, id, "p1", []);
        resolveTopOfStack(state);
        const token = state.players[0].battlefield.find((c) => c.isToken)!;
        expect(token.counters).toEqual({ "+1/+1": 2 });
    });

    // CR 122's "put N counters" with N ≤ 0 is a no-op — an unresolved or
    // non-positive count is dropped, not stamped as 0.
    it("drops a counter entry whose count resolves to 0", () => {
        const id = registerScript("test-op-token-enterswith-zero", [
            {
                op: "createToken",
                token: {
                    name: "Incubator",
                    types: ["Artifact"],
                    entersWith: { counters: [{ type: "+1/+1", count: 0 }] },
                },
                controller: "controller",
            },
        ]);
        const state = makeState();
        pushSpell(state, id, "p1", []);
        resolveTopOfStack(state);
        const token = state.players[0].battlefield.find((c) => c.isToken)!;
        expect(token.counters).toBeUndefined();
    });

    // Wire format (GRE testing convention): the counters live on
    // `CardInstanceState.counters`, a field the projection carries verbatim —
    // must survive `projectPublicState` so the client renders the token with
    // its counters.
    it("the stamped counters survive projection (wire format)", () => {
        const id = registerScript("test-op-token-enterswith-wire", [
            {
                op: "createToken",
                token: {
                    name: "Incubator",
                    types: ["Artifact"],
                    entersWith: { counters: [{ type: "+1/+1", count: 2 }] },
                },
                controller: "controller",
            },
        ]);
        const state = makeState();
        pushSpell(state, id, "p1", []);
        resolveTopOfStack(state);
        const token = state.players[0].battlefield.find((c) => c.isToken)!;

        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === token.id
        )!;
        expect(slim.counters).toEqual({ "+1/+1": 2 });
    });
});

// CR 701.27 / 712 (issue #1210, ADR 0067) — transform a permanent between its
// front/back printed characteristic sets. The Incubator token shape (CR
// 701.53 Incubate): a front-face artifact token with "{2}: Transform this
// artifact" whose back face is a Construct creature token.
describe("Effect Script Op: transform (CR 701.27 / 712, issue #1210, ADR 0067)", () => {
    const INCUBATOR_ID = "test-op-transform-incubator";
    registerTokenDefinition({
        id: INCUBATOR_ID,
        name: "Incubator",
        rarity: "common",
        manaCost: {},
        types: ["Artifact"],
        activatedAbilities: [
            {
                id: "incubator-transform",
                oracleText: "{2}: Transform this artifact.",
                cost: { mana: { generic: 2 } },
                useStack: true,
                effects: [{ op: "transform", target: { ref: "$source" } }],
            },
        ],
        backFace: {
            name: "Construct",
            types: ["Artifact", "Creature"],
            subtypes: ["Construct"],
            power: 0,
            toughness: 0,
            staticAbilities: [],
        },
    });

    function activateTransform(state: GameState, sourceId: string): void {
        const src = state.players[0].battlefield.find(
            (c) => c.id === sourceId
        )!;
        state.stack.push({
            ...src,
            zone: "stack",
            castById: "p1",
            abilityId: "incubator-transform",
            targets: [],
        });
    }

    it("flips the permanent to its back face via the implicit $source binding", () => {
        const incubator = makeInstance(INCUBATOR_ID, {
            id: "incu1",
            controllerId: "p1",
            ownerId: "p1",
            counters: { "+1/+1": 2 },
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [incubator] }),
                makePlayer("p2"),
            ],
        });
        activateTransform(state, "incu1");
        resolveTopOfStack(state);

        const flipped = state.players[0].battlefield.find(
            (c) => c.id === "incu1"
        )!;
        expect(flipped.transformed).toBe(true);
        expect(flipped.transformedFrom).toBe(INCUBATOR_ID);
        expect(flipped.types).toEqual(["Artifact", "Creature"]);
        expect(flipped.subtypes).toEqual(["Construct"]);
        expect(flipped.power).toBe(0);
        expect(flipped.toughness).toBe(0);
        // CR 122 — counters put on the permanent BEFORE transforming carry
        // over across the flip (transform doesn't remove them); the layer
        // system reads the base 0/0 + the 2 +1/+1 counters as 2/2.
        expect(flipped.counters).toEqual({ "+1/+1": 2 });
        expect(getEffectivePower(state, flipped)).toBe(2);
        expect(getEffectiveToughness(state, flipped)).toBe(2);
        // The front-face activated ability ("{2}: Transform") no longer
        // reads off the definition once the id has swapped to the back face.
        const backDef = getDefinition((flipped.card as { id: string }).id);
        expect(backDef.activatedAbilities ?? []).toHaveLength(0);
    });

    // A second transform flips back to front (CR 712.8a — the SAME Op/
    // primitive toggles either direction). Driven by two SEPARATE targeted
    // `transform` Ops (not the Incubator's own one-way ability, which the
    // back Construct face doesn't carry — most printed transform-back
    // permanents declare their OWN back-face ability for that) to isolate the
    // toggle behavior of the primitive itself.
    it("flips back to front on a second transform (CR 712.8a toggle)", () => {
        const id = registerScript("test-op-transform-toggle", [
            { op: "transform", target: { target: 0 } },
        ]);
        const incubator = makeInstance(INCUBATOR_ID, {
            id: "incu2",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [incubator] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, id, "p1", [{ type: "permanent", id: "incu2" }]);
        resolveTopOfStack(state);
        expect(
            state.players[0].battlefield.find((c) => c.id === "incu2")!
                .transformed
        ).toBe(true);

        pushSpell(state, id, "p1", [{ type: "permanent", id: "incu2" }]);
        resolveTopOfStack(state);

        const back = state.players[0].battlefield.find(
            (c) => c.id === "incu2"
        )!;
        expect(back.transformed).toBeUndefined();
        expect(back.transformedFrom).toBeUndefined();
        expect((back.card as { id: string }).id).toBe(INCUBATOR_ID);
        expect(back.types).toEqual(["Artifact"]);
    });

    // A permanent whose current face declares no `backFace` — nothing to
    // flip to. No-op, not a throw (CR 608.2b-style "does as much as it can").
    it("is a no-op when the permanent's current face has no backFace", () => {
        const id = registerScript("test-op-transform-none", [
            { op: "transform", target: { target: 0 } },
        ]);
        const bear = makeInstance(BEAR_ID, { controllerId: "p2", id: "tb1" });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        pushSpell(state, id, "p1", [{ type: "permanent", id: "tb1" }]);
        expect(() => resolveTopOfStack(state)).not.toThrow();
        const still = state.players[1].battlefield.find((c) => c.id === "tb1")!;
        expect(still.transformed).toBeUndefined();
    });

    // CR 608.2b — an announced target missing at resolution resolves to no
    // object, so the Op is skipped without throwing.
    it("is skipped when the target is gone (CR 608.2b)", () => {
        const id = registerScript("test-op-transform-missing", [
            { op: "transform", target: { target: 0 } },
        ]);
        const state = makeState();
        pushSpell(state, id, "p1", []);
        expect(() => resolveTopOfStack(state)).not.toThrow();
    });

    // Wire format (GRE testing convention): transform is ALWAYS PUBLIC
    // information (CR 712.1a) — unlike faceDown, there is no per-viewer
    // hiding, so the swapped face must project identically to both players.
    it("the transformed face survives projection identically for both players (wire format)", () => {
        const incubator = makeInstance(INCUBATOR_ID, {
            id: "incu3",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [incubator] }),
                makePlayer("p2"),
            ],
        });
        activateTransform(state, "incu3");
        resolveTopOfStack(state);
        const flipped = state.players[0].battlefield.find(
            (c) => c.id === "incu3"
        )!;

        for (const viewerId of ["p1", "p2"]) {
            const projected = projectPublicState(state, 1, viewerId);
            const slim = projected.players[0].battlefield.find(
                (c) => c.id === "incu3"
            )!;
            expect(slim).toBeDefined();
            expect(slim.transformed).toBe(true);
            expect(slim.types).toEqual(["Artifact", "Creature"]);
            expect(slim.subtypes).toEqual(["Construct"]);
            expect(slim.power).toBe(0);
            expect(slim.toughness).toBe(0);
            expect(slim.card.id).toBe(flipped.card.id);
        }
    });
});

describe("Effect Script Op: gainControl (CR 613.1b, layer 2, issue #848)", () => {
    // Indefinite reassignment (Ghazbán Ogre / Chaos Lord shape): no `duration`
    // → no condition, control never reverts on its own (CR 613.1b).
    it("changes control of the announced target to the controller (indefinite)", () => {
        const id = registerScript("test-op-gaincontrol-indef", [
            {
                op: "gainControl",
                target: { target: 0 },
                controller: "controller",
            },
        ]);
        const bear = makeInstance(BEAR_ID, {
            controllerId: "p2",
            ownerId: "p2",
            id: "bear1",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        pushSpell(state, id, "p1", [{ type: "permanent", id: "bear1" }]);
        resolveTopOfStack(state);
        // The stolen permanent moved to p1's battlefield array (CR 613.1b).
        expect(
            state.players[1].battlefield.find((c) => c.id === "bear1")
        ).toBeUndefined();
        const stolen = state.players[0].battlefield.find(
            (c) => c.id === "bear1"
        )!;
        expect(stolen).toBeDefined();
        expect(stolen.controllerId).toBe("p1");
        // CR 702.10c — a creature that changes control has summoning sickness.
        expect(stolen.isSummoningSick).toBe(true);
        // Indefinite: the entry records no condition, so the SBA never reverts it.
        expect(stolen.controlChanges?.[0].condition).toBeUndefined();
        checkConditionalControlChanges(state);
        expect(
            state.players[0].battlefield.find((c) => c.id === "bear1")
        ).toBeDefined();
    });

    // "for as long as you control this creature" (Aladdin / Thrull Champion):
    // the conditional-control SBA reverts control the moment the source leaves.
    it("while-you-control-source installs a condition the SBA reverts when the source leaves", () => {
        const STEALER_ID = "test-op-gaincontrol-controls-src";
        registerTokenDefinition({
            id: STEALER_ID,
            name: STEALER_ID,
            rarity: "rare",
            manaCost: { R: 1 },
            types: ["Creature"],
            activatedAbilities: [
                {
                    id: "steal",
                    oracleText:
                        "{T}: Gain control of target creature for as long as you control this.",
                    cost: { tap: true },
                    useStack: true,
                    targetRequirement: { type: "Creature", count: 1 },
                    effects: [
                        {
                            op: "gainControl",
                            target: { target: 0 },
                            controller: "controller",
                            duration: "while-you-control-source",
                        },
                    ],
                },
            ],
        });
        const stealer = makeInstance(STEALER_ID, {
            id: "stealer1",
            controllerId: "p1",
            ownerId: "p1",
            isSummoningSick: false,
        });
        const bear = makeInstance(BEAR_ID, {
            controllerId: "p2",
            ownerId: "p2",
            id: "bear1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [stealer] }),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        state.stack.push({
            ...state.players[0].battlefield[0],
            zone: "stack",
            castById: "p1",
            abilityId: "steal",
            targets: [{ type: "permanent", id: "bear1" }],
        });
        resolveTopOfStack(state);
        const stolen = state.players[0].battlefield.find(
            (c) => c.id === "bear1"
        )!;
        expect(stolen.controllerId).toBe("p1");
        expect(stolen.controlChanges?.[0].condition).toEqual({
            kind: "controller-controls-source",
            controllerId: "p1",
        });
        // Source leaves the battlefield → the condition lapses → the SBA hands
        // the creature back to its prior controller (CR 611.2b).
        const src = state.players[0].battlefield.findIndex(
            (c) => c.id === "stealer1"
        );
        state.players[0].battlefield.splice(src, 1);
        checkConditionalControlChanges(state);
        expect(
            state.players[0].battlefield.find((c) => c.id === "bear1")
        ).toBeUndefined();
        expect(
            state.players[1].battlefield.find((c) => c.id === "bear1")
                ?.controllerId
        ).toBe("p2");
    });

    // "for as long as this creature remains tapped" (Preacher / Seasinger): the
    // SBA reverts control the moment the source untaps (CR 611.2b).
    it("while-source-tapped installs a condition the SBA reverts on untap", () => {
        const id = registerScript("test-op-gaincontrol-tapped", [
            {
                op: "gainControl",
                target: { target: 0 },
                controller: "controller",
                duration: "while-source-tapped",
            },
        ]);
        const bear = makeInstance(BEAR_ID, {
            controllerId: "p2",
            ownerId: "p2",
            id: "bear1",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        const item = pushSpell(state, id, "p1", [
            { type: "permanent", id: "bear1" },
        ]);
        // Put the resolving source on p1's battlefield, TAPPED, so the condition
        // can hold after resolution (the primitive keys the entry to item.id).
        state.players[0].battlefield.push({
            ...makeInstance(id, {
                id: item.id,
                controllerId: "p1",
                ownerId: "p1",
            }),
            isTapped: true,
        });
        resolveTopOfStack(state);
        const stolen = state.players[0].battlefield.find(
            (c) => c.id === "bear1"
        )!;
        expect(stolen.controlChanges?.[0].condition).toEqual({
            kind: "source-tapped",
        });
        // Holds while tapped.
        checkConditionalControlChanges(state);
        expect(
            state.players[0].battlefield.find((c) => c.id === "bear1")
        ).toBeDefined();
        // Untap the source → condition lapses → control reverts.
        const source = state.players[0].battlefield.find(
            (c) => c.id === item.id
        )!;
        source.isTapped = false;
        checkConditionalControlChanges(state);
        expect(
            state.players[1].battlefield.find((c) => c.id === "bear1")
                ?.controllerId
        ).toBe("p2");
    });

    // CR 608.2b — an announced target gone at resolution makes the Op a no-op.
    it("skips when the target has left the battlefield (CR 608.2b)", () => {
        const id = registerScript("test-op-gaincontrol-gone", [
            {
                op: "gainControl",
                target: { target: 0 },
                controller: "controller",
            },
        ]);
        const state = makeState();
        // Target a permanent that isn't on any battlefield.
        pushSpell(state, id, "p1", [{ type: "permanent", id: "ghost" }]);
        expect(() => resolveTopOfStack(state)).not.toThrow();
        expect(state.players[0].battlefield).toHaveLength(0);
    });

    // Wire format (GRE testing convention): the stolen permanent must project
    // onto the NEW controller's battlefield in PublicGameState so the client
    // renders control correctly across the network boundary.
    it("the stolen permanent projects under the new controller (wire format)", () => {
        const id = registerScript("test-op-gaincontrol-wire", [
            {
                op: "gainControl",
                target: { target: 0 },
                controller: "controller",
            },
        ]);
        const bear = makeInstance(BEAR_ID, {
            controllerId: "p2",
            ownerId: "p2",
            id: "bear1",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        pushSpell(state, id, "p1", [{ type: "permanent", id: "bear1" }]);
        resolveTopOfStack(state);
        const projected = projectPublicState(state, 1, "p1");
        expect(
            projected.players[0].battlefield.find((c) => c.id === "bear1")
        ).toBeDefined();
        expect(
            projected.players[1].battlefield.find((c) => c.id === "bear1")
        ).toBeUndefined();
        expect(
            projected.players[0].battlefield.find((c) => c.id === "bear1")
                ?.controllerId
        ).toBe("p1");
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

    // `.owner` (issue #1106, CR 108.3) — DISTINCT from `.controller`: the
    // snapshot's owner slot never changes even when a control-magic effect
    // (Spinal Embrace) makes some other player the current controller. The
    // Recoil shape: bounce via `moveZone` bind, then read `.owner` for "that
    // player" (CR 400.7), not `.controller`.
    it("reads a bound object's OWNER, distinct from its controller, after a moveZone bounce (CR 108.3/400.7)", () => {
        const id = registerScript("test-bind-ref-owner", [
            { op: "moveZone", target: { target: 0 }, to: "hand", bind: "$c" },
            {
                op: "gainLife",
                player: { ref: "$c.owner" },
                amount: 5,
            },
        ]);
        // Owned by p2, but controlled by p1 (the Spinal-Embrace-then-Recoil
        // shape the issue is about) — sits in p2's battlefield array; a
        // control change only mutates `controllerId`, never relocates the
        // permanent between players' arrays.
        const bear = makeInstance(BEAR_ID, {
            controllerId: "p1",
            ownerId: "p2",
            id: "stolenBear",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        pushSpell(state, id, "p1", [{ type: "permanent", id: "stolenBear" }]);
        resolveTopOfStack(state);
        // The OWNER (p2) gained life, NOT the controller (p1).
        expect(state.players[1].life).toBe(25);
        expect(state.players[0].life).toBe(20);
        // The bounced permanent went to its OWNER's (p2) hand.
        expect(state.players[1].hand.some((c) => c.id === "stolenBear")).toBe(
            true
        );
    });

    it("the bound-owner ref survives projection (wire format, issue #1106)", () => {
        const id = registerScript("test-bind-ref-owner-wire", [
            { op: "moveZone", target: { target: 0 }, to: "hand", bind: "$c" },
            {
                op: "gainLife",
                player: { ref: "$c.owner" },
                amount: 5,
            },
        ]);
        const bear = makeInstance(BEAR_ID, {
            controllerId: "p1",
            ownerId: "p2",
            id: "stolenBearWire",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        pushSpell(state, id, "p1", [
            { type: "permanent", id: "stolenBearWire" },
        ]);
        resolveTopOfStack(state);
        // Viewed from p2 (the owner) so its own hand isn't nulled-out by the
        // opponent-hand projection (the point here is `.owner` resolving
        // correctly, not hand secrecy).
        const projected = projectPublicState(state, 1, "p2");
        expect(projected.players[1].life).toBe(25);
        expect(
            projected.players[1].hand.some((c) => c?.id === "stolenBearWire")
        ).toBe(true);
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

    // `filter.any` on a BATTLEFIELD count (issue #897) — `toPermanentFilter`
    // (the `EffectCardFilter` → `PermanentFilter` mapping used by every
    // battlefield `choice`/`count`/`forEach` site) used to drop `any` on the
    // floor: a filter carrying ONLY `any` mapped to an all-undefined
    // `PermanentFilter`, which `matchesPermanentFilter` treats as "no
    // constraint" — counting EVERY permanent (fail OPEN), not just the
    // disjunction members. An Artifact (matches `types`), a Dragon (matches
    // `subtypes`), and a Bear (matches NEITHER clause) on the battlefield:
    // only the first two should count.
    it("counts only the disjunction members on a battlefield count (any: type OR subtype, issue #897)", () => {
        const ARTIFACT_ID = "test-count-any-artifact";
        registerTokenDefinition({
            id: ARTIFACT_ID,
            name: ARTIFACT_ID,
            rarity: "common",
            manaCost: { X: 2 },
            types: ["Artifact"],
        });
        const DRAGON_ID = "test-count-any-dragon";
        registerTokenDefinition({
            id: DRAGON_ID,
            name: DRAGON_ID,
            rarity: "common",
            manaCost: { X: 4, R: 2 },
            types: ["Creature"],
            subtypes: ["Dragon"],
            power: 4,
            toughness: 4,
        });
        const id = registerScript("test-count-any-battlefield", [
            {
                op: "draw",
                player: "controller",
                count: {
                    count: {
                        zone: "battlefield",
                        controller: "controller",
                        filter: {
                            any: [{ type: "Artifact" }, { subtype: "Dragon" }],
                        },
                    },
                },
            },
        ]);
        const artifact = makeInstance(ARTIFACT_ID, {
            id: "any-artifact",
            controllerId: "p1",
            ownerId: "p1",
        });
        const dragon = makeInstance(DRAGON_ID, {
            id: "any-dragon",
            controllerId: "p1",
            ownerId: "p1",
        });
        const bear = makeInstance(BEAR_ID, {
            id: "any-bear",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [artifact, dragon, bear],
                    library: withLibrary("p1", 5),
                }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        // Only the Artifact + Dragon match `any` → draw 2 (NOT 3, the whole
        // battlefield, and NOT 0).
        expect(state.players[0].hand).toHaveLength(2);
        expect(state.players[0].library).toHaveLength(3);
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

    // issue #1282 — an author-supplied stable `id`, overriding `bind` as the
    // wire-visible `PendingChoice.choiceId`. Lets a migrated card reproduce
    // the exact literal choiceId its `resolve()`-era test pinned (Bazaar of
    // Baghdad's "bazaar-discard") without touching that pre-existing test —
    // the migration-equivalence invariant this Op field exists for.
    it("uses an author-supplied `id` as the PendingChoice.choiceId, while `bind` still resolves the picks (issue #1282)", () => {
        const id = registerScript(
            "test-op-choice-author-id",
            [
                {
                    op: "choice",
                    kind: "discard-hand",
                    player: { target: 0 },
                    zone: "hand",
                    count: 2,
                    prompt: "Discard two cards.",
                    bind: "$picked",
                    id: "custom-stable-id",
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
        // The wire-visible id is the AUTHOR-SUPPLIED one, not the bind name.
        expect(head.choiceId).toBe("custom-stable-id");

        applyPendingChoiceSubmit(state, {
            playerId: "p2",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["h1", "h3"],
        });
        // The picks still reach the consuming `discard` Op through `$picked`
        // — `id` only overrides the wire-visible choiceId, never the picks
        // binding `ref`s read.
        expect(state.players[1].hand.map((c) => c.id)).toEqual(["h2"]);
        expect(state.players[1].graveyard.map((c) => c.id).sort()).toEqual([
            "h1",
            "h3",
        ]);
        expect(state.stack).toHaveLength(0);
        expect(state.pendingChoices).toBeUndefined();
    });

    // issue #1282 — the wire projection (`expectedInput.choiceId`) surfaces
    // the author-supplied id too, not just the raw `PendingChoice`.
    it("surfaces the author-supplied `id` through the wire projection's expectedInput (issue #1282)", () => {
        const id = registerScript(
            "test-op-choice-author-id-wire",
            [
                {
                    op: "choice",
                    kind: "discard-hand",
                    player: { target: 0 },
                    zone: "hand",
                    count: 1,
                    prompt: "Discard a card.",
                    bind: "$picked",
                    id: "custom-stable-id",
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
        refreshExpectedInput(state);
        const projected = projectPublicState(state, 1, "p2");
        const head = projected.pendingChoices![0];
        expect(head.choiceId).toBe("custom-stable-id");
        expect(projected.expectedInput).toEqual({
            kind: "choice",
            playerId: "p2",
            stackItemId: head.stackItemId,
            choiceId: "custom-stable-id",
            choiceKind: "discard-hand",
        });
    });

    // `zone: "graveyard"` + `filter` (issue #680): the graveyard branch used to
    // ignore `op.filter` entirely (unlike the hand/library branches above),
    // so a "choose a LAND card" pick could illegally offer a non-land
    // (Titania, Protector of Argoth's "return target LAND card from your
    // graveyard"). Paired with the `moveZone` cards-shape `from: "graveyard"`
    // Op (issue #680) to reanimate the pick — the Exhume / Titania pattern.
    it("restricts choose-graveyard-card candidates by type filter, then reanimates the pick", () => {
        const LAND_GY_ID = "test-effects-land-gy";
        registerTokenDefinition({
            id: LAND_GY_ID,
            name: LAND_GY_ID,
            rarity: "common",
            types: ["Land"],
            subtypes: ["Forest"],
        });
        const id = registerScript("test-choice-gy-filter", [
            {
                op: "choice",
                kind: "choose-graveyard-card",
                player: "controller",
                zone: "graveyard",
                filter: { type: "Land" },
                count: 1,
                prompt: "Return target land card from your graveyard to the battlefield.",
                bind: "$picked",
            },
            {
                op: "moveZone",
                cards: { ref: "$picked" },
                player: "controller",
                from: "graveyard",
                to: "battlefield",
            },
        ]);
        const land = makeInstance(LAND_GY_ID, {
            id: "landGY1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const bear = makeInstance(BEAR_ID, {
            id: "bearGY1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { graveyard: [land, bear] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("choose-graveyard-card");
        // Only the land is offered — the Bear is filtered out (CR 205).
        expect(head.candidateIds).toEqual(["landGY1"]);
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["landGY1"],
        });
        expect(state.players[0].graveyard.map((c) => c.id)).not.toContain(
            "landGY1"
        );
        expect(state.players[0].graveyard.map((c) => c.id)).toContain(
            "bearGY1"
        );
        expect(state.players[0].battlefield.map((c) => c.id)).toContain(
            "landGY1"
        );
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.players[0].battlefield.map((c) => c.id)).toContain(
            "landGY1"
        );
    });

    // `count: { min: 0, max: 1 }` on a `choose-graveyard-card` pick (issue
    // #680) — "you MAY return target card from your graveyard to your hand"
    // (Eternal Witness) with no candidates at all: the choice clamps to 0 and
    // is skipped entirely (CR 608.2b), so the consuming `moveZone` Op has
    // nothing to move — no throw, no PendingChoice.
    it("skips an optional (min:0) choose-graveyard-card pick with an empty graveyard", () => {
        const id = registerScript("test-choice-gy-optional-empty", [
            {
                op: "choice",
                kind: "choose-graveyard-card",
                player: "controller",
                zone: "graveyard",
                count: { min: 0, max: 1 },
                prompt: "You may return target card from your graveyard to your hand.",
                bind: "$picked",
            },
            {
                op: "moveZone",
                cards: { ref: "$picked" },
                player: "controller",
                from: "graveyard",
                to: "hand",
            },
        ]);
        const state = makeState();
        pushSpell(state, id, "p1");
        expect(() => resolveTopOfStack(state)).not.toThrow();
        expect(state.pendingChoices).toBeUndefined();
        expect(state.players[0].hand).toHaveLength(0);
    });
});

// issue #945 — the `reveal` Op's `cards`-shape: the tutor "search …, reveal
// it, put it into your hand, then shuffle" clause (CR 701.20 — a reveal makes
// the found card known to every player). Mirrors Spellseeker / Stoneforge
// Mystic / Brightglass Gearhulk / Expedition Map: choice(search-library) →
// reveal(cards) → moveZone(library→hand) → libraryLook(shuffle). The reveal
// must survive the shuffle and cross the wire projection so the OPPONENT sees
// the real card in the searcher's hand, not a nulled hidden slot.
describe("Effect Script Op: reveal — searched card (issue #945, CR 701.20)", () => {
    const libraryOf = (owner: "p1" | "p2", ids: string[]) =>
        ids.map((cid) =>
            makeInstance(BEAR_ID, {
                id: cid,
                controllerId: owner,
                ownerId: owner,
                zone: "library",
            })
        );

    const tutorScript = (scriptId: string): string =>
        registerScript(scriptId, [
            {
                op: "choice",
                kind: "search-library",
                player: "controller",
                zone: "library",
                count: { min: 0, max: 1 },
                prompt: "Search your library for a card.",
                bind: "$picked",
            },
            { op: "reveal", player: "controller", cards: { ref: "$picked" } },
            {
                op: "moveZone",
                cards: { ref: "$picked" },
                player: "controller",
                from: "library",
                to: "hand",
            },
            { op: "libraryLook", action: "shuffle", player: "controller" },
        ]);

    it("makes the found card known to EVERY player; the opponent's projection shows the real revealed card in the searcher's hand", () => {
        const id = tutorScript("test-op-reveal-tutor");
        const state = makeState({
            players: [
                makePlayer("p1", {
                    library: libraryOf("p1", ["found1", "other1", "other2"]),
                }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, id, "p1");
        expect(resolveTopOfStack(state)).toBeNull(); // suspended on the search
        const head = state.pendingChoices![0];
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["found1"],
        });

        // The card moved to the searcher's hand…
        const inHand = state.players[0].hand.find((c) => c.id === "found1");
        expect(inHand).toBeDefined();
        // …and the reveal stamped it known to BOTH players (CR 701.20). It
        // survived the trailing shuffle because it left the library first.
        expect(inHand!.knownTo?.slice().sort()).toEqual(["p1", "p2"]);
        expect(state.stack).toHaveLength(0);
        expect(state.pendingChoices).toBeUndefined();

        // Wire format (mandatory, GRE testing convention): for VIEWER p2 the
        // projection must surface the real revealed card in p1's hand, not a
        // nulled hidden slot.
        const projected = projectPublicState(state, 1, "p2");
        const slot = projected.players[0].hand.find((c) => c?.id === "found1");
        expect(slot).toBeTruthy();
        // The rest of p1's hand stays hidden to the opponent (only the
        // revealed card crosses).
        expect(
            projected.players[0].hand.filter((c) => c !== null)
        ).toHaveLength(1);
    });

    it("reveals nothing and does not error when the optional (min:0) search finds nothing (CR 608.2b)", () => {
        const id = tutorScript("test-op-reveal-tutor-empty");
        const state = makeState({
            players: [
                makePlayer("p1", { library: libraryOf("p1", ["only1"]) }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, id, "p1");
        expect(resolveTopOfStack(state)).toBeNull();
        const head = state.pendingChoices![0];
        // Decline the optional search (pick nothing).
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: [],
        });
        // Nothing revealed, nothing moved, no lingering knowledge.
        expect(state.players[0].hand).toHaveLength(0);
        expect(
            state.players[0].library.every((c) => c.knownTo === undefined)
        ).toBe(true);
        expect(state.stack).toHaveLength(0);
        expect(state.pendingChoices).toBeUndefined();
    });
});

// issue #920 / #682 — the `choice` Op's `zoneOwnerId` generalization: the
// chooser (`player`) and the zone owner picked from can now differ. Paired
// with the new `reveal` Op this is the Thoughtseize/Duress/Inquisition-of-
// Kozilek/Grief template: "target player reveals their hand, you choose a
// nonland card from it, that player discards it."
describe("Effect Script Op: choice — zoneOwnerId (issue #920)", () => {
    const handOf = (owner: "p1" | "p2", ids: string[]) =>
        ids.map((cid) =>
            makeInstance(BEAR_ID, {
                id: cid,
                controllerId: owner,
                ownerId: owner,
                zone: "hand",
            })
        );

    it("lets the CONTROLLER choose from the TARGET's hand (chooser ≠ zone owner), then discards the pick from the target's hand", () => {
        const id = registerScript(
            "test-op-choice-zoneownerid",
            [
                { op: "reveal", player: { target: 0 }, zone: "hand" },
                {
                    op: "choice",
                    kind: "choose-hand-card",
                    player: "controller",
                    zoneOwnerId: { target: 0 },
                    zone: "hand",
                    count: 1,
                    prompt: "Choose a card from that player's hand.",
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
        expect(resolveTopOfStack(state)).toBeNull(); // suspended on the choice

        const head = state.pendingChoices![0];
        // The CHOOSER is the caster (p1), even though the zone belongs to p2.
        expect(head.playerId).toBe("p1");
        expect(head.zoneOwnerId).toBe("p2");
        expect(head.count).toBe(1);

        // Wire format (CR 701.20a reveal): the `reveal` Op ran first, so p2's
        // hand cards are now known to p1 too — the projection for VIEWER p1
        // must show the real cards instead of nulling p2's hand slots.
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.players[1].hand.map((c) => c?.id).sort()).toEqual([
            "h1",
            "h2",
            "h3",
        ]);

        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["h2"],
        });
        // The TARGET (p2) discards the chosen card, not the chooser (p1).
        expect(state.players[1].hand.map((c) => c.id).sort()).toEqual([
            "h1",
            "h3",
        ]);
        expect(state.players[1].graveyard.map((c) => c.id)).toEqual(["h2"]);
        expect(state.stack).toHaveLength(0);
        expect(state.pendingChoices).toBeUndefined();
    });

    it("skips the choice when zoneOwnerId cannot be resolved (CR 608.2b) and defaults to the chooser's own zone when omitted", () => {
        // Omitted zoneOwnerId — unchanged pre-existing behaviour (the chooser
        // picks from their OWN hand, Mind Rot-style).
        const id = registerScript("test-op-choice-zoneownerid-default", [
            {
                op: "choice",
                kind: "discard-hand",
                player: "controller",
                zone: "hand",
                count: 1,
                prompt: "Discard a card.",
                bind: "$picked",
            },
            { op: "discard", player: "controller", cards: { ref: "$picked" } },
        ]);
        const state = makeState({
            players: [
                makePlayer("p1", { hand: handOf("p1", ["own1", "own2"]) }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        const head = state.pendingChoices![0];
        expect(head.playerId).toBe("p1");
        expect(head.zoneOwnerId).toBeUndefined();
        expect(head.candidateIds).toBeUndefined(); // no filter, unfiltered hand pick
    });

    it("restricts a battlefield choice to tokens / nontoken permanents via the isToken filter (issue #920)", () => {
        const token = makeInstance(BEAR_ID, {
            id: "tok1",
            controllerId: "p2",
            ownerId: "p2",
            isToken: true,
        });
        const nontoken = makeInstance(BEAR_ID, {
            id: "real1",
            controllerId: "p2",
            ownerId: "p2",
        });
        const id = registerScript(
            "test-op-choice-istoken",
            [
                {
                    op: "choice",
                    kind: "sacrifice-permanents",
                    player: { target: 0 },
                    zone: "battlefield",
                    filter: { type: "Creature", isToken: true },
                    count: 1,
                    prompt: "Sacrifice a creature token.",
                    bind: "$sac",
                },
                { op: "sacrifice", permanents: { ref: "$sac" } },
            ],
            { targetRequirement: { type: "player", count: 1 } }
        );
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [token, nontoken] }),
            ],
        });
        pushSpell(state, id, "p1", [{ type: "player", id: "p2" }]);
        resolveTopOfStack(state);
        const head = state.pendingChoices![0];
        expect(head.filter?.isToken).toBe(true);
        applyPendingChoiceSubmit(state, {
            playerId: "p2",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["tok1"],
        });
        expect(state.players[1].battlefield.map((c) => c.id)).toEqual([
            "real1",
        ]); // the nontoken survives; only the token is gone
    });

    // issue #682 — `excludeType` is the negative of `type` (mirrors the
    // already-shipped `TargetRequirement.excludeTypes`), exposed on the hand/
    // library/graveyard `EffectCardFilter` too. Thoughtseize/Inquisition of
    // Kozilek/Duress-class "reveal hand, choose a NONLAND card" template.
    it("excludes cards of the listed type(s) from a hand choice via excludeType (issue #682)", () => {
        const land = makeInstance(LAND_ID, {
            id: "land1",
            controllerId: "p2",
            ownerId: "p2",
            zone: "hand",
        });
        const bear = makeInstance(BEAR_ID, {
            id: "bear1",
            controllerId: "p2",
            ownerId: "p2",
            zone: "hand",
        });
        const id = registerScript(
            "test-op-choice-excludetype",
            [
                { op: "reveal", player: { target: 0 }, zone: "hand" },
                {
                    op: "choice",
                    kind: "choose-hand-card",
                    player: "controller",
                    zoneOwnerId: { target: 0 },
                    zone: "hand",
                    filter: { excludeType: "Land" },
                    count: 1,
                    prompt: "Choose a nonland card.",
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
                makePlayer("p2", { hand: [land, bear] }),
            ],
        });
        pushSpell(state, id, "p1", [{ type: "player", id: "p2" }]);
        resolveTopOfStack(state);
        const head = state.pendingChoices![0];
        // Only the nonland card is a legal candidate — the land is excluded.
        expect(head.candidateIds).toEqual(["bear1"]);
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["bear1"],
        });
        expect(state.players[1].hand.map((c) => c.id)).toEqual(["land1"]);
        expect(state.players[1].graveyard.map((c) => c.id)).toEqual(["bear1"]);
    });

    // issue #1287 — `excludeColor` is the negative of `color` (mirrors
    // `excludeType`/`excludeSupertype`'s negation shape exactly), exposed on
    // the hand/library/graveyard `EffectCardFilter`. Krovikan Sorcerer's
    // "Discard a NONBLACK card" template.
    it("excludes cards of the listed color(s) from a hand choice via excludeColor (issue #1287)", () => {
        const blackCard = makeInstance(BLACK_CARD_ID, {
            id: "black1",
            controllerId: "p2",
            ownerId: "p2",
            zone: "hand",
        });
        const bear = makeInstance(BEAR_ID, {
            id: "bear1",
            controllerId: "p2",
            ownerId: "p2",
            zone: "hand",
        });
        const id = registerScript(
            "test-op-choice-excludecolor",
            [
                { op: "reveal", player: { target: 0 }, zone: "hand" },
                {
                    op: "choice",
                    kind: "choose-hand-card",
                    player: "controller",
                    zoneOwnerId: { target: 0 },
                    zone: "hand",
                    filter: { excludeColor: "B" },
                    count: 1,
                    prompt: "Choose a nonblack card.",
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
                makePlayer("p2", { hand: [blackCard, bear] }),
            ],
        });
        pushSpell(state, id, "p1", [{ type: "player", id: "p2" }]);
        resolveTopOfStack(state);
        const head = state.pendingChoices![0];
        // Only the green (nonblack) card is a legal candidate.
        expect(head.candidateIds).toEqual(["bear1"]);
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["bear1"],
        });
        expect(state.players[1].hand.map((c) => c.id)).toEqual(["black1"]);
        expect(state.players[1].graveyard.map((c) => c.id)).toEqual(["bear1"]);
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

    // Cost-free `mayPay` (issue #680) — `cost` omitted models a bare "you
    // may …" decision with no payment (Squee, Goblin Nabob: "At the
    // beginning of your upkeep, you may return this card from your graveyard
    // to your hand"), generalizing the existing Op rather than adding a new
    // one (`SpellContext.requestMayPay`'s `cost` field was already optional —
    // Nether Shadow / Verduran Enchantress's `resolve()` already call it
    // cost-free; this Op shape merely exposes that to the DSL). A graveyard-
    // zone ability's `$source` still resolves via the existing Ashen Ghoul
    // self-return path (issue #737).
    it("suspends with a cost-free may-pay PendingChoice (no `cost` field) and returns the source to hand when accepted", () => {
        const UPKEEP_RETURNER_ID = "test-effects-upkeep-returner";
        registerTokenDefinition({
            id: UPKEEP_RETURNER_ID,
            name: UPKEEP_RETURNER_ID,
            rarity: "rare",
            manaCost: { X: 2, R: 1 },
            types: ["Creature"],
            subtypes: ["Goblin"],
            power: 1,
            toughness: 1,
            triggeredAbilities: [
                {
                    id: "upkeep-returner-maypay",
                    oracleText:
                        "At the beginning of your upkeep, you may return this card from your graveyard to your hand.",
                    event: "PHASE_BEGIN",
                    zone: "graveyard",
                    matches: (event, self) =>
                        event.type === "PHASE_BEGIN" &&
                        event.phase === "UPKEEP" &&
                        event.activePlayerId === self.controllerId,
                    effects: [
                        {
                            op: "mayPay",
                            player: "controller",
                            prompt: "Return this card to your hand?",
                            bind: "$yes",
                        },
                        {
                            op: "if",
                            predicate: { binding: "$yes" },
                            then: [
                                {
                                    op: "moveZone",
                                    target: { ref: "$source" },
                                    to: "hand",
                                },
                            ],
                        },
                    ],
                },
            ],
        });
        const dead = makeInstance(UPKEEP_RETURNER_ID, {
            controllerId: "p1",
            ownerId: "p1",
            id: "deadReturner",
            zone: "graveyard",
        });
        const state = makeState({
            activePlayerId: "p1",
            phase: "UPKEEP",
            players: [
                makePlayer("p1", { graveyard: [dead] }),
                makePlayer("p2"),
            ],
        });
        const upkeep = {
            type: "PHASE_BEGIN" as const,
            phase: "UPKEEP" as const,
            activePlayerId: "p1",
        };
        state.stack.push(...collectTriggers(state, [upkeep]));
        expect(resolveTopOfStack(state)).toBeNull(); // suspended on may-pay
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("may-pay");
        expect(head.cost).toBeUndefined(); // cost-free — nothing to pay
        applyMayPaySubmit(state, { playerId: "p1", accept: true });
        expect(state.players[0].graveyard.map((c) => c.id)).not.toContain(
            "deadReturner"
        );
        expect(state.players[0].hand.map((c) => c.id)).toContain(
            "deadReturner"
        );
    });
});

// A `mayPay` Op's ENERGY cost leg (CR 122.1, issue #1194 — "you may pay
// {E}{E}{E}", Guide of Souls). `cost.energy` is a fixed count, paid
// all-or-nothing alongside every other leg through the existing
// `SpellContext.payEnergy` primitive (#697). No new PendingChoice shape — the
// energy leg rides the same `may-pay` pipeline the mana/life/sacrifice/
// discard legs already use.
describe("Effect Script Op: mayPay energy leg (CR 122.1, issue #1194)", () => {
    it("spends energy counters on accept and fires the consequence", () => {
        const id = registerScript("test-op-maypay-energy-paid", [
            {
                op: "mayPay",
                player: "controller",
                cost: { energy: 3 },
                prompt: "Pay {E}{E}{E}?",
                bind: "$paid",
            },
            {
                op: "if",
                predicate: { binding: "$paid" },
                then: [{ op: "gainLife", player: "controller", amount: 7 }],
            },
        ]);
        const state = makeState({
            players: [
                makePlayer("p1", { energyCounters: 5 }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, id, "p1");
        expect(resolveTopOfStack(state)).toBeNull(); // suspended on may-pay
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("may-pay");
        expect(head.cost).toEqual({ energy: 3 });
        applyMayPaySubmit(state, { playerId: "p1", accept: true });
        expect(state.players[0].energyCounters).toBe(2); // 5 - 3
        expect(state.players[0].life).toBe(27); // 20 + 7 — consequence fired
        expect(state.stack).toHaveLength(0);

        // Wire format — energyCounters is board-visible (Guide of Souls'
        // ETB grants it, and the may-pay prompt reads it) and must survive
        // the projection.
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.players[0].energyCounters).toBe(2);
    });

    it("does not spend energy when the payment is declined", () => {
        const id = registerScript("test-op-maypay-energy-declined", [
            {
                op: "mayPay",
                player: "controller",
                cost: { energy: 3 },
                prompt: "Pay {E}{E}{E}?",
                bind: "$paid",
            },
            {
                op: "if",
                predicate: { binding: "$paid" },
                then: [{ op: "gainLife", player: "controller", amount: 7 }],
            },
        ]);
        const state = makeState({
            players: [
                makePlayer("p1", { energyCounters: 5 }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        applyMayPaySubmit(state, { playerId: "p1", accept: false });
        expect(state.players[0].energyCounters).toBe(5); // unspent
        expect(state.players[0].life).toBe(20); // consequence skipped
    });

    it("rejects the accept when the player lacks enough energy (all-or-nothing, CR 117.3a)", () => {
        const id = registerScript("test-op-maypay-energy-unaffordable", [
            {
                op: "mayPay",
                player: "controller",
                cost: { energy: 3 },
                prompt: "Pay {E}{E}{E}?",
                bind: "$paid",
            },
        ]);
        const state = makeState({
            players: [
                makePlayer("p1", { energyCounters: 2 }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        expect(() =>
            applyMayPaySubmit(state, { playerId: "p1", accept: true })
        ).toThrow("Cannot pay the cost");
        expect(state.players[0].energyCounters).toBe(2); // unspent
    });
});

// A `mayPay` Op's dynamically-derived cost leg (issue #1150, `DynamicMayPay-
// ManaCost`: `{ manaCostOf, reducedBy }`) — "pay a runtime-selected object's
// own printed mana cost, reduced by a fixed generic amount". Exercises the
// exact template Flash (MIR) uses: a `choice` binds `$picked` to a card put
// from hand onto the battlefield, `mayPay`'s cost reads THAT card's own
// printed mana cost via `manaCostOf: { ref: "$picked" }`, and `reducedBy`
// trims the generic portion (CR 601.2f — colored pips untouched), floored at
// {0} (CR 118.9).
describe("Effect Script Op: mayPay dynamic cost (manaCostOf/reducedBy, issue #1150)", () => {
    const DYNAMIC_COST_CREATURE_ID = "test-op-maypay-dynamic-creature";
    registerTokenDefinition({
        id: DYNAMIC_COST_CREATURE_ID,
        name: DYNAMIC_COST_CREATURE_ID,
        rarity: "common",
        // {3}{G} — a 3-generic cost big enough to show a NON-trivial
        // reduction (reduced by 2 → {1}{G}), distinct from the floor case
        // exercised below.
        manaCost: { X: 3, G: 1 },
        types: ["Creature"],
        subtypes: ["Bear"],
        power: 2,
        toughness: 2,
    });
    const CHEAP_CREATURE_ID = "test-op-maypay-dynamic-cheap-creature";
    registerTokenDefinition({
        id: CHEAP_CREATURE_ID,
        name: CHEAP_CREATURE_ID,
        rarity: "common",
        // {1}{G} — generic (1) is LESS than reducedBy (2): the reduction
        // must floor at {0} generic (CR 118.9), not go negative.
        manaCost: { X: 1, G: 1 },
        types: ["Creature"],
        subtypes: ["Bear"],
        power: 1,
        toughness: 1,
    });

    function registerFlashLikeScript(id: string): string {
        return registerScript(id, [
            {
                op: "choice",
                kind: "choose-hand-card",
                player: "controller",
                zone: "hand",
                filter: { type: "Creature" },
                count: { min: 0, max: 1 },
                prompt: "Put a creature card from your hand onto the battlefield (or none).",
                bind: "$picked",
            },
            {
                op: "moveZone",
                cards: { ref: "$picked" },
                player: "controller",
                from: "hand",
                to: "battlefield",
            },
            {
                op: "mayPay",
                player: "controller",
                cost: { manaCostOf: { ref: "$picked" }, reducedBy: 2 },
                prompt: "Pay its mana cost reduced by {2}?",
                bind: "$paid",
            },
            {
                op: "if",
                predicate: { not: { binding: "$paid" } },
                then: [{ op: "sacrifice", permanents: { ref: "$picked" } }],
            },
        ]);
    }

    it("derives the reduced ManaCost from the picked object's printed cost and pays it (kept, not sacrificed)", () => {
        const id = registerFlashLikeScript("test-op-maypay-dynamic-pay");
        const handCreature = makeInstance(DYNAMIC_COST_CREATURE_ID, {
            id: "dynCreature1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    hand: [handCreature],
                    manaPool: { W: 0, U: 0, B: 0, R: 0, G: 1, C: 1 },
                }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, id, "p1");
        expect(resolveTopOfStack(state)).toBeNull(); // suspended on the hand pick
        const pickHead = state.pendingChoices![0];
        expect(pickHead.kind).toBe("choose-hand-card");
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: pickHead.stackItemId,
            step: pickHead.step,
            choiceId: pickHead.choiceId,
            cardInstanceIds: ["dynCreature1"],
        });
        // The picked creature is now on the battlefield, and the script
        // suspended again on the mayPay leg.
        expect(state.players[0].battlefield.map((c) => c.id)).toContain(
            "dynCreature1"
        );
        const payHead = state.pendingChoices![0];
        expect(payHead.kind).toBe("may-pay");
        // {3}{G} reduced by {2} → {1}{G} (generic 3-2=1, colored pip untouched).
        expect(payHead.cost).toEqual({ mana: { G: 1, generic: 1 } });
        // Wire format (ADR 0045 / gre-development.md convention) — the
        // dynamically-derived cost must survive the projection unchanged;
        // the client renders the may-pay prompt from `PublicGameState`, not
        // the fat server state.
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.pendingChoices?.[0].cost).toEqual({
            mana: { G: 1, generic: 1 },
        });
        applyMayPaySubmit(state, { playerId: "p1", accept: true });
        // Paid → kept, not sacrificed; the reduced mana was spent.
        expect(state.players[0].battlefield.map((c) => c.id)).toContain(
            "dynCreature1"
        );
        expect(state.players[0].manaPool.G).toBe(0);
        expect(state.players[0].manaPool.C).toBe(0);
    });

    it("floors the reduction at {0} generic (CR 118.9) and sacrifices the object on decline", () => {
        const id = registerFlashLikeScript("test-op-maypay-dynamic-decline");
        const handCreature = makeInstance(CHEAP_CREATURE_ID, {
            id: "cheapCreature1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { hand: [handCreature] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, id, "p1");
        expect(resolveTopOfStack(state)).toBeNull();
        const pickHead = state.pendingChoices![0];
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: pickHead.stackItemId,
            step: pickHead.step,
            choiceId: pickHead.choiceId,
            cardInstanceIds: ["cheapCreature1"],
        });
        const payHead = state.pendingChoices![0];
        // {1}{G} reduced by {2} → generic floors at {0} (CR 118.9), not -1;
        // the colored pip is never touched by a generic reduction.
        expect(payHead.cost).toEqual({ mana: { G: 1 } });
        applyMayPaySubmit(state, { playerId: "p1", accept: false });
        expect(state.players[0].battlefield.map((c) => c.id)).not.toContain(
            "cheapCreature1"
        );
        expect(state.players[0].graveyard.map((c) => c.id)).toContain(
            "cheapCreature1"
        );
    });

    it("skips the whole mayPay Op (no prompt) when nothing was picked — the bare 'you may' declined", () => {
        const id = registerFlashLikeScript(
            "test-op-maypay-dynamic-nothing-picked"
        );
        const state = makeState();
        pushSpell(state, id, "p1"); // empty hand — nothing to pick
        // The choice finds zero candidates (CR 608.2b) and is skipped
        // entirely, so the whole script runs to completion in one go —
        // no may-pay prompt is ever raised for a creature that was never
        // put into play.
        expect(resolveTopOfStack(state)).not.toBeNull();
        expect(state.pendingChoices ?? []).toHaveLength(0);
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

    // picksNonEmpty (issue #1287) — reads whether a preceding `choice` Op's
    // picks binding actually captured anything. Krovikan Sorcerer / Mesmeric
    // Trance's "discard a card: draw a card" template: the discard is paid
    // in-effect via `choice` + `discard`, and the draw is gated on whether
    // the discard choice found a card to pick (CR 608.2b — zero candidates
    // means the choice Op skips entirely and the binding is never captured).
    describe("picksNonEmpty predicate (issue #1287)", () => {
        function looterScript(id: string): string {
            return registerScript(id, [
                {
                    op: "choice",
                    kind: "choose-hand-card",
                    player: "controller",
                    zone: "hand",
                    count: 1,
                    prompt: "Discard a card.",
                    bind: "$discarded",
                },
                {
                    op: "discard",
                    player: "controller",
                    cards: { ref: "$discarded" },
                },
                {
                    op: "if",
                    predicate: { picksNonEmpty: { ref: "$discarded" } },
                    then: [{ op: "draw", player: "controller", count: 1 }],
                },
            ]);
        }

        it("a captured, nonempty pick takes the then branch (discard → draw)", () => {
            const id = looterScript("test-if-picksnonempty-true");
            const hand = [
                makeInstance(BEAR_ID, {
                    id: "h1",
                    controllerId: "p1",
                    ownerId: "p1",
                    zone: "hand",
                }),
            ];
            const lib = [
                makeInstance(BEAR_ID, {
                    id: "lib0",
                    controllerId: "p1",
                    ownerId: "p1",
                    zone: "library",
                }),
            ];
            const state = makeState({
                players: [
                    makePlayer("p1", { hand, library: lib }),
                    makePlayer("p2"),
                ],
            });
            pushSpell(state, id, "p1");
            // Suspends on the discard choice.
            expect(resolveTopOfStack(state)).toBeNull();
            const head = state.pendingChoices![0];
            applyPendingChoiceSubmit(state, {
                playerId: "p1",
                stackItemId: head.stackItemId,
                step: head.step,
                choiceId: head.choiceId,
                cardInstanceIds: ["h1"],
            });
            // Discarded h1, then picksNonEmpty($discarded) is true → drew
            // lib0. (The resolved sorcery itself also lands in the
            // graveyard, CR 608.2k — assert h1 is THERE, not exact equality.)
            expect(state.players[0].graveyard.map((c) => c.id)).toContain("h1");
            expect(state.players[0].hand.map((c) => c.id)).toEqual(["lib0"]);
            expect(state.stack).toHaveLength(0);
            // Wire — the outcome (hand/graveyard contents) is client-visible;
            // re-run the same assertion against the projected state.
            const projected = projectPublicState(state, 2, "p1");
            expect(projected.players[0].hand.map((c) => c?.id)).toEqual([
                "lib0",
            ]);
            expect(projected.players[0].graveyard.map((c) => c.id)).toContain(
                "h1"
            );
        });

        it("an uncaptured pick (empty hand, zero candidates) takes no branch — the draw is skipped (CR 608.2b)", () => {
            const id = looterScript("test-if-picksnonempty-false");
            const lib = [
                makeInstance(BEAR_ID, {
                    id: "lib0",
                    controllerId: "p1",
                    ownerId: "p1",
                    zone: "library",
                }),
            ];
            const state = makeState({
                players: [
                    makePlayer("p1", { hand: [], library: lib }),
                    makePlayer("p2"),
                ],
            });
            pushSpell(state, id, "p1");
            // Zero hand candidates → the choice Op skips entirely (no
            // suspension), the discard Op skips (binding never captured),
            // and picksNonEmpty reads false → the draw never happens.
            resolveTopOfStack(state);
            expect(state.pendingChoices ?? []).toHaveLength(0);
            expect(state.players[0].hand).toHaveLength(0);
            expect(state.players[0].library.map((c) => c.id)).toEqual(["lib0"]);
            expect(state.stack).toHaveLength(0);
        });
    });

    // picksMatchFilter (issue #1343) — true iff at least one picked card,
    // resolved via `player`'s graveyard (CR 701.9 — every discard lands
    // there), matches an `EffectCardFilter`. Connive's "if you discarded a
    // NONLAND card, put a +1/+1 counter on this creature" gate (CR 701.50,
    // Ledger Shredder). Exercised here through a synthetic permanent so a
    // `counters` Op can target `$source` (a resolving SPELL/sorcery has no
    // battlefield presence to put a counter on) — this is the construct's OWN
    // permanent test: any later card reusing `picksMatchFilter` inherits this
    // coverage free.
    describe("picksMatchFilter predicate (issue #1343, CR 701.50 connive)", () => {
        const CONNIVE_PROBE_ID = "test-effects-connive-probe";
        const CONNIVE_TRIGGER_ID = "connive-probe-trigger";
        registerTokenDefinition({
            id: CONNIVE_PROBE_ID,
            name: CONNIVE_PROBE_ID,
            rarity: "common",
            manaCost: { X: 1, U: 1 },
            types: ["Creature"],
            subtypes: ["Bird"],
            power: 1,
            toughness: 3,
            staticAbilities: ["flying"],
            triggeredAbilities: [
                spellCastTrigger({
                    id: CONNIVE_TRIGGER_ID,
                    oracleText: "test connive trigger",
                    scope: "any",
                    effects: [
                        { op: "draw", player: "controller", count: 1 },
                        {
                            op: "choice",
                            kind: "choose-hand-card",
                            player: "controller",
                            zone: "hand",
                            count: 1,
                            prompt: "Connive: discard a card.",
                            bind: "$connived",
                        },
                        {
                            op: "discard",
                            player: "controller",
                            cards: { ref: "$connived" },
                        },
                        {
                            op: "if",
                            predicate: {
                                picksMatchFilter: { ref: "$connived" },
                                player: "controller",
                                filter: { excludeType: "Land" },
                            },
                            then: [
                                {
                                    op: "counters",
                                    action: "add",
                                    counter: "+1/+1",
                                    target: { ref: "$source" },
                                    count: 1,
                                },
                            ],
                        },
                    ],
                }),
            ],
        });

        function conniveTriggerOnStack(
            state: GameState,
            source: CardInstanceState
        ): StackItem {
            const trig: StackItem = {
                ...source,
                id: "connive-trig",
                zone: "stack",
                castById: source.controllerId,
                triggeredAbilityId: CONNIVE_TRIGGER_ID,
                triggerSourceId: source.id,
                triggerEvent: {
                    type: "SPELL_CAST",
                    casterId: source.controllerId,
                    spellInstanceId: "x",
                    spellCardId: "x",
                    spellTypes: [],
                    spellSubtypes: [],
                    spellColors: [],
                } as StackItem["triggerEvent"],
                targets: undefined,
            };
            state.stack.push(trig);
            return trig;
        }

        it("discarding a NONLAND card puts a +1/+1 counter on the source — wire format", () => {
            const source = makeInstance(CONNIVE_PROBE_ID, {
                id: "connive1",
                controllerId: "p1",
                ownerId: "p1",
            });
            const hand = [
                makeInstance(BEAR_ID, {
                    id: "h1",
                    controllerId: "p1",
                    ownerId: "p1",
                    zone: "hand",
                }),
            ];
            const lib = [
                makeInstance(BEAR_ID, {
                    id: "lib0",
                    controllerId: "p1",
                    ownerId: "p1",
                    zone: "library",
                }),
            ];
            const state = makeState({
                players: [
                    makePlayer("p1", {
                        hand,
                        library: lib,
                        battlefield: [source],
                    }),
                    makePlayer("p2"),
                ],
            });
            conniveTriggerOnStack(state, source);
            // Draw resolves immediately, then suspends on the discard choice.
            expect(resolveTopOfStack(state)).toBeNull();
            const head = state.pendingChoices![0];
            applyPendingChoiceSubmit(state, {
                playerId: "p1",
                stackItemId: head.stackItemId,
                step: head.step,
                choiceId: head.choiceId,
                cardInstanceIds: ["h1"],
            });
            const after = state.players[0].battlefield.find(
                (c) => c.id === "connive1"
            )!;
            expect(after.counters?.["+1/+1"]).toBe(1);
            expect(state.players[0].graveyard.map((c) => c.id)).toContain("h1");
            // Wire — the counter and graveyard contents are board-visible.
            const projected = projectPublicState(state, 1, "p1");
            const slim = projected.players[0].battlefield.find(
                (c) => c.id === "connive1"
            )!;
            expect(slim.counters?.["+1/+1"]).toBe(1);
            expect(projected.players[0].graveyard.map((c) => c.id)).toContain(
                "h1"
            );
        });

        it("discarding a LAND card puts NO counter on the source", () => {
            const source = makeInstance(CONNIVE_PROBE_ID, {
                id: "connive2",
                controllerId: "p1",
                ownerId: "p1",
            });
            const hand = [
                makeInstance(LAND_ID, {
                    id: "h2",
                    controllerId: "p1",
                    ownerId: "p1",
                    zone: "hand",
                }),
            ];
            const lib = [
                makeInstance(BEAR_ID, {
                    id: "lib1",
                    controllerId: "p1",
                    ownerId: "p1",
                    zone: "library",
                }),
            ];
            const state = makeState({
                players: [
                    makePlayer("p1", {
                        hand,
                        library: lib,
                        battlefield: [source],
                    }),
                    makePlayer("p2"),
                ],
            });
            conniveTriggerOnStack(state, source);
            expect(resolveTopOfStack(state)).toBeNull();
            const head = state.pendingChoices![0];
            applyPendingChoiceSubmit(state, {
                playerId: "p1",
                stackItemId: head.stackItemId,
                step: head.step,
                choiceId: head.choiceId,
                cardInstanceIds: ["h2"],
            });
            const after = state.players[0].battlefield.find(
                (c) => c.id === "connive2"
            )!;
            expect(after.counters?.["+1/+1"] ?? 0).toBe(0);
            expect(state.players[0].graveyard.map((c) => c.id)).toContain("h2");
        });
    });

    // targetIsAnother (issue #1315, CR 702.165a) — object-identity comparison:
    // true iff the announced target slot resolves to a PERMANENT other than
    // the resolving ability's source. This is Backup's own predicate ("if
    // that's ANOTHER creature, it gains …") — exercised here through the real
    // production factory (`backupTrigger`) rather than a hand-rolled script,
    // the same "reuse the production seam" precedent `dashTrigger` follows in
    // dash.test.ts. This is the construct's OWN permanent test: any later
    // card reusing `targetIsAnother` inherits this coverage free.
    describe("targetIsAnother predicate (issue #1315, CR 702.165a)", () => {
        const BACKUP_PROBE_ID = "test-effects-backup-probe";
        registerTokenDefinition({
            id: BACKUP_PROBE_ID,
            name: BACKUP_PROBE_ID,
            rarity: "common",
            manaCost: { X: 2, G: 1 },
            types: ["Creature"],
            subtypes: ["Bear"],
            power: 2,
            toughness: 2,
            staticAbilities: ["backup 1", "trample"],
            triggeredAbilities: [backupTrigger(1, ["trample"])],
        });

        function backupEtbOnStack(
            state: GameState,
            source: CardInstanceState,
            targets: StackItem["targets"]
        ): StackItem {
            const trig: StackItem = {
                ...source,
                id: "backup-trig",
                zone: "stack",
                castById: source.controllerId,
                triggeredAbilityId: "backup-1",
                triggerSourceId: source.id,
                triggerEvent: {
                    type: "PERMANENT_ENTERED",
                    instanceId: source.id,
                    controllerId: source.controllerId,
                    types: ["Creature"],
                } as StackItem["triggerEvent"],
                targets,
            };
            state.stack.push(trig);
            return trig;
        }

        it("false on a SELF target: puts the counter, grants nothing", () => {
            const source = makeInstance(BACKUP_PROBE_ID, {
                id: "backupSelf",
                controllerId: "p1",
                ownerId: "p1",
            });
            const state = makeState({
                players: [
                    makePlayer("p1", { battlefield: [source] }),
                    makePlayer("p2"),
                ],
            });
            backupEtbOnStack(state, source, [
                { type: "permanent", id: "backupSelf" },
            ]);
            resolveTopOfStack(state);
            const after = state.players[0].battlefield.find(
                (c) => c.id === "backupSelf"
            )!;
            // CR 702.165a — "put N +1/+1 counters on target creature" always
            // happens, self-target included.
            expect(after.counters?.["+1/+1"]).toBe(1);
            // CR 702.165a — "If that's ANOTHER creature" — false on self, so
            // no grant: `trample` was already printed, but not RE-granted.
            expect(after.grantedStaticAbilities ?? []).toHaveLength(0);
        });

        it("true on an OTHER target: puts the counter AND grants the source's listed ability until end of turn", () => {
            const source = makeInstance(BACKUP_PROBE_ID, {
                id: "backupSrc",
                controllerId: "p1",
                ownerId: "p1",
            });
            const bear = makeInstance(BEAR_ID, {
                id: "backupOther",
                controllerId: "p1",
                ownerId: "p1",
            });
            const state = makeState({
                players: [
                    makePlayer("p1", { battlefield: [source, bear] }),
                    makePlayer("p2"),
                ],
            });
            backupEtbOnStack(state, source, [
                { type: "permanent", id: "backupOther" },
            ]);
            resolveTopOfStack(state);
            const granted = state.players[0].battlefield.find(
                (c) => c.id === "backupOther"
            )!;
            expect(granted.counters?.["+1/+1"]).toBe(1);
            // CR 702.165a — the target gains the source's printed ability
            // (trample) until end of turn — it did not have it printed.
            expect(granted.staticAbilities).toContain("trample");
            expect(granted.grantedStaticAbilities).toHaveLength(1);
            // Wire format — a granted keyword + a counter are both
            // board-visible; neither may be stripped on the way to the client.
            const projected = projectPublicState(state, 1, "p1");
            const slim = projected.players[0].battlefield.find(
                (c) => c.id === "backupOther"
            )!;
            expect(slim.staticAbilities).toContain("trample");
            expect(slim.counters?.["+1/+1"]).toBe(1);
        });
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

describe("Effect Script Op: sacrifice — single-object target form (CR 701.16, issue #731)", () => {
    it("sacrifices the announced target permanent", () => {
        const id = registerScript("test-sac-target", [
            { op: "sacrifice", target: { target: 0 } },
        ]);
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        makeInstance(BEAR_ID, {
                            id: "victim",
                            controllerId: "p1",
                        }),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, id, "p1", [{ type: "permanent", id: "victim" }]);
        resolveTopOfStack(state);
        expect(
            state.players[0].battlefield.some((c) => c.id === "victim")
        ).toBe(false);
        expect(state.players[0].graveyard.some((c) => c.id === "victim")).toBe(
            true
        );
    });

    it("is a no-op when the target has already left the battlefield (CR 608.2b)", () => {
        const id = registerScript("test-sac-target-gone", [
            { op: "sacrifice", target: { target: 0 } },
        ]);
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        // Target id points at nothing on the battlefield — resolveObjectRef
        // returns undefined and the Op skips without throwing.
        pushSpell(state, id, "p1", [{ type: "permanent", id: "ghost" }]);
        expect(() => resolveTopOfStack(state)).not.toThrow();
    });
});

// forEach + moveZone (target-shape, to: "hand") — a NEW construct
// combination (issue #685, Upheaval): every prior forEach consumer paired
// $each with destroy/exile/pump/counters/tapUntap/grantAbility, never with
// moveZone's target-shape. `moveZone`'s `resolveObjectRef(ctx, op.target)`
// call is generic (identical to destroy/exile's), so `{ ref: "$each" }`
// resolves the same way — this test is the combination's permanent proof,
// reused free by every later mass-bounce card (CR 400.7 zone change,
// CR 608.2i "determined once" set-freeze).
describe("Effect Script construct: forEach + moveZone — mass bounce (CR 400.7 / 608.2i, issue #685)", () => {
    const BOUNCE_LAND_ID = "test-foreach-movezone-land";
    registerTokenDefinition({
        id: BOUNCE_LAND_ID,
        name: BOUNCE_LAND_ID,
        rarity: "common",
        manaCost: {},
        types: ["Land"],
    });

    it("returns EVERY permanent on BOTH battlefields to its owner's hand, regardless of type (Upheaval sweep)", () => {
        const id = registerScript("test-foreach-movezone-sweep", [
            {
                op: "forEach",
                select: { set: "permanents", zone: "battlefield" },
                effects: [
                    { op: "moveZone", target: { ref: "$each" }, to: "hand" },
                ],
            },
        ]);
        const myCreature = makeInstance(BEAR_ID, {
            controllerId: "p1",
            id: "uphA",
        });
        const myLand = makeInstance(BOUNCE_LAND_ID, {
            controllerId: "p1",
            id: "uphB",
        });
        const theirCreature = makeInstance(BEAR_ID, {
            id: "uphC",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [myCreature, myLand] }),
                makePlayer("p2", { battlefield: [theirCreature] }),
            ],
        });
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        expect(state.players[0].battlefield).toHaveLength(0);
        expect(state.players[1].battlefield).toHaveLength(0);
        expect(state.players[0].hand.map((c) => c.id).sort()).toEqual([
            "uphA",
            "uphB",
        ]);
        expect(state.players[1].hand.map((c) => c.id)).toEqual(["uphC"]);
    });

    it("a token bounced to hand ceases to exist instead (CR 111.7) — no crash, no phantom hand card", () => {
        const id = registerScript("test-foreach-movezone-token", [
            {
                op: "forEach",
                select: { set: "permanents", zone: "battlefield" },
                effects: [
                    { op: "moveZone", target: { ref: "$each" }, to: "hand" },
                ],
            },
        ]);
        const token = makeInstance(BEAR_ID, {
            id: "uphTok",
            controllerId: "p1",
            isToken: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [token] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, id, "p1");
        expect(() => resolveTopOfStack(state)).not.toThrow();
        // CR 111.7 is a state-based action — the token still transiently sits
        // in hand right after the move; `checkStateBasedActions` is what
        // wipes it (mirrors the engine's real post-resolution SBA sweep).
        checkStateBasedActions(state);
        expect(state.players[0].battlefield).toHaveLength(0);
        expect(state.players[0].hand.some((c) => c.id === "uphTok")).toBe(
            false
        );
    });

    // Wire format (mandatory — the effect is fully client-visible): every
    // permanent leaves both battlefields and the mover's hand count grows.
    it("wire format: the mass-bounce outcome survives projectPublicState", () => {
        const id = registerScript("test-foreach-movezone-wire", [
            {
                op: "forEach",
                select: { set: "permanents", zone: "battlefield" },
                effects: [
                    { op: "moveZone", target: { ref: "$each" }, to: "hand" },
                ],
            },
        ]);
        const mine = makeInstance(BEAR_ID, { controllerId: "p1", id: "uphW1" });
        const theirs = makeInstance(BEAR_ID, {
            id: "uphW2",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [mine] }),
                makePlayer("p2", { battlefield: [theirs] }),
            ],
        });
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.players[0].battlefield).toHaveLength(0);
        expect(projected.players[1].battlefield).toHaveLength(0);
        expect(projected.players[0].hand).toHaveLength(1);
        // Opponent's hand is hidden from this viewer — slimmed to a count.
        expect(projected.players[1].hand).toEqual([null]);
    });

    // Colour-filtered mass bounce (Hibernation, issue #995, CR 202.2 / 400.7):
    // the SAME forEach+moveZone sweep narrowed by `filter: { color: "G" }` on
    // the selector. Asserts the two acceptance criteria — every GREEN permanent
    // (any type, both battlefields) returns to its owner's hand, and non-green
    // permanents are untouched. The colour predicate is matched against
    // EFFECTIVE colours (`getBattlefieldIds` populates layer-5 colour), the
    // shared filter path every `filter.color` consumer uses. BEAR_ID is green
    // ({G}); BOUNCE_LAND_ID is a colourless land.
    it("returns only GREEN permanents to their owners' hands, sparing non-green (Hibernation)", () => {
        const id = registerScript("test-foreach-movezone-color", [
            {
                op: "forEach",
                select: {
                    set: "permanents",
                    zone: "battlefield",
                    filter: { color: "G" },
                },
                effects: [
                    { op: "moveZone", target: { ref: "$each" }, to: "hand" },
                ],
            },
        ]);
        const myGreen = makeInstance(BEAR_ID, {
            controllerId: "p1",
            id: "hibG1",
        });
        const myLand = makeInstance(BOUNCE_LAND_ID, {
            controllerId: "p1",
            id: "hibLand",
        });
        const theirGreen = makeInstance(BEAR_ID, {
            id: "hibG2",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [myGreen, myLand] }),
                makePlayer("p2", { battlefield: [theirGreen] }),
            ],
        });
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        // Both green creatures bounced, across both battlefields.
        expect(state.players[0].hand.map((c) => c.id)).toEqual(["hibG1"]);
        expect(state.players[1].hand.map((c) => c.id)).toEqual(["hibG2"]);
        // The colourless land is untouched.
        expect(state.players[0].battlefield.map((c) => c.id)).toEqual([
            "hibLand",
        ]);
        expect(state.players[1].battlefield).toHaveLength(0);
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
        expect(inst.payload).toEqual({ it: "dtb1" });
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
        // The fired stack item carries the inline trigger's oracle text so the
        // client can render the ability tile (art + text) — an inline trigger
        // has no `cardDef.delayedTriggers[]` row to look it up from. The field
        // must survive the wire projection (bug: inline delayed triggers
        // rendered as a full-card image on the stack).
        expect(state.stack[0].delayedOracleText).toBe(
            "At the beginning of the next end step, destroy it."
        );
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.stack[0].delayedOracleText).toBe(
            "At the beginning of the next end step, destroy it."
        );
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
            self: "launcher1",
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
        expect(state.delayedTriggers![0].payload).toEqual({ p: "p2" });
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

// --- Sneak Attack shape: choice(hand) + moveZone(bind) + grantAbility +
// delayedTrigger(capture) + sacrifice(target) (CR 400.7 / 603.7 / 701.16,
// issue #1151) -----------------------------------------------------------
// The full "You may put a creature card from your hand onto the
// battlefield. That creature gains haste. Sacrifice the creature at the
// beginning of the next end step." template, end to end through the real
// resolution path. Exercises the NEW combination this issue closes: a
// `moveZone` cards-shape `bind` feeding BOTH an immediate `grantAbility` and
// a `delayedTrigger` capture, whose body sacrifices the EXACT captured
// creature via the `sacrifice` Op's `target` form — not a fresh `choice`.
describe("Effect Script construct: choice + moveZone(bind) + grantAbility + delayedTrigger(capture) + sacrifice(target) — Sneak Attack shape (CR 400.7 / 603.7 / 701.16, issue #1151)", () => {
    const SNEAK_SCRIPT: EffectOp[] = [
        {
            op: "choice",
            kind: "choose-hand-card",
            player: "controller",
            zone: "hand",
            filter: { type: "Creature" },
            count: { min: 0, max: 1 },
            prompt: "Put a creature card from your hand onto the battlefield.",
            bind: "$picked",
        },
        {
            op: "moveZone",
            cards: { ref: "$picked" },
            player: "controller",
            from: "hand",
            to: "battlefield",
            bind: "$sneak",
        },
        {
            op: "grantAbility",
            ability: "haste",
            target: { ref: "$sneak" },
            duration: { phase: "end-of-turn" },
        },
        {
            op: "delayedTrigger",
            timing: "next-end-step",
            oracleText:
                "Sacrifice the creature at the beginning of the next end step.",
            capture: { $captured: { ref: "$sneak" } },
            effects: [{ op: "sacrifice", target: { ref: "$captured" } }],
        },
    ];

    it("puts the picked creature onto the battlefield with haste, then sacrifices EXACTLY that creature at the next end step", () => {
        const id = registerScript("test-sneak-attack-shape", SNEAK_SCRIPT);
        const creature = makeInstance(BEAR_ID, {
            id: "sneak1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const state = makeState({
            players: [makePlayer("p1", { hand: [creature] }), makePlayer("p2")],
        });
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("choose-hand-card");
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["sneak1"],
        });
        const entered = state.players[0].battlefield.find(
            (c) => c.id === "sneak1"
        )!;
        expect(entered).toBeDefined();
        expect(entered.staticAbilities).toContain("haste");
        // The delayed trigger captured the SAME instance id the moveZone
        // Op's `bind` snapshotted — not a picks list a later choice re-derives.
        expect(state.delayedTriggers).toHaveLength(1);
        expect(state.delayedTriggers![0].payload).toEqual({
            captured: "sneak1",
        });
        // Firing it sacrifices the exact creature — no further player choice.
        fireDelayedTriggers(state, "next-end-step");
        resolveTopOfStack(state);
        expect(
            state.players[0].battlefield.some((c) => c.id === "sneak1")
        ).toBe(false);
        expect(state.players[0].graveyard.map((c) => c.id)).toContain("sneak1");
    });

    it("skips the sacrifice (no throw) when the captured creature already left before the trigger fires (CR 608.2b)", () => {
        const id = registerScript("test-sneak-attack-shape-gone", SNEAK_SCRIPT);
        const creature = makeInstance(BEAR_ID, {
            id: "sneak2",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const state = makeState({
            players: [makePlayer("p1", { hand: [creature] }), makePlayer("p2")],
        });
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        const head = state.pendingChoices![0];
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["sneak2"],
        });
        const entered = state.players[0].battlefield.find(
            (c) => c.id === "sneak2"
        )!;
        expect(entered).toBeDefined();
        // Removed by something else (a blocker trade, a removal spell)
        // before the delayed trigger's boundary — moved straight to the
        // graveyard, exactly once.
        state.players[0].battlefield = [];
        state.players[0].graveyard.push({ ...entered, zone: "graveyard" });
        fireDelayedTriggers(state, "next-end-step");
        expect(() => resolveTopOfStack(state)).not.toThrow();
        // No double-move — the graveyard still has exactly one copy (the
        // body's sacrifice skipped, CR 608.2b — the captured binding no
        // longer resolves to a battlefield permanent).
        expect(
            state.players[0].graveyard.filter((c) => c.id === "sneak2")
        ).toHaveLength(1);
    });

    it("survives the wire projection: the entered creature's granted haste is visible, and after the delayed sacrifice fires it moves to the public graveyard", () => {
        const id = registerScript("test-sneak-attack-shape-wire", SNEAK_SCRIPT);
        const creature = makeInstance(BEAR_ID, {
            id: "sneak3",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const state = makeState({
            players: [makePlayer("p1", { hand: [creature] }), makePlayer("p2")],
        });
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        const head = state.pendingChoices![0];
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["sneak3"],
        });
        const projectedBefore = projectPublicState(state, 1, "p2");
        const slimBefore = projectedBefore.players[0].battlefield.find(
            (c) => c.id === "sneak3"
        )!;
        expect(slimBefore.staticAbilities).toContain("haste");
        fireDelayedTriggers(state, "next-end-step");
        resolveTopOfStack(state);
        const projectedAfter = projectPublicState(state, 2, "p2");
        expect(
            projectedAfter.players[0].battlefield.some((c) => c.id === "sneak3")
        ).toBe(false);
        expect(projectedAfter.players[0].graveyard.map((c) => c.id)).toContain(
            "sneak3"
        );
    });
});

// --- delayedTrigger LIST-valued capture (ADR 0049, issue #866) ----------------
// A `delayedTrigger` capture may resolve to N ids via a `{ select }` source and
// FREEZE them into the payload as a `string[]` (freeze-at-cast, not fire-time:
// combat state is live-only, so a fire-time scan returns empty once the target
// itself died). The inline body reads the frozen list with the new
// `forEach { set: "bound", ref }` selector and acts on each member. v1's only
// list selector is `combatPartners of { target }` — the creatures that BLOCKED
// OR WERE BLOCKED BY the target this turn (CR 509.1h, BOTH directions). These
// tests drive the REAL path end to end (schedule → fire → resolve) exactly as
// the engine does, and cover the frozen `string[]` across projection + DB.
describe("Effect Script Op: delayedTrigger LIST capture (combatPartners, CR 509.1h / ADR 0049)", () => {
    const VENOM_SCRIPT: EffectOp[] = [
        {
            op: "delayedTrigger",
            timing: "next-end-of-combat",
            oracleText:
                "At end of combat, destroy all creatures that blocked or were blocked by it.",
            capture: {
                $partners: {
                    select: { set: "combatPartners", of: { target: 0 } },
                },
            },
            effects: [
                {
                    op: "forEach",
                    select: { set: "bound", ref: "$partners" },
                    effects: [{ op: "destroy", target: { ref: "$each" } }],
                },
            ],
        },
    ];

    /** p1's attacker "att" blocked by p2's "blkA" and "blkB" (CR 509.1h). */
    function combatState(): GameState {
        const att = makeInstance(BEAR_ID, {
            id: "att",
            controllerId: "p1",
            ownerId: "p1",
            isAttacking: true,
        });
        const blkA = makeInstance(BEAR_ID, {
            id: "blkA",
            controllerId: "p2",
            ownerId: "p2",
            isBlocking: true,
        });
        const blkB = makeInstance(BEAR_ID, {
            id: "blkB",
            controllerId: "p2",
            ownerId: "p2",
            isBlocking: true,
        });
        return makeState({
            players: [
                makePlayer("p1", { battlefield: [att] }),
                makePlayer("p2", { battlefield: [blkA, blkB] }),
            ],
            phase: "DECLARE_BLOCKERS",
            combat: {
                attackerIds: ["att"],
                confirmed: true,
                blockerAssignments: { blkA: ["att"], blkB: ["att"] },
                blockersConfirmed: true,
            },
        });
    }

    it("freezes the target-attacker's blockers as a list at cast, then destroys each at end of combat", () => {
        const id = registerScript("test-op-list-attacker", VENOM_SCRIPT);
        const state = combatState();
        pushSpell(state, id, "p1", [{ type: "permanent", id: "att" }]);
        resolveTopOfStack(state);
        // Freeze-at-cast: the two blockers are in the payload as a `string[]`.
        expect(state.delayedTriggers).toHaveLength(1);
        const frozen = state.delayedTriggers![0].payload.partners;
        expect(Array.isArray(frozen)).toBe(true);
        expect([...(frozen as string[])].sort()).toEqual(["blkA", "blkB"]);
        // Fire at end of combat → the inline forEach body destroys each member.
        fireDelayedTriggers(state, "next-end-of-combat");
        resolveTopOfStack(state);
        expect(state.players[1].battlefield).toHaveLength(0);
        expect(state.players[1].graveyard.map((c) => c.id).sort()).toEqual([
            "blkA",
            "blkB",
        ]);
    });

    it("captures the OTHER direction too — a target-blocker freezes the attacker it blocked (CR 509.1h bidirectional)", () => {
        const id = registerScript("test-op-list-blocker", VENOM_SCRIPT);
        const state = combatState();
        // Target a BLOCKER: the inverse scan must find the attacker it blocked.
        pushSpell(state, id, "p1", [{ type: "permanent", id: "blkA" }]);
        resolveTopOfStack(state);
        expect(state.delayedTriggers![0].payload.partners).toEqual(["att"]);
        fireDelayedTriggers(state, "next-end-of-combat");
        resolveTopOfStack(state);
        // Only the attacker "att" (p1) dies; both untargeted blockers survive.
        // (p1's graveyard also holds the resolved Sorcery itself, so assert att
        // is present rather than sole-occupant.)
        expect(state.players[0].battlefield).toHaveLength(0);
        expect(state.players[0].graveyard.map((c) => c.id)).toContain("att");
        expect(state.players[1].battlefield.map((c) => c.id).sort()).toEqual([
            "blkA",
            "blkB",
        ]);
    });

    it("keeps a member that has left the battlefield in the frozen list — its destroy is a no-op (CR 608.2b)", () => {
        const id = registerScript("test-op-list-lki", VENOM_SCRIPT);
        const state = combatState();
        pushSpell(state, id, "p1", [{ type: "permanent", id: "att" }]);
        resolveTopOfStack(state);
        // One frozen partner leaves before the trigger fires.
        state.players[1].battlefield = state.players[1].battlefield.filter(
            (c) => c.id !== "blkA"
        );
        state.players[1].graveyard.push(
            makeInstance(BEAR_ID, {
                id: "blkA",
                controllerId: "p2",
                ownerId: "p2",
                zone: "graveyard",
            })
        );
        fireDelayedTriggers(state, "next-end-of-combat");
        expect(() => resolveTopOfStack(state)).not.toThrow();
        // blkB still dies; blkA is not double-destroyed (one grave copy).
        expect(state.players[1].battlefield).toHaveLength(0);
        expect(state.players[1].graveyard.map((c) => c.id).sort()).toEqual([
            "blkA",
            "blkB",
        ]);
    });

    it("wire format: the frozen string[] payload survives projection and the DB round-trip and replays identically", () => {
        const id = registerScript("test-op-list-wire", VENOM_SCRIPT);
        const state = combatState();
        pushSpell(state, id, "p1", [{ type: "permanent", id: "att" }]);
        resolveTopOfStack(state);
        // Projection passes `delayedTriggers` through whole — the list payload
        // must reach the client untouched.
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.delayedTriggers).toEqual(state.delayedTriggers);
        // DB round-trip while queued: the `string[]` value survives compact/
        // expand (JSON-pure, no scalar-only assumption).
        const reloaded = expandState(compactState(state));
        expect(reloaded.delayedTriggers).toEqual(state.delayedTriggers);
        expect(reloaded.delayedTriggers![0].payload.partners).toEqual(
            state.delayedTriggers![0].payload.partners
        );
        // The reloaded state fires and resolves identically (replay
        // determinism): both blockers destroyed.
        fireDelayedTriggers(reloaded, "next-end-of-combat");
        resolveTopOfStack(reloaded);
        expect(reloaded.players[1].graveyard.map((c) => c.id).sort()).toEqual([
            "blkA",
            "blkB",
        ]);
    });
});

// --- forEach{set:"bound"} over a PICKS-family binding (issue #1284) ---------
// `forEach { set: "bound", ref }`'s validator, until now, only accepted a LIST
// binding (a delayedTrigger/divideIntoPiles capture, tested above). This was
// a validator-only restriction: a `choice` Op's picks binding (family
// "picks") is the identical frozen `string[]` runtime storage
// (`readBinding`/`recallChoice`), and `execForEach`'s per-member `$each`
// snapshot binding is produced the same way regardless of which family
// supplied the member set. This test drives the pattern the widened validator
// unblocks — Frantic Search's "untap up to three lands" (`convex/cards/sets/
// ulg/blue.ts`) — through the REAL resolution path: a `choice(kind:
// "choose-permanents")` picks a subset of the caster's lands, and the
// following `forEach { set: "bound" }` consumes that PICKS binding directly
// (no intervening list-family capture) to untap each pick.
describe('Effect Script Op: forEach{set:"bound"} over a picks-family binding (issue #1284)', () => {
    const UNTAP_PICKED_SCRIPT: EffectOp[] = [
        {
            op: "choice",
            kind: "choose-permanents",
            player: "controller",
            zone: "battlefield",
            filter: { type: "Land" },
            count: { min: 0, max: 3 },
            prompt: "Untap up to three lands.",
            bind: "$lands",
        },
        {
            op: "forEach",
            select: { set: "bound", ref: "$lands" },
            effects: [
                { op: "tapUntap", action: "untap", target: { ref: "$each" } },
            ],
        },
    ];

    function threeTappedLands(): GameState {
        const land = (id: string) =>
            makeInstance(LAND_ID, {
                id,
                controllerId: "p1",
                ownerId: "p1",
                isTapped: true,
            });
        return makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [land("landA"), land("landB"), land("landC")],
                }),
                makePlayer("p2"),
            ],
        });
    }

    it("untaps exactly the picked lands, leaving the unpicked one tapped", () => {
        const id = registerScript(
            "test-op-bound-picks-untap",
            UNTAP_PICKED_SCRIPT
        );
        const state = threeTappedLands();
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("choose-permanents");
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["landA", "landB"],
        });
        const byId = (cid: string) =>
            state.players[0].battlefield.find((c) => c.id === cid)!;
        expect(byId("landA").isTapped).toBe(false);
        expect(byId("landB").isTapped).toBe(false);
        expect(byId("landC").isTapped).toBe(true); // not picked — stays tapped
        // Wire format: the untapped state must survive the projection (the
        // client reads tap state off the slimmed wire state).
        const projected = projectPublicState(state, 1, "p1");
        const slimA = projected.players[0].battlefield.find(
            (c) => c.id === "landA"
        )!;
        const slimC = projected.players[0].battlefield.find(
            (c) => c.id === "landC"
        )!;
        expect(slimA.isTapped).toBe(false);
        expect(slimC.isTapped).toBe(true);
    });

    it("declining down to ZERO picks is legal — the bound forEach then iterates nothing", () => {
        const id = registerScript(
            "test-op-bound-picks-untap-decline",
            UNTAP_PICKED_SCRIPT
        );
        const state = threeTappedLands();
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        const head = state.pendingChoices![0];
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: [],
        });
        expect(state.players[0].battlefield.every((c) => c.isTapped)).toBe(
            true
        );
    });
});

// --- optionChoice Op: modal "choose one" (CR 700.2 / 601.2b, issue #849) ------
// The interpreter presents the ordered modes as an `option-pick` Pending Choice
// and SUSPENDS; on the pick it runs the chosen mode's `effects` through the same
// `runOpList` path an `if` branch uses. Like `if`/`forEach` it is a structural
// construct that always re-descends on a re-walk, so a suspending Op nested
// inside the chosen mode resumes correctly (CR 608.3). A single-mode Op
// auto-resolves; author-supplied mode `id`s are preserved so a migrated card's
// (untouched) per-card test can submit the same semantic option ids.

/** Submits an option-pick answer (the chosen mode's option id) through the same
 *  seam the generic `submitResolutionChoice` mutation drives. */
function submitOptionPick(
    state: ReturnType<typeof makeState>,
    optionId: string
): void {
    const head = state.pendingChoices![0];
    applyPendingChoiceSubmit(state, {
        playerId: head.playerId,
        stackItemId: head.stackItemId,
        step: head.step,
        choiceId: head.choiceId,
        cardInstanceIds: [optionId],
    });
}

describe("Effect Script Op: optionChoice (CR 700.2 / 601.2b, issue #849)", () => {
    const TWO_MODES: EffectOp[] = [
        {
            op: "optionChoice",
            prompt: "Choose one.",
            modes: [
                {
                    label: "Gain 3 life",
                    effects: [
                        { op: "gainLife", player: "controller", amount: 3 },
                    ],
                },
                {
                    label: "Target opponent loses 3 life",
                    effects: [
                        { op: "loseLife", player: "opponent", amount: 3 },
                    ],
                },
            ],
        },
    ];

    it("suspends with an option-pick choice, then runs the FIRST chosen mode", () => {
        const id = registerScript("test-op-optionchoice-first", TWO_MODES);
        const state = makeState();
        pushSpell(state, id, "p1");
        expect(resolveTopOfStack(state)).toBeNull(); // suspended on the pick
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("option-pick");
        expect(head.playerId).toBe("p1"); // the resolving controller chooses
        expect(head.options?.map((o) => o.id)).toEqual(["0", "1"]);
        // CR 608.3 — the spell stays on the stack while suspended.
        expect(state.stack).toHaveLength(1);

        submitOptionPick(state, "0");
        expect(state.players[0].life).toBe(23); // gained 3
        expect(state.players[1].life).toBe(20); // the other mode did NOT run
        expect(state.stack).toHaveLength(0);
        expect(state.pendingChoices).toBeUndefined();
    });

    it("runs the SECOND chosen mode (only the picked branch executes)", () => {
        const id = registerScript("test-op-optionchoice-second", TWO_MODES);
        const state = makeState();
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        submitOptionPick(state, "1");
        expect(state.players[1].life).toBe(17); // opponent lost 3
        expect(state.players[0].life).toBe(20); // gain-life mode did NOT run
    });

    it("executes a MULTI-OP mode body top to bottom (CR 608.2c)", () => {
        const id = registerScript("test-op-optionchoice-multiop", [
            {
                op: "optionChoice",
                prompt: "Choose one.",
                modes: [
                    {
                        label: "Gain 2 and drain 2",
                        effects: [
                            { op: "gainLife", player: "controller", amount: 2 },
                            { op: "loseLife", player: "opponent", amount: 2 },
                        ],
                    },
                    {
                        label: "Gain 5",
                        effects: [
                            { op: "gainLife", player: "controller", amount: 5 },
                        ],
                    },
                ],
            },
        ]);
        const state = makeState();
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        submitOptionPick(state, "0");
        expect(state.players[0].life).toBe(22); // +2
        expect(state.players[1].life).toBe(18); // -2
    });

    it("auto-resolves a SINGLE-mode optionChoice with no prompt", () => {
        const id = registerScript("test-op-optionchoice-single", [
            {
                op: "optionChoice",
                prompt: "Choose one.",
                modes: [
                    {
                        label: "Gain 5 life",
                        effects: [
                            { op: "gainLife", player: "controller", amount: 5 },
                        ],
                    },
                ],
            },
        ]);
        const state = makeState();
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        // No decision was raised (one mode = no real choice, Arena-style).
        expect(state.pendingChoices).toBeUndefined();
        expect(state.players[0].life).toBe(25);
        expect(state.stack).toHaveLength(0);
    });

    it("preserves author-supplied semantic option ids (tap / untap) and taps the target — wire format", () => {
        const id = registerScript(
            "test-op-optionchoice-semantic",
            [
                {
                    op: "optionChoice",
                    prompt: "Tap or untap the target?",
                    modes: [
                        {
                            id: "tap",
                            label: "Tap it",
                            effects: [
                                {
                                    op: "tapUntap",
                                    action: "tap",
                                    target: { target: 0 },
                                },
                            ],
                        },
                        {
                            id: "untap",
                            label: "Untap it",
                            effects: [
                                {
                                    op: "tapUntap",
                                    action: "untap",
                                    target: { target: 0 },
                                },
                            ],
                        },
                    ],
                },
            ],
            { targetRequirement: { type: "Creature", count: 1 } }
        );
        const bear = makeInstance(BEAR_ID, {
            controllerId: "p2",
            ownerId: "p2",
            id: "bearOC",
            isTapped: false,
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        pushSpell(state, id, "p1", [{ type: "permanent", id: "bearOC" }]);
        resolveTopOfStack(state);
        const head = state.pendingChoices![0];
        // The semantic ids the author supplied are what the pipeline offers.
        expect(head.options?.map((o) => o.id)).toEqual(["tap", "untap"]);
        submitOptionPick(state, "tap");
        const tapped = state.players[1].battlefield.find(
            (c) => c.id === "bearOC"
        )!;
        expect(tapped.isTapped).toBe(true);
        // Tap state is board-visible — it must survive the projection.
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[1].battlefield.find(
            (c) => c.id === "bearOC"
        )!;
        expect(slim.isTapped).toBe(true);
    });

    it("resumes a SUSPENDING op nested inside the chosen mode (re-descends through the construct, CR 608.3)", () => {
        const id = registerScript("test-op-optionchoice-nested-suspend", [
            {
                op: "optionChoice",
                prompt: "Choose one.",
                modes: [
                    {
                        id: "discard",
                        label: "Discard two cards",
                        effects: [
                            {
                                op: "choice",
                                kind: "discard-hand",
                                player: "controller",
                                zone: "hand",
                                count: 2,
                                prompt: "Discard two cards.",
                                bind: "$picked",
                            },
                            {
                                op: "discard",
                                player: "controller",
                                cards: { ref: "$picked" },
                            },
                        ],
                    },
                    {
                        id: "gain",
                        label: "Gain 1 life",
                        effects: [
                            { op: "gainLife", player: "controller", amount: 1 },
                        ],
                    },
                ],
            },
        ]);
        const hand = ["h1", "h2", "h3"].map((cid) =>
            makeInstance(BEAR_ID, {
                id: cid,
                controllerId: "p1",
                ownerId: "p1",
                zone: "hand",
            })
        );
        const state = makeState({
            players: [makePlayer("p1", { hand }), makePlayer("p2")],
        });
        pushSpell(state, id, "p1");
        // Phase 1 — suspends on the mode pick.
        expect(resolveTopOfStack(state)).toBeNull();
        expect(state.pendingChoices![0].kind).toBe("option-pick");
        // Pick the discard mode — the interpreter descends and its nested choice
        // SUSPENDS again (a second Pending Choice).
        submitOptionPick(state, "discard");
        const nested = state.pendingChoices![0];
        expect(nested.kind).toBe("discard-hand");
        expect(nested.count).toBe(2);
        // Submitting the discard picks resumes the script — it re-walks the tree,
        // re-descends through the optionChoice (skip-exception), and completes
        // the discard Op that consumes the picks.
        applyPendingChoiceSubmit(state, {
            playerId: nested.playerId,
            stackItemId: nested.stackItemId,
            step: nested.step,
            choiceId: nested.choiceId,
            cardInstanceIds: ["h1", "h3"],
        });
        expect(state.players[0].hand.map((c) => c.id)).toEqual(["h2"]);
        // The two picked cards were discarded (the resolved sorcery also lands
        // in this same graveyard, CR 608.2k — assert the discards are present).
        const grave = state.players[0].graveyard.map((c) => c.id);
        expect(grave).toContain("h1");
        expect(grave).toContain("h3");
        expect(state.stack).toHaveLength(0);
        expect(state.pendingChoices).toBeUndefined();
    });
});

// --- $event.<field> refs at trigger sites (ADR 0049, issue #865) ------------
// A triggered ability's Effect Script can read fields of the FIRING event via
// the reserved `$event.<field>` ref, resolved through EVENT_FIELD_REGISTRY. This
// issue closes the interpreter seam: `resolveTopOfStack` now threads
// `top.triggerEvent` into the ctx for the Effect Script path (it previously
// reached only the imperative `resolve(ctx, event)`). Coverage per the "new
// construct usage" regime: object family (BLOCKERS_CONFIRMED.blockerId) read in
// an IMMEDIATE destroy target AND as a delayedTrigger CAPTURE source; player
// family (DAMAGE_DEALT.damagedPlayer) read in an immediate loseLife — once
// through projectPublicState (wire format).
describe("Effect Script value grammar: $event.<field> (ADR 0049, CR 603, issue #865)", () => {
    const EVENT_RAM_ID = "test-event-ram";
    registerTokenDefinition({
        id: EVENT_RAM_ID,
        name: EVENT_RAM_ID,
        rarity: "common",
        manaCost: { X: 1 },
        types: ["Artifact", "Creature"],
        subtypes: ["Construct"],
        power: 1,
        toughness: 1,
        triggeredAbilities: [
            {
                // Immediate: destroy the blocker read live from the event.
                id: "ram-destroy-blocker",
                oracleText: "destroy that blocker",
                event: "BLOCKERS_CONFIRMED",
                matches: () => true,
                effects: [
                    { op: "destroy", target: { ref: "$event.blockerId" } },
                ],
            },
            {
                // Delayed: capture the blocker at fire time, destroy at EOC.
                id: "ram-delay-blocker",
                oracleText: "destroy that blocker at end of combat",
                event: "BLOCKERS_CONFIRMED",
                matches: () => true,
                effects: [
                    {
                        op: "delayedTrigger",
                        timing: "next-end-of-combat",
                        oracleText: "destroy that blocker at end of combat",
                        capture: { $blk: { ref: "$event.blockerId" } },
                        effects: [{ op: "destroy", target: { ref: "$blk" } }],
                    },
                ],
            },
        ],
    });

    const EVENT_ASP_ID = "test-event-asp";
    registerTokenDefinition({
        id: EVENT_ASP_ID,
        name: EVENT_ASP_ID,
        rarity: "common",
        manaCost: { G: 1 },
        types: ["Creature"],
        subtypes: ["Snake"],
        power: 1,
        toughness: 1,
        triggeredAbilities: [
            {
                // Player family: the damaged player loses 2 life.
                id: "asp-poison",
                oracleText: "that player loses 2 life",
                event: "DAMAGE_DEALT",
                matches: () => true,
                effects: [
                    {
                        op: "loseLife",
                        player: { ref: "$event.damagedPlayer" },
                        amount: 2,
                    },
                ],
            },
        ],
    });

    function blockersConfirmed(
        attackerId: string,
        blockerId: string
    ): StackItem["triggerEvent"] {
        return {
            type: "BLOCKERS_CONFIRMED",
            attackerId,
            attackerControllerId: "p1",
            attackerTypes: ["Creature"],
            attackerSubtypes: [],
            blockerId,
            blockerControllerId: "p2",
            blockerTypes: ["Creature"],
            blockerSubtypes: [],
        };
    }

    function damageToPlayer(
        sourceInstanceId: string,
        playerId: string
    ): StackItem["triggerEvent"] {
        return {
            type: "DAMAGE_DEALT",
            sourceInstanceId,
            sourceControllerId: "p1",
            target: { type: "player", id: playerId },
            amount: 1,
            isCombat: true,
        };
    }

    function fireTrigger(
        state: GameState,
        source: { id: string; controllerId: string },
        triggeredAbilityId: string,
        triggerEvent: StackItem["triggerEvent"]
    ): void {
        const src = state.players
            .flatMap((p) => p.battlefield)
            .find((c) => c.id === source.id)!;
        state.stack.push({
            ...src,
            zone: "stack",
            castById: source.controllerId,
            triggeredAbilityId,
            triggerSourceId: source.id,
            triggerEvent,
            targets: [],
        });
        resolveTopOfStack(state);
    }

    it("object family: $event.blockerId destroys the blocker immediately", () => {
        const ram = makeInstance(EVENT_RAM_ID, {
            id: "ram",
            controllerId: "p1",
            ownerId: "p1",
        });
        const blk = makeInstance(BEAR_ID, {
            id: "blk",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [ram] }),
                makePlayer("p2", { battlefield: [blk] }),
            ],
        });
        fireTrigger(
            state,
            { id: "ram", controllerId: "p1" },
            "ram-destroy-blocker",
            blockersConfirmed("ram", "blk")
        );
        expect(
            state.players[1].battlefield.find((c) => c.id === "blk")
        ).toBeUndefined();
        expect(
            state.players[1].graveyard.find((c) => c.id === "blk")
        ).toBeDefined();
    });

    it("player family: $event.damagedPlayer loses life (wire format)", () => {
        const asp = makeInstance(EVENT_ASP_ID, {
            id: "asp",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [asp] }),
                makePlayer("p2", { life: 20 }),
            ],
        });
        fireTrigger(
            state,
            { id: "asp", controllerId: "p1" },
            "asp-poison",
            damageToPlayer("asp", "p2")
        );
        expect(state.players[1].life).toBe(18);
        // The same result survives the projection (ADR 0049 / wire format).
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.players[1].life).toBe(18);
    });

    it("object family as a delayedTrigger capture: destroys the blocker at end of combat", () => {
        const ram = makeInstance(EVENT_RAM_ID, {
            id: "ram2",
            controllerId: "p1",
            ownerId: "p1",
        });
        const blk = makeInstance(BEAR_ID, {
            id: "blk2",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [ram] }),
                makePlayer("p2", { battlefield: [blk] }),
            ],
        });
        fireTrigger(
            state,
            { id: "ram2", controllerId: "p1" },
            "ram-delay-blocker",
            blockersConfirmed("ram2", "blk2")
        );
        // The blocker id is captured into the payload under the `$blk` binding.
        expect(state.delayedTriggers).toHaveLength(1);
        expect(state.delayedTriggers![0].payload["blk"]).toBe("blk2");
        // Still alive until end of combat.
        expect(
            state.players[1].battlefield.find((c) => c.id === "blk2")
        ).toBeDefined();
        // Fire the delayed trigger — the body re-binds $blk and destroys it.
        fireDelayedTriggers(state, "next-end-of-combat");
        resolveTopOfStack(state);
        expect(
            state.players[1].battlefield.find((c) => c.id === "blk2")
        ).toBeUndefined();
        expect(
            state.players[1].graveyard.find((c) => c.id === "blk2")
        ).toBeDefined();
    });
});

// --- counter Op + destination (CR 701.5a, issue #683) -----------------------
//
// The bare `counter` Op (default graveyard destination) predates this suite —
// existing per-card tests (Counterspell, Force Spike) are its only coverage.
// This block adds the interpreter-level coverage the per-Op regime expects,
// plus the NEW `destination` parameter's own permanent test (an extension to
// an already-`implemented` Op, per the "new Op or new param shape" full-regime
// rule) — the redirect half of "if that spell is countered this way, exile it
// / put it on top of its owner's library / put it into its owner's hand
// instead" (No More Lies, Memory Lapse, Remand).
describe("Effect Script Op: counter + destination (CR 701.5a, issue #683)", () => {
    it("removes the target spell from the stack into its owner's graveyard by default", () => {
        const id = registerScript(
            "test-op-counter-default",
            [{ op: "counter", target: { target: 0 } }],
            { targetRequirement: { type: "spell", count: 1 } }
        );
        const state = makeState();
        const bolt = pushSpell(state, BEAR_ID, "p2");
        pushSpell(state, id, "p1", [{ type: "spell", id: bolt.id }]);
        resolveTopOfStack(state);
        expect(state.stack.find((s) => s.id === bolt.id)).toBeUndefined();
        expect(state.players[1].graveyard.some((c) => c.id === bolt.id)).toBe(
            true
        );
    });

    it('destination: "exile" — No More Lies redirects a countered spell to exile', () => {
        const id = registerScript(
            "test-op-counter-exile",
            [{ op: "counter", target: { target: 0 }, destination: "exile" }],
            { targetRequirement: { type: "spell", count: 1 } }
        );
        const state = makeState();
        const bolt = pushSpell(state, BEAR_ID, "p2");
        pushSpell(state, id, "p1", [{ type: "spell", id: bolt.id }]);
        resolveTopOfStack(state);
        expect(state.players[1].graveyard.some((c) => c.id === bolt.id)).toBe(
            false
        );
        expect(state.players[1].exile.some((c) => c.id === bolt.id)).toBe(true);
    });

    it('destination: "library-top" — Memory Lapse puts a countered spell on top of its owner\'s library', () => {
        const id = registerScript(
            "test-op-counter-library-top",
            [
                {
                    op: "counter",
                    target: { target: 0 },
                    destination: "library-top",
                },
            ],
            { targetRequirement: { type: "spell", count: 1 } }
        );
        const filler = makeInstance(BEAR_ID, {
            id: "libFiller",
            controllerId: "p2",
            ownerId: "p2",
            zone: "library",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { library: [filler] }),
            ],
        });
        const bolt = pushSpell(state, BEAR_ID, "p2");
        pushSpell(state, id, "p1", [{ type: "spell", id: bolt.id }]);
        resolveTopOfStack(state);
        expect(state.players[1].library[0]?.id).toBe(bolt.id); // top = index 0
        expect(state.players[1].library[1]?.id).toBe("libFiller");
    });

    it('destination: "hand" — Remand puts a countered spell into its owner\'s hand', () => {
        const id = registerScript(
            "test-op-counter-hand",
            [{ op: "counter", target: { target: 0 }, destination: "hand" }],
            { targetRequirement: { type: "spell", count: 1 } }
        );
        const state = makeState();
        const bolt = pushSpell(state, BEAR_ID, "p2");
        pushSpell(state, id, "p1", [{ type: "spell", id: bolt.id }]);
        resolveTopOfStack(state);
        expect(state.players[1].hand.some((c) => c.id === bolt.id)).toBe(true);
    });

    it("wire format: an exile-redirected counter survives projection", () => {
        const id = registerScript(
            "test-op-counter-exile-wire",
            [{ op: "counter", target: { target: 0 }, destination: "exile" }],
            { targetRequirement: { type: "spell", count: 1 } }
        );
        const state = makeState();
        const bolt = pushSpell(state, BEAR_ID, "p2");
        pushSpell(state, id, "p1", [{ type: "spell", id: bolt.id }]);
        resolveTopOfStack(state);
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.stack.find((s) => s.id === bolt.id)).toBeUndefined();
        expect(projected.players[1].exile.some((c) => c.id === bolt.id)).toBe(
            true
        );
    });
});

// --- CardDefinition.cantBeCountered (CR 701.5c, issue #1065) ---------------
//
// "This spell can't be countered" (Obliterate, Urza's Rage, Blurred Mongoose,
// Kavu Chameleon). The flag is checked at the single choke point every
// counter card routes through — `SpellContext.counter`, called by both the
// DSL `counter` Op and a `resolve()` closure alike — so this is engine-level
// coverage, not per-card.
const UNCOUNTERABLE_ID = "test-cant-be-countered-spell";
registerTokenDefinition({
    id: UNCOUNTERABLE_ID,
    name: UNCOUNTERABLE_ID,
    rarity: "common",
    manaCost: { X: 1, R: 1 },
    types: ["Sorcery"],
    cantBeCountered: true,
    effects: [{ op: "draw", player: "controller", count: 1 }],
});
describe("CardDefinition.cantBeCountered (CR 701.5c, issue #1065)", () => {
    it("a flagged spell is a legal target for counter, but the counter fizzles — the spell stays on the stack", () => {
        const id = registerScript(
            "test-cant-be-countered-counterspell",
            [{ op: "counter", target: { target: 0 } }],
            { targetRequirement: { type: "spell", count: 1 } }
        );
        const libCard = makeInstance(BEAR_ID, {
            id: "lib1",
            controllerId: "p2",
            ownerId: "p2",
            zone: "library",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { library: [libCard] }),
            ],
        });
        const uncounterable = pushSpell(state, UNCOUNTERABLE_ID, "p2");
        pushSpell(state, id, "p1", [{ type: "spell", id: uncounterable.id }]);
        resolveTopOfStack(state); // resolves the counterspell
        // The countering spell targeted it fine (no illegal-target fizzle) —
        // it simply fails to remove the flagged spell from the stack.
        expect(
            state.stack.find((s) => s.id === uncounterable.id)
        ).toBeDefined();
        expect(
            state.players[1].graveyard.some((c) => c.id === uncounterable.id)
        ).toBe(false);
        resolveTopOfStack(state); // the surviving spell resolves normally
        expect(state.players[1].hand).toHaveLength(1); // p2 (its controller) drew
    });

    it("an UNFLAGGED spell is still countered normally (regression guard)", () => {
        const id = registerScript(
            "test-cant-be-countered-control-counterspell",
            [{ op: "counter", target: { target: 0 } }],
            { targetRequirement: { type: "spell", count: 1 } }
        );
        const state = makeState();
        const bolt = pushSpell(state, BEAR_ID, "p2");
        pushSpell(state, id, "p1", [{ type: "spell", id: bolt.id }]);
        resolveTopOfStack(state);
        expect(state.stack.find((s) => s.id === bolt.id)).toBeUndefined();
        expect(state.players[1].graveyard.some((c) => c.id === bolt.id)).toBe(
            true
        );
    });

    it("wire format: the surviving flagged spell stays visible on the projected stack", () => {
        const id = registerScript(
            "test-cant-be-countered-wire",
            [{ op: "counter", target: { target: 0 } }],
            { targetRequirement: { type: "spell", count: 1 } }
        );
        const state = makeState();
        const uncounterable = pushSpell(state, UNCOUNTERABLE_ID, "p2");
        pushSpell(state, id, "p1", [{ type: "spell", id: uncounterable.id }]);
        resolveTopOfStack(state);
        const projected = projectPublicState(state, 1, "p1");
        expect(
            projected.stack.find((s) => s.id === uncounterable.id)
        ).toBeDefined();
    });
});

// --- dealDamage Op: `unpreventable` (CR 615, issue #1065) -------------------
//
// Urza's Rage's kicked mode ("the damage can't be prevented") generalizes the
// already-implemented `dealDamage` Op with an optional flag that skips CR 615
// prevention shields only — CR 614 replacement and CR 702.16 protection are
// untouched (per the "new param shape" full-regime rule, mirroring counter's
// `destination` param).
describe("Effect Script Op: dealDamage unpreventable (CR 615, issue #1065)", () => {
    it("skips a target-keyed prevention shield on a PLAYER when unpreventable", () => {
        const id = registerScript(
            "test-op-dealdamage-unpreventable-player",
            [
                {
                    op: "dealDamage",
                    amount: 10,
                    to: { target: 0 },
                    unpreventable: true,
                },
            ],
            { targetRequirement: { type: "player", count: 1 } }
        );
        const state = makeState();
        state.targetPreventionShields = [
            {
                targetType: "player",
                targetId: "p2",
                remaining: 100,
                duration: { phase: "end-of-turn" },
            },
        ];
        pushSpell(state, id, "p1", [{ type: "player", id: "p2" }]);
        resolveTopOfStack(state);
        expect(state.players[1].life).toBe(10); // 20 - 10, shield ignored
    });

    it("skips a target-keyed prevention shield on a PERMANENT when unpreventable", () => {
        const id = registerScript(
            "test-op-dealdamage-unpreventable-permanent",
            [
                {
                    op: "dealDamage",
                    amount: 10,
                    to: { target: 0 },
                    unpreventable: true,
                },
            ],
            { targetRequirement: { type: "Creature", count: 1 } }
        );
        const bear = makeInstance(BEAR_ID, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        state.targetPreventionShields = [
            {
                targetType: "permanent",
                targetId: "bear",
                remaining: 100,
                duration: { phase: "end-of-turn" },
            },
        ];
        pushSpell(state, id, "p1", [{ type: "permanent", id: "bear" }]);
        resolveTopOfStack(state);
        expect(bear.damageMarked).toBe(10); // shield ignored, lethal (5 toughness)
    });

    it("WITHOUT unpreventable, the same shield still prevents damage (default path unaffected)", () => {
        const id = registerScript("test-op-dealdamage-preventable-default", [
            { op: "dealDamage", amount: 10, to: { target: 0 } },
        ]);
        const state = makeState();
        state.targetPreventionShields = [
            {
                targetType: "player",
                targetId: "p2",
                remaining: 100,
                duration: { phase: "end-of-turn" },
            },
        ];
        pushSpell(state, id, "p1", [{ type: "player", id: "p2" }]);
        resolveTopOfStack(state);
        expect(state.players[1].life).toBe(20); // fully prevented
    });

    it("wire format: unpreventable damage to a player survives projection", () => {
        const id = registerScript(
            "test-op-dealdamage-unpreventable-wire",
            [
                {
                    op: "dealDamage",
                    amount: 10,
                    to: { target: 0 },
                    unpreventable: true,
                },
            ],
            { targetRequirement: { type: "player", count: 1 } }
        );
        const state = makeState();
        state.targetPreventionShields = [
            {
                targetType: "player",
                targetId: "p2",
                remaining: 100,
                duration: { phase: "end-of-turn" },
            },
        ];
        pushSpell(state, id, "p1", [{ type: "player", id: "p2" }]);
        resolveTopOfStack(state);
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.players[1].life).toBe(10);
    });
});

// ADR 0026 (revised) — a reveal→discard (Thoughtseize / Duress / Hymn to
// Tourach) must NOT hide the cards it revealed. `reveal` stamps the whole
// target hand `knownTo` all players; discarding the chosen card leaves the
// REMAINING hand still known to the caster (knowledge is per-instance and the
// discard is public), so the exposed cards persist face-up after resolution.
// Regression for the over-conservative discard-clear that reverted them.
describe("Effect Script: reveal→discard keeps knowledge of the remaining hand (ADR 0026 revised)", () => {
    it("the caster still knows the cards left in the opponent's hand after the discard", () => {
        const id = registerScript(
            "test-reveal-discard-knowledge",
            [
                { op: "reveal", player: { target: 0 }, zone: "hand" },
                {
                    op: "choice",
                    kind: "choose-hand-card",
                    player: "controller",
                    zoneOwnerId: { target: 0 },
                    zone: "hand",
                    count: 1,
                    prompt: "Choose a card from that player's hand.",
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

        const c1 = makeInstance(BEAR_ID, {
            id: "p2-c1",
            ownerId: "p2",
            controllerId: "p2",
            zone: "hand",
        });
        const c2 = makeInstance(BEAR_ID, {
            id: "p2-c2",
            ownerId: "p2",
            controllerId: "p2",
            zone: "hand",
        });
        const state = makeState({
            activePlayerId: "p1",
            players: [makePlayer("p1"), makePlayer("p2", { hand: [c1, c2] })],
        });
        pushSpell(state, id, "p1", [{ type: "player", id: "p2" }]);

        // Resolution suspends at the hand-pick choice (CR 608.2).
        expect(resolveTopOfStack(state)).toBeNull();
        const head = state.pendingChoices![0];
        // The reveal already made both cards known to the caster.
        for (const c of state.players[1].hand) {
            expect(c.knownTo).toContain("p1");
        }

        // The caster picks c1; c1 is discarded.
        applyPendingChoiceSubmit(state, {
            playerId: head.playerId,
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["p2-c1"],
        });

        const p2 = state.players[1];
        expect(p2.graveyard.some((c) => c.id === "p2-c1")).toBe(true);
        // The card left in hand is STILL known to the caster — the discard of
        // the other card introduced no uncertainty about it.
        expect(p2.hand.map((c) => c.id)).toEqual(["p2-c2"]);
        expect(p2.hand[0].knownTo).toContain("p1");

        // Wire format: the surviving card crosses the projection face-up to the
        // caster (its identity carried by `knownTo`, not nulled).
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[1].hand.find((c) => c?.id === "p2-c2");
        expect(slim).toBeTruthy();
    });
});

// --- scryReorder Op: look / reorder the top of a library (CR 401.4 / 701.22 /
// 701.44, issue #885) ---------------------------------------------------------
// scryReorder is the declarative skin over `SpellContext.orderTop`. Like
// `choice` it SUSPENDS: the first resolution raises the `order-top`
// PendingChoice on the top `count` cards; the generic `submitResolutionChoice`
// path (`applyPendingChoiceSubmit`) commits the kept order + the un-kept split,
// and resolution resumes AT the Op (later Ops — e.g. the draw — then run).

describe("Effect Script Op: scryReorder (CR 401.4 / 701.22 / 701.44, issue #885)", () => {
    const libOf = (owner: "p1" | "p2", ids: string[]) =>
        ids.map((cid) =>
            makeInstance(BEAR_ID, {
                id: cid,
                controllerId: owner,
                ownerId: owner,
                zone: "library",
            })
        );

    it("scry (library-bottom): suspends with an order-top choice, then keeps/bottoms and continues to the draw", () => {
        const id = registerScript("test-op-scry-bottom", [
            {
                op: "scryReorder",
                player: "controller",
                count: 2,
                destination: "library-bottom",
                prompt: "Scry 2.",
            },
            { op: "draw", player: "controller", count: 1 },
        ]);
        const state = makeState({
            players: [
                makePlayer("p1", {
                    library: libOf("p1", ["a", "b", "c", "d"]),
                }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, id, "p1");
        expect(resolveTopOfStack(state)).toBeNull(); // suspended on the scry
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("order-top");
        expect(head.destination).toBe("library-bottom");
        expect(head.playerId).toBe("p1");
        expect(head.candidateIds).toEqual(["a", "b"]);
        expect(head.prompt).toBe("Scry 2.");
        // CR 608.3 — the spell stays on the stack while suspended.
        expect(state.stack).toHaveLength(1);

        // Keep "b" on top, send "a" to the bottom.
        applyPendingChoiceSubmit(state, {
            playerId: head.playerId,
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["b"],
            secondZoneIds: ["a"],
        });
        // "b" was on top → it is drawn; "a" is now at the true bottom.
        expect(state.players[0].hand.map((c) => c.id)).toEqual(["b"]);
        const libIds = state.players[0].library.map((c) => c.id);
        expect(libIds[libIds.length - 1]).toBe("a");
        expect(state.stack).toHaveLength(0);
        expect(state.pendingChoices).toBeUndefined();
    });

    it("order-only (none): reorders the kept cards on top, all staying in the library (Ponder shape)", () => {
        const id = registerScript("test-op-scry-none", [
            {
                op: "scryReorder",
                player: "controller",
                count: 3,
                destination: "none",
            },
        ]);
        const state = makeState({
            players: [
                makePlayer("p1", {
                    library: libOf("p1", ["a", "b", "c", "d"]),
                }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        const head = state.pendingChoices![0];
        expect(head.destination).toBe("none");
        expect(head.candidateIds).toEqual(["a", "b", "c"]);
        // Put them back reversed (c, b, a); nothing leaves the top.
        applyPendingChoiceSubmit(state, {
            playerId: head.playerId,
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["c", "b", "a"],
            secondZoneIds: [],
        });
        expect(state.players[0].library.map((c) => c.id)).toEqual([
            "c",
            "b",
            "a",
            "d",
        ]);
        // The looked-at cards are known to the controller (ADR 0026).
        expect(state.players[0].library[0].knownTo).toContain("p1");
    });

    it("surveil (graveyard): the un-kept cards go to the graveyard, kept stay on top", () => {
        const id = registerScript("test-op-scry-gy", [
            {
                op: "scryReorder",
                player: "controller",
                count: 2,
                destination: "graveyard",
            },
        ]);
        const state = makeState({
            players: [
                makePlayer("p1", { library: libOf("p1", ["a", "b", "c"]) }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        const head = state.pendingChoices![0];
        expect(head.destination).toBe("graveyard");
        // Keep "a", surveil "b" into the graveyard.
        applyPendingChoiceSubmit(state, {
            playerId: head.playerId,
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["a"],
            secondZoneIds: ["b"],
        });
        expect(state.players[0].graveyard.map((c) => c.id)).toContain("b");
        expect(state.players[0].library.map((c) => c.id)).toEqual(["a", "c"]);
    });

    it("targets an announced player (player: { target })", () => {
        const id = registerScript(
            "test-op-scry-target",
            [
                {
                    op: "scryReorder",
                    player: { target: 0 },
                    count: 2,
                    destination: "library-bottom",
                },
            ],
            { targetRequirement: { type: "player", count: 1 } }
        );
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { library: libOf("p2", ["x", "y", "z"]) }),
            ],
        });
        pushSpell(state, id, "p1", [{ type: "player", id: "p2" }]);
        resolveTopOfStack(state);
        const head = state.pendingChoices![0];
        expect(head.playerId).toBe("p2");
        expect(head.candidateIds).toEqual(["x", "y"]);
    });

    it("no-ops on an empty library and on count <= 0 (CR 608.2b) — never suspends", () => {
        const idEmpty = registerScript("test-op-scry-empty", [
            {
                op: "scryReorder",
                player: "controller",
                count: 2,
                destination: "library-bottom",
            },
            { op: "gainLife", player: "controller", amount: 3 },
        ]);
        const empty = makeState();
        pushSpell(empty, idEmpty, "p1");
        expect(resolveTopOfStack(empty)).not.toBeNull(); // no suspension
        expect(empty.pendingChoices ?? []).toHaveLength(0);
        // The following Op still ran.
        expect(empty.players[0].life).toBe(23);

        const idZero = registerScript("test-op-scry-zero", [
            {
                op: "scryReorder",
                player: "controller",
                count: 0,
                destination: "none",
            },
        ]);
        const zero = makeState({
            players: [
                makePlayer("p1", { library: libOf("p1", ["a", "b"]) }),
                makePlayer("p2"),
            ],
        });
        pushSpell(zero, idZero, "p1");
        expect(resolveTopOfStack(zero)).not.toBeNull();
        expect(zero.pendingChoices ?? []).toHaveLength(0);
    });

    it("an Op before the scryReorder never re-runs on resume (CR 608.3 checkpoint)", () => {
        const id = registerScript("test-op-scry-checkpoint", [
            { op: "draw", player: "controller", count: 1 },
            {
                op: "scryReorder",
                player: "controller",
                count: 1,
                destination: "library-bottom",
            },
        ]);
        const state = makeState({
            players: [
                makePlayer("p1", { library: libOf("p1", ["a", "b", "c"]) }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, id, "p1");
        resolveTopOfStack(state); // draws "a", then suspends on the scry of "b"
        expect(state.players[0].hand.map((c) => c.id)).toEqual(["a"]);
        const head = state.pendingChoices![0];
        applyPendingChoiceSubmit(state, {
            playerId: head.playerId,
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["b"],
            secondZoneIds: [],
        });
        // The draw did NOT run a second time — still exactly one card in hand.
        expect(state.players[0].hand.map((c) => c.id)).toEqual(["a"]);
    });

    it("wire format: the chooser sees exactly the looked-at cards as libraryPeek; the outcome survives projection", () => {
        const id = registerScript("test-op-scry-wire", [
            {
                op: "scryReorder",
                player: "controller",
                count: 2,
                destination: "library-bottom",
            },
        ]);
        const state = makeState({
            players: [
                makePlayer("p1", {
                    library: libOf("p1", ["a", "b", "c", "d"]),
                }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, id, "p1");
        resolveTopOfStack(state); // suspends

        // Chooser's projected view: exactly the top two are face-up.
        const chooserView = projectPublicState(state, 1, "p1");
        expect(chooserView.players[0].libraryPeek?.map((c) => c.id)).toEqual([
            "a",
            "b",
        ]);
        // Opponent's projected view: no leak.
        const oppView = projectPublicState(state, 1, "p2");
        expect(oppView.players[0].libraryPeek).toBeUndefined();

        const head = state.pendingChoices![0];
        applyPendingChoiceSubmit(state, {
            playerId: head.playerId,
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["b"],
            secondZoneIds: ["a"],
        });
        // The library reshuffle survives projection: "a" is on the bottom.
        const post = projectPublicState(state, 1, "p1");
        expect(post.players[0].library.count).toBe(4);
    });
});

// --- mill Op: move top-of-library cards to the graveyard (CR 701.17, issue
// #885) ------------------------------------------------------------------------
// mill is deterministic (no choice, no suspension): it re-reads the live top id
// each pass and moves it library → graveyard, stopping when the library empties.

describe("Effect Script Op: mill (CR 701.17, issue #885)", () => {
    const libOf = (owner: "p1" | "p2", ids: string[]) =>
        ids.map((cid) =>
            makeInstance(BEAR_ID, {
                id: cid,
                controllerId: owner,
                ownerId: owner,
                zone: "library",
            })
        );

    it("mills N cards off the top of an announced target player's library", () => {
        const id = registerScript(
            "test-op-mill-target",
            [{ op: "mill", player: { target: 0 }, count: 2 }],
            { targetRequirement: { type: "player", count: 1 } }
        );
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", {
                    library: libOf("p2", ["a", "b", "c", "d"]),
                }),
            ],
        });
        pushSpell(state, id, "p1", [{ type: "player", id: "p2" }]);
        resolveTopOfStack(state);
        expect(state.players[1].graveyard.map((c) => c.id)).toEqual(["a", "b"]);
        expect(state.players[1].library.map((c) => c.id)).toEqual(["c", "d"]);
    });

    it("mills the resolving controller's own library", () => {
        const id = registerScript("test-op-mill-controller", [
            { op: "mill", player: "controller", count: 1 },
        ]);
        const state = makeState({
            players: [
                makePlayer("p1", { library: libOf("p1", ["a", "b"]) }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        // "a" was milled into p1's graveyard (the resolved sorcery lands there
        // too, CR 608.2k — so assert containment, not exact equality).
        expect(state.players[0].graveyard.map((c) => c.id)).toContain("a");
        expect(state.players[0].library.map((c) => c.id)).toEqual(["b"]);
    });

    it("mills fewer than requested when the library runs out (CR 701.17a)", () => {
        const id = registerScript(
            "test-op-mill-short",
            [{ op: "mill", player: { target: 0 }, count: 5 }],
            { targetRequirement: { type: "player", count: 1 } }
        );
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { library: libOf("p2", ["a", "b"]) }),
            ],
        });
        pushSpell(state, id, "p1", [{ type: "player", id: "p2" }]);
        expect(() => resolveTopOfStack(state)).not.toThrow();
        expect(state.players[1].graveyard.map((c) => c.id)).toEqual(["a", "b"]);
        expect(state.players[1].library).toHaveLength(0);
    });

    it("no-ops on count <= 0 and on a non-player target (CR 608.2b)", () => {
        const idZero = registerScript(
            "test-op-mill-zero",
            [{ op: "mill", player: { target: 0 }, count: 0 }],
            { targetRequirement: { type: "player", count: 1 } }
        );
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { library: libOf("p2", ["a", "b"]) }),
            ],
        });
        pushSpell(state, idZero, "p1", [{ type: "player", id: "p2" }]);
        resolveTopOfStack(state);
        expect(state.players[1].graveyard).toHaveLength(0);
        expect(state.players[1].library).toHaveLength(2);
    });

    it("wire format: the milled cards land in the graveyard and the library count drops after projection", () => {
        const id = registerScript(
            "test-op-mill-wire",
            [{ op: "mill", player: { target: 0 }, count: 2 }],
            { targetRequirement: { type: "player", count: 1 } }
        );
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { library: libOf("p2", ["a", "b", "c"]) }),
            ],
        });
        pushSpell(state, id, "p1", [{ type: "player", id: "p2" }]);
        resolveTopOfStack(state);
        const projected = projectPublicState(state, 1, "p1");
        // Graveyard is a public zone — the milled cards are face-up on the wire.
        expect(projected.players[1].graveyard.map((c) => c.id).sort()).toEqual([
            "a",
            "b",
        ]);
        expect(projected.players[1].library.count).toBe(1);
    });
});

// --- digToHand Op: look at top N, put one (or K) into hand, rest on the bottom
// (CR 401.4, issue #984) ---------------------------------------------------------
// digToHand SUSPENDS on a `look-distribute` choice over exactly the looked-at
// top N (candidateIds), then moves the kept cards library→hand and bottoms the
// rest in the player's chosen order (marking them known, ADR 0026). The pick is
// consumed internally (no `bind`), like `scryReorder`. Impulse is the canonical
// instance: look 4, take 1. These tests submit only the kept cards (no
// `secondZoneIds`), so the rest auto-bottom in look order (the bot/auto path).

describe("Effect Script Op: digToHand (CR 401.4, issue #984)", () => {
    const libOf = (owner: "p1" | "p2", ids: string[]) =>
        ids.map((cid) =>
            makeInstance(BEAR_ID, {
                id: cid,
                controllerId: owner,
                ownerId: owner,
                zone: "library",
            })
        );

    // Drives the suspended look-distribute choice to keep `keep` and finish the
    // Op (no second list → the rest auto-bottom in look order).
    const submitKeep = (state: GameState, keep: string[]) => {
        const head = state.pendingChoices![0];
        applyPendingChoiceSubmit(state, {
            playerId: head.playerId,
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: keep,
        });
    };

    it("Impulse: looks at the top four, one enters hand, the other three go to the bottom", () => {
        const id = registerScript("test-op-dig-impulse", [
            { op: "digToHand", player: "controller", look: 4, take: 1 },
        ]);
        const state = makeState({
            players: [
                makePlayer("p1", {
                    library: libOf("p1", ["a", "b", "c", "d", "e"]),
                }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, id, "p1");
        // First execution suspends on the look-top pick over exactly the top 4.
        expect(resolveTopOfStack(state)).toBeNull();
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("look-distribute");
        expect(head.candidateIds).toEqual(["a", "b", "c", "d"]);
        expect(head.count).toEqual({ min: 1, max: 1 });

        submitKeep(state, ["b"]);
        expect(state.pendingChoices ?? []).toHaveLength(0);
        // "b" is in hand; the untouched fifth card "e" is now on top; the three
        // un-kept looked-at cards (a, c, d) are on the bottom.
        expect(state.players[0].hand.map((c) => c.id)).toContain("b");
        expect(state.players[0].library.map((c) => c.id)).toEqual([
            "e",
            "a",
            "c",
            "d",
        ]);
    });

    it("mills nothing to the graveyard — the rest go to the library bottom, not away", () => {
        const id = registerScript("test-op-dig-bottom", [
            { op: "digToHand", player: "controller", look: 3, take: 1 },
        ]);
        const state = makeState({
            players: [
                makePlayer("p1", { library: libOf("p1", ["a", "b", "c"]) }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        submitKeep(state, ["a"]);
        // "a" to hand; b, c bottomed — library still holds both, none in gy.
        expect(state.players[0].hand.map((c) => c.id)).toContain("a");
        expect(state.players[0].library.map((c) => c.id)).toEqual(["b", "c"]);
        expect(state.players[0].graveyard.map((c) => c.id)).not.toContain("b");
    });

    it("takes two when take is 2 (the general dig, Stock Up-style)", () => {
        const id = registerScript("test-op-dig-take2", [
            { op: "digToHand", player: "controller", look: 4, take: 2 },
        ]);
        const state = makeState({
            players: [
                makePlayer("p1", {
                    library: libOf("p1", ["a", "b", "c", "d", "e"]),
                }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        expect(state.pendingChoices![0].count).toEqual({ min: 2, max: 2 });
        submitKeep(state, ["a", "c"]);
        expect(state.players[0].hand.map((c) => c.id)).toEqual(
            expect.arrayContaining(["a", "c"])
        );
        // b, d bottomed under the untouched e.
        expect(state.players[0].library.map((c) => c.id)).toEqual([
            "e",
            "b",
            "d",
        ]);
    });

    it("looks at fewer than requested when the library is short, still keeps one", () => {
        const id = registerScript("test-op-dig-short", [
            { op: "digToHand", player: "controller", look: 4, take: 1 },
        ]);
        const state = makeState({
            players: [
                makePlayer("p1", { library: libOf("p1", ["a", "b"]) }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        // Only two cards to look at; candidateIds is the whole (short) library.
        expect(state.pendingChoices![0].candidateIds).toEqual(["a", "b"]);
        submitKeep(state, ["b"]);
        expect(state.players[0].hand.map((c) => c.id)).toContain("b");
        expect(state.players[0].library.map((c) => c.id)).toEqual(["a"]);
    });

    // Keep-all (take === look) — nothing to select between and nothing left to
    // distribute, so there is no real choice: auto-resolve WITHOUT a
    // look-distribute picker (Dark Confidant's look:1/take:1 "reveal the top
    // card and put it into your hand"). The card must land in hand in a SINGLE
    // resolveTopOfStack, with no pendingChoice ever raised.
    it("keep-all (take === look): no picker, the looked-at cards go straight to hand", () => {
        const id = registerScript("test-op-dig-keepall", [
            { op: "digToHand", player: "controller", look: 1, take: 1 },
        ]);
        const state = makeState({
            players: [
                makePlayer("p1", { library: libOf("p1", ["a", "b", "c"]) }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, id, "p1");
        // Resolves fully — no suspend, no pendingChoice.
        expect(resolveTopOfStack(state)).not.toBeNull();
        expect(state.pendingChoices ?? []).toHaveLength(0);
        // Top card "a" moved to hand; "b", "c" untouched on top of the library.
        expect(state.players[0].hand.map((c) => c.id)).toContain("a");
        expect(state.players[0].library.map((c) => c.id)).toEqual(["b", "c"]);
    });

    // The keep-all path still honours `bind` — the moved top card is snapshot
    // so a trailing Op (Dark Confidant's `loseLife` off its mana value) reads it.
    it("keep-all: binds the moved card for a later mana-value ref (Dark Confidant)", () => {
        const id = registerScript("test-op-dig-keepall-bind", [
            {
                op: "digToHand",
                player: "controller",
                look: 1,
                take: 1,
                bind: "$revealed",
            },
            {
                op: "loseLife",
                player: "controller",
                amount: { manaValue: { of: { ref: "$revealed" } } },
            },
        ]);
        // Top card is a Bear ({1}{G}, mana value 2).
        const state = makeState({
            players: [
                makePlayer("p1", {
                    life: 20,
                    library: libOf("p1", ["a", "b"]),
                }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, id, "p1");
        expect(resolveTopOfStack(state)).not.toBeNull();
        expect(state.pendingChoices ?? []).toHaveLength(0);
        expect(state.players[0].hand.map((c) => c.id)).toContain("a");
        // Lost life equal to the revealed card's mana value (Bear = 2).
        expect(state.players[0].life).toBe(18);
    });

    it("look via {X} (a value ref): reads the chosen X as the look count", () => {
        const id = registerScript("test-op-dig-x", [
            {
                op: "digToHand",
                player: "controller",
                look: { X: true },
                take: 1,
            },
        ]);
        const state = makeState({
            players: [
                makePlayer("p1", {
                    library: libOf("p1", ["a", "b", "c", "d"]),
                }),
                makePlayer("p2"),
            ],
        });
        const item = pushSpell(state, id, "p1");
        item.chosenX = 2; // look at only the top two
        resolveTopOfStack(state);
        expect(state.pendingChoices![0].candidateIds).toEqual(["a", "b"]);
        submitKeep(state, ["a"]);
        expect(state.players[0].hand.map((c) => c.id)).toContain("a");
        // "b" bottomed under the untouched c, d.
        expect(state.players[0].library.map((c) => c.id)).toEqual([
            "c",
            "d",
            "b",
        ]);
    });

    it("digs a target player's library, not the controller's", () => {
        const id = registerScript(
            "test-op-dig-target",
            [{ op: "digToHand", player: { target: 0 }, look: 3, take: 1 }],
            { targetRequirement: { type: "player", count: 1 } }
        );
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", {
                    library: libOf("p2", ["a", "b", "c", "d"]),
                }),
            ],
        });
        pushSpell(state, id, "p1", [{ type: "player", id: "p2" }]);
        resolveTopOfStack(state);
        // The chooser is p2 (the library's owner picks their own kept card).
        expect(state.pendingChoices![0].playerId).toBe("p2");
        submitKeep(state, ["b"]);
        expect(state.players[1].hand.map((c) => c.id)).toContain("b");
        expect(state.players[1].library.map((c) => c.id)).toEqual([
            "d",
            "a",
            "c",
        ]);
    });

    it("no-ops (never suspends) on an empty library and on look <= 0; a later Op still runs", () => {
        const idEmpty = registerScript("test-op-dig-empty", [
            { op: "digToHand", player: "controller", look: 4, take: 1 },
            { op: "gainLife", player: "controller", amount: 3 },
        ]);
        const empty = makeState();
        pushSpell(empty, idEmpty, "p1");
        expect(resolveTopOfStack(empty)).not.toBeNull(); // no suspension
        expect(empty.pendingChoices ?? []).toHaveLength(0);
        expect(empty.players[0].life).toBe(23); // the trailing Op ran

        const idZero = registerScript("test-op-dig-zero", [
            { op: "digToHand", player: "controller", look: 0, take: 1 },
        ]);
        const zero = makeState({
            players: [
                makePlayer("p1", { library: libOf("p1", ["a", "b"]) }),
                makePlayer("p2"),
            ],
        });
        pushSpell(zero, idZero, "p1");
        expect(resolveTopOfStack(zero)).not.toBeNull();
        expect(zero.pendingChoices ?? []).toHaveLength(0);
        expect(zero.players[0].library).toHaveLength(2);
    });

    it("an Op before the digToHand never re-runs on resume (CR 608.3 checkpoint)", () => {
        const id = registerScript("test-op-dig-checkpoint", [
            { op: "gainLife", player: "controller", amount: 2 },
            { op: "digToHand", player: "controller", look: 2, take: 1 },
        ]);
        const state = makeState({
            players: [
                makePlayer("p1", { library: libOf("p1", ["a", "b", "c"]) }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, id, "p1");
        resolveTopOfStack(state); // gains 2, then suspends on the dig
        expect(state.players[0].life).toBe(22);
        submitKeep(state, ["a"]);
        // The gainLife did NOT run a second time on resume.
        expect(state.players[0].life).toBe(22);
        expect(state.players[0].hand.map((c) => c.id)).toContain("a");
    });

    it("wire format: the chooser sees exactly the looked-at cards as libraryPeek; the kept card survives projection", () => {
        const id = registerScript("test-op-dig-wire", [
            { op: "digToHand", player: "controller", look: 3, take: 1 },
        ]);
        const state = makeState({
            players: [
                makePlayer("p1", {
                    library: libOf("p1", ["a", "b", "c", "d"]),
                }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, id, "p1");
        resolveTopOfStack(state); // suspends

        // Chooser's projected view: exactly the top three are face-up.
        const chooserView = projectPublicState(state, 1, "p1");
        expect(chooserView.players[0].libraryPeek?.map((c) => c.id)).toEqual([
            "a",
            "b",
            "c",
        ]);
        // Opponent's projected view: no leak.
        const oppView = projectPublicState(state, 1, "p2");
        expect(oppView.players[0].libraryPeek).toBeUndefined();

        submitKeep(state, ["b"]);
        // The kept card is in hand and the reshuffle survives projection.
        const post = projectPublicState(state, 1, "p1");
        expect(post.players[0].hand.some((c) => c?.id === "b")).toBe(true);
        expect(post.players[0].library.count).toBe(3);
    });
});

// --- digToHand refinements: filter + optional + randomBottom (issue #1266,
// Narset, Parter of Veils) --------------------------------------------------
// Narset −2: look at the top four, you MAY put a NONCREATURE, NONLAND card into
// your hand, and the rest go to the bottom in a RANDOM order. `filter` narrows
// the hand-eligible subset; `optional` allows keeping 0; `randomBottom` bottoms
// the rest without a player-ordering pick and without marking them known.
const NC_INSTANT_ID = "test-effects-nc-instant";
registerTokenDefinition({
    id: NC_INSTANT_ID,
    name: NC_INSTANT_ID,
    rarity: "common",
    manaCost: { U: 1 },
    types: ["Instant"],
});
const NC_LAND_ID = "test-effects-nc-land";
registerTokenDefinition({
    id: NC_LAND_ID,
    name: NC_LAND_ID,
    rarity: "common",
    types: ["Land"],
    subtypes: ["Island"],
});

describe("Effect Script Op: digToHand filter/optional/randomBottom (issue #1266, Narset)", () => {
    // A library from a list of [id, cardDefId] pairs (top-first), so a scenario
    // can mix noncreature/creature/land cards in a known top-4 order.
    const mixedLib = (
        owner: "p1" | "p2",
        cards: [string, string][]
    ): ReturnType<typeof makeInstance>[] =>
        cards.map(([cid, defId]) =>
            makeInstance(defId, {
                id: cid,
                controllerId: owner,
                ownerId: owner,
                zone: "library",
            })
        );

    const submitKeep = (state: GameState, keep: string[]) => {
        const head = state.pendingChoices![0];
        applyPendingChoiceSubmit(state, {
            playerId: head.playerId,
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: keep,
        });
    };

    const narsetDig: EffectOp = {
        op: "digToHand",
        player: "controller",
        look: 4,
        take: 1,
        optional: true,
        filter: { excludeType: ["Creature", "Land"] },
        randomBottom: true,
    };

    it("filter restricts the hand-eligible set to noncreature/nonland; the filtered-out looked-at cards still bottom", () => {
        const id = registerScript("test-op-dig-narset-filter", [narsetDig]);
        // Top 4: instant, creature, land, instant; a 5th card sits below.
        const state = makeState({
            players: [
                makePlayer("p1", {
                    library: mixedLib("p1", [
                        ["s1", NC_INSTANT_ID],
                        ["cr1", BEAR_ID],
                        ["ld1", NC_LAND_ID],
                        ["s2", NC_INSTANT_ID],
                        ["x", NC_INSTANT_ID],
                    ]),
                }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, id, "p1");
        expect(resolveTopOfStack(state)).toBeNull(); // suspends on the pick
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("look-distribute");
        // The full top-four window is shown ("look at the top four cards")...
        expect(head.candidateIds).toEqual(["s1", "cr1", "ld1", "s2"]);
        // ...but only the two noncreature/nonland cards are HAND-eligible — the
        // creature and land can only be bottomed.
        expect(head.eligibleIds).toEqual(["s1", "s2"]);
        // "You may" — keeping 0 is legal.
        expect(head.count).toEqual({ min: 0, max: 1 });
        // The random bottom is flagged on the wire so the client mounts the
        // simple grid pick (nothing to order) instead of the drag picker.
        expect(head.randomizeRest).toBe(true);
        // Wire-format: the flag must survive the public projection (the
        // `...state` spread carries pendingChoices verbatim).
        expect(
            projectPublicState(state, 1, "p1").pendingChoices?.[0]
                ?.randomizeRest
        ).toBe(true);

        submitKeep(state, ["s1"]);
        expect(state.pendingChoices ?? []).toHaveLength(0);
        expect(state.players[0].hand.map((c) => c.id)).toContain("s1");
        // The un-kept looked-at cards (incl. the filtered-out creature and land)
        // bottom under the untouched fifth card "x".
        expect(state.players[0].library.map((c) => c.id)).toEqual([
            "x",
            "cr1",
            "ld1",
            "s2",
        ]);
    });

    it("the submit validator rejects taking a non-eligible (creature/land) card to hand", () => {
        const id = registerScript("test-op-dig-narset-reject", [narsetDig]);
        const state = makeState({
            players: [
                makePlayer("p1", {
                    library: mixedLib("p1", [
                        ["s1", NC_INSTANT_ID],
                        ["cr1", BEAR_ID],
                        ["ld1", NC_LAND_ID],
                        ["s2", NC_INSTANT_ID],
                    ]),
                }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        // "cr1" is a creature — shown in the window but not hand-eligible.
        expect(() => submitKeep(state, ["cr1"])).toThrow(
            /not eligible to put into your hand/
        );
    });

    it("randomBottom leaves the bottomed cards UNKNOWN to the controller (no markKnown)", () => {
        const id = registerScript("test-op-dig-narset-unknown", [narsetDig]);
        const state = makeState({
            players: [
                makePlayer("p1", {
                    library: mixedLib("p1", [
                        ["s1", NC_INSTANT_ID],
                        ["cr1", BEAR_ID],
                        ["ld1", NC_LAND_ID],
                        ["s2", NC_INSTANT_ID],
                    ]),
                }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        submitKeep(state, ["s1"]);
        // The three un-kept looked-at cards are on the bottom, but random order
        // is unobservable — none is marked known to p1 (contrast the default
        // digToHand path, which marks its ordered bottom known, ADR 0026).
        for (const cid of ["cr1", "ld1", "s2"]) {
            const card = state.players[0].library.find((c) => c.id === cid)!;
            expect(card.knownTo ?? []).not.toContain("p1");
        }
    });

    it("optional: the player may decline (keep 0) — nothing enters hand, all four bottom", () => {
        const id = registerScript("test-op-dig-narset-decline", [narsetDig]);
        const state = makeState({
            players: [
                makePlayer("p1", {
                    library: mixedLib("p1", [
                        ["s1", NC_INSTANT_ID],
                        ["s2", NC_INSTANT_ID],
                        ["s3", NC_INSTANT_ID],
                        ["s4", NC_INSTANT_ID],
                    ]),
                }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        expect(state.pendingChoices![0].count).toEqual({ min: 0, max: 1 });
        submitKeep(state, []); // decline
        expect(state.players[0].hand).toHaveLength(0);
        expect(state.players[0].library.map((c) => c.id)).toEqual([
            "s1",
            "s2",
            "s3",
            "s4",
        ]);
    });

    it("no eligible card in the top four → auto-resolves without a prompt, all bottom (CR 608.2b)", () => {
        const id = registerScript("test-op-dig-narset-nomatch", [
            narsetDig,
            { op: "gainLife", player: "controller", amount: 5 },
        ]);
        // Top 4 are all creatures/lands — nothing is hand-eligible.
        const state = makeState({
            players: [
                makePlayer("p1", {
                    library: mixedLib("p1", [
                        ["cr1", BEAR_ID],
                        ["cr2", BEAR_ID],
                        ["ld1", NC_LAND_ID],
                        ["ld2", NC_LAND_ID],
                    ]),
                }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, id, "p1");
        // No real choice — never suspends; the trailing Op runs.
        expect(resolveTopOfStack(state)).not.toBeNull();
        expect(state.pendingChoices ?? []).toHaveLength(0);
        expect(state.players[0].hand).toHaveLength(0);
        expect(state.players[0].life).toBe(25);
        // The four looked-at cards are still in the library (bottomed, not gone).
        expect(state.players[0].library).toHaveLength(4);
    });

    it("wire format: the chooser sees ALL four looked-at cards as libraryPeek; opponent sees nothing", () => {
        const id = registerScript("test-op-dig-narset-wire", [narsetDig]);
        const state = makeState({
            players: [
                makePlayer("p1", {
                    library: mixedLib("p1", [
                        ["s1", NC_INSTANT_ID],
                        ["cr1", BEAR_ID],
                        ["ld1", NC_LAND_ID],
                        ["s2", NC_INSTANT_ID],
                    ]),
                }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, id, "p1");
        resolveTopOfStack(state); // suspends
        const chooserView = projectPublicState(state, 1, "p1");
        // All four looked-at cards are shown ("look at the top four"), not just
        // the eligible ones.
        expect(chooserView.players[0].libraryPeek?.map((c) => c.id)).toEqual([
            "s1",
            "cr1",
            "ld1",
            "s2",
        ]);
        // The eligible-subset survives the projection so the client picker can
        // lock the creature/land out of the HAND pile (the field player-library
        // reads to build `distribute.eligibleIds`).
        expect(chooserView.pendingChoices?.[0]?.eligibleIds).toEqual([
            "s1",
            "s2",
        ]);
        const oppView = projectPublicState(state, 1, "p2");
        expect(oppView.players[0].libraryPeek).toBeUndefined();
    });
});

// --- digToHand destination + bind (issue #1101, Reviving Vapors) ----------
// `destination` sends the un-kept looked-at cards to the GRAVEYARD instead of
// the library bottom (mirrors `scryReorder`'s own discriminator); `bind`
// snapshot-binds the kept card so a later Op reads it back through the
// ordinary `EffectObjectSelector` bare-ref path — `manaValue: { of: { ref } }`
// sizing a `gainLife` Op is the Reviving Vapors shape this cluster exists for.
const RV_MV3_ID = "test-effects-rv-mv3";
registerTokenDefinition({
    id: RV_MV3_ID,
    name: RV_MV3_ID,
    rarity: "common",
    manaCost: { generic: 3 },
    types: ["Sorcery"],
});
const RV_MV1_ID = "test-effects-rv-mv1";
registerTokenDefinition({
    id: RV_MV1_ID,
    name: RV_MV1_ID,
    rarity: "common",
    manaCost: { U: 1 },
    types: ["Instant"],
});

describe("Effect Script Op: digToHand destination + bind (issue #1101)", () => {
    const mixedLib = (
        owner: "p1" | "p2",
        cards: [string, string][]
    ): ReturnType<typeof makeInstance>[] =>
        cards.map(([cid, defId]) =>
            makeInstance(defId, {
                id: cid,
                controllerId: owner,
                ownerId: owner,
                zone: "library",
            })
        );

    const submitKeep = (state: GameState, keep: string[]) => {
        const head = state.pendingChoices![0];
        applyPendingChoiceSubmit(state, {
            playerId: head.playerId,
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: keep,
        });
    };

    it("destination omitted: the default path stays library-bottom (unchanged from issue #984)", () => {
        const id = registerScript("test-op-dig-dest-default", [
            { op: "digToHand", player: "controller", look: 3, take: 1 },
        ]);
        const state = makeState({
            players: [
                makePlayer("p1", {
                    library: mixedLib("p1", [
                        ["a", RV_MV1_ID],
                        ["b", RV_MV1_ID],
                        ["c", RV_MV1_ID],
                        ["x", RV_MV1_ID],
                    ]),
                }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        submitKeep(state, ["a"]);
        expect(state.players[0].hand.map((c) => c.id)).toContain("a");
        // The un-kept "b", "c" are bottomed (under the untouched "x"), not
        // graveyarded.
        expect(state.players[0].library.map((c) => c.id)).toEqual([
            "x",
            "b",
            "c",
        ]);
        // Only the resolved sorcery itself lands in the graveyard (CR 608.2m)
        // — "b" and "c" were bottomed, not graveyarded.
        expect(state.players[0].graveyard.map((c) => c.id)).not.toEqual(
            expect.arrayContaining(["b", "c"])
        );
    });

    it("destination: graveyard sends the un-kept looked-at cards to the graveyard, not the library bottom", () => {
        const id = registerScript("test-op-dig-dest-gy", [
            {
                op: "digToHand",
                player: "controller",
                look: 3,
                take: 1,
                destination: "graveyard",
            },
        ]);
        const state = makeState({
            players: [
                makePlayer("p1", {
                    library: mixedLib("p1", [
                        ["a", RV_MV1_ID],
                        ["b", RV_MV1_ID],
                        ["c", RV_MV1_ID],
                        ["x", RV_MV1_ID],
                    ]),
                }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, id, "p1");
        expect(resolveTopOfStack(state)).toBeNull(); // suspends on the pick
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("look-distribute");
        expect(head.destination).toBe("graveyard");

        submitKeep(state, ["a"]);
        expect(state.pendingChoices ?? []).toHaveLength(0);
        expect(state.players[0].hand.map((c) => c.id)).toContain("a");
        // "b", "c" are in the graveyard now, NOT bottomed under "x" (the
        // resolved sorcery itself, CR 608.2m, is the 3rd graveyard member).
        expect(state.players[0].graveyard.map((c) => c.id)).toEqual(
            expect.arrayContaining(["b", "c"])
        );
        expect(state.players[0].library.map((c) => c.id)).toEqual(["x"]);
    });

    it("destination: graveyard skips markKnown (a graveyard is already public — ADR 0026)", () => {
        const id = registerScript("test-op-dig-dest-gy-known", [
            {
                op: "digToHand",
                player: "controller",
                look: 2,
                take: 1,
                destination: "graveyard",
            },
        ]);
        const state = makeState({
            players: [
                makePlayer("p1", {
                    library: mixedLib("p1", [
                        ["a", RV_MV1_ID],
                        ["b", RV_MV1_ID],
                    ]),
                }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        submitKeep(state, ["a"]);
        const gyCard = state.players[0].graveyard.find((c) => c.id === "b")!;
        expect(gyCard.knownTo ?? []).toHaveLength(0);
    });

    it("bind snapshots the kept card; a later Op reads it via manaValue: { of: { ref } } (Reviving Vapors' gainLife sizing)", () => {
        const id = registerScript("test-op-dig-bind-manavalue", [
            {
                op: "digToHand",
                player: "controller",
                look: 3,
                take: 1,
                destination: "graveyard",
                bind: "$kept",
            },
            {
                op: "gainLife",
                player: "controller",
                amount: { manaValue: { of: { ref: "$kept" } } },
            },
        ]);
        const state = makeState({
            players: [
                makePlayer("p1", {
                    library: mixedLib("p1", [
                        ["a", RV_MV3_ID], // mana value 3 — the one kept
                        ["b", RV_MV1_ID],
                        ["c", RV_MV1_ID],
                    ]),
                }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, id, "p1");
        resolveTopOfStack(state); // suspends on the dig pick
        submitKeep(state, ["a"]);
        // The digToHand resume finishes, THEN the trailing gainLife runs in the
        // same resolution (no second suspension) — sized off the kept card's
        // mana value (3), not a fixed amount.
        expect(state.players[0].hand.map((c) => c.id)).toContain("a");
        expect(state.players[0].life).toBe(23); // 20 + 3
        expect(state.players[0].graveyard.map((c) => c.id)).toEqual(
            expect.arrayContaining(["b", "c"])
        );
    });

    it("bind: unbound when nothing was kept (optional decline) — the later Op's manaValue-of skips (CR 608.2b)", () => {
        const id = registerScript("test-op-dig-bind-unkept", [
            {
                op: "digToHand",
                player: "controller",
                look: 2,
                take: 1,
                optional: true,
                filter: { type: "Land" }, // nothing in the library matches
                destination: "graveyard",
                bind: "$kept",
            },
            {
                op: "gainLife",
                player: "controller",
                amount: { manaValue: { of: { ref: "$kept" } } },
            },
        ]);
        const state = makeState({
            players: [
                makePlayer("p1", {
                    library: mixedLib("p1", [
                        ["a", RV_MV3_ID],
                        ["b", RV_MV1_ID],
                    ]),
                }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, id, "p1");
        // No eligible card — no real choice, never suspends.
        expect(resolveTopOfStack(state)).not.toBeNull();
        expect(state.players[0].hand).toHaveLength(0);
        // The unresolvable manaValue-of skips the gainLife entirely (CR 608.2b)
        // rather than reading a stale/zero binding.
        expect(state.players[0].life).toBe(20);
        // Both looked-at cards (no eligible hand pick) went to the graveyard
        // destination, alongside the resolved sorcery itself (CR 608.2m).
        expect(state.players[0].graveyard.map((c) => c.id)).toEqual(
            expect.arrayContaining(["a", "b"])
        );
    });

    it("wire format: destination graveyard + bind survive projectPublicState (kept card in hand, life gained, others in graveyard)", () => {
        const id = registerScript("test-op-dig-wire-rv", [
            {
                op: "digToHand",
                player: "controller",
                look: 3,
                take: 1,
                destination: "graveyard",
                bind: "$kept",
            },
            {
                op: "gainLife",
                player: "controller",
                amount: { manaValue: { of: { ref: "$kept" } } },
            },
        ]);
        const state = makeState({
            players: [
                makePlayer("p1", {
                    library: mixedLib("p1", [
                        ["a", RV_MV3_ID],
                        ["b", RV_MV1_ID],
                        ["c", RV_MV1_ID],
                    ]),
                }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, id, "p1");
        resolveTopOfStack(state); // suspends
        submitKeep(state, ["a"]);

        const projected = projectPublicState(state, 1, "p1");
        expect(projected.players[0].hand.some((c) => c?.id === "a")).toBe(true);
        expect(projected.players[0].life).toBe(23);
        expect(projected.players[0].graveyard.map((c) => c.id)).toEqual(
            expect.arrayContaining(["b", "c"])
        );
    });
});

describe("Effect Script Op: putBack (CR 401.4, issue #1046)", () => {
    const handOf = (owner: "p1" | "p2", ids: string[]) =>
        ids.map((cid) =>
            makeInstance(BEAR_ID, {
                id: cid,
                controllerId: owner,
                ownerId: owner,
                zone: "hand",
            })
        );

    it("suspends with a choose-hand-card PendingChoice over the whole hand, then moves the picks to the top in pick order (last picked ends up on top)", () => {
        const id = registerScript("test-op-putback-order", [
            { op: "putBack", player: "controller", count: 2 },
        ]);
        const state = makeState({
            players: [
                makePlayer("p1", { hand: handOf("p1", ["h1", "h2", "h3"]) }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, id, "p1");
        expect(resolveTopOfStack(state)).toBeNull(); // suspended
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("choose-hand-card");
        expect(head.zone).toBe("hand");
        expect(head.playerId).toBe("p1");
        expect(head.count).toBe(2);
        // CR 608.3 — the spell stays on the stack while suspended.
        expect(state.stack).toHaveLength(1);

        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["h1", "h3"], // pick order: h1 first, h3 last
        });
        // h3 (picked last) lands literally on top; h1 second from top —
        // moveHandCardToLibraryTop unshifts, so the pick order IS the
        // resulting top-to-bottom order (CR 401 "in any order").
        expect(state.players[0].library.map((c) => c.id)).toEqual(["h3", "h1"]);
        expect(state.players[0].hand.map((c) => c.id)).toEqual(["h2"]);
        expect(state.stack).toHaveLength(0);
        expect(state.pendingChoices).toBeUndefined();
    });

    it("flags the raised choice `putOnTop` so the client mounts the ordered HAND→TOP picker", () => {
        const id = registerScript("test-op-putback-flag", [
            { op: "putBack", player: "controller", count: 2 },
        ]);
        const state = makeState({
            players: [
                makePlayer("p1", { hand: handOf("p1", ["h1", "h2"]) }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, id, "p1");
        expect(resolveTopOfStack(state)).toBeNull(); // suspended
        expect(state.pendingChoices![0].putOnTop).toBe(true);
    });

    it("clamps count to hand size and no-ops (never suspends) on an empty hand; a later Op still runs", () => {
        const idClamp = registerScript("test-op-putback-clamp", [
            { op: "putBack", player: "controller", count: 5 },
        ]);
        const clampState = makeState({
            players: [
                makePlayer("p1", { hand: handOf("p1", ["only"]) }),
                makePlayer("p2"),
            ],
        });
        pushSpell(clampState, idClamp, "p1");
        expect(resolveTopOfStack(clampState)).toBeNull();
        expect(clampState.pendingChoices![0].count).toBe(1); // clamped

        const idEmpty = registerScript("test-op-putback-empty", [
            { op: "putBack", player: "controller", count: 2 },
            { op: "gainLife", player: "controller", amount: 3 },
        ]);
        const emptyState = makeState();
        pushSpell(emptyState, idEmpty, "p1");
        expect(resolveTopOfStack(emptyState)).not.toBeNull(); // no suspension
        expect(emptyState.pendingChoices ?? []).toHaveLength(0);
        expect(emptyState.players[0].life).toBe(23); // the trailing Op ran
    });

    it("an Op before the putBack never re-runs on resume (CR 608.3 checkpoint) — the Brainstorm draw-replay bug", () => {
        const id = registerScript("test-op-putback-checkpoint", [
            { op: "draw", player: "controller", count: 3 },
            { op: "putBack", player: "controller", count: 2 },
        ]);
        const state = makeState({
            players: [
                makePlayer("p1", {
                    library: [0, 1, 2, 3, 4, 5, 6].map((i) =>
                        makeInstance(BEAR_ID, {
                            id: `lib${i}`,
                            controllerId: "p1",
                            ownerId: "p1",
                            zone: "library",
                        })
                    ),
                }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, id, "p1");
        resolveTopOfStack(state); // draws 3, suspends on the put-back choice
        expect(state.players[0].hand).toHaveLength(3);
        const head = state.pendingChoices![0];
        const drawn = state.players[0].hand.map((c) => c.id);
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: [drawn[0], drawn[1]],
        });
        // 3 drawn − 2 put back = 1 in hand. NOT 6 − 2 = 4 (the replay bug the
        // old imperative Brainstorm `resolveSteps` split fixed by hand — the
        // interpreter's own per-Op checkpoint now does it for free).
        expect(state.players[0].hand).toHaveLength(1);
    });

    it("wire format: the caster keeps knowing the put-back cards on top, hidden from the opponent", () => {
        const id = registerScript("test-op-putback-wire", [
            { op: "putBack", player: "controller", count: 2 },
        ]);
        const state = makeState({
            players: [
                makePlayer("p1", { hand: handOf("p1", ["h1", "h2", "h3"]) }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, id, "p1");
        resolveTopOfStack(state); // suspends
        const head = state.pendingChoices![0];
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["h1", "h3"],
        });
        const topTwo = state.players[0].library.slice(0, 2).map((c) => c.id);
        expect(topTwo).toEqual(["h3", "h1"]);

        // ADR 0026 — the caster keeps knowing the cards they put on top; they
        // surface as the caster's contiguous top-of-library known run, in
        // order, and are hidden from the opponent.
        const casterView = projectPublicState(state, 1, "p1");
        const known = casterView.players[0].library.known ?? [];
        expect(known.map((k) => k.card.id)).toEqual(topTwo);
        expect(known.map((k) => k.index)).toEqual([0, 1]);

        const oppView = projectPublicState(state, 1, "p2");
        expect(oppView.players[0].library.known ?? []).toEqual([]);
    });

    it("wire format: the `putOnTop` flag survives projection so the client can route to the picker", () => {
        const id = registerScript("test-op-putback-wire-flag", [
            { op: "putBack", player: "controller", count: 2 },
        ]);
        const state = makeState({
            players: [
                makePlayer("p1", { hand: handOf("p1", ["h1", "h2"]) }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, id, "p1");
        resolveTopOfStack(state); // suspends
        const casterView = projectPublicState(state, 1, "p1");
        expect(casterView.pendingChoices?.[0]?.putOnTop).toBe(true);
    });

    it("puts back a target player's hand cards, not the controller's", () => {
        const id = registerScript(
            "test-op-putback-target",
            [{ op: "putBack", player: { target: 0 }, count: 1 }],
            { targetRequirement: { type: "player", count: 1 } }
        );
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { hand: handOf("p2", ["a", "b"]) }),
            ],
        });
        pushSpell(state, id, "p1", [{ type: "player", id: "p2" }]);
        resolveTopOfStack(state);
        const head = state.pendingChoices![0];
        // The chooser is p2 — whoever's hand it is picks their own card.
        expect(head.playerId).toBe("p2");
        applyPendingChoiceSubmit(state, {
            playerId: "p2",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["a"],
        });
        expect(state.players[1].library.map((c) => c.id)).toContain("a");
        expect(state.players[1].hand.map((c) => c.id)).toEqual(["b"]);
    });
});

describe("Effect Script count refinements: times multiplier + excludeSupertype (CR 122 / 205.4a, issue #999)", () => {
    // Price of Progress-shaped constructs — the `count` value gains a `times`
    // literal multiplier ("TWICE the number of …") and the `EffectCardFilter`
    // gains an `excludeSupertype` selector ("nonbasic land"). Neither is an Op
    // nor a new grammar member; they are refinements of the existing `count`
    // value (ADR 0045 stays closed). Exercised through the real resolution path
    // (a forEach over players dealing each player 2× their nonbasic-land count),
    // with a projectPublicState wire assertion since damage is board-visible.

    // A nonbasic land (no "Basic" supertype) and a basic land, registered so
    // makeInstance hydrates real card shapes. Supertypes are set on the
    // instance so the battlefield matcher reads them directly.
    const NONBASIC_LAND = "test-999-nonbasic-land";
    const BASIC_LAND = "test-999-basic-land";
    registerTokenDefinition({
        id: NONBASIC_LAND,
        name: NONBASIC_LAND,
        rarity: "common",
        manaCost: { generic: 0 },
        types: ["Land"],
    });
    registerTokenDefinition({
        id: BASIC_LAND,
        name: BASIC_LAND,
        rarity: "common",
        manaCost: { generic: 0 },
        types: ["Land"],
        supertypes: ["Basic"],
    });

    /** Price of Progress' effect script (issue #999). */
    const PRICE_OF_PROGRESS: EffectOp[] = [
        {
            op: "forEach",
            select: { set: "players" },
            effects: [
                {
                    op: "dealDamage",
                    amount: {
                        count: {
                            zone: "battlefield",
                            controller: { ref: "$each" },
                            filter: {
                                type: "Land",
                                excludeSupertype: "Basic",
                            },
                            times: 2,
                        },
                    },
                    to: { player: { ref: "$each" } },
                },
            ],
        },
    ];

    // Supertypes are NOT stored on the instance — the battlefield matcher
    // resolves them live from the registry (via the injected `supertypesOf`),
    // so a token def's `supertypes: ["Basic"]` drives the nonbasic distinction.
    function nonbasic(
        id: string,
        controller: string
    ): ReturnType<typeof makeInstance> {
        return makeInstance(NONBASIC_LAND, {
            id,
            controllerId: controller,
            ownerId: controller,
        });
    }
    function basic(
        id: string,
        controller: string
    ): ReturnType<typeof makeInstance> {
        return makeInstance(BASIC_LAND, {
            id,
            controllerId: controller,
            ownerId: controller,
        });
    }

    it("deals each player 2× their nonbasic-land count; basics contribute 0", () => {
        const scriptId = registerScript(
            "test-999-price-of-progress",
            PRICE_OF_PROGRESS
        );
        const state = makeState({
            players: [
                // p1: 2 nonbasic + 1 basic → 2 nonbasic → 4 damage.
                makePlayer("p1", {
                    battlefield: [
                        nonbasic("p1-nb1", "p1"),
                        nonbasic("p1-nb2", "p1"),
                        basic("p1-b1", "p1"),
                    ],
                }),
                // p2: 1 nonbasic + 2 basic → 1 nonbasic → 2 damage.
                makePlayer("p2", {
                    battlefield: [
                        nonbasic("p2-nb1", "p2"),
                        basic("p2-b1", "p2"),
                        basic("p2-b2", "p2"),
                    ],
                }),
            ],
        });
        pushSpell(state, scriptId, "p1");
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(16); // 20 - 2*2
        expect(state.players[1].life).toBe(18); // 20 - 1*2

        // Wire format: damage is board-visible — the resulting life totals must
        // survive the projection (new-construct regime).
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.players[0].life).toBe(16);
        expect(projected.players[1].life).toBe(18);
    });

    it("deals 0 to a player controlling only basic lands (excludeSupertype filters them out)", () => {
        const scriptId = registerScript(
            "test-999-price-only-basics",
            PRICE_OF_PROGRESS
        );
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        basic("p1-only-b1", "p1"),
                        basic("p1-only-b2", "p1"),
                    ],
                }),
                makePlayer("p2", {
                    battlefield: [nonbasic("p2-solo-nb", "p2")],
                }),
            ],
        });
        pushSpell(state, scriptId, "p1");
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(20); // only basics → 0 damage
        expect(state.players[1].life).toBe(18); // 1 nonbasic → 2 damage
    });
});

// --- New value members (CR 702.33 kicker, CR 202.3 mana value, issue #692) ---
//
// Each new EffectValue member pays the "entry fee once" (per DSL-first
// authoring, new-value regime): an interpreter unit test through the REAL
// resolution path plus a wire-format assertion once through projectPublicState.
// Later kicker cards reuse these free.

describe("Effect Script value: kickerCount (CR 702.33 / 702.33e)", () => {
    it("reads the spell's kicker tally in a comparison predicate (was-kicked gate)", () => {
        const id = registerScript("test-val-kicked-gate", [
            {
                op: "if",
                predicate: {
                    left: { kickerCount: true },
                    op: "ge",
                    right: 1,
                },
                then: [
                    { op: "dealDamage", amount: 4, to: { player: "opponent" } },
                ],
                else: [
                    { op: "dealDamage", amount: 2, to: { player: "opponent" } },
                ],
            },
        ]);
        // Unkicked (no kickerCount on the stack item) → the else branch.
        const s1 = makeState();
        pushSpell(s1, id, "p1");
        resolveTopOfStack(s1);
        expect(s1.players[1].life).toBe(18);
        // Kicked (kickerCount = 1) → the then branch.
        const s2 = makeState();
        const item = pushSpell(s2, id, "p1");
        item.kickerCount = 1;
        resolveTopOfStack(s2);
        expect(s2.players[1].life).toBe(16);
    });

    it("reads the raw multikicker tally as a numeric amount", () => {
        const id = registerScript("test-val-kicked-count", [
            {
                op: "dealDamage",
                amount: { kickerCount: true },
                to: { player: "opponent" },
            },
        ]);
        const state = makeState();
        const item = pushSpell(state, id, "p1");
        item.kickerCount = 3; // paid three times (multikicker)
        resolveTopOfStack(state);
        expect(state.players[1].life).toBe(17);
    });

    it("survives the wire projection (kickerCount is server-read; outcome matches)", () => {
        const id = registerScript("test-val-kicked-wire", [
            {
                op: "dealDamage",
                amount: { kickerCount: true },
                to: { player: "opponent" },
            },
        ]);
        const state = makeState();
        const item = pushSpell(state, id, "p1");
        item.kickerCount = 2;
        // The projected stack still carries the tally (compact round-trip).
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.stack.find((s) => s.id === item.id) as
            | { kickerCount?: number }
            | undefined;
        expect(slim?.kickerCount).toBe(2);
        resolveTopOfStack(state);
        expect(state.players[1].life).toBe(18);
    });
});

describe("Effect Script value: manaValue (CR 202.3)", () => {
    it("gates a destroy on the announced target's mana value", () => {
        const id = registerScript("test-val-mv-gate", [
            {
                op: "if",
                predicate: {
                    left: { manaValue: { of: { target: 0 } } },
                    op: "le",
                    right: 2,
                },
                then: [{ op: "destroy", target: { target: 0 } }],
            },
        ]);
        // Target BEAR_ID has mana value 1 ({X:1,G:1} → 1 generic + 1 G = 2? →
        // X:1 is generic 1, G:1 → mana value 2). It is destroyed (≤ 2).
        const bear = makeInstance(BEAR_ID, {
            controllerId: "p2",
            id: "mvbear",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        pushSpell(state, id, "p1", [{ type: "permanent", id: "mvbear" }]);
        resolveTopOfStack(state);
        expect(
            state.players[1].battlefield.find((c) => c.id === "mvbear")
        ).toBeUndefined();
    });

    it("does not fire when the target's mana value exceeds the ceiling", () => {
        const id = registerScript("test-val-mv-over", [
            {
                op: "if",
                predicate: {
                    left: { manaValue: { of: { target: 0 } } },
                    op: "le",
                    right: 2,
                },
                then: [{ op: "destroy", target: { target: 0 } }],
            },
        ]);
        // Serra Angel-like MV 5 target survives.
        const bigId = "test-val-mv-big";
        registerTokenDefinition({
            id: bigId,
            name: bigId,
            rarity: "common",
            manaCost: { X: 3, W: 2 },
            types: ["Creature"],
            power: 4,
            toughness: 4,
        });
        const big = makeInstance(bigId, { controllerId: "p2", id: "mvbig" });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [big] }),
            ],
        });
        pushSpell(state, id, "p1", [{ type: "permanent", id: "mvbig" }]);
        resolveTopOfStack(state);
        expect(
            state.players[1].battlefield.find((c) => c.id === "mvbig")
        ).toBeDefined();
    });
});

// Synthetic basic-land instances for the Domain value member tests below
// (CR 305.6 — the five basic land types). Registered once at module scope,
// mirroring `BEAR_ID`'s pattern above.
const PLAINS_ID = "test-effects-plains";
registerTokenDefinition({
    id: PLAINS_ID,
    name: PLAINS_ID,
    rarity: "common",
    types: ["Land"],
    subtypes: ["Plains"],
});
const ISLAND_ID = "test-effects-island";
registerTokenDefinition({
    id: ISLAND_ID,
    name: ISLAND_ID,
    rarity: "common",
    types: ["Land"],
    subtypes: ["Island"],
});
const SWAMP_ID = "test-effects-swamp";
registerTokenDefinition({
    id: SWAMP_ID,
    name: SWAMP_ID,
    rarity: "common",
    types: ["Land"],
    subtypes: ["Swamp"],
});
// A dual land (two basic subtypes) — "duals contribute several" (issue #1066).
const DUAL_ID = "test-effects-dual";
registerTokenDefinition({
    id: DUAL_ID,
    name: DUAL_ID,
    rarity: "common",
    types: ["Land"],
    subtypes: ["Mountain", "Forest"],
});

describe("Effect Script value: domain (CR 702 preamble ability word, issue #1066)", () => {
    it("reads the controller's Domain as a numeric amount (dealDamage)", () => {
        const id = registerScript("test-val-domain-dmg", [
            {
                op: "dealDamage",
                amount: { domain: { of: "controller" } },
                to: { player: "opponent" },
            },
        ]);
        // p1 controls Plains + Island + a duplicate Plains: 2 distinct basic
        // types (the duplicate does not double-count).
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        makeInstance(PLAINS_ID, {
                            id: "pl-1",
                            controllerId: "p1",
                        }),
                        makeInstance(ISLAND_ID, {
                            id: "is-1",
                            controllerId: "p1",
                        }),
                        makeInstance(PLAINS_ID, {
                            id: "pl-2",
                            controllerId: "p1",
                        }),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        expect(state.players[1].life).toBe(18); // 20 - 2
    });

    it("a dual land contributes BOTH of its basic subtypes", () => {
        const id = registerScript("test-val-domain-dual", [
            {
                op: "dealDamage",
                amount: { domain: { of: "controller" } },
                to: { player: "opponent" },
            },
        ]);
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        makeInstance(DUAL_ID, {
                            id: "dual-1",
                            controllerId: "p1",
                        }),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        expect(state.players[1].life).toBe(18); // 20 - 2 (Mountain + Forest)
    });

    it('reads a NON-controller player\'s Domain via `of: "opponent"`', () => {
        const id = registerScript("test-val-domain-opponent", [
            {
                op: "gainLife",
                player: "controller",
                amount: { domain: { of: "opponent" } },
            },
        ]);
        // p1 (the caster/controller) has NO basic lands; p2 (the opponent)
        // controls three distinct basic types — the amount reads p2's Domain,
        // not p1's, proving the player-scoped `of` selector (unlike
        // counters'/manaValue's object-scoped `of`).
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", {
                    battlefield: [
                        makeInstance(PLAINS_ID, {
                            id: "pl-opp",
                            controllerId: "p2",
                        }),
                        makeInstance(ISLAND_ID, {
                            id: "is-opp",
                            controllerId: "p2",
                        }),
                        makeInstance(SWAMP_ID, {
                            id: "sw-opp",
                            controllerId: "p2",
                        }),
                    ],
                }),
            ],
        });
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(23); // 20 + 3
    });

    it("is 0 (a no-op) for a player with no basic lands", () => {
        const id = registerScript("test-val-domain-zero", [
            {
                op: "dealDamage",
                amount: { domain: { of: "controller" } },
                to: { player: "opponent" },
            },
        ]);
        const state = makeState();
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        expect(state.players[1].life).toBe(20); // unchanged — 0 damage no-ops
    });

    it("survives the wire projection (Domain is server-computed; the outcome matches post-projection)", () => {
        const id = registerScript("test-val-domain-wire", [
            {
                op: "dealDamage",
                amount: { domain: { of: "controller" } },
                to: { player: "opponent" },
            },
        ]);
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        makeInstance(PLAINS_ID, {
                            id: "pl-w",
                            controllerId: "p1",
                        }),
                        makeInstance(ISLAND_ID, {
                            id: "is-w",
                            controllerId: "p1",
                        }),
                        makeInstance(SWAMP_ID, {
                            id: "sw-w",
                            controllerId: "p1",
                        }),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        expect(state.players[1].life).toBe(17); // 20 - 3
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.players[1].life).toBe(17);
    });

    it("multiplies the Domain count by `times` (Wandering Stream: 2 life per basic land type, issue #1066 review)", () => {
        const id = registerScript("test-val-domain-times", [
            {
                op: "gainLife",
                player: "controller",
                amount: { domain: { of: "controller", times: 2 } },
            },
        ]);
        // p1 controls 3 distinct basic land types → Domain is 3, times 2 = 6.
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        makeInstance(PLAINS_ID, {
                            id: "pl-times",
                            controllerId: "p1",
                        }),
                        makeInstance(ISLAND_ID, {
                            id: "is-times",
                            controllerId: "p1",
                        }),
                        makeInstance(SWAMP_ID, {
                            id: "sw-times",
                            controllerId: "p1",
                        }),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(26); // 20 + (3 * 2)
    });
});

describe("Effect Script value: abilityResolutionCount (CR 122 / 603.3, issue #1189)", () => {
    // A synthetic Landfall-shaped source: "At the beginning of your upkeep,
    // you gain 1 life. If this is the second time this ability has resolved
    // this turn, gain 10 life instead. If it's the third-or-later time,
    // gain 100 life instead." Mirrors the nested if/else-if/else shape
    // Omnath, Locus of Creation's escalating branches use — exercising the
    // `abilityResolutionCount` value across a THREE-way nested `if` combo,
    // not just a single bare comparison.
    const RESOLUTION_COUNT_SOURCE_ID = "test-effects-resolution-count-source";
    registerTokenDefinition({
        id: RESOLUTION_COUNT_SOURCE_ID,
        name: RESOLUTION_COUNT_SOURCE_ID,
        rarity: "rare",
        manaCost: { X: 1, R: 1 },
        types: ["Creature"],
        subtypes: ["Elemental"],
        power: 1,
        toughness: 1,
        triggeredAbilities: [
            {
                id: "resolution-count-upkeep",
                oracleText:
                    "At the beginning of your upkeep, you gain 1 life. If this is the second time this ability has resolved this turn, you gain 10 life instead. If it's the third time (or later), you gain 100 life instead.",
                event: "PHASE_BEGIN",
                matches: (event, self) =>
                    event.type === "PHASE_BEGIN" &&
                    event.phase === "UPKEEP" &&
                    event.activePlayerId === self.controllerId,
                effects: [
                    {
                        op: "if",
                        predicate: {
                            left: { abilityResolutionCount: true },
                            op: "eq",
                            right: 1,
                        },
                        then: [
                            { op: "gainLife", player: "controller", amount: 1 },
                        ],
                        else: [
                            {
                                op: "if",
                                predicate: {
                                    left: { abilityResolutionCount: true },
                                    op: "eq",
                                    right: 2,
                                },
                                then: [
                                    {
                                        op: "gainLife",
                                        player: "controller",
                                        amount: 10,
                                    },
                                ],
                                else: [
                                    {
                                        op: "gainLife",
                                        player: "controller",
                                        amount: 100,
                                    },
                                ],
                            },
                        ],
                    },
                ],
            },
        ],
    });

    function upkeepEvent(activePlayerId: string) {
        return {
            type: "PHASE_BEGIN" as const,
            phase: "UPKEEP" as const,
            activePlayerId,
        };
    }

    it("reads 1 on the first resolution this turn", () => {
        const source = makeInstance(RESOLUTION_COUNT_SOURCE_ID, {
            id: "rc-src-first",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            activePlayerId: "p1",
            phase: "UPKEEP",
            players: [
                makePlayer("p1", { battlefield: [source] }),
                makePlayer("p2"),
            ],
        });
        state.stack.push(...collectTriggers(state, [upkeepEvent("p1")]));
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(21); // 20 + 1 (first resolution)
    });

    it("escalates to the second branch on the SECOND resolution the same turn", () => {
        const source = makeInstance(RESOLUTION_COUNT_SOURCE_ID, {
            id: "rc-src-second",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            activePlayerId: "p1",
            phase: "UPKEEP",
            players: [
                makePlayer("p1", { battlefield: [source] }),
                makePlayer("p2"),
            ],
        });
        state.stack.push(...collectTriggers(state, [upkeepEvent("p1")]));
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(21); // 20 + 1
        state.stack.push(...collectTriggers(state, [upkeepEvent("p1")]));
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(31); // 21 + 10 (second resolution)
    });

    it("escalates to the third-or-later branch on the THIRD resolution the same turn", () => {
        const source = makeInstance(RESOLUTION_COUNT_SOURCE_ID, {
            id: "rc-src-third",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            activePlayerId: "p1",
            phase: "UPKEEP",
            players: [
                makePlayer("p1", { battlefield: [source] }),
                makePlayer("p2"),
            ],
        });
        for (let i = 0; i < 3; i++) {
            state.stack.push(...collectTriggers(state, [upkeepEvent("p1")]));
            resolveTopOfStack(state);
        }
        expect(state.players[0].life).toBe(131); // 20 + 1 + 10 + 100
    });

    it("resets at CLEANUP (CR 514.2) — next turn's first resolution reads 1 again", () => {
        const source = makeInstance(RESOLUTION_COUNT_SOURCE_ID, {
            id: "rc-src-cleanup",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            activePlayerId: "p1",
            phase: "UPKEEP",
            players: [
                makePlayer("p1", { battlefield: [source] }),
                makePlayer("p2"),
            ],
        });
        state.stack.push(...collectTriggers(state, [upkeepEvent("p1")]));
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(21); // 20 + 1

        state.phase = "CLEANUP";
        finalizeCleanup(state);
        expect(state.abilityResolutionCounts).toBeUndefined();

        state.stack.push(...collectTriggers(state, [upkeepEvent("p1")]));
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(22); // 21 + 1 again, NOT 21 + 10
    });

    it("is scoped per (source, ability) — a DIFFERENT source's tally is independent", () => {
        const sourceA = makeInstance(RESOLUTION_COUNT_SOURCE_ID, {
            id: "rc-src-a",
            controllerId: "p1",
            ownerId: "p1",
        });
        const sourceB = makeInstance(RESOLUTION_COUNT_SOURCE_ID, {
            id: "rc-src-b",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            activePlayerId: "p1",
            phase: "UPKEEP",
            players: [
                makePlayer("p1", { battlefield: [sourceA, sourceB] }),
                makePlayer("p2"),
            ],
        });
        const triggers = collectTriggers(state, [upkeepEvent("p1")]);
        expect(triggers).toHaveLength(2);
        state.stack.push(...triggers);
        resolveTopOfStack(state); // resolves the top trigger
        resolveTopOfStack(state); // resolves the other trigger
        // Both are each other's FIRST resolution — 20 + 1 + 1, not 20 + 1 + 10.
        expect(state.players[0].life).toBe(22);
    });

    it("survives the wire projection (life total after the escalating branch is server-computed)", () => {
        const source = makeInstance(RESOLUTION_COUNT_SOURCE_ID, {
            id: "rc-src-wire",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            activePlayerId: "p1",
            phase: "UPKEEP",
            players: [
                makePlayer("p1", { battlefield: [source] }),
                makePlayer("p2"),
            ],
        });
        state.stack.push(...collectTriggers(state, [upkeepEvent("p1")]));
        resolveTopOfStack(state);
        state.stack.push(...collectTriggers(state, [upkeepEvent("p1")]));
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(31); // 20 + 1 + 10
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.players[0].life).toBe(31);
    });
});

describe("Effect Script Op: winGame (CR 104.2a, issue #1066)", () => {
    it("sets state.gameOver for the resolving controller", () => {
        const id = registerScript("test-op-wingame-controller", [
            { op: "winGame", player: "controller" },
        ]);
        const state = makeState();
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        expect(state.gameOver).toEqual({
            winnerId: "p1",
            loserId: "p2",
            reason: "alternate-win",
        });
    });

    it('sets the OPPONENT as winner when player: "opponent"', () => {
        const id = registerScript("test-op-wingame-opponent", [
            { op: "winGame", player: "opponent" },
        ]);
        const state = makeState();
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        expect(state.gameOver).toEqual({
            winnerId: "p2",
            loserId: "p1",
            reason: "alternate-win",
        });
    });

    it("is a no-op when the game already ended (CR 104.2a doesn't re-decide)", () => {
        const id = registerScript("test-op-wingame-already-over", [
            { op: "winGame", player: "controller" },
        ]);
        const state = makeState();
        state.gameOver = {
            winnerId: "p2",
            loserId: "p1",
            reason: "life",
        };
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        expect(state.gameOver).toEqual({
            winnerId: "p2",
            loserId: "p1",
            reason: "life",
        });
    });

    it("survives the wire projection (gameOver is a top-level GameState key)", () => {
        const id = registerScript("test-op-wingame-wire", [
            { op: "winGame", player: "controller" },
        ]);
        const state = makeState();
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.gameOver).toEqual({
            winnerId: "p1",
            loserId: "p2",
            reason: "alternate-win",
        });
    });
});

describe("Effect Script Op: emblem (CR 114, issue #1221)", () => {
    it("creates one command-zone emblem owned by the controller", () => {
        const id = registerScript("test-op-emblem-create", [
            { op: "emblem", emblem: SORIN_LORD_OF_INNISTRAD_EMBLEM_ID },
        ]);
        const state = makeState();
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        expect(state.emblems).toHaveLength(1);
        expect(state.emblems![0]).toMatchObject({
            id: "emblem-1",
            ownerId: "p1",
            emblemId: SORIN_LORD_OF_INNISTRAD_EMBLEM_ID,
            name: "Sorin, Lord of Innistrad emblem",
            // Art print id denormalized from the def so the UI can render the
            // emblem's real Scryfall card art (issue #1221 follow-up).
            imagePrintId: "327ddaaf-b6a7-4c80-9b38-5ab68181b3d6",
        });
    });

    it("survives the wire projection (emblems ride the top-level spread)", () => {
        const id = registerScript("test-op-emblem-wire", [
            { op: "emblem", emblem: SORIN_LORD_OF_INNISTRAD_EMBLEM_ID },
        ]);
        const state = makeState();
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.emblems).toHaveLength(1);
        expect(projected.emblems![0].emblemId).toBe(
            SORIN_LORD_OF_INNISTRAD_EMBLEM_ID
        );
        // The denormalized display fields the command-zone UI renders survive
        // the projection (name/text/art print id ride the top-level spread).
        expect(projected.emblems![0].name).toBe(
            "Sorin, Lord of Innistrad emblem"
        );
        expect(projected.emblems![0].imagePrintId).toBe(
            "327ddaaf-b6a7-4c80-9b38-5ab68181b3d6"
        );
    });

    it("continuous anthem: creatures the owner controls get +1/+0, incl. after projection (CR 114.2a / 611)", () => {
        const p1Bear = makeInstance(BEAR_ID, {
            id: "p1-bear",
            controllerId: "p1",
        });
        const p2Bear = makeInstance(BEAR_ID, {
            id: "p2-bear",
            controllerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [p1Bear] }),
                makePlayer("p2", { battlefield: [p2Bear] }),
            ],
        });
        // Baseline (no emblem): the 2/5 bear is unbuffed.
        expect(getEffectivePower(state, p1Bear)).toBe(2);
        expect(getEffectiveToughness(state, p1Bear)).toBe(5);

        const id = registerScript("test-op-emblem-anthem", [
            { op: "emblem", emblem: SORIN_LORD_OF_INNISTRAD_EMBLEM_ID },
        ]);
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);

        // p1's creature gets +1/+0; p2's is unaffected (owner-scoped).
        expect(getEffectivePower(state, p1Bear)).toBe(3);
        expect(getEffectiveToughness(state, p1Bear)).toBe(5);
        expect(getEffectivePower(state, p2Bear)).toBe(2);

        // Wire: the source-less anthem still applies through projectPublicState.
        const projected = projectPublicState(state, 1, "p1");
        const slimP1Bear = projected.players[0].battlefield.find(
            (c) => c.id === "p1-bear"
        )!;
        const slimP2Bear = projected.players[1].battlefield.find(
            (c) => c.id === "p2-bear"
        )!;
        expect(getEffectivePower(projected, slimP1Bear)).toBe(3);
        expect(getEffectivePower(projected, slimP2Bear)).toBe(2);
    });

    it("triggered emblem: fires owner-scoped from the command zone and resolves (CR 114.2a / 603)", () => {
        // Synthetic triggered emblem: "Whenever you cast a spell, you gain 2
        // life." Exercises the collectTriggers emblem scan + the emblem-trigger
        // resolution branch (source-less, no permanent).
        const TRIGGERED_ID = "test-emblem-cast-lifegain";
        registerEmblemDefinition({
            id: TRIGGERED_ID,
            name: "Test cast-lifegain emblem",
            text: "Whenever you cast a spell, you gain 2 life.",
            triggeredAbilities: [
                {
                    id: `${TRIGGERED_ID}-trigger`,
                    oracleText: "Whenever you cast a spell, you gain 2 life.",
                    event: "SPELL_CAST",
                    matches: (event, self) =>
                        event.type === "SPELL_CAST" &&
                        event.casterId === self.controllerId,
                    effects: [
                        { op: "gainLife", player: "controller", amount: 2 },
                    ],
                },
            ],
        });
        const state = makeState();
        state.emblems = [
            {
                id: "emblem-1",
                ownerId: "p1",
                emblemId: TRIGGERED_ID,
                name: "Test cast-lifegain emblem",
                text: "Whenever you cast a spell, you gain 2 life.",
            },
        ];

        const castBy = (casterId: string): GameEvent =>
            ({
                type: "SPELL_CAST",
                casterId,
                spellInstanceId: "s1",
                spellCardId: "x",
                spellTypes: ["Sorcery"],
                spellSubtypes: [],
                spellColors: [],
                priorSpellCount: 0,
            }) as GameEvent;

        // p1 casts a spell → the emblem's owner-scoped trigger fires.
        const triggers = collectTriggers(state, [castBy("p1")]);
        expect(triggers).toHaveLength(1);
        expect(triggers[0].emblemSourceId).toBe(TRIGGERED_ID);
        expect(triggers[0].controllerId).toBe("p1");
        placeTriggersOnStack(state, triggers);
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(22);

        // p2 casting does NOT fire p1's emblem (CR 114.3 owner-scoped "you").
        expect(collectTriggers(state, [castBy("p2")])).toHaveLength(0);
    });

    it("emblems persist a serialize round-trip (drift guard, CR 114.4)", () => {
        const id = registerScript("test-op-emblem-serialize", [
            { op: "emblem", emblem: SORIN_LORD_OF_INNISTRAD_EMBLEM_ID },
        ]);
        const state = makeState();
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        const round = expandState(compactState(state));
        expect(round.emblems).toEqual(state.emblems);
        expect(round.nextEmblemSeq).toBe(state.nextEmblemSeq);
    });
});

describe("Effect Script Op: becomeMonarch (CR 720.2, issue #1199)", () => {
    it("crowns the resolving controller by default", () => {
        const id = registerScript("test-op-become-monarch-controller", [
            { op: "becomeMonarch" },
        ]);
        const state = makeState();
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        expect(state.monarchId).toBe("p1");
    });

    it("crowns an explicit player ref (opponent)", () => {
        const id = registerScript("test-op-become-monarch-opponent", [
            { op: "becomeMonarch", controller: "opponent" },
        ]);
        const state = makeState();
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        expect(state.monarchId).toBe("p2");
    });

    it("is idempotent — re-crowning the current monarch is a no-op", () => {
        const id = registerScript("test-op-become-monarch-idempotent", [
            { op: "becomeMonarch" },
        ]);
        const state = makeState();
        state.monarchId = "p1";
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        expect(state.monarchId).toBe("p1");
    });

    it("survives the wire projection (monarchId is a top-level GameState key)", () => {
        const id = registerScript("test-op-become-monarch-wire", [
            { op: "becomeMonarch" },
        ]);
        const state = makeState();
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.monarchId).toBe("p1");
    });
});

describe("delayedTrigger timing: this-turn-creature-deals-combat-damage-to-player (CR 720.2, Forth Eorlingas!, issue #1199)", () => {
    it("schedules the delayed trigger with no capture map needed", () => {
        const id = registerScript("test-timing-monarch-damage-schedule", [
            {
                op: "delayedTrigger",
                timing: "this-turn-creature-deals-combat-damage-to-player",
                oracleText: "test",
                effects: [{ op: "becomeMonarch" }],
            },
        ]);
        const state = makeState();
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        const watch = state.delayedTriggers?.find(
            (t) =>
                t.timing === "this-turn-creature-deals-combat-damage-to-player"
        );
        expect(watch).toBeDefined();
        expect(watch!.payload).toEqual({});
    });

    it("fires when a creature the scheduling controller controls deals combat damage to a player, crowning them monarch", () => {
        const id = registerScript("test-timing-monarch-damage-fire", [
            {
                op: "delayedTrigger",
                timing: "this-turn-creature-deals-combat-damage-to-player",
                oracleText: "test",
                effects: [{ op: "becomeMonarch" }],
            },
        ]);
        const attacker = makeInstance(BEAR_ID, {
            id: "atk",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            phase: "COMBAT_DAMAGE",
            players: [
                makePlayer("p1", { battlefield: [attacker] }),
                makePlayer("p2"),
            ],
            combat: {
                confirmed: true,
                blockerAssignments: {},
                blockersConfirmed: true,
                damageConfirmed: false,
                attackerIds: ["atk"],
            } as GameState["combat"],
        });
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        expect(state.monarchId).toBeUndefined();

        applyAllCombatDamage(state, {});
        // The delayed trigger is now on the stack — resolve it.
        while (
            state.stack.some(
                (s) =>
                    s.delayedTriggerId !== undefined &&
                    s.triggerEvent?.type === "DAMAGE_DEALT"
            )
        ) {
            resolveTopOfStack(state);
        }

        expect(state.monarchId).toBe("p1");
        // CR 603.7d-shaped — NOT consumed by firing; stays queued.
        expect(
            state.delayedTriggers?.some(
                (t) =>
                    t.timing ===
                    "this-turn-creature-deals-combat-damage-to-player"
            )
        ).toBe(true);
    });

    it("collapses several simultaneous DAMAGE_DEALT events in one damage step into a single firing (official ruling)", () => {
        const id = registerScript("test-timing-monarch-damage-collapse", [
            {
                op: "delayedTrigger",
                timing: "this-turn-creature-deals-combat-damage-to-player",
                oracleText: "test",
                effects: [{ op: "becomeMonarch", controller: "opponent" }],
            },
        ]);
        // Two attackers CONTROLLED BY p1 (the scheduling player), unblocked —
        // both hit p2 in the SAME damage step batch.
        const atk1 = makeInstance(BEAR_ID, {
            id: "atk1",
            controllerId: "p1",
            ownerId: "p1",
        });
        const atk2 = makeInstance(BEAR_ID, {
            id: "atk2",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            phase: "COMBAT_DAMAGE",
            activePlayerId: "p1",
            players: [
                makePlayer("p1", { battlefield: [atk1, atk2] }),
                makePlayer("p2"),
            ],
            combat: {
                confirmed: true,
                blockerAssignments: {},
                blockersConfirmed: true,
                damageConfirmed: false,
                attackerIds: ["atk1", "atk2"],
            } as GameState["combat"],
        });
        // Scheduled by p1 ("becomeMonarch controller: opponent" reads back p2
        // relative to the FIRING stack item's own controller — p1, the
        // scheduling player).
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);

        applyAllCombatDamage(state, {});
        const damageTriggerCount = state.stack.filter(
            (s) =>
                s.delayedTriggerId !== undefined &&
                s.triggerEvent?.type === "DAMAGE_DEALT"
        ).length;
        // "One or more creatures ... one or more players" — one firing, not two.
        expect(damageTriggerCount).toBe(1);
    });

    it("expires unconditionally at CLEANUP (CR 514.2)", () => {
        const id = registerScript("test-timing-monarch-damage-cleanup", [
            {
                op: "delayedTrigger",
                timing: "this-turn-creature-deals-combat-damage-to-player",
                oracleText: "test",
                effects: [{ op: "becomeMonarch" }],
            },
        ]);
        const state = makeState();
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        expect(
            state.delayedTriggers?.some(
                (t) =>
                    t.timing ===
                    "this-turn-creature-deals-combat-damage-to-player"
            )
        ).toBe(true);
        finalizeCleanup(state);
        expect(
            state.delayedTriggers?.some(
                (t) =>
                    t.timing ===
                    "this-turn-creature-deals-combat-damage-to-player"
            ) ?? false
        ).toBe(false);
    });
});

describe("Effect Script choice kind: choose-exile-card + Op: grantCastFromExile (CR 601.3e / 117.6 / 122.6, issue #1156)", () => {
    it("filters the exile-zone choice by hasCounter, then grants cast permission + the free-cast waiver cross-player (Dauthi Voidwalker shape)", () => {
        const voidCard = makeInstance(BEAR_ID, {
            id: "void1",
            controllerId: "p2",
            ownerId: "p2",
            zone: "exile",
            counters: { void: 1 },
        });
        const plainExiled = makeInstance(BEAR_ID, {
            id: "plain1",
            controllerId: "p2",
            ownerId: "p2",
            zone: "exile",
        });
        const id = registerScript("test-op-grant-cast-from-exile", [
            {
                op: "choice",
                kind: "choose-exile-card",
                player: "controller",
                zoneOwnerId: "opponent",
                zone: "exile",
                filter: { hasCounter: { type: "void" } },
                count: 1,
                prompt: "Choose an exiled card with a void counter.",
                bind: "$picked",
            },
            {
                op: "grantCastFromExile",
                card: { ref: "$picked" },
                player: "controller",
                window: "this-turn",
                withoutPayingManaCost: true,
            },
        ]);
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { exile: [voidCard, plainExiled] }),
            ],
        });
        pushSpell(state, id, "p1");
        expect(resolveTopOfStack(state)).toBeNull(); // suspended on the choice

        const head = state.pendingChoices![0];
        expect(head.kind).toBe("choose-exile-card");
        expect(head.zone).toBe("exile");
        // The chooser is the caster (p1); the zone belongs to the opponent (p2).
        expect(head.playerId).toBe("p1");
        expect(head.zoneOwnerId).toBe("p2");
        // The hasCounter filter precomputed candidateIds — only the
        // void-countered card is eligible, not the plain exiled one.
        expect(head.candidateIds).toEqual(["void1"]);

        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["void1"],
        });
        expect(state.stack).toHaveLength(0);
        expect(state.pendingChoices).toBeUndefined();

        // The grant lands on the picked card, still in the OPPONENT's exile
        // (CR 400.7 — the card never changes owner or zone).
        const granted = state.players[1].exile.find((c) => c.id === "void1")!;
        expect(granted.castableFromExileBy).toBe("p1");
        expect(granted.castableFromExileUntilTurn).toBe(state.turn);
        expect(granted.castFromExileWithoutPayingManaCost).toBe(true);
        // The non-picked exiled card is untouched.
        const untouched = state.players[1].exile.find(
            (c) => c.id === "plain1"
        )!;
        expect(untouched.castableFromExileBy).toBeUndefined();
        expect(untouched.castFromExileWithoutPayingManaCost).toBeUndefined();

        // Wire format: the granted card survives projection, still listed
        // under its OWNER's (p2's) exile pile for both viewers (CR 400.2 —
        // exile is a public zone).
        const projectedForCaster = projectPublicState(state, 1, "p1");
        expect(
            projectedForCaster.players[1].exile.find((c) => c.id === "void1")
        ).toBeDefined();
        const projectedForOwner = projectPublicState(state, 1, "p2");
        expect(
            projectedForOwner.players[1].exile.find((c) => c.id === "void1")
        ).toBeDefined();
    });

    it("degrades to a full no-op when no exiled card matches the filter (CR 608.2b) — the choice never suspends and the grant binding stays uncaptured", () => {
        const plainExiled = makeInstance(BEAR_ID, {
            id: "plain2",
            controllerId: "p2",
            ownerId: "p2",
            zone: "exile",
        });
        const id = registerScript("test-op-grant-cast-from-exile-empty", [
            {
                op: "choice",
                kind: "choose-exile-card",
                player: "controller",
                zoneOwnerId: "opponent",
                zone: "exile",
                filter: { hasCounter: { type: "void" } },
                count: 1,
                prompt: "Choose an exiled card with a void counter.",
                bind: "$picked",
            },
            {
                op: "grantCastFromExile",
                card: { ref: "$picked" },
                player: "controller",
                withoutPayingManaCost: true,
            },
        ]);
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { exile: [plainExiled] }),
            ],
        });
        pushSpell(state, id, "p1");
        expect(() => resolveTopOfStack(state)).not.toThrow();
        // No suspension — a 0-candidate fixed-count choice clamps to a no-op
        // (CR 608.2b) rather than raising an unanswerable PendingChoice.
        expect(state.pendingChoices).toBeUndefined();
        expect(state.stack).toHaveLength(0);
        expect(
            state.players[1].exile.find((c) => c.id === "plain2")!
                .castableFromExileBy
        ).toBeUndefined();
    });

    it("is a no-op when the grantee player cannot be resolved (CR 608.2b)", () => {
        const voidCard = makeInstance(BEAR_ID, {
            id: "void2",
            controllerId: "p2",
            ownerId: "p2",
            zone: "exile",
            counters: { void: 1 },
        });
        const id = registerScript("test-op-grant-cast-from-exile-no-player", [
            {
                op: "grantCastFromExile",
                card: { ref: "$nope" },
                player: "controller",
            },
        ]);
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { exile: [voidCard] }),
            ],
        });
        pushSpell(state, id, "p1");
        expect(() => resolveTopOfStack(state)).not.toThrow();
        expect(
            state.players[1].exile.find((c) => c.id === "void2")!
                .castableFromExileBy
        ).toBeUndefined();
    });
});

describe("Effect Script choice kind: choose-hand-card + Op: grantCastFromGraveyard (CR 601.3e / 117.6-analog, issue #1344)", () => {
    it("discards the chosen hand card, then grants graveyard cast permission + the free-cast waiver (Malcolm shape, same-player, 'this-turn' window)", () => {
        const handCard = makeInstance(BEAR_ID, {
            id: "hand1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const id = registerScript("test-op-grant-cast-from-graveyard", [
            {
                op: "choice",
                kind: "choose-hand-card",
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
                op: "grantCastFromGraveyard",
                card: { ref: "$picked" },
                player: "controller",
                window: "this-turn",
                withoutPayingManaCost: true,
            },
        ]);
        const state = makeState({
            players: [makePlayer("p1", { hand: [handCard] }), makePlayer("p2")],
        });
        pushSpell(state, id, "p1");
        expect(resolveTopOfStack(state)).toBeNull(); // suspended on the choice

        const head = state.pendingChoices![0];
        expect(head.kind).toBe("choose-hand-card");
        expect(head.zone).toBe("hand");
        expect(head.playerId).toBe("p1");

        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["hand1"],
        });
        expect(state.stack).toHaveLength(0);
        expect(state.pendingChoices).toBeUndefined();

        // The discarded card landed in the OWN graveyard (CR 701.9) and
        // carries the per-card grant.
        expect(state.players[0].hand).toHaveLength(0);
        const granted = state.players[0].graveyard.find(
            (c) => c.id === "hand1"
        )!;
        expect(granted).toBeDefined();
        expect(granted.castableFromGraveyardBy).toBe("p1");
        expect(granted.castableFromGraveyardUntilTurn).toBe(state.turn);
        expect(granted.castFromGraveyardWithoutPayingManaCost).toBe(true);

        // Wire format: the caster's own projected graveyard card carries the
        // grant's `legalActions` + `castKind`; the opponent's view of the
        // SAME card carries neither (the grant is the caster's alone —
        // there IS no opponent's graveyard copy since this is same-player,
        // but the projection is per-viewer regardless).
        const projected = projectPublicState(state, 1, "p1");
        const projGranted = projected.players[0].graveyard.find(
            (c) => c.id === "hand1"
        )!;
        expect(projGranted.legalActions).toContain("cast");
        expect(projGranted.castKind).toBe("graveyard-grant");
    });

    it("degrades to a full no-op when the chooser's hand is empty (CR 608.2b) — the choice never suspends and the grant binding stays uncaptured", () => {
        const id = registerScript("test-op-grant-cast-from-graveyard-empty", [
            {
                op: "choice",
                kind: "choose-hand-card",
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
                op: "grantCastFromGraveyard",
                card: { ref: "$picked" },
                player: "controller",
                withoutPayingManaCost: true,
            },
        ]);
        const state = makeState({
            players: [makePlayer("p1", { hand: [] }), makePlayer("p2")],
        });
        pushSpell(state, id, "p1");
        expect(() => resolveTopOfStack(state)).not.toThrow();
        // No suspension — a 0-candidate fixed-count choice clamps to a no-op
        // (CR 608.2b) rather than raising an unanswerable PendingChoice.
        expect(state.pendingChoices).toBeUndefined();
        expect(state.stack).toHaveLength(0);
        // The resolved sorcery itself lands in the graveyard (CR 608.2m) —
        // no OTHER card (there was nothing to discard) carries a grant.
        expect(state.players[0].graveyard).toHaveLength(1);
        expect(
            state.players[0].graveyard.every(
                (c) => c.castableFromGraveyardBy === undefined
            )
        ).toBe(true);
    });

    it("is a no-op when the grantee player cannot be resolved (CR 608.2b)", () => {
        const gyCard = makeInstance(BEAR_ID, {
            id: "gy1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const id = registerScript(
            "test-op-grant-cast-from-graveyard-no-player",
            [
                {
                    op: "grantCastFromGraveyard",
                    card: { ref: "$nope" },
                    player: "opponent",
                },
            ]
        );
        // A SINGLE-player state — "opponent" (CR 102.2's "the one player who
        // isn't the controller") has no candidate to resolve to.
        const state = makeState({
            players: [makePlayer("p1", { graveyard: [gyCard] })],
        });
        pushSpell(state, id, "p1");
        expect(() => resolveTopOfStack(state)).not.toThrow();
        expect(
            state.players[0].graveyard.find((c) => c.id === "gy1")!
                .castableFromGraveyardBy
        ).toBeUndefined();
    });

    it("defaults to an OPEN-ENDED grant ('while-in-graveyard') when `window` is omitted — no expiry marker stamped", () => {
        const gyCard = makeInstance(BEAR_ID, {
            id: "gy2",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const id = registerScript(
            "test-op-grant-cast-from-graveyard-open-ended",
            [
                {
                    op: "choice",
                    kind: "choose-graveyard-card",
                    player: "controller",
                    zone: "graveyard",
                    count: 1,
                    prompt: "Choose a graveyard card.",
                    bind: "$picked",
                },
                {
                    op: "grantCastFromGraveyard",
                    card: { ref: "$picked" },
                    player: "controller",
                },
            ]
        );
        const state = makeState({
            players: [
                makePlayer("p1", { graveyard: [gyCard] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, id, "p1");
        expect(resolveTopOfStack(state)).toBeNull(); // suspended on the choice

        const head = state.pendingChoices![0];
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["gy2"],
        });
        const granted = state.players[0].graveyard.find((c) => c.id === "gy2")!;
        expect(granted.castableFromGraveyardBy).toBe("p1");
        expect(granted.castableFromGraveyardUntilTurn).toBeUndefined();
        expect(granted.castFromGraveyardWithoutPayingManaCost).toBeUndefined();
    });
});

// --- nameCard Op: an open name choice during resolution (CR 201.3 / 202.3,
// issue #1085) -----------------------------------------------------------
// `nameCard` suspends like `choice`/`mayPay` — the binding name doubles as
// the choiceId, and the chosen name is committed as a picks-family binding
// (a single-element string array) a later `EffectCardFilter.name` bare ref
// reads back. Real catalogue card names are used throughout (Grizzly Bears /
// Hill Giant / Forest) because `applyNameCardSubmit` resolves names through
// the LIVE catalogue's `nameRegistry`, which synthetic `registerTokenDefinition`
// test cards never join (mirrors Petra Sphinx's own test fixture, `leg/white`).

describe("Effect Script Op: nameCard (CR 201.3 / 202.3, issue #1085)", () => {
    it("suspends on a name-card choice, then resumes once a legal name is submitted", () => {
        const id = registerScript("test-op-namecard-basic", [
            {
                op: "nameCard",
                player: "controller",
                prompt: "Name a card.",
                bind: "$named",
            },
        ]);
        const state = makeState();
        pushSpell(state, id, "p1");
        expect(resolveTopOfStack(state)).toBeNull(); // suspended
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("name-card");
        expect(head.playerId).toBe("p1");
        applyNameCardSubmit(state, {
            playerId: "p1",
            cardName: "grizzly bears",
        });
        // Resolution resumed and the sorcery left the stack — the binding had
        // no downstream reader in this script, exactly like an unread `choice`
        // pick (CR 608.2b, no crash on an unconsumed binding).
        expect(state.pendingChoices ?? []).toHaveLength(0);
        expect(state.stack).toHaveLength(0);
    });

    it("rejects a basic land name at SUBMIT time (excludeBasicLand, CR 201.3) — the chooser is asked again", () => {
        const id = registerScript("test-op-namecard-nobasic", [
            {
                op: "nameCard",
                player: "controller",
                prompt: "Choose a card name other than a basic land card name.",
                bind: "$named",
                excludeBasicLand: true,
            },
        ]);
        const state = makeState();
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        expect(() =>
            applyNameCardSubmit(state, { playerId: "p1", cardName: "Forest" })
        ).toThrow(/basic land/i);
        // The illegal submission left the pending choice in place — no
        // silent skip, the chooser must submit a legal name.
        expect(state.pendingChoices).toHaveLength(1);
        expect(state.pendingChoices![0].kind).toBe("name-card");
        applyNameCardSubmit(state, {
            playerId: "p1",
            cardName: "Grizzly Bears",
        });
        expect(state.pendingChoices ?? []).toHaveLength(0);
    });

    it("wire format: the suspended name-card choice crosses the projection", () => {
        const id = registerScript(
            "test-op-namecard-wire",
            [
                {
                    op: "nameCard",
                    player: { target: 0 },
                    prompt: "Name a card.",
                    bind: "$named",
                },
            ],
            { targetRequirement: { type: "player", count: 1 } }
        );
        const state = makeState();
        pushSpell(state, id, "p1", [{ type: "player", id: "p2" }]);
        resolveTopOfStack(state);
        refreshExpectedInput(state); // ADR 0047 — stable-point snapshot
        const projected = projectPublicState(state, 1, "p2");
        const head = projected.pendingChoices![0];
        expect(head.kind).toBe("name-card");
        expect(head.playerId).toBe("p2");
        expect(head.prompt).toBe("Name a card.");
    });
});

// --- digMatchingToHand Op: filter-driven reveal-and-split (CR 701.20a /
// 401.4, issue #1085) ------------------------------------------------------
// Deterministic sibling of digToHand: reveals the top `look` cards to every
// player, puts every FILTER-matching card into hand with NO player choice,
// and sends every non-matching card to `destination`. One synchronous step —
// no suspension.

describe("Effect Script Op: digMatchingToHand (CR 701.20a / 401.4, issue #1085)", () => {
    const grizzlyBears = getCardByName("Grizzly Bears");
    const hillGiant = getCardByName("Hill Giant");

    const libOf = (owner: "p1" | "p2", cardIds: string[]) =>
        cardIds.map((cardId, i) =>
            makeInstance(cardId, {
                id: `dig-match-${owner}-${i}`,
                controllerId: owner,
                ownerId: owner,
                zone: "library",
            })
        );

    it("Desperate Research shape: matching cards go to hand, the rest are exiled (literal name filter)", () => {
        const id = registerScript("test-op-digmatch-literal-exile", [
            {
                op: "digMatchingToHand",
                player: "controller",
                look: 3,
                filter: { name: "Grizzly Bears" },
                destination: "exile",
            },
        ]);
        const state = makeState({
            players: [
                makePlayer("p1", {
                    library: libOf("p1", [
                        grizzlyBears.id,
                        hillGiant.id,
                        grizzlyBears.id,
                    ]),
                }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, id, "p1");
        resolveTopOfStack(state); // no suspension — single synchronous step
        expect(state.pendingChoices ?? []).toHaveLength(0);
        expect(state.players[0].hand.map((c) => c.card.id).sort()).toEqual(
            [grizzlyBears.id, grizzlyBears.id].sort()
        );
        expect(state.players[0].exile.map((c) => c.card.id)).toEqual([
            hillGiant.id,
        ]);
        expect(state.players[0].library).toHaveLength(0);
    });

    it("no matches → the whole looked-at window is sent to destination, hand unchanged (CR 608.2b)", () => {
        const id = registerScript("test-op-digmatch-no-match", [
            {
                op: "digMatchingToHand",
                player: "controller",
                look: 2,
                filter: { name: "Not A Real Card Name" },
                destination: "graveyard",
            },
        ]);
        const state = makeState({
            players: [
                makePlayer("p1", {
                    library: libOf("p1", [hillGiant.id, hillGiant.id]),
                }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        expect(state.players[0].hand).toHaveLength(0);
        // The graveyard also holds the sorcery itself once it resolves (CR
        // 608.3) — filter to the dug cards to isolate the digMatchingToHand
        // outcome.
        expect(
            state.players[0].graveyard
                .filter((c) => c.card.id === hillGiant.id)
                .map((c) => c.card.id)
        ).toEqual([hillGiant.id, hillGiant.id]);
    });

    it("bind snapshots the first matching card put into hand", () => {
        const id = registerScript("test-op-digmatch-bind", [
            {
                op: "digMatchingToHand",
                player: "controller",
                look: 2,
                filter: { name: "Grizzly Bears" },
                destination: "exile",
                bind: "$firstMatch",
            },
            // A hand-card snapshot's `.power`/`.toughness` are always zero
            // (`bindSnapshot`'s non-permanent branch, mirrors `digToHand`'s
            // own `bind`); `.manaValue` IS captured pre-move (CR 202.3,
            // issue #1101's Reviving Vapors precedent) — asserting it proves
            // the bind captured the RIGHT instance, not just that a move
            // happened.
            {
                op: "loseLife",
                player: "opponent",
                amount: { ref: "$firstMatch.manaValue" },
            },
        ]);
        const state = makeState({
            players: [
                makePlayer("p1", {
                    library: libOf("p1", [grizzlyBears.id, hillGiant.id]),
                }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        // Grizzly Bears {X:1}{G:1} → mana value 2.
        expect(state.players[1].life).toBe(18);
    });

    it("wire format: the reveal-and-split hand/exile counts cross the projection", () => {
        const id = registerScript("test-op-digmatch-wire", [
            {
                op: "digMatchingToHand",
                player: "controller",
                look: 3,
                filter: { name: "Grizzly Bears" },
                destination: "exile",
            },
        ]);
        const state = makeState({
            players: [
                makePlayer("p1", {
                    library: libOf("p1", [
                        grizzlyBears.id,
                        hillGiant.id,
                        grizzlyBears.id,
                    ]),
                }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.players[0].hand).toHaveLength(2);
        expect(projected.players[0].exile).toHaveLength(1);
        expect(projected.players[0].library.count).toBe(0);
    });

    it("Desperate Research composition: nameCard's chosen name reads back into digMatchingToHand's filter via a bare ref", () => {
        const id = registerScript("test-op-namecard-digmatch-combo", [
            {
                op: "nameCard",
                player: "controller",
                prompt: "Choose a card name other than a basic land card name.",
                bind: "$named",
                excludeBasicLand: true,
            },
            {
                op: "digMatchingToHand",
                player: "controller",
                look: 7,
                filter: { name: { ref: "$named" } },
                destination: "exile",
            },
        ]);
        const state = makeState({
            players: [
                makePlayer("p1", {
                    library: libOf("p1", [
                        grizzlyBears.id,
                        hillGiant.id,
                        grizzlyBears.id,
                        hillGiant.id,
                        grizzlyBears.id,
                        hillGiant.id,
                        hillGiant.id,
                    ]),
                }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, id, "p1");
        expect(resolveTopOfStack(state)).toBeNull(); // suspends on nameCard
        applyNameCardSubmit(state, {
            playerId: "p1",
            cardName: "Grizzly Bears",
        });
        // Resumed: digMatchingToHand's bare ref reads the committed picks-
        // family binding back and splits the revealed window on it.
        expect(state.pendingChoices ?? []).toHaveLength(0);
        expect(
            state.players[0].hand.every((c) => c.card.id === grizzlyBears.id)
        ).toBe(true);
        expect(state.players[0].hand).toHaveLength(3);
        expect(state.players[0].exile).toHaveLength(4);
        expect(state.players[0].library).toHaveLength(0);
    });

    it("an uncaptured name binding fails the filter closed — nothing matches (CR 608.2b)", () => {
        // The nameCard Op is deliberately OMITTED here — `$named` is never
        // bound, so the bare ref read returns undefined and the filter must
        // fail closed (matching nothing), not throw or match everything.
        const id = registerScript("test-op-digmatch-uncaptured-ref", [
            {
                op: "digMatchingToHand",
                player: "controller",
                look: 2,
                filter: { name: { ref: "$named" } },
                destination: "exile",
            },
        ]);
        const state = makeState({
            players: [
                makePlayer("p1", {
                    library: libOf("p1", [grizzlyBears.id, hillGiant.id]),
                }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        expect(state.players[0].hand).toHaveLength(0);
        expect(state.players[0].exile).toHaveLength(2);
    });
});

describe("Effect Script Op: exileWithAttachments / returnExiledForSource (CR 603.7a / 701.18 / ADR 0028)", () => {
    // A minimal Aura for the includeAttachments tests (attaches to a creature).
    const TEST_AURA_ID = "test-op-exile-aura";
    registerTokenDefinition({
        id: TEST_AURA_ID,
        name: TEST_AURA_ID,
        rarity: "common",
        manaCost: { W: 1 },
        types: ["Enchantment"],
        subtypes: ["Aura"],
    });

    it("exiles the announced target and arms a bundle keyed to $source (host-only default)", () => {
        const id = registerScript("test-op-ewa-exile", [
            { op: "exileWithAttachments", target: { target: 0 } },
        ]);
        const bear = makeInstance(BEAR_ID, {
            controllerId: "p2",
            ownerId: "p2",
            id: "ewaBear",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        const item = pushSpell(state, id, "p1", [
            { type: "permanent", id: "ewaBear" },
        ]);
        resolveTopOfStack(state);
        // CR 701.18 — the target left the battlefield into its owner's exile.
        expect(
            state.players[1].battlefield.find((c) => c.id === "ewaBear")
        ).toBeUndefined();
        expect(state.players[1].exile.map((c) => c.id)).toContain("ewaBear");
        // ADR 0028 — a bundle was armed, keyed to the RESOLVING source (the
        // spell instance), not an author-supplied id.
        const bundle = (state.exileHeld ?? []).find(
            (b) => b.hostId === "ewaBear"
        );
        expect(bundle).toBeDefined();
        expect(bundle!.sourceId).toBe(item.id);
    });

    it("wire format: the exiled target no longer appears on the projected battlefield", () => {
        const id = registerScript("test-op-ewa-wire", [
            { op: "exileWithAttachments", target: { target: 0 } },
        ]);
        const bear = makeInstance(BEAR_ID, {
            controllerId: "p2",
            ownerId: "p2",
            id: "ewaWire",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        pushSpell(state, id, "p1", [{ type: "permanent", id: "ewaWire" }]);
        resolveTopOfStack(state);
        const projected = projectPublicState(state, 1, "p1");
        expect(
            projected.players[1].battlefield.find((c) => c.id === "ewaWire")
        ).toBeUndefined();
    });

    it("host-only default (includeAttachments omitted): the Aura is NOT bundled — the Op flips the primitive's true default", () => {
        const id = registerScript("test-op-ewa-hostonly", [
            { op: "exileWithAttachments", target: { target: 0 } },
        ]);
        const bear = makeInstance(BEAR_ID, {
            controllerId: "p2",
            ownerId: "p2",
            id: "hoBear",
        });
        const aura = makeInstance(TEST_AURA_ID, {
            controllerId: "p2",
            ownerId: "p2",
            id: "hoAura",
            attachedTo: "hoBear",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear, aura] }),
            ],
        });
        pushSpell(state, id, "p1", [{ type: "permanent", id: "hoBear" }]);
        resolveTopOfStack(state);
        checkStateBasedActions(state); // orphan-aura SBA (CR 704.5n)
        const bundle = (state.exileHeld ?? []).find(
            (b) => b.hostId === "hoBear"
        );
        expect(bundle).toBeDefined();
        expect(bundle!.attached).toHaveLength(0);
        // The now-orphaned Aura fell to its owner's graveyard, not exile.
        expect(state.players[1].graveyard.map((c) => c.id)).toContain("hoAura");
        expect(state.players[1].exile.map((c) => c.id)).not.toContain("hoAura");
    });

    it("includeAttachments: true bundles the host's Aura to travel into exile with it", () => {
        const id = registerScript("test-op-ewa-withattach", [
            {
                op: "exileWithAttachments",
                target: { target: 0 },
                includeAttachments: true,
            },
        ]);
        const bear = makeInstance(BEAR_ID, {
            controllerId: "p2",
            ownerId: "p2",
            id: "waBear",
        });
        const aura = makeInstance(TEST_AURA_ID, {
            controllerId: "p2",
            ownerId: "p2",
            id: "waAura",
            attachedTo: "waBear",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear, aura] }),
            ],
        });
        pushSpell(state, id, "p1", [{ type: "permanent", id: "waBear" }]);
        resolveTopOfStack(state);
        const bundle = (state.exileHeld ?? []).find(
            (b) => b.hostId === "waBear"
        );
        expect(bundle).toBeDefined();
        expect(bundle!.attached.map((a) => a.id)).toContain("waAura");
        expect(state.players[1].exile.map((c) => c.id)).toEqual(
            expect.arrayContaining(["waBear", "waAura"])
        );
    });

    it("returnExiledForSource returns the armed bundle to the battlefield (round-trip)", () => {
        const id = registerScript("test-op-return", [
            { op: "returnExiledForSource" },
        ]);
        const bear = makeInstance(BEAR_ID, {
            controllerId: "p2",
            ownerId: "p2",
            id: "retBear",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        const item = pushSpell(state, id, "p1", []);
        // Arm a bundle keyed to the resolving source BEFORE it resolves.
        exileWithAttachments(state, "retBear", {
            sourceId: item.id,
            returnTapped: false,
            includeAttachments: false,
        });
        expect(
            state.players[1].battlefield.find((c) => c.id === "retBear")
        ).toBeUndefined();
        resolveTopOfStack(state);
        // CR 603.7a — the host is back (a fresh object, so match by card id)
        // and the bundle is cleared.
        expect(
            state.players[1].battlefield.some((c) => c.card.id === BEAR_ID)
        ).toBe(true);
        expect(
            (state.exileHeld ?? []).some((b) => b.sourceId === item.id)
        ).toBe(false);
    });

    it("wire format: the returned host reappears on the projected battlefield", () => {
        const id = registerScript("test-op-return-wire", [
            { op: "returnExiledForSource" },
        ]);
        const bear = makeInstance(BEAR_ID, {
            controllerId: "p2",
            ownerId: "p2",
            id: "retWire",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        const item = pushSpell(state, id, "p1", []);
        exileWithAttachments(state, "retWire", {
            sourceId: item.id,
            returnTapped: false,
            includeAttachments: false,
        });
        resolveTopOfStack(state);
        const projected = projectPublicState(state, 1, "p1");
        expect(
            projected.players[1].battlefield.some((c) => c.card.id === BEAR_ID)
        ).toBe(true);
    });
});
