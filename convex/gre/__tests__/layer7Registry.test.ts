// Layer 7 reads the Continuous Effects Registry (ADR 0082, PRD #2064 S2).
//
// `layers.test.ts` is the behavioural baseline and stays untouched — it proves
// the migration changed no outcome. This file proves the things the migration
// ADDED, none of which the baseline can reach: a STORED registry entry
// participates in the pipeline, the CR 613.4 sublayers order it correctly
// (including the 7d switch, which the pre-registry pipeline had no body for),
// and the ADR 0020 §2 bot-eval filter now keys off an entry's expiry instead of
// which instance field it came from.

import { describe, expect, it } from "vitest";
import {
    getEffectivePower,
    getEffectiveToughness,
    getPermanentEffectivePower,
    getPermanentEffectiveToughness,
} from "../layers";
import type { ContinuousEffect } from "../continuousEffects";
import type { CardInstanceState, GameState } from "../state";
import { makePlayer, makeState } from "../../cards/__tests__/setup";
import { resetBattlefieldTransientState } from "../state";
import { crusade } from "../../cards/sets/lea";

/** A vanilla creature with no registry entry — every effect in this file
 *  arrives as a registry entry, so no card definition is needed. */
function creature(
    id: string,
    power: number,
    toughness: number,
    overrides: Partial<CardInstanceState> = {}
): CardInstanceState {
    return {
        id,
        card: { id: `synth-${id}` },
        types: ["Creature"],
        subtypes: [],
        power,
        toughness,
        staticAbilities: [],
        controllerId: "p1",
        ownerId: "p1",
        zone: "battlefield",
        isTapped: false,
        ...overrides,
    };
}

/** A layer-7 registry entry affecting `instanceIds`. Every field an assertion
 *  cares about is passed in, so the defaults never carry meaning. */
function entry(
    id: string,
    timestamp: number,
    sublayer: "7a" | "7b" | "7c" | "7d",
    payload: ContinuousEffect["payload"],
    overrides: Partial<ContinuousEffect> = {}
): ContinuousEffect {
    return {
        id,
        layer: 7,
        sublayer,
        timestamp,
        expiry: { kind: "indefinite", controllerId: "p1" },
        affected: { kind: "instances", instanceIds: ["bear"] },
        payload,
        characteristicDefining: sublayer === "7a",
        ...overrides,
    } as ContinuousEffect;
}

function stateWith(
    battlefield: CardInstanceState[],
    entries: ContinuousEffect[]
): GameState {
    return makeState({
        players: [makePlayer("p1", { battlefield }), makePlayer("p2")],
        continuousEffects: entries,
    });
}

