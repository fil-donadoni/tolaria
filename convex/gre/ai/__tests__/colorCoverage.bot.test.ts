// Colour coverage (issue #3532, PRD #3526) — the symmetric quantity
// `evaluate`'s `colorCoverage` term prices. One `describe` per half: the seat
// whose hand may be read, the seat whose hand never may be, and the third
// state that decides whether the opponent half helps or hurts.

import { describe, expect, it } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../../cards/__tests__/setup";
import { grizzlyBears } from "../../../cards/sets/lea/green";
import { darkRitual } from "../../../cards/sets/lea/black";
import { lightningBolt } from "../../../cards/sets/lea/red";
import {
    forest,
    island,
    mountain,
    plains,
    swamp,
} from "../../../cards/sets/lea/colorless";
import { manaCensusFor } from "../../manaAvailability";
import type { GameState, PlayerState } from "../../state";
import {
    UNKNOWN_COLOR_COVERAGE,
    observedColorCoverage,
    ownHandColorCoverage,
} from "../colorCoverage";

/** Shorthand: a battlefield/hand permanent of `def`, controlled by `owner`. */
function card(
    defId: string,
    id: string,
    owner: string,
    overrides: Record<string, unknown> = {}
) {
    return makeInstance(defId, { id, controllerId: owner, ...overrides });
}

/** The seat's own mana BASE — the census both halves of the term ask their
 *  colour question of (tap state ignored; see `colorCoverage.ts`'s header). */
function base(state: GameState, player: PlayerState) {
    return manaCensusFor(state, player).base;
}

describe("ownHandColorCoverage — the seat whose hand may be read (issue #3532)", () => {
    it("a hand the base cannot supply the colours for reads 0, the same hand with the right land reads 1", () => {
        const screwed = makePlayer("p1", {
            battlefield: [
                card(mountain.id, "mtn-1", "p1"),
                card(mountain.id, "mtn-2", "p1"),
            ],
            hand: [card(darkRitual.id, "rit-1", "p1", { zone: "hand" })],
        });
        const screwedState = makeState({
            players: [screwed, makePlayer("p2")],
        });
        expect(ownHandColorCoverage(screwed, base(screwedState, screwed))).toBe(
            0
        );

        const fixed = makePlayer("p1", {
            battlefield: [
                card(mountain.id, "mtn-1", "p1"),
                card(swamp.id, "swp-1", "p1"),
            ],
            hand: [card(darkRitual.id, "rit-1", "p1", { zone: "hand" })],
        });
        const fixedState = makeState({ players: [fixed, makePlayer("p2")] });
        expect(ownHandColorCoverage(fixed, base(fixedState, fixed))).toBe(1);
    });

    it("counts per CARD, so half a colour-dead hand reads one half", () => {
        const player = makePlayer("p1", {
            battlefield: [card(mountain.id, "mtn-1", "p1")],
            hand: [
                card(darkRitual.id, "rit-1", "p1", { zone: "hand" }),
                card(lightningBolt.id, "bolt-1", "p1", {
                    zone: "hand",
                }),
            ],
        });
        const state = makeState({ players: [player, makePlayer("p2")] });
        expect(ownHandColorCoverage(player, base(state, player))).toBe(0.5);
    });

    it("a hand that demands no colour at all is never colour-screwed — empty denominator reads 1, not 0", () => {
        const player = makePlayer("p1", {
            battlefield: [card(mountain.id, "mtn-1", "p1")],
            hand: [card(forest.id, "for-hand", "p1", { zone: "hand" })],
        });
        const state = makeState({ players: [player, makePlayer("p2")] });
        // A land in hand has no mana cost (CR 202.3a) — no colour demanded, so
        // it is not in the denominator and cannot make the hand read as dead.
        expect(ownHandColorCoverage(player, base(state, player))).toBe(1);
        const empty = makePlayer("p1", {
            battlefield: [card(mountain.id, "mtn-1", "p1")],
        });
        const emptyState = makeState({ players: [empty, makePlayer("p2")] });
        expect(ownHandColorCoverage(empty, base(emptyState, empty))).toBe(1);
    });
});

