// Determinization for ISMCTS (issue #112). `determinize` samples one plausible
// world: hidden zones (opponent hand + both libraries) are re-dealt, every
// public fact and every zone COUNT is preserved, and the result is pure and
// reproducible given the RNG stream. See `convex/gre/determinize.ts`.
import { describe, expect, it } from "vitest";
import { getCardByName } from "../../cards";
import { determinize } from "../determinize";
import { makeRng } from "../rng";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";

const BEARS = getCardByName("Grizzly Bears").id;
const GIANT = getCardByName("Hill Giant").id;
const BOLT = getCardByName("Lightning Bolt").id;
const MOUNTAIN = getCardByName("Mountain").id;

/** A mid-game position with full hidden information so determinize has real
 *  pools to re-deal: observer p1 with a known hand + a stocked library, and a
 *  hidden opponent p2 with hand + library. */
function fullInfoState() {
    const lib = (owner: string, ids: string[]) =>
        ids.map((cardId, i) =>
            makeInstance(cardId, {
                controllerId: owner,
                ownerId: owner,
                id: `${owner}-lib-${i}`,
                zone: "library",
            })
        );
    const hand = (owner: string, ids: string[]) =>
        ids.map((cardId, i) =>
            makeInstance(cardId, {
                controllerId: owner,
                ownerId: owner,
                id: `${owner}-hand-${i}`,
                zone: "hand",
            })
        );
    return makeState({
        players: [
            makePlayer("p1", {
                hand: hand("p1", [BOLT, BEARS]),
                library: lib("p1", [MOUNTAIN, MOUNTAIN, GIANT, BEARS, BOLT]),
                battlefield: [
                    makeInstance(MOUNTAIN, { controllerId: "p1", id: "p1-m" }),
                ],
                graveyard: [
                    makeInstance(BEARS, {
                        controllerId: "p1",
                        id: "p1-gy",
                        zone: "graveyard",
                    }),
                ],
            }),
            makePlayer("p2", {
                hand: hand("p2", [GIANT, BOLT, MOUNTAIN]),
                library: lib("p2", [BEARS, BEARS, GIANT, MOUNTAIN]),
                battlefield: [
                    makeInstance(GIANT, { controllerId: "p2", id: "p2-g" }),
                ],
                life: 17,
            }),
        ],
    });
}

const sortedIds = (cards: { id: string }[]) => cards.map((c) => c.id).sort();

describe("determinize — public state untouched (issue #112)", () => {
    it("leaves battlefields, graveyards, life and the observer's hand identical", () => {
        const state = fullInfoState();
        const out = determinize(state, "p1", makeRng(1));

        const [p1, p2] = out.players;
        // Battlefields and graveyards (public) are byte-identical.
        expect(sortedIds(p1.battlefield)).toEqual(["p1-m"]);
        expect(sortedIds(p2.battlefield)).toEqual(["p2-g"]);
        expect(sortedIds(p1.graveyard)).toEqual(["p1-gy"]);
        expect(p2.life).toBe(17);
        // Observer's own hand is known — kept exactly (same ids).
        expect(sortedIds(p1.hand)).toEqual(["p1-hand-0", "p1-hand-1"]);
    });
});

describe("determinize — respects hidden zone counts (issue #112)", () => {
    it("preserves opponent hand size and both library sizes", () => {
        const state = fullInfoState();
        const out = determinize(state, "p1", makeRng(7));
        const [p1, p2] = out.players;
        expect(p2.hand.length).toBe(3);
        expect(p2.library.length).toBe(4);
        expect(p1.library.length).toBe(5);
    });

    it("preserves the opponent's hidden multiset (hand ∪ library) by card id", () => {
        const state = fullInfoState();
        const before = sortedIds([
            ...state.players[1].hand,
            ...state.players[1].library,
        ]);
        const out = determinize(state, "p1", makeRng(7));
        const after = sortedIds([
            ...out.players[1].hand,
            ...out.players[1].library,
        ]);
        expect(after).toEqual(before);
    });

    it("re-tags dealt cards with the zone they land in", () => {
        const state = fullInfoState();
        const out = determinize(state, "p1", makeRng(3));
        expect(out.players[1].hand.every((c) => c.zone === "hand")).toBe(true);
        expect(out.players[1].library.every((c) => c.zone === "library")).toBe(
            true
        );
    });
});

