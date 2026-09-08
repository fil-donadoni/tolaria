// mh1 — green card behaviour tests (ADR 0043 colour split).
//
// Hexdrinker is the engine's first leveler card (CR 711), so this file is the
// permanent test for the Level Up mechanic (CR 702.87) as well as for the
// card: the activated ability that puts the counters on, the two LEVEL bands
// they cross (CR 711.2a/b) and the printed sub-band they start below
// (CR 711.5) — each driven through the REAL engine (`resolveTopOfStack`, the
// layer reads, `projectPublicState`), never a hand-built view.

import { describe, expect, it } from "vitest";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import type { CardInstanceState, GameState } from "../../../../gre/state";
import {
    beginApplyingStaticEffects,
    resolveTopOfStack,
} from "../../../../gre/state";
import {
    getEffectivePower,
    getEffectiveToughness,
} from "../../../../gre/layers";
import { projectPublicState } from "../../../../gameProjections";
import { getDefinition } from "../../../index";
import { assertActivationTimingLegal } from "../../../../game";

const HEXDRINKER = "89f5cc05-5d9d-4709-b3c5-a6249c294acc";

/** Resolves one activation of Hexdrinker's level up ability through the real
 *  stack (CR 702.87a), exactly as the `activateAbility` mutation would after
 *  the cost is paid. */
function levelUp(state: GameState, source: CardInstanceState): void {
    state.stack.push({
        ...source,
        zone: "stack",
        castById: source.controllerId,
        abilityId: "level-up",
        targets: [],
    });
    resolveTopOfStack(state);
}

/** Hexdrinker alone on p1's battlefield, levelled up `n` times. */
function board(n: number): { state: GameState; hex: CardInstanceState } {
    const state = makeState({
        players: [
            makePlayer("p1", {
                battlefield: [makeInstance(HEXDRINKER, { id: "hex" })],
            }),
            makePlayer("p2"),
        ],
    });
    const hex = state.players[0].battlefield[0];
    // CR 613.7a — the entry-side call every real battlefield arrival makes
    // (`putOnBattlefield`, token creation, scenario load): it mints the
    // source's static timestamp, without which the layer-6 derivation skips
    // an unstamped source entirely and the LEVEL bands would never grant.
    beginApplyingStaticEffects(state, hex);
    for (let i = 0; i < n; i++) levelUp(state, hex);
    return { state, hex };
}

describe("Hexdrinker — Level Up (CR 702.87)", () => {
    it("CR 702.87a — each activation puts one level counter on it", () => {
        const { hex } = board(3);
        expect(hex.counters?.level).toBe(3);
    });

    it("CR 702.87a / 602.5d — the server's own timing gate refuses it outside a main phase", () => {
        const ability = getDefinition(HEXDRINKER).activatedAbilities![0];
        const { state, hex } = board(0);
        expect(() =>
            assertActivationTimingLegal(state, hex, ability)
        ).not.toThrow();
        state.phase = "DECLARE_ATTACKERS";
        expect(() =>
            assertActivationTimingLegal(state, hex, ability)
        ).toThrow();
    });

    it("CR 711.4 — the ability stays activatable at every level", () => {
        // No `canActivate` gate: the 9th activation lands its counter exactly
        // like the 1st, above the final band's threshold.
        const { hex } = board(9);
        expect(hex.counters?.level).toBe(9);
    });
});

describe("Hexdrinker — LEVEL bands (CR 711.2)", () => {
    it("CR 711.5 — at 0-2 level counters it is the printed 2/1 with no granted ability", () => {
        for (const n of [0, 2]) {
            const { state, hex } = board(n);
            expect(getEffectivePower(state, hex)).toBe(2);
            expect(getEffectiveToughness(state, hex)).toBe(1);
            expect(hex.staticAbilities).not.toContain(
                "protection from instants"
            );
            expect(hex.staticAbilities).not.toContain(
                "protection from everything"
            );
        }
    });

    it("CR 711.2a — {LEVEL 3-7}: 4/4 with protection from instants, at both ends of the band", () => {
        for (const n of [3, 7]) {
            const { state, hex } = board(n);
            expect(getEffectivePower(state, hex)).toBe(4);
            expect(getEffectiveToughness(state, hex)).toBe(4);
            expect(hex.staticAbilities).toContain("protection from instants");
            expect(hex.staticAbilities).not.toContain(
                "protection from everything"
            );
        }
    });

    it("CR 711.2b — {LEVEL 8+}: 6/6 with protection from everything, and the earlier band drops off", () => {
        const { state, hex } = board(8);
        expect(getEffectivePower(state, hex)).toBe(6);
        expect(getEffectiveToughness(state, hex)).toBe(6);
        expect(hex.staticAbilities).toContain("protection from everything");
        // CR 711.2a's band is bounded at N2 = 7 — crossing into the final band
        // must UNAPPLY it, not stack on top of it.
        expect(hex.staticAbilities).not.toContain("protection from instants");
    });
});

describe("Hexdrinker — wire format (projectPublicState)", () => {
    // CR 711.2/711.5 — one row per band. The projection strips `card.card` to
    // `{ id }` and reshapes the zone arrays, so a band that reads right
    // server-side can still be wrong on the client.
    const bands: {
        level: number;
        power: number;
        toughness: number;
        keyword?: string;
    }[] = [
        { level: 0, power: 2, toughness: 1 },
        {
            level: 3,
            power: 4,
            toughness: 4,
            keyword: "protection from instants",
        },
        {
            level: 8,
            power: 6,
            toughness: 6,
            keyword: "protection from everything",
        },
    ];

    for (const band of bands) {
        it(`level ${band.level}: counters, P/T and granted keyword all survive the projection`, () => {
            const { state, hex } = board(band.level);
            const projected = projectPublicState(state, 1, "p1");
            const slim = projected.players[0].battlefield.find(
                (c) => c.id === hex.id
            )!;
            expect(slim.counters?.level ?? 0).toBe(band.level);
            expect(getEffectivePower(projected, slim)).toBe(band.power);
            expect(getEffectiveToughness(projected, slim)).toBe(band.toughness);
            if (band.keyword) {
                expect(slim.staticAbilities).toContain(band.keyword);
            } else {
                expect(
                    (slim.staticAbilities ?? []).filter((a) =>
                        a.startsWith("protection from")
                    )
                ).toEqual([]);
            }
        });
    }
});
