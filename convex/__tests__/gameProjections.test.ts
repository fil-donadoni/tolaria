import { describe, it, expect } from "vitest";
import { projectFullState, projectPublicState } from "../gameProjections";
import { computeSoloViewerId } from "../soloViewer";
import type { CardInstanceState, GameState, PlayerState } from "../gre/state";

function makeCard(
    id: string,
    overrides: Partial<CardInstanceState> = {}
): CardInstanceState {
    return {
        id,
        card: { id: "def-" + id, name: "Cardname " + id, manaCost: { R: 1 } },
        controllerId: "p1",
        ownerId: "p1",
        zone: "hand",
        types: ["Creature"],
        subtypes: [],
        staticAbilities: [],
        isTapped: false,
        ...overrides,
    };
}

function makePlayer(
    id: string,
    overrides: Partial<PlayerState> = {}
): PlayerState {
    return {
        id,
        name: id,
        bgColor: "#000",
        life: 20,
        hand: [],
        library: [],
        graveyard: [],
        exile: [],
        battlefield: [],
        // Ample default pool so projection tests aren't gated by canCast's
        // mana check (CR 601.2f). Tests focused on payment cover that path.
        manaPool: { W: 5, U: 5, B: 5, R: 5, G: 5, C: 5 },
        ...overrides,
    };
}

function makeState(overrides: Partial<GameState> = {}): GameState {
    const p1 = makePlayer("p1", {
        hand: [makeCard("p1-h1"), makeCard("p1-h2")],
        library: [makeCard("p1-l1", { zone: "library" })],
        battlefield: [makeCard("p1-b1", { zone: "battlefield" })],
    });
    const p2 = makePlayer("p2", {
        hand: [
            makeCard("p2-h1", { controllerId: "p2", ownerId: "p2" }),
            makeCard("p2-h2", { controllerId: "p2", ownerId: "p2" }),
            makeCard("p2-h3", { controllerId: "p2", ownerId: "p2" }),
        ],
        library: [
            makeCard("p2-l1", {
                controllerId: "p2",
                ownerId: "p2",
                zone: "library",
            }),
            makeCard("p2-l2", {
                controllerId: "p2",
                ownerId: "p2",
                zone: "library",
            }),
        ],
    });
    return {
        players: [p1, p2],
        stack: [],
        turn: 1,
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        passCount: 0,
        phase: "PRECOMBAT_MAIN",
        rngSeed: 0,
        rngCounter: 0,
        ...overrides,
    };
}

describe("projectPublicState (CR: shape contract)", () => {
    const state = makeState();
    const result = projectPublicState(state, 42, "p1");

    it("includes seq at top level", () => {
        expect(result.seq).toBe(42);
    });

    it("reduces own library to { count } (not an array)", () => {
        const me = result.players.find((p) => p.id === "p1")!;
        expect(Array.isArray(me.library)).toBe(false);
        expect(me.library).toEqual({ count: 1 });
    });

    it("reduces opponent library to { count } (not an array)", () => {
        const opp = result.players.find((p) => p.id === "p2")!;
        expect(Array.isArray(opp.library)).toBe(false);
        expect(opp.library).toEqual({ count: 2 });
    });

    it("keeps own hand as array of slim cards with legalActions", () => {
        const me = result.players.find((p) => p.id === "p1")!;
        expect(me.hand).toHaveLength(2);
        for (const card of me.hand) {
            expect(card).not.toBeNull();
            expect(card!.legalActions).toBeDefined();
            expect(Array.isArray(card!.legalActions)).toBe(true);
        }
    });

    it("nulls every opponent hand slot but preserves length", () => {
        const opp = result.players.find((p) => p.id === "p2")!;
        expect(opp.hand).toHaveLength(3);
        expect(opp.hand.every((c) => c === null)).toBe(true);
    });

    it("slims every card.card to { id } only (drops name, manaCost, …)", () => {
        const me = result.players.find((p) => p.id === "p1")!;
        for (const card of me.hand) {
            expect(Object.keys(card!.card)).toEqual(["id"]);
        }
        for (const card of me.battlefield) {
            expect(Object.keys(card.card)).toEqual(["id"]);
        }
    });

    it("projects battlefield, graveyard, exile as arrays", () => {
        const me = result.players.find((p) => p.id === "p1")!;
        expect(Array.isArray(me.battlefield)).toBe(true);
        expect(Array.isArray(me.graveyard)).toBe(true);
        expect(Array.isArray(me.exile)).toBe(true);
    });
});

