// Determinization for ISMCTS (issue #112). `determinize` samples one plausible
// world: hidden zones (opponent hand + both libraries) are re-dealt, every
// public fact and every zone COUNT is preserved, and the result is pure and
// reproducible given the RNG stream. See `convex/gre/determinize.ts`.
import { describe, expect, it } from "vitest";
import { getCardByName } from "../../cards";
import { PLACEHOLDER_CARD_ID } from "../constants";
import { unseenRemainder } from "../deckKnowledge";
import { determinize } from "../determinize";
import type { GameState } from "../state";
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

// ─────────────────────────────────────────────────────────────────────────────
// Issue #2789 / PRD #2787 — the INFORMED opponent. With a decklist for the
// opponent's seat, their hidden zones stop being re-dealt from whatever they
// happen to hold and start being SAMPLED from what that decklist still admits.
// Without it the simulated opponent holds placeholders, resolves to no
// `CardDefinition`, and therefore never casts anything from this moment to the
// end of the game — a systematic optimism no search budget corrects.
describe("determinize — informed opponent sampling (issue #2789)", () => {
    /** `hiddenCount` opaque placeholders, exactly what the state adapter hands
     *  the search for a blind seat's hidden zone. */
    const opaque = (owner: string, zone: "hand" | "library", n: number) =>
        Array.from({ length: n }, (_, i) => ({
            id: `placeholder:${zone}:${owner}:${i}`,
            card: { id: PLACEHOLDER_CARD_ID },
            controllerId: owner,
            ownerId: owner,
            zone,
            types: [],
            subtypes: [],
            staticAbilities: [],
            isTapped: false,
        }));

    /** The production shape: observer p1 sees its own hand; opponent p2's
     *  hidden zones arrive as counts filled with placeholders. */
    const wireShapedState = (handCount: number, libraryCount: number) =>
        makeState({
            players: [
                makePlayer("p1", {
                    hand: [makeInstance(BOLT, { id: "p1-h0", zone: "hand" })],
                }),
                makePlayer("p2", {
                    hand: opaque("p2", "hand", handCount),
                    library: opaque("p2", "library", libraryCount),
                }),
            ],
        });

    const OPP_DECK = [BEARS, BEARS, BEARS, BEARS, GIANT, BOLT, MOUNTAIN];
    const knowledge = (cardIds: string[]) => [{ playerId: "p2", cardIds }];
    const cardIds = (cards: { card: Record<string, unknown> }[]) =>
        cards.map((c) => String(c.card.id ?? ""));

    it("fills the opponent's hidden zones with REAL identities from their decklist", () => {
        const state = wireShapedState(2, 4);
        const out = determinize(state, "p1", makeRng(11), knowledge(OPP_DECK));

        const hidden = [...out.players[1].hand, ...out.players[1].library];
        expect(hidden).toHaveLength(6);
        // Nothing opaque survives: every slot is a card the deck could hold.
        expect(cardIds(hidden)).not.toContain(PLACEHOLDER_CARD_ID);
        for (const id of cardIds(hidden)) expect(OPP_DECK).toContain(id);
    });

    it("is a no-op for a seat with NO entry — the blind path is untouched", () => {
        const state = wireShapedState(2, 4);
        const blind = determinize(state, "p1", makeRng(11));
        // Knowledge for a seat that is not in this game changes nothing.
        const other = determinize(state, "p1", makeRng(11), [
            { playerId: "nobody", cardIds: OPP_DECK },
        ]);
        expect(JSON.stringify(other)).toBe(JSON.stringify(blind));
    });

    it("never imagines a fifth copy of a four-of (evidence consistency)", () => {
        // Three Bears already accounted for in public zones, so the deck admits
        // exactly ONE more — and the hidden zones have six slots to fill.
        const state = wireShapedState(2, 4);
        state.players[1].battlefield = [
            makeInstance(BEARS, { controllerId: "p2", id: "p2-bf-0" }),
            makeInstance(BEARS, { controllerId: "p2", id: "p2-bf-1" }),
        ];
        state.players[1].graveyard = [
            makeInstance(BEARS, {
                controllerId: "p2",
                ownerId: "p2",
                id: "p2-gy-0",
                zone: "graveyard",
            }),
        ];

        for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
            const out = determinize(
                state,
                "p1",
                makeRng(seed),
                knowledge(OPP_DECK)
            );
            const hidden = cardIds([
                ...out.players[1].hand,
                ...out.players[1].library,
            ]);
            expect(hidden.filter((id) => id === BEARS)).toHaveLength(1);
            // Counts are public facts and survive regardless (CR 704.5b).
            expect(out.players[1].hand).toHaveLength(2);
            expect(out.players[1].library).toHaveLength(4);
        }
    });

    it("pads with placeholders when the decklist runs out, keeping counts exact", () => {
        // Two cards of deck knowledge against six hidden slots: four slots have
        // no identity the deck can supply. A short library would deck the
        // opponent out early and hand the bot a phantom win (CR 704.5b).
        const state = wireShapedState(2, 4);
        const out = determinize(
            state,
            "p1",
            makeRng(3),
            knowledge([BOLT, GIANT])
        );

        expect(out.players[1].hand).toHaveLength(2);
        expect(out.players[1].library).toHaveLength(4);
        const hidden = cardIds([
            ...out.players[1].hand,
            ...out.players[1].library,
        ]);
        expect(hidden.filter((id) => id === PLACEHOLDER_CARD_ID)).toHaveLength(
            4
        );
    });

    it("keeps a CR 401.5 revealed top card pinned, and out of the imagined hand", () => {
        const SPY = getCardByName("Goblin Spy").id;
        const state = wireShapedState(2, 4);
        // p2 controls the Spy, so p2's top card is public to p1 as well.
        state.players[1].battlefield = [
            makeInstance(SPY, { controllerId: "p2", id: "p2-spy" }),
        ];
        state.players[1].library = [
            makeInstance(GIANT, {
                controllerId: "p2",
                ownerId: "p2",
                id: "p2-top",
                zone: "library",
            }),
            ...opaque("p2", "library", 3),
        ];

        for (const seed of [1, 2, 3, 4, 5, 6]) {
            const out = determinize(
                state,
                "p1",
                makeRng(seed),
                knowledge(OPP_DECK)
            );
            // The real instance is still at index 0 — not a guess of the same
            // name, the SAME instance.
            expect(out.players[1].library[0].id).toBe("p2-top");
            // …and it was struck from the pool, so it is not dealt a SECOND
            // time into the hand: the deck holds exactly one Hill Giant.
            const hidden = cardIds([
                ...out.players[1].hand,
                ...out.players[1].library,
            ]);
            expect(hidden.filter((id) => id === GIANT)).toHaveLength(1);
            expect(out.players[1].library).toHaveLength(4);
            expect(out.players[1].hand).toHaveLength(2);
        }
    });

    it("never re-samples the OBSERVER's own hand, even with an entry for that seat", () => {
        const state = wireShapedState(2, 4);
        const out = determinize(state, "p1", makeRng(5), [
            { playerId: "p1", cardIds: OPP_DECK },
            { playerId: "p2", cardIds: OPP_DECK },
        ]);
        // The bot SEES its own hand; re-deriving it from the decklist would
        // destroy information it legitimately has.
        expect(out.players[0].hand.map((c) => c.id)).toEqual(["p1-h0"]);
        expect(cardIds(out.players[0].hand)).toEqual([BOLT]);
    });

    it("keeps a hidden card the observer HAS been shown, instead of guessing over it", () => {
        // A face-up-revealed opponent hand card (a Thoughtseige-style pick, a
        // reveal effect) carries `knownTo` naming the observer. Sampling over
        // it would have the bot forget a card it is looking at RIGHT NOW —
        // strictly worse than the blind path, which at least only moves it.
        const state = wireShapedState(2, 4);
        const revealed = makeInstance(GIANT, {
            controllerId: "p2",
            ownerId: "p2",
            id: "p2-revealed",
            zone: "hand",
        });
        revealed.knownTo = ["p1", "p2"];
        state.players[1].hand = [revealed, ...opaque("p2", "hand", 1)];

        for (const seed of [1, 2, 3, 4, 5, 6]) {
            const out = determinize(
                state,
                "p1",
                makeRng(seed),
                knowledge(OPP_DECK)
            );
            const hand = out.players[1].hand;
            expect(hand).toHaveLength(2);
            // The REAL instance survives — same id, so a move naming it still
            // round-trips to the server.
            expect(hand.map((c) => c.id)).toContain("p2-revealed");
            // …and it was struck from the pool, so the deck's single Hill
            // Giant is not dealt a second time somewhere the observer cannot
            // see.
            const hidden = cardIds([...hand, ...out.players[1].library]);
            expect(hidden.filter((id) => id === GIANT)).toHaveLength(1);
        }
    });

    it("still samples a hidden card the observer has NOT been shown", () => {
        // The mirror: `knownTo` naming only its owner must not pin anything,
        // or the informed path would leak the opponent's real hand.
        const state = wireShapedState(1, 4);
        const secret = makeInstance(GIANT, {
            controllerId: "p2",
            ownerId: "p2",
            id: "p2-secret",
            zone: "hand",
        });
        secret.knownTo = ["p2"];
        state.players[1].hand = [secret];

        const out = determinize(state, "p1", makeRng(9), knowledge(OPP_DECK));
        expect(out.players[1].hand.map((c) => c.id)).not.toContain("p2-secret");
    });

    it("is reproducible: same seed and knowledge → identical world", () => {
        const state = wireShapedState(2, 4);
        const a = determinize(state, "p1", makeRng(77), knowledge(OPP_DECK));
        const b = determinize(state, "p1", makeRng(77), knowledge(OPP_DECK));
        expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    });

    it("samples a DIFFERENT hand across seeds", () => {
        const state = wireShapedState(2, 4);
        const hands = [1, 2, 3, 4, 5, 6, 7, 8].map((s) =>
            cardIds(
                determinize(state, "p1", makeRng(s), knowledge(OPP_DECK))
                    .players[1].hand
            )
                .sort()
                .join(",")
        );
        expect(new Set(hands).size).toBeGreaterThan(1);
    });

    it("does not mutate the input state", () => {
        const state = wireShapedState(2, 4);
        const snapshot = JSON.stringify(state);
        determinize(state, "p1", makeRng(42), knowledge(OPP_DECK));
        expect(JSON.stringify(state)).toBe(snapshot);
    });
});

