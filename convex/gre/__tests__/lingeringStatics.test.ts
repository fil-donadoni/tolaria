// CR 611.3b / 611.3d / 611.2c — a static ability's continuous effect that
// CONTINUES for a stated duration after its source leaves the battlefield
// (issue #3726, `gre/lingeringStatics.ts`).
//
// What this file guards is the MECHANISM, not one card's rules text: that a
// departure converts a live predicate-scoped effect into a frozen, duration-
// scoped registry entry; that the frozen set really is frozen; that the entry
// keeps the CR 613.7a timestamp it was ordering by; that the boundary ends it;
// and that the conversion happens on a battlefield DEPARTURE and on nothing
// else. Titania's Song is the exercise board because it is the card that asked
// for the mechanism and it spans three layers at once (6, 4 and 7a).
import { describe, it, expect } from "vitest";
import {
    applyExistingGrantsTo,
    beginApplyingStaticEffects,
    removePermanentTo,
    stopApplyingStaticEffects,
    type CardInstanceState,
    type GameState,
} from "../state";
import { getEffectivePower, getEffectiveToughness } from "../layers";
import { finalizeCleanup } from "../phases";
import { hasManaAbility } from "../constants";
import { projectPublicState } from "../../gameProjections";
import { compactState, expandState } from "../serialize";
import { makeInstance, makeState } from "../../cards/__tests__/setup";
import { titaniasSong } from "../../cards/sets/atq/green";
import { solRing } from "../../cards/sets/lea/colorless";

/** The Song and one Sol Ring on p1's battlefield, animated. */
function withSong(): {
    state: GameState;
    song: CardInstanceState;
    ring: CardInstanceState;
} {
    const state = makeState();
    const song = makeInstance(titaniasSong.id, {
        id: "song-1",
        controllerId: "p1",
        zone: "battlefield",
    });
    const ring = makeInstance(solRing.id, {
        id: "ring-1",
        controllerId: "p1",
        zone: "battlefield",
    });
    state.players[0].battlefield.push(song, ring);
    beginApplyingStaticEffects(state, song);
    return { state, song, ring };
}

/** Sol Ring animated: an artifact creature, abilities stripped, 1/1 (mana
 *  value 1). The three layers the Song touches, asserted as one fact. */
function expectAnimated(state: GameState, ring: CardInstanceState): void {
    expect(ring.types).toContain("Creature");
    expect(ring.types).toContain("Artifact");
    expect(hasManaAbility(ring)).toBe(false);
    expect(getEffectivePower(state, ring)).toBe(1);
    expect(getEffectiveToughness(state, ring)).toBe(1);
}

describe("a static effect that lingers after its source leaves (CR 611.3b/611.3d)", () => {
    it("keeps applying after the source leaves the battlefield, then ends at cleanup", () => {
        const { state, ring } = withSong();
        expectAnimated(state, ring);

        removePermanentTo(state, "song-1", "graveyard");
        // CR 611.3d — the stated duration outlives the generator. Without the
        // linger this is where Sol Ring stops being a creature.
        expectAnimated(state, ring);

        // CR 514.2 — the boundary the duration names.
        state.phase = "CLEANUP";
        finalizeCleanup(state);
        expect(ring.types).not.toContain("Creature");
        expect(hasManaAbility(ring)).toBe(true);
    });

    it("freezes its affected set at departure: an artifact entering afterwards is NOT animated (CR 611.2c)", () => {
        const { state } = withSong();
        removePermanentTo(state, "song-1", "graveyard");

        const late = makeInstance(solRing.id, {
            id: "ring-2",
            controllerId: "p1",
            zone: "battlefield",
        });
        state.players[0].battlefield.push(late);
        applyExistingGrantsTo(state, late);

        // CR 611.2c — "the set of objects it affects is determined when that
        // continuous effect begins. After that point, the set won't change."
        // The 611.3a "not locked in" half lapsed with the source.
        expect(late.types).not.toContain("Creature");
        expect(hasManaAbility(late)).toBe(true);
    });

    it("converts to instances + duration entries and NOT to a predicate entry with a longer life (ADR 0082)", () => {
        const { state, song, ring } = withSong();
        const stamp = song.staticSeq;
        expect(stamp).toBeGreaterThan(0);
        // While the Song applies, its effects are DERIVED: nothing is stored.
        expect(state.continuousEffects ?? []).toHaveLength(0);

        removePermanentTo(state, "song-1", "graveyard");

        const stored = state.continuousEffects ?? [];
        // Three effects x one affected permanent.
        expect(stored).toHaveLength(3);
        for (const entry of stored) {
            expect(entry.affected).toEqual({
                kind: "instances",
                instanceIds: [ring.id],
            });
            expect(entry.expiry).toEqual({
                kind: "duration",
                duration: { phase: "end-of-turn" },
                controllerId: "p1",
            });
            expect(entry.payload.kind).not.toBe("template");
            // CR 613.7a — the stamp the effect has been ordering by all along.
            expect(entry.timestamp).toBe(stamp);
        }
        expect(stored.map((e) => e.layer).sort()).toEqual([4, 6, 7]);
        // CR 604.3 / 613.4a — the mana-value P/T stays a CDA in sublayer 7a,
        // with its value computed once (Sol Ring's mana value is 1).
        const pt = stored.find((e) => e.layer === 7)!;
        expect(pt.sublayer).toBe("7a");
        expect(pt.characteristicDefining).toBe(true);
        expect(pt.payload).toEqual({ kind: "pt-set", power: 1, toughness: 1 });
    });

    it("does not snapshot when the source stays on the battlefield (re-attach, detach)", () => {
        // `stopApplyingStaticEffects` is called by `reattachAura` / `attachTo` /
        // `detachFrom` for a source that never leaves. A linger hooked there
        // would store a second, permanent copy of the effect on every move.
        const { state, song } = withSong();
        stopApplyingStaticEffects(state, song);
        expect(state.continuousEffects ?? []).toHaveLength(0);
        beginApplyingStaticEffects(state, song);
        expect(state.continuousEffects ?? []).toHaveLength(0);
    });

    it("wire format: the lingering animation survives projectPublicState", () => {
        const { state } = withSong();
        removePermanentTo(state, "song-1", "graveyard");

        const projected = projectPublicState(state, 1, "p1");
        const projRing = projected.players[0].battlefield.find(
            (c) => c.id === "ring-1"
        )!;
        // The projection strips fat fields and derives characteristics from the
        // registry it carries; an entry dropped on the wire is a card the
        // client renders un-animated while the server counts it as a creature.
        expect(projRing.types).toContain("Creature");
        expect(projRing.types).toContain("Artifact");
        expect(getEffectivePower(projected, projRing)).toBe(1);
        expect(getEffectiveToughness(projected, projRing)).toBe(1);
    });

    it("survives the DB round trip (the entries are stored state, not derived)", () => {
        const { state } = withSong();
        removePermanentTo(state, "song-1", "graveyard");

        const loaded = expandState(
            compactState(state) as unknown as Record<string, unknown>
        );
        const ring = loaded.players[0].battlefield.find(
            (c) => c.id === "ring-1"
        )!;
        expectAnimated(loaded, ring);
    });
});