describe("projectFullState (CR: debug contract)", () => {
    const state = makeState();
    const result = projectFullState(state, 7);

    it("includes seq at top level", () => {
        expect(result.seq).toBe(7);
    });

    it("keeps every library as array (no { count } collapsing)", () => {
        for (const player of result.players) {
            expect(Array.isArray(player.library)).toBe(true);
        }
    });

    it("computes legalActions for every hand card of every player", () => {
        for (const player of result.players) {
            for (const card of player.hand) {
                expect(card.legalActions).toBeDefined();
                expect(Array.isArray(card.legalActions)).toBe(true);
            }
        }
    });

    it("slims card defs across all zones (hand, library, battlefield, graveyard, exile, stack)", () => {
        for (const player of result.players) {
            for (const card of [
                ...player.hand,
                ...player.library,
                ...player.battlefield,
                ...player.graveyard,
                ...player.exile,
            ]) {
                expect(Object.keys(card.card)).toEqual(["id"]);
            }
        }
        for (const item of result.stack) {
            expect(Object.keys(item.card)).toEqual(["id"]);
        }
    });
});

// Regression (issue #239): a `search-library` choice (CR 401.4 / 701.19)
// exposes the chooser's library face-up via `librarySearch` so the picker pile
// can open. Two failure modes are guarded here:
//  1. In solo mode the projection's viewer must be the choice owner, not the
//     priority/active player. When they diverge (mid-resolution choice — no one
//     holds priority), keying exposure off the priority holder leaves the
//     chooser without its library and the dialog opens empty until a refresh.
//  2. The full/debug projection never populated `librarySearch` at all, so the
//     picker was broken in "show all cards" mode regardless of timing.
describe("search-library library exposure (issue #239, CR 401.4 / 701.19)", () => {
    function stateWithSearch(): GameState {
        // p2 is the chooser; priority still reads as p1 (the active player) —
        // the mid-resolution divergence that the solo viewer must resolve.
        return makeState({
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            pendingChoices: [
                {
                    stackItemId: "s1",
                    step: 0,
                    choiceId: "p2",
                    playerId: "p2",
                    kind: "search-library",
                    zone: "library",
                    count: 1,
                    prompt: "Search your library for a card.",
                },
            ],
        });
    }

    it("projectPublicState exposes librarySearch only to the chooser viewer", () => {
        const state = stateWithSearch();
        const result = projectPublicState(state, 1, "p2");
        const chooser = result.players.find((p) => p.id === "p2")!;
        const other = result.players.find((p) => p.id === "p1")!;
        expect(chooser.librarySearch).toBeDefined();
        expect(chooser.librarySearch!.map((c) => c.id)).toEqual([
            "p2-l1",
            "p2-l2",
        ]);
        expect(other.librarySearch).toBeUndefined();
    });

    it("does NOT expose librarySearch when the viewer is the priority holder, not the chooser", () => {
        // This is the bug: projecting for the priority/active player (p1) — as
        // the old solo viewer did — leaves the real chooser (p2) without a
        // face-up library, so the search dialog opens empty.
        const state = stateWithSearch();
        const result = projectPublicState(state, 1, "p1");
        const chooser = result.players.find((p) => p.id === "p2")!;
        expect(chooser.librarySearch).toBeUndefined();
    });

    it("solo viewer follows the chooser so the picker pile opens without a refresh", () => {
        // Mirrors the composition getPublicState performs for a solo game:
        // computeSoloViewerId(state) → projectPublicState(state, seq, viewerId).
        const state = stateWithSearch();
        const viewerId = computeSoloViewerId({
            activePlayerId: state.activePlayerId,
            priorityPlayerId: state.priorityPlayerId ?? state.activePlayerId,
            phase: state.phase,
            combat: state.combat,
            pendingCast: state.pendingCast,
            pendingActivation: state.pendingActivation,
            pendingTarget: state.pendingTarget,
            pendingChoices: state.pendingChoices,
            playerIds: state.players.map((p) => p.id),
        });
        expect(viewerId).toBe("p2");
        const result = projectPublicState(state, 1, viewerId);
        const chooser = result.players.find((p) => p.id === "p2")!;
        expect(chooser.librarySearch!.map((c) => c.id)).toEqual([
            "p2-l1",
            "p2-l2",
        ]);
    });

    it("projectFullState exposes librarySearch to the chooser in show-all-cards mode", () => {
        const state = stateWithSearch();
        const result = projectFullState(state, 1);
        const chooser = result.players.find((p) => p.id === "p2")!;
        const other = result.players.find((p) => p.id === "p1")!;
        expect(chooser.librarySearch!.map((c) => c.id)).toEqual([
            "p2-l1",
            "p2-l2",
        ]);
        expect(other.librarySearch).toBeUndefined();
    });
});

