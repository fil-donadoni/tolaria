import { describe, it, expect } from "vitest";
import { projectFullState, projectPublicState } from "../gameProjections";
import { computeSoloViewerId } from "../soloViewer";
import { drawCard, exileFaceDownCard, removeFromZone } from "../gre/state";
import { FACE_DOWN_CARD_ID } from "../cards";
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

    it("reduces own library to { count, known } (not an array)", () => {
        const me = result.players.find((p) => p.id === "p1")!;
        expect(Array.isArray(me.library)).toBe(false);
        // ADR 0026 — no card is `knownTo` the viewer, so `known` is empty.
        expect(me.library).toEqual({ count: 1, known: [] });
    });

    it("reduces opponent library to { count, known } (not an array)", () => {
        const opp = result.players.find((p) => p.id === "p2")!;
        expect(Array.isArray(opp.library)).toBe(false);
        expect(opp.library).toEqual({ count: 2, known: [] });
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

// ---------------------------------------------------------------------------
// Persistent card knowledge — ADR 0026 / PRD #338
// ---------------------------------------------------------------------------
describe("projectPublicState — knownTo (ADR 0026)", () => {
    it("exposes a viewer-known library card sparsely at its top index", () => {
        const state = makeState();
        // p1 knows p1-l1 at the top of their own library.
        const p1 = state.players.find((p) => p.id === "p1")!;
        p1.library[0].knownTo = ["p1"];

        const instanceId = p1.library[0].id; // "p1-l1"
        const defId = (p1.library[0].card as { id: string }).id; // "def-p1-l1"
        const forP1 = projectPublicState(state, 1, "p1");
        const lib = forP1.players.find((p) => p.id === "p1")!.library;
        expect(lib.count).toBe(1);
        expect(lib.known).toHaveLength(1);
        expect(lib.known[0].index).toBe(0);
        expect(lib.known[0].card.id).toBe(instanceId);
        expect(lib.known[0].card.card.id).toBe(defId);
    });

    it("hides a known library card from a viewer not in knownTo", () => {
        const state = makeState();
        state.players.find((p) => p.id === "p1")!.library[0].knownTo = ["p1"];
        const forP2 = projectPublicState(state, 1, "p2");
        const lib = forP2.players.find((p) => p.id === "p1")!.library;
        expect(lib.known).toEqual([]);
    });

    it("never emits raw knownTo on a projected library card", () => {
        const state = makeState();
        state.players.find((p) => p.id === "p1")!.library[0].knownTo = ["p1"];
        const forP1 = projectPublicState(state, 1, "p1");
        const card = forP1.players.find((p) => p.id === "p1")!.library.known[0]
            .card;
        expect((card as { knownTo?: string[] }).knownTo).toBeUndefined();
    });

    it("flags own-hand cards seenByOpponent and reveals known opponent-hand slots", () => {
        const state = makeState();
        // p2 knows p1's first hand card (e.g. Duress — future slice).
        state.players.find((p) => p.id === "p1")!.hand[0].knownTo = ["p2"];

        // p1's own view: the known card carries seenByOpponent; the other does not.
        const forP1 = projectPublicState(state, 1, "p1");
        const myHand = forP1.players.find((p) => p.id === "p1")!.hand;
        expect(myHand[0]!.seenByOpponent).toBe(true);
        expect(myHand[1]!.seenByOpponent).toBeUndefined();

        // p2's view of p1's hand: known slot carries identity, rest are null.
        const forP2 = projectPublicState(state, 1, "p2");
        const oppHand = forP2.players.find((p) => p.id === "p1")!.hand;
        expect(oppHand).toHaveLength(2);
        expect(oppHand[0]).not.toBeNull();
        expect(oppHand[1]).toBeNull();
        expect((oppHand[0] as { knownTo?: string[] }).knownTo).toBeUndefined();
    });

    it("does NOT flag seenByOpponent when only the owner knows a hand card", () => {
        const state = makeState();
        state.players.find((p) => p.id === "p1")!.hand[0].knownTo = ["p1"];
        const forP1 = projectPublicState(state, 1, "p1");
        const myHand = forP1.players.find((p) => p.id === "p1")!.hand;
        expect(myHand[0]!.seenByOpponent).toBeUndefined();
    });

    // Slice 2 (#340) — a REVEALED library card (knownTo = all players) projects
    // face-up to EVERY viewer, including the library owner who would otherwise
    // not auto-know their own order. A look (single knower) does not.
    it("reveal: a library card known to all players is exposed to every viewer", () => {
        const state = makeState();
        const p2 = state.players.find((p) => p.id === "p2")!;
        // p2-l1 revealed to both players (markKnownToAll on p2's library).
        p2.library[0].knownTo = ["p1", "p2"];
        const instanceId = p2.library[0].id; // "p2-l1"

        // The library owner sees their own revealed top card.
        const forP2 = projectPublicState(state, 1, "p2");
        const ownerLib = forP2.players.find((p) => p.id === "p2")!.library;
        expect(ownerLib.count).toBe(2);
        expect(ownerLib.known).toHaveLength(1);
        expect(ownerLib.known[0].index).toBe(0);
        expect(ownerLib.known[0].card.id).toBe(instanceId);

        // The opponent sees the same revealed card at the same index.
        const forP1 = projectPublicState(state, 1, "p1");
        const oppLib = forP1.players.find((p) => p.id === "p2")!.library;
        expect(oppLib.known).toHaveLength(1);
        expect(oppLib.known[0].index).toBe(0);
        expect(oppLib.known[0].card.id).toBe(instanceId);

        // Raw knownTo never crosses the wire for either viewer.
        expect(
            (oppLib.known[0].card as { knownTo?: string[] }).knownTo
        ).toBeUndefined();
        expect(
            (ownerLib.known[0].card as { knownTo?: string[] }).knownTo
        ).toBeUndefined();
    });

    // Slice 5 (#344) — cross-zone movement → projection, end-to-end through the
    // real primitives. An opponent who saw the top of the library still knows
    // the card after the owner draws it: it projects face-up to the opponent
    // and carries `seenByOpponent` in the owner's hand.
    it("witnessed draw: a card the opponent saw on top stays known after drawing it (post-transfer scoping)", () => {
        const state = makeState();
        const p1 = state.players.find((p) => p.id === "p1")!;
        // p2 saw p1's top-of-library card (e.g. a reveal-top effect).
        p1.library[0].knownTo = ["p2"];
        const seenId = p1.library[0].id; // "p1-l1"

        // The owner draws it — library→hand is hidden→hidden, knowledge persists.
        drawCard(p1);
        expect(p1.hand.some((c) => c.id === seenId)).toBe(true);

        // Owner's view: the drawn card is flagged seenByOpponent.
        const forP1 = projectPublicState(state, 1, "p1");
        const ownHand = forP1.players.find((p) => p.id === "p1")!.hand;
        const ownSlot = ownHand.find((c) => c?.id === seenId)!;
        expect(ownSlot.seenByOpponent).toBe(true);

        // Opponent's view of p1's hand: the witnessed card is revealed, the rest
        // are null. Raw knownTo never crosses the wire.
        const forP2 = projectPublicState(state, 1, "p2");
        const oppView = forP2.players.find((p) => p.id === "p1")!.hand;
        const revealed = oppView.find((c) => c?.id === seenId)!;
        expect(revealed).not.toBeNull();
        expect((revealed as { knownTo?: string[] }).knownTo).toBeUndefined();
        expect(oppView.filter((c) => c !== null)).toHaveLength(1);
    });

    // Slice 5 (#344) — a self-scryed card (knownTo = owner only) drawn into hand
    // is known to the owner only and is NOT flagged seenByOpponent.
    it("self-scry then draw: the card is owner-known only, never flagged seenByOpponent", () => {
        const state = makeState();
        const p1 = state.players.find((p) => p.id === "p1")!;
        p1.library[0].knownTo = ["p1"]; // owner scryed it to top
        const scryedId = p1.library[0].id;

        drawCard(p1);

        const forP1 = projectPublicState(state, 1, "p1");
        const ownSlot = forP1.players
            .find((p) => p.id === "p1")!
            .hand.find((c) => c?.id === scryedId)!;
        expect(ownSlot.seenByOpponent).toBeUndefined();

        // The opponent does not see it in p1's hand.
        const forP2 = projectPublicState(state, 1, "p2");
        const oppView = forP2.players.find((p) => p.id === "p1")!.hand;
        expect(oppView.every((c) => c === null)).toBe(true);
    });

    // Slice 5 (#344) — play to a public zone (stack) then return to a hidden
    // zone: old knowledge does NOT resurrect. Casting routes through
    // `removeFromZone`, which empties knownTo at the public-zone boundary.
    it("play-to-public then return-to-hidden: old knowledge does not resurrect", () => {
        const state = makeState();
        const p1 = state.players.find((p) => p.id === "p1")!;
        p1.hand[0].knownTo = ["p2"];
        const cardId = p1.hand[0].id;

        // Cast it: hand → stack (public). Knowledge is emptied.
        const onStack = removeFromZone(p1, cardId, "hand");
        expect(onStack.knownTo).toBeUndefined();

        // Simulate a return to a hidden zone (e.g. countered to hand): the card
        // carries no knownTo, so the opponent does not re-learn it.
        onStack.zone = "hand";
        p1.hand.push(onStack);

        const forP2 = projectPublicState(state, 1, "p2");
        const oppView = forP2.players.find((p) => p.id === "p1")!.hand;
        const returned = oppView.find((c) => c?.id === cardId);
        expect(returned).toBeUndefined(); // hidden — slot is null, not present by id
    });

    it("reveal vs look: a single-knower library card stays hidden from the other player", () => {
        const state = makeState();
        const p2 = state.players.find((p) => p.id === "p2")!;
        // Only p1 looked — not a reveal.
        p2.library[0].knownTo = ["p1"];

        const forP1 = projectPublicState(state, 1, "p1");
        expect(
            forP1.players.find((p) => p.id === "p2")!.library.known
        ).toHaveLength(1);

        // The library owner p2 did not learn it (no auto-knowledge of own order).
        const forP2 = projectPublicState(state, 1, "p2");
        expect(forP2.players.find((p) => p.id === "p2")!.library.known).toEqual(
            []
        );
    });
});

// ---------------------------------------------------------------------------
// Face-down exile / impulse-draw — ADR 0026 / PRD #338 (slice 6, #342)
// Exile is normally public; a face-down exile is the CR 406.3 exception, gated
// per-viewer by `knownTo` exactly like a hidden zone.
// ---------------------------------------------------------------------------
describe("projectPublicState — face-down exile (ADR 0026 slice 6, CR 406.3)", () => {
    // End-to-end through the real primitive: p1 impulse-exiles their own top
    // card. Their projection reveals it; the opponent's hides it.
    function stateWithFaceDownExile() {
        const state = makeState();
        const p1 = state.players.find((p) => p.id === "p1")!;
        exileFaceDownCard(p1, p1.library[0].id, "library", "p1");
        return state;
    }

    it("reveals the exiled card's real identity to the controller", () => {
        const state = stateWithFaceDownExile();
        const exiledId = state.players.find((p) => p.id === "p1")!.exile[0].id;
        const defId = "def-p1-l1";

        const forP1 = projectPublicState(state, 1, "p1");
        const exile = forP1.players.find((p) => p.id === "p1")!.exile;
        expect(exile).toHaveLength(1);
        expect(exile[0].id).toBe(exiledId);
        expect(exile[0].card.id).toBe(defId); // real identity, not the sentinel
    });

    it("hides the exiled card's identity from the opponent (face-down sentinel)", () => {
        const state = stateWithFaceDownExile();
        const exiledId = state.players.find((p) => p.id === "p1")!.exile[0].id;

        const forP2 = projectPublicState(state, 1, "p2");
        const exile = forP2.players.find((p) => p.id === "p1")!.exile;
        // The card is still present (a face-down card the opponent can count),
        // but its identity is the sentinel, not the real def.
        expect(exile).toHaveLength(1);
        expect(exile[0].id).toBe(exiledId);
        expect(exile[0].card.id).toBe(FACE_DOWN_CARD_ID);
        expect(exile[0].card.id).not.toBe("def-p1-l1");
    });

    it("never emits raw knownTo on a face-down exiled card, for either viewer", () => {
        const state = stateWithFaceDownExile();
        const forP1 = projectPublicState(state, 1, "p1");
        const forP2 = projectPublicState(state, 1, "p2");
        const p1Card = forP1.players.find((p) => p.id === "p1")!.exile[0];
        const p2Card = forP2.players.find((p) => p.id === "p1")!.exile[0];
        expect((p1Card as { knownTo?: string[] }).knownTo).toBeUndefined();
        expect((p2Card as { knownTo?: string[] }).knownTo).toBeUndefined();
    });

    it("does not strip faceDownOf-style leaks for the opponent", () => {
        const state = stateWithFaceDownExile();
        const forP2 = projectPublicState(state, 1, "p2");
        const p2Card = forP2.players.find((p) => p.id === "p1")!.exile[0];
        expect((p2Card as { faceDownOf?: string }).faceDownOf).toBeUndefined();
    });

    it("keeps an ordinary face-up exiled card public to all viewers", () => {
        // A card sent to exile via the normal path has no knownTo, so it stays
        // public — the face-down gate only triggers on non-empty knownTo.
        const state = makeState();
        const p1 = state.players.find((p) => p.id === "p1")!;
        const faceUp = makeCard("p1-x1", { zone: "exile" });
        p1.exile.push(faceUp);

        const forP2 = projectPublicState(state, 1, "p2");
        const card = forP2.players
            .find((p) => p.id === "p1")!
            .exile.find((c) => c.id === "p1-x1")!;
        expect(card.card.id).toBe("def-p1-x1"); // real identity to everyone
    });
});