describe("observedColorCoverage — the seat whose hand never may be read (issue #3532)", () => {
    /** A green creature, a Forest and a Plains: {G} is evidenced by BOTH the
     *  creature and the land, {W} only by the land itself. */
    function boardWithGreenThreat(opts: { forest: boolean; plains: boolean }) {
        const battlefield = [card(grizzlyBears.id, "bear-1", "p2")];
        if (opts.forest) battlefield.push(card(forest.id, "for-1", "p2"));
        if (opts.plains) battlefield.push(card(plains.id, "pla-1", "p2"));
        const opponent = makePlayer("p2", { battlefield });
        const state = makeState({ players: [makePlayer("p1"), opponent] });
        return { state, opponent };
    }

    it("a base that supplies every colour the seat is visibly using reads 1", () => {
        const { state, opponent } = boardWithGreenThreat({
            forest: true,
            plains: true,
        });
        expect(
            observedColorCoverage(state, opponent, base(state, opponent))
        ).toBe(1);
    });

    it("denying the ONLY source of a colour they are visibly using drops the coverage", () => {
        const before = boardWithGreenThreat({ forest: true, plains: true });
        const after = boardWithGreenThreat({ forest: false, plains: true });
        const coverageBefore = observedColorCoverage(
            before.state,
            before.opponent,
            base(before.state, before.opponent)
        );
        const coverageAfter = observedColorCoverage(
            after.state,
            after.opponent,
            base(after.state, after.opponent)
        );
        // The creature's {G} evidence survives the land, so the colour is now
        // demanded and unsupplied: 3 of the 4 evidence points go uncovered.
        expect(coverageAfter).toBeLessThan(coverageBefore);
        expect(coverageAfter).toBeCloseTo(1 / 4, 10);
    });

    it("denying a colour NOTHING but the land itself evidences buys nothing — the demand leaves with the supply", () => {
        const before = boardWithGreenThreat({ forest: true, plains: true });
        const after = boardWithGreenThreat({ forest: true, plains: false });
        expect(
            observedColorCoverage(
                after.state,
                after.opponent,
                base(after.state, after.opponent)
            )
        ).toBe(
            observedColorCoverage(
                before.state,
                before.opponent,
                base(before.state, before.opponent)
            )
        );
    });

    it("NEVER reads the seat's hand — a throwing `hand` accessor is not touched", () => {
        const { state, opponent } = boardWithGreenThreat({
            forest: true,
            plains: true,
        });
        const guarded = new Proxy(opponent, {
            get(target, prop, receiver) {
                if (prop === "hand") {
                    throw new Error(
                        "observedColorCoverage read the opponent's hand"
                    );
                }
                return Reflect.get(target, prop, receiver);
            },
        }) as PlayerState;
        const guardedState: GameState = {
            ...state,
            players: [state.players[0], guarded],
        };
        expect(() =>
            observedColorCoverage(guardedState, guarded, base(state, opponent))
        ).not.toThrow();
        expect(
            observedColorCoverage(guardedState, guarded, base(state, opponent))
        ).toBe(observedColorCoverage(state, opponent, base(state, opponent)));
    });

    it("no evidence at all reads UNKNOWN — not 'needs no colours' (1) and not 'needs every colour' (0.2)", () => {
        // A TAPPED Island: a land is colourless (CR 202.2 — no colour
        // indicator, no mana symbol in a cost), it is in no graveyard and on no
        // stack, and a tapped source is not evidence (`observedColors.ts`). So
        // the position has shown NOTHING, while the mana base still produces
        // exactly one colour — which is what makes all three readings distinct
        // on this one board.
        const opponent = makePlayer("p2", {
            battlefield: [card(island.id, "isl-1", "p2", { isTapped: true })],
        });
        const state = makeState({ players: [makePlayer("p1"), opponent] });
        const units = base(state, opponent);
        expect(units.some((u) => u.has("U"))).toBe(true);

        const coverage = observedColorCoverage(state, opponent, units);
        expect(coverage).toBe(UNKNOWN_COLOR_COVERAGE);
        // The two readings it refuses, spelled out on this exact board:
        // "needs no colours" is a vacuously perfect 1 (every denial free),
        // "needs every colour" is 1 of 5 (every denial scores, on a board that
        // has shown nothing).
        expect(coverage).not.toBe(1);
        expect(coverage).not.toBe(1 / 5);
        expect(coverage).toBeGreaterThan(0);
        expect(coverage).toBeLessThan(1);
    });
});