// Regression (issue #262): the sibling mid-resolution choices that ride the
// same peek/reveal exposure as search-library — `reorder-library` (Natural
// Selection), `draw-look-keep` (Aladdin's Lamp) and `reveal-hand` — never
// populated their fields in the full/debug "show all cards" projection, so the
// picker piles opened empty there. The full projection must mirror the public
// projection's `libraryPeek` / `revealedHand` exposure, honoring `zoneOwnerId`
// (the looked-at zone may belong to a different player than the chooser) and
// the looked-at count.
describe("reorder/peek/reveal exposure (issue #262, CR 401.4)", () => {
    // p1 (chooser) reorders the top 2 of p2's library — Natural Selection
    // targeting an opponent: chooser ≠ zone owner.
    function stateWithReorder(): GameState {
        return makeState({
            pendingChoices: [
                {
                    stackItemId: "s1",
                    step: 0,
                    choiceId: "p1",
                    playerId: "p1",
                    zoneOwnerId: "p2",
                    kind: "reorder-library",
                    zone: "library",
                    count: 2,
                    prompt: "Put these cards back in any order (first = top).",
                },
            ],
        });
    }

    // p1 (chooser) looks at the top 2 of their own library and keeps one —
    // Aladdin's Lamp. peekCount comes from candidateIds, not count.
    function stateWithDrawLookKeep(): GameState {
        return makeState({
            players: [
                makePlayer("p1", {
                    library: [
                        makeCard("p1-l1", { zone: "library" }),
                        makeCard("p1-l2", { zone: "library" }),
                        makeCard("p1-l3", { zone: "library" }),
                    ],
                }),
                makePlayer("p2"),
            ],
            pendingChoices: [
                {
                    stackItemId: "s1",
                    step: 0,
                    choiceId: "p1",
                    playerId: "p1",
                    kind: "draw-look-keep",
                    zone: "library",
                    count: 1,
                    candidateIds: ["p1-l1", "p1-l2"],
                    prompt: "Keep one of the looked-at cards.",
                },
            ],
        });
    }

    // p1 (chooser) reveals p2's hand — reveal-hand with a divergent zone owner.
    function stateWithRevealHand(): GameState {
        return makeState({
            pendingChoices: [
                {
                    stackItemId: "s1",
                    step: 0,
                    choiceId: "p1",
                    playerId: "p1",
                    zoneOwnerId: "p2",
                    kind: "reveal-hand",
                    zone: "hand",
                    count: 0,
                    prompt: "Reveal target player's hand.",
                },
            ],
        });
    }

    it("projectPublicState exposes libraryPeek (top N of the zone owner) to the chooser only", () => {
        const result = projectPublicState(stateWithReorder(), 1, "p1");
        const owner = result.players.find((p) => p.id === "p2")!;
        const chooser = result.players.find((p) => p.id === "p1")!;
        // Honors zoneOwnerId: the peek is the opponent's top 2, not p1's own.
        expect(owner.libraryPeek!.map((c) => c.id)).toEqual(["p2-l1", "p2-l2"]);
        expect(chooser.libraryPeek).toBeUndefined();
    });

    it("projectFullState exposes libraryPeek for reorder-library in show-all-cards mode", () => {
        const result = projectFullState(stateWithReorder(), 1);
        const owner = result.players.find((p) => p.id === "p2")!;
        const chooser = result.players.find((p) => p.id === "p1")!;
        expect(owner.libraryPeek!.map((c) => c.id)).toEqual(["p2-l1", "p2-l2"]);
        expect(chooser.libraryPeek).toBeUndefined();
    });

    it("projectFullState exposes libraryPeek for draw-look-keep using candidateIds count", () => {
        const result = projectFullState(stateWithDrawLookKeep(), 1);
        const chooser = result.players.find((p) => p.id === "p1")!;
        // candidateIds.length (2) drives the peek count, not `count` (1).
        expect(chooser.libraryPeek!.map((c) => c.id)).toEqual([
            "p1-l1",
            "p1-l2",
        ]);
    });

    it("projectPublicState matches projectFullState for draw-look-keep", () => {
        const pub = projectPublicState(stateWithDrawLookKeep(), 1, "p1");
        const full = projectFullState(stateWithDrawLookKeep(), 1);
        const pubPeek = pub.players
            .find((p) => p.id === "p1")!
            .libraryPeek!.map((c) => c.id);
        const fullPeek = full.players
            .find((p) => p.id === "p1")!
            .libraryPeek!.map((c) => c.id);
        expect(fullPeek).toEqual(pubPeek);
    });

    it("projectFullState exposes revealedHand (zone owner's hand) for reveal-hand", () => {
        const result = projectFullState(stateWithRevealHand(), 1);
        const owner = result.players.find((p) => p.id === "p2")!;
        const chooser = result.players.find((p) => p.id === "p1")!;
        // zoneOwnerId p2: the revealed hand is p2's (3 cards), exposed to p1.
        expect(owner.revealedHand!.map((c) => c.id)).toEqual([
            "p2-h1",
            "p2-h2",
            "p2-h3",
        ]);
        expect(chooser.revealedHand).toBeUndefined();
    });

    it("does NOT expose peek/reveal fields when no exposing choice is active", () => {
        const full = projectFullState(makeState(), 1);
        for (const player of full.players) {
            expect(player.libraryPeek).toBeUndefined();
            expect(player.revealedHand).toBeUndefined();
        }
    });
});