describe("unseenRemainder — what the decklist still admits (issue #2789)", () => {
    const DECK = [BEARS, BEARS, GIANT, BOLT];

    it("subtracts public zones but never the hidden zones themselves", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {}),
                makePlayer("p2", {
                    // Hidden zones hold a Bolt; subtracting them would be
                    // circular — these are the zones being sampled.
                    hand: [
                        makeInstance(BOLT, {
                            controllerId: "p2",
                            ownerId: "p2",
                            id: "h",
                            zone: "hand",
                        }),
                    ],
                    battlefield: [
                        makeInstance(BEARS, { controllerId: "p2", id: "bf" }),
                    ],
                    graveyard: [
                        makeInstance(GIANT, {
                            controllerId: "p2",
                            ownerId: "p2",
                            id: "gy",
                            zone: "graveyard",
                        }),
                    ],
                }),
            ],
        });
        const out = unseenRemainder(state, state.players[1], DECK, "p1");
        expect(out.sort()).toEqual([BEARS, BOLT].sort());
    });

    it("does not subtract a card in exile the observer has not been shown", () => {
        // Face-down EXILE (impulse draw, foretell) keeps the card's real id and
        // is gated by `knownTo` alone — a `faceDown` check does not see it, so
        // this is the shape that actually leaks (review finding on PR #2874).
        const hidden = makeInstance(BOLT, {
            controllerId: "p2",
            ownerId: "p2",
            id: "exiled",
            zone: "exile",
        });
        hidden.knownTo = ["p2"];
        const state = makeState({
            players: [
                makePlayer("p1", {}),
                makePlayer("p2", { exile: [hidden] }),
            ],
        });
        // p1 cannot read it — the Bolt stays admitted.
        expect(unseenRemainder(state, state.players[1], DECK, "p1")).toContain(
            BOLT
        );
        // p2 can, so from THEIR viewpoint it is accounted for.
        expect(
            unseenRemainder(state, state.players[1], DECK, "p2")
        ).not.toContain(BOLT);
    });

    it("subtracts a permanent whose CONTROL changed — it is still this seat's copy", () => {
        // `applyControlChange` splices the instance onto the new controller's
        // battlefield and leaves `ownerId` alone. Scanning only the seat's own
        // battlefield misses it, and the bot imagines a second copy of a card
        // it is looking at on its OWN board.
        const stolen = makeInstance(GIANT, {
            controllerId: "p1",
            ownerId: "p2",
            id: "stolen",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [stolen] }),
                makePlayer("p2", {}),
            ],
        });
        const out = unseenRemainder(state, state.players[1], DECK, "p1");
        expect(out).not.toContain(GIANT);
    });

    it("subtracts a phased-out permanent — off the battlefield but still public", () => {
        const state = makeState({
            players: [makePlayer("p1", {}), makePlayer("p2", {})],
        });
        state.phasedOut = [
            {
                id: "bundle",
                cards: [
                    makeInstance(GIANT, {
                        controllerId: "p2",
                        ownerId: "p2",
                        id: "phased",
                    }),
                ],
                returnOn: "untap-cycle",
            },
        ] as unknown as GameState["phasedOut"];
        const out = unseenRemainder(state, state.players[1], DECK, "p1");
        expect(out).not.toContain(GIANT);
    });

    it("does not subtract a spell COPY on the stack — a copy is not a card", () => {
        const real = makeInstance(BOLT, {
            controllerId: "p2",
            ownerId: "p2",
            id: "real-bolt",
            zone: "stack",
        });
        const copy = makeInstance(BOLT, {
            controllerId: "p2",
            ownerId: "p2",
            id: "copy-bolt",
            zone: "stack",
        });
        const state = makeState({
            players: [makePlayer("p1", {}), makePlayer("p2", {})],
        });
        state.stack = [
            { ...real, castById: "p2" },
            { ...copy, castById: "p2", isCopy: true },
        ] as GameState["stack"];
        // DECK holds one Bolt; the real spell accounts for it, the copy must
        // not account for a second one that was never in the deck.
        const out = unseenRemainder(state, state.players[1], DECK, "p1");
        expect(out.filter((id) => id === BOLT)).toHaveLength(0);
        // …and with only the COPY on the stack, the Bolt is still admitted.
        state.stack = [
            { ...copy, castById: "p2", isCopy: true },
        ] as GameState["stack"];
        expect(unseenRemainder(state, state.players[1], DECK, "p1")).toContain(
            BOLT
        );
    });

    it("is deterministic in ORDER — the decklist's, not a Map's insertion order", () => {
        const state = makeState({
            players: [makePlayer("p1", {}), makePlayer("p2", {})],
        });
        const a = unseenRemainder(state, state.players[1], DECK, "p1");
        const b = unseenRemainder(state, state.players[1], DECK, "p1");
        expect(a).toEqual(DECK);
        expect(a).toEqual(b);
    });
});