describe("layer 7 reads the Continuous Effects Registry (CR 613.4, ADR 0082)", () => {
    it("applies a stored 7c modifier to the instance it names (CR 613.4c)", () => {
        const bear = creature("bear", 2, 2);
        const state = stateWith(
            [bear],
            [
                entry("ce-1", 10, "7c", {
                    kind: "pt-modify",
                    power: 3,
                    toughness: 1,
                }),
            ]
        );

        expect(getEffectivePower(state, bear)).toBe(5);
        expect(getEffectiveToughness(state, bear)).toBe(3);
    });

    it("ignores a stored entry that names a different instance (CR 611.2c)", () => {
        const bear = creature("bear", 2, 2);
        const ox = creature("ox", 2, 4);
        const state = stateWith(
            [bear, ox],
            [
                entry("ce-1", 10, "7c", {
                    kind: "pt-modify",
                    power: 3,
                    toughness: 1,
                }),
            ]
        );

        expect(getEffectivePower(state, ox)).toBe(2);
        expect(getEffectiveToughness(state, ox)).toBe(4);
    });

    it("lets the latest 7b set win, per characteristic (CR 613.4b, 613.7)", () => {
        const bear = creature("bear", 2, 2);
        const state = stateWith(
            [bear],
            [
                entry("ce-late", 20, "7b", { kind: "pt-set", power: 7 }),
                entry("ce-early", 10, "7b", {
                    kind: "pt-set",
                    power: 0,
                    toughness: 1,
                }),
            ]
        );

        // Power: the later entry (timestamp 20) overwrites the earlier 0.
        // Toughness: only the earlier entry sets it, so 1 stands.
        expect(getEffectivePower(state, bear)).toBe(7);
        expect(getEffectiveToughness(state, bear)).toBe(1);
    });

    it("applies a 7c modifier on top of a 7b set, never under it (CR 613.4b/c)", () => {
        const bear = creature("bear", 5, 5);
        const state = stateWith(
            [bear],
            [
                // Deliberately the LATER timestamp: sublayer order beats
                // timestamp order across sublayers (CR 613.4).
                entry("ce-mod", 30, "7c", {
                    kind: "pt-modify",
                    power: 2,
                    toughness: 2,
                }),
                entry("ce-set", 10, "7b", {
                    kind: "pt-set",
                    power: 0,
                    toughness: 1,
                }),
            ]
        );

        expect(getEffectivePower(state, bear)).toBe(2);
        expect(getEffectiveToughness(state, bear)).toBe(3);
    });

    it("switches power and toughness in 7d, after every modifier (CR 613.4d)", () => {
        // The CR 613.4d example verbatim: a 1/3 creature is given +0/+1, then
        // another effect switches its power and toughness — it becomes 4/1.
        const bear = creature("bear", 1, 3);
        const state = stateWith(
            [bear],
            [
                entry("ce-switch", 10, "7d", { kind: "pt-switch" }),
                entry("ce-pump", 20, "7c", {
                    kind: "pt-modify",
                    power: 0,
                    toughness: 1,
                }),
            ]
        );

        expect(getEffectivePower(state, bear)).toBe(4);
        expect(getEffectiveToughness(state, bear)).toBe(1);
    });

    it("puts counters and modifying effects in ONE sublayer (CR 613.4c)", () => {
        const bear = creature("bear", 2, 2, { counters: { "+1/+1": 2 } });
        const state = stateWith(
            [bear],
            [
                entry("ce-1", 10, "7c", {
                    kind: "pt-modify",
                    power: 1,
                    toughness: 0,
                }),
            ]
        );

        expect(getEffectivePower(state, bear)).toBe(5);
        expect(getEffectiveToughness(state, bear)).toBe(4);
    });

    it("does not let a 7d entry both switch and drop its own value (CR 613.4d)", () => {
        // `ContinuousEffectSlot` pins sublayer to LAYER, not to payload kind,
        // so a 7d entry carrying a value is representable. Swapping on it
        // would silently discard that value; the pipeline ignores it instead.
        const bear = creature("bear", 1, 3);
        const state = stateWith(
            [bear],
            [
                entry("ce-bogus", 10, "7d", {
                    kind: "pt-modify",
                    power: 9,
                    toughness: 9,
                }),
            ]
        );

        expect(getEffectivePower(state, bear)).toBe(1);
        expect(getEffectiveToughness(state, bear)).toBe(3);
    });

    it("ignores a stored template whose sourceCardId no longer matches", () => {
        // A stored entry names its source by INSTANCE id; ids are reused across
        // games, so the entry's own record of the card it was written against
        // is what decides whether it still describes this permanent.
        const anthem = creature("crusade", 0, 0, {
            types: crusade.types,
            card: { id: crusade.id },
        });
        const bear = creature("bear", 2, 2, {
            card: { id: "synth-bear", manaCost: { W: 1 } },
        });
        const state = stateWith(
            [anthem, bear],
            [
                {
                    id: "ce-stale",
                    layer: 7,
                    sublayer: "7c",
                    timestamp: 10,
                    expiry: { kind: "source", sourceId: "crusade" },
                    affected: { kind: "predicate" },
                    payload: {
                        kind: "template",
                        sourceCardId: "some-other-card",
                        effectIndex: 0,
                    },
                    characteristicDefining: false,
                } as ContinuousEffect,
            ]
        );

        // Crusade's own derived entry still applies once — 2/2 + 1/+1.
        expect(getEffectivePower(state, bear)).toBe(3);
        expect(getEffectiveToughness(state, bear)).toBe(3);
    });

    it("derives a 7a CDA below a 7b set, whatever their timestamps (CR 613.4a/b)", () => {
        const bear = creature("bear", 2, 2);
        const state = stateWith(
            [bear],
            [
                entry("ce-cda", 40, "7a", {
                    kind: "pt-modify",
                    power: 4,
                    toughness: 4,
                }),
                // Sets POWER only, so toughness stays observable: the 7a
                // contribution has to survive into the answer, and a 7a body
                // that did nothing would show up as 2 instead of 6.
                entry("ce-set", 10, "7b", { kind: "pt-set", power: 1 }),
            ]
        );

        expect(getEffectivePower(state, bear)).toBe(1);
        expect(getEffectiveToughness(state, bear)).toBe(6);
    });
});