// Wire-format invariant: every transient field on a battlefield permanent
// must reach the client through projectPublicState / projectFullState.
// `slimCard` uses spread, so this is also a regression guard against any
// future refactor replacing the spread with explicit enumeration (the same
// class of bug that broke aura/pump P/T display through toPermanentView).
describe("projection forwards every transient battlefield field", () => {
    function stateWithEnrichedPermanent(): GameState {
        const enriched = makeCard("p1-b1", {
            zone: "battlefield",
            isTapped: true,
            isToken: true,
            isSummoningSick: true,
            isAttacking: true,
            isBlocking: true,
            hasAttackedThisTurn: true,
            hasBlockedThisTurn: true,
            manaCommitted: true,
            damageMarked: 2,
            regenerationShields: 1,
            chosenMana: { R: 1 },
            attachedTo: "host-id",
            temporaryPTMods: [
                { power: 1, toughness: 0, duration: { phase: "end-of-turn" } },
            ],
            counters: { "+1/+1": 1, "+1/+0": 2 },
            grantedStaticAbilities: [{ ability: "flying", auraId: "aura-1" }],
            grantedActivatedAbilities: [
                {
                    sourceCardId: "src",
                    abilityId: "ability",
                    auraId: "aura-1",
                },
            ],
            damagedBySources: ["bolt-1", "bolt-2"],
            controlChanges: [{ auraId: "aura-1", previousControllerId: "p1" }],
        });
        const p1 = makePlayer("p1", { battlefield: [enriched] });
        const p2 = makePlayer("p2");
        return {
            players: [p1, p2],
            stack: [],
            turn: 1,
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            passCount: 0,
            phase: "PRECOMBAT_MAIN",
            rngSeed: 0,
            rngCounter: 0,
        };
    }

    it("projectPublicState preserves every transient field on slim cards", () => {
        const result = projectPublicState(
            stateWithEnrichedPermanent(),
            1,
            "p1"
        );
        const me = result.players.find((p) => p.id === "p1")!;
        const card = me.battlefield[0];
        expect(card.isTapped).toBe(true);
        expect(card.isToken).toBe(true);
        expect(card.isSummoningSick).toBe(true);
        expect(card.isAttacking).toBe(true);
        expect(card.isBlocking).toBe(true);
        expect(card.hasAttackedThisTurn).toBe(true);
        expect(card.hasBlockedThisTurn).toBe(true);
        expect(card.manaCommitted).toBe(true);
        expect(card.damageMarked).toBe(2);
        expect(card.regenerationShields).toBe(1);
        expect(card.chosenMana).toEqual({ R: 1 });
        expect(card.attachedTo).toBe("host-id");
        expect(card.temporaryPTMods).toEqual([
            { power: 1, toughness: 0, duration: { phase: "end-of-turn" } },
        ]);
        expect(card.counters).toEqual({ "+1/+1": 1, "+1/+0": 2 });
        expect(card.grantedStaticAbilities).toEqual([
            { ability: "flying", auraId: "aura-1" },
        ]);
        expect(card.grantedActivatedAbilities).toEqual([
            { sourceCardId: "src", abilityId: "ability", auraId: "aura-1" },
        ]);
        expect(card.damagedBySources).toEqual(["bolt-1", "bolt-2"]);
        expect(card.controlChanges).toEqual([
            { auraId: "aura-1", previousControllerId: "p1" },
        ]);
    });

    it("projectFullState preserves every transient field on slim cards", () => {
        const result = projectFullState(stateWithEnrichedPermanent(), 1);
        const me = result.players.find((p) => p.id === "p1")!;
        const card = me.battlefield[0];
        expect(card.attachedTo).toBe("host-id");
        expect(card.temporaryPTMods).toEqual([
            { power: 1, toughness: 0, duration: { phase: "end-of-turn" } },
        ]);
        expect(card.counters).toEqual({ "+1/+1": 1, "+1/+0": 2 });
        expect(card.hasAttackedThisTurn).toBe(true);
        expect(card.hasBlockedThisTurn).toBe(true);
    });
});

describe("projectPublicState legal actions timing", () => {
    it("yields 'cast' on a Creature in main phase with empty stack", () => {
        const state = makeState();
        const result = projectPublicState(state, 1, "p1");
        const me = result.players.find((p) => p.id === "p1")!;
        expect(me.hand[0]!.legalActions).toContain("cast");
    });

    it("returns all debug actions when allActions=true", () => {
        const state = makeState();
        const result = projectPublicState(state, 1, "p1", true);
        const me = result.players.find((p) => p.id === "p1")!;
        expect(me.hand[0]!.legalActions.length).toBeGreaterThan(1);
    });
});