describe("determinize — purity & determinism (issue #112)", () => {
    it("does not mutate the input state", () => {
        const state = fullInfoState();
        const snapshot = JSON.stringify(state);
        determinize(state, "p1", makeRng(42));
        expect(JSON.stringify(state)).toBe(snapshot);
    });

    it("is reproducible: same seed → identical world", () => {
        const state = fullInfoState();
        const a = determinize(state, "p1", makeRng(99));
        const b = determinize(state, "p1", makeRng(99));
        expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    });

    it("re-deals differently across seeds (samples the hidden space)", () => {
        const state = fullInfoState();
        // The opponent's hand is drawn from 7 mixed cards; two different seeds
        // should land on different hands at least once across a few tries.
        const hands = [1, 2, 3, 4, 5].map((s) =>
            sortedIds(
                determinize(state, "p1", makeRng(s)).players[1].hand
            ).join(",")
        );
        expect(new Set(hands).size).toBeGreaterThan(1);
    });

    it("is a faithful no-op when hidden zones are empty (production projection)", () => {
        // The bot's own wire view: own hand known, libraries dropped to empty,
        // opponent hand empty. Nothing to re-deal.
        const state = makeState({
            players: [
                makePlayer("p1", {
                    hand: [makeInstance(BOLT, { id: "h0", zone: "hand" })],
                }),
                makePlayer("p2", {}),
            ],
        });
        const out = determinize(state, "p1", makeRng(5));
        expect(JSON.stringify(out)).toBe(JSON.stringify(state));
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// CR 401.5 (issue #1095) — a continuously-revealed library top is PUBLIC
// information, so determinization must not re-sample it. Without the pin the
// search reasons about a top card the bot can plainly see is a different card:
// the observer's own library gets reshuffled, and the opponent's top card is
// pooled with their hand and can even come back IN HAND.
describe("determinize — a CR 401.5 revealed library top is pinned (issue #1095)", () => {
    const SPY = getCardByName("Goblin Spy").id;

    const lib = (owner: string, ids: string[]) =>
        ids.map((cardId, i) =>
            makeInstance(cardId, {
                controllerId: owner,
                ownerId: owner,
                id: `${owner}-lib-${i}`,
                zone: "library",
            })
        );
    const hand = (owner: string, ids: string[]) =>
        ids.map((cardId, i) =>
            makeInstance(cardId, {
                controllerId: owner,
                ownerId: owner,
                id: `${owner}-hand-${i}`,
                zone: "hand",
            })
        );

    /** `spyOwner` controls a Goblin Spy; both players have hidden zones big
     *  enough that an unpinned shuffle would move the top card with
     *  overwhelming probability across the seeds tried. */
    const stateWithSpy = (spyOwner: "p1" | "p2") =>
        makeState({
            players: [
                makePlayer("p1", {
                    hand: hand("p1", [BOLT, BEARS, GIANT]),
                    library: lib("p1", [
                        MOUNTAIN,
                        BEARS,
                        GIANT,
                        BOLT,
                        BEARS,
                        GIANT,
                        BOLT,
                    ]),
                    battlefield:
                        spyOwner === "p1"
                            ? [
                                  makeInstance(SPY, {
                                      controllerId: "p1",
                                      id: "spy",
                                  }),
                              ]
                            : [],
                }),
                makePlayer("p2", {
                    hand: hand("p2", [BOLT, BEARS, GIANT]),
                    library: lib("p2", [
                        MOUNTAIN,
                        BEARS,
                        GIANT,
                        BOLT,
                        BEARS,
                        GIANT,
                        BOLT,
                    ]),
                    battlefield:
                        spyOwner === "p2"
                            ? [
                                  makeInstance(SPY, {
                                      controllerId: "p2",
                                      id: "spy",
                                  }),
                              ]
                            : [],
                }),
            ],
        });

    it("keeps the OBSERVER's revealed top card at index 0 across every seed", () => {
        const state = stateWithSpy("p1");
        const topId = state.players[0].library[0].id;
        for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
            const out = determinize(state, "p1", makeRng(seed));
            expect(out.players[0].library[0].id).toBe(topId);
            expect(out.players[0].library).toHaveLength(7);
        }
    });

    it("keeps the OPPONENT's revealed top card at index 0 and out of their hand", () => {
        const state = stateWithSpy("p2");
        const topId = state.players[1].library[0].id;
        for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
            const out = determinize(state, "p1", makeRng(seed));
            expect(out.players[1].library[0].id).toBe(topId);
            expect(out.players[1].hand.map((c) => c.id)).not.toContain(topId);
            // Counts are still exact (CR 704.5b depends on them).
            expect(out.players[1].library).toHaveLength(7);
            expect(out.players[1].hand).toHaveLength(3);
        }
    });

    it("still re-deals everything BELOW the pinned top card", () => {
        const state = stateWithSpy("p1");
        const belows = [1, 2, 3, 4, 5].map((s) =>
            determinize(state, "p1", makeRng(s))
                .players[0].library.slice(1)
                .map((c) => c.id)
                .join(",")
        );
        expect(new Set(belows).size).toBeGreaterThan(1);
    });

    it("does NOT pin anything when no Goblin Spy is on the battlefield", () => {
        const state = stateWithSpy("p1");
        state.players[0].battlefield = [];
        const tops = [1, 2, 3, 4, 5, 6, 7, 8].map(
            (s) => determinize(state, "p1", makeRng(s)).players[0].library[0].id
        );
        expect(new Set(tops).size).toBeGreaterThan(1);
    });

    it("does not crash on an empty library under an active reveal", () => {
        const state = stateWithSpy("p1");
        state.players[0].library = [];
        const out = determinize(state, "p1", makeRng(3));
        expect(out.players[0].library).toEqual([]);
    });
});