describe("the bot-eval filter keys off expiry, not provenance (ADR 0020 §2)", () => {
    it("drops `duration` entries and keeps every other expiry", () => {
        // A combat trick is a `duration` entry since PRD #2064 S6 (it was
        // `temporaryPTMods` on the instance, tagged `instance-duration` on the
        // way through), so it is not scored as permanent material. A counter, a
        // static buff and an indefinite registry entry all are.
        const anthem = {
            id: "crusade",
            card: { id: crusade.id },
            types: crusade.types,
            subtypes: [],
            staticAbilities: [],
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield" as const,
            isTapped: false,
        };
        // WHITE, so Crusade's "white creatures get +1/+1" actually applies:
        // a colourless bear would let the filter drop every `source`-expiry
        // entry with no test noticing (the anthem would contribute 0 either
        // way, and nothing else in the repo calls these two accessors).
        const bear = creature("bear", 2, 2, {
            subtypes: [],
            card: { id: "synth-bear", manaCost: { W: 1 } },
            counters: { "+1/+1": 1 },
        });
        const untilEOT = {
            expiry: {
                kind: "duration" as const,
                duration: { phase: "end-of-turn" as const },
                controllerId: "p1",
            },
        };
        const state = stateWith(
            [anthem as CardInstanceState, bear],
            [
                entry("ce-forever", 10, "7c", {
                    kind: "pt-modify",
                    power: 1,
                    toughness: 1,
                }),
                entry(
                    "ce-trick",
                    20,
                    "7c",
                    { kind: "pt-modify", power: 5, toughness: 5 },
                    untilEOT
                ),
                entry(
                    "ce-set-eot",
                    5,
                    "7b",
                    { kind: "pt-set", power: 9 },
                    untilEOT
                ),
            ]
        );

        // Everything counted: base 2/2, Crusade +1/+1, +1/+1 counter,
        // indefinite +1/+1, temporary +5/+5, and a 7b set of power 9
        // underneath the modifiers.
        expect(getEffectivePower(state, bear)).toBe(17);
        expect(getEffectiveToughness(state, bear)).toBe(10);

        // Permanent material only: the 7b set and the +5/+5 pump are gone;
        // the anthem, the counter and the indefinite entry all remain.
        expect(getPermanentEffectivePower(state, bear)).toBe(5);
        expect(getPermanentEffectiveToughness(state, bear)).toBe(5);
    });

    it("counts an INDEFINITE 7b base-P/T set as permanent material (CR 611.2a)", () => {
        // The correction PRD #2064 S6 carries. `SpellContext.setBasePT` with
        // `"indefinite"` (Wall of Tombstones — "change its base toughness ...
        // indefinitely") used to land in `temporaryPTSet` beside the timed
        // form, and the whole array was tagged `instance-duration`, so the bot
        // dropped it as if it were a combat trick. It holds no boundary at all,
        // so it is material.
        const bear = creature("bear", 2, 2, { subtypes: [] });
        const state = stateWith(
            [bear],
            [
                entry("ce-set-forever", 10, "7b", {
                    kind: "pt-set",
                    toughness: 7,
                }),
            ]
        );
        expect(getEffectiveToughness(state, bear)).toBe(7);
        expect(getPermanentEffectiveToughness(state, bear)).toBe(7);
    });

    it("keeps a while-source-tapped effect as permanent material (CR 611.2b)", () => {
        // Ashnod's Battle Gear holds its buff for as long as the Gear stays
        // tapped — state-tied, not boundary-tied, so ADR 0020 §2 counts it.
        const gear = creature("gear", 0, 0, {
            types: ["Artifact"],
            isTapped: true,
        });
        const bear = creature("bear", 2, 4, {
            sourceTappedPTMods: [{ power: 2, toughness: -2, sourceId: "gear" }],
        });
        const state = stateWith([gear, bear], []);

        expect(getPermanentEffectivePower(state, bear)).toBe(4);
        expect(getPermanentEffectiveToughness(state, bear)).toBe(2);

        // Untap the source: the entry stops existing, so the buff is gone at
        // the next read — no purge pass in between.
        gear.isTapped = false;
        expect(getPermanentEffectivePower(state, bear)).toBe(2);
        expect(getPermanentEffectiveToughness(state, bear)).toBe(4);
    });
});

// ---------------------------------------------------------------------------
// CR 400.7 — the zone-change purge (PRD #2064 S6).
//
// The instance fields the registry replaced were DELETED on the way out
// (`delete card.temporaryPTSet`), and they had to be: the engine reuses the
// instance record across a zone change, so a residue entry that survives
// re-attaches itself to what CR 400.7 says is a NEW object.
// ---------------------------------------------------------------------------

describe("CR 400.7 — a permanent that leaves takes its registry residue with it", () => {
    it("drops an entry scoped only to the departing instance", () => {
        const bear = creature("bear", 2, 2);
        const state = stateWith(
            [bear],
            [entry("ce-set", 10, "7b", { kind: "pt-set", toughness: 9 })]
        );
        expect(getEffectiveToughness(state, bear)).toBe(9);

        resetBattlefieldTransientState(bear, state);

        expect(state.continuousEffects).toBeUndefined();
        expect(getEffectiveToughness(state, bear)).toBe(2);
    });

    it("keeps a SHARED entry alive for the instances that did not leave", () => {
        // CR 611.2c — an effect from a resolving spell has a FIXED affected
        // set; one member leaving does not end it for the others, so the
        // purge strikes the id rather than dropping the entry.
        const bear = creature("bear", 2, 2);
        const ox = creature("ox", 1, 1);
        const state = stateWith(
            [bear, ox],
            [
                entry(
                    "ce-mass",
                    10,
                    "7c",
                    { kind: "pt-modify", power: 3, toughness: 3 },
                    {
                        affected: {
                            kind: "instances",
                            instanceIds: ["bear", "ox"],
                        },
                    }
                ),
            ]
        );
        expect(getEffectivePower(state, ox)).toBe(4);

        resetBattlefieldTransientState(bear, state);

        expect(state.continuousEffects).toHaveLength(1);
        expect(getEffectivePower(state, ox)).toBe(4);
        expect(getEffectivePower(state, bear)).toBe(2);
    });

    it("leaves a `predicate`-affected entry alone", () => {
        // Its affected set IS the live board, re-evaluated at every read, so a
        // departure removes the permanent from it for free. Purging it would
        // delete a live anthem because one creature bounced.
        const bear = creature("bear", 2, 2);
        const state = stateWith(
            [bear],
            [
                entry(
                    "ce-anthem",
                    10,
                    "7c",
                    {
                        kind: "template",
                        sourceCardId: "src",
                        effectIndex: 0,
                    },
                    {
                        affected: { kind: "predicate" },
                        expiry: { kind: "source", sourceId: "src" },
                    }
                ),
            ]
        );

        resetBattlefieldTransientState(bear, state);

        expect(state.continuousEffects).toHaveLength(1);
    });
});
