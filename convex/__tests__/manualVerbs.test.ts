import { describe, it, expect } from "vitest";
import {
    setupManualGame,
    manualMoveCard,
    manualSetTapped,
    manualUntapAll,
    manualAdjustLife,
    manualAdjustCounter,
    manualSetFaceDown,
    manualSetLane,
    manualSetBackColumn,
    manualAttach,
    manualSetArrow,
    manualClearArrows,
    manualClearArrow,
    manualDraw,
    manualMill,
    manualExileTop,
    manualPeek,
    manualShuffle,
    manualCreateToken,
    manualRoll,
    manualSetNote,
    manualSetPhase,
    manualSetActivePlayer,
    manualEndTurn,
    manualConcede,
    manualReveal,
    manualRevealHand,
    backfillManualCardNames,
} from "../manual";

function freshState() {
    return setupManualGame([
        {
            id: "p1",
            name: "Alice",
            bgColor: "#aabbcc",
            deck: [
                { cardId: "c1", cardName: "Mountain" },
                { cardId: "c2", cardName: "Lightning Bolt" },
                { cardId: "c3", cardName: "Shock" },
                { cardId: "c4", cardName: "Grizzly Bears" },
                { cardId: "c5", cardName: "Savannah Lions" },
                { cardId: "c6", cardName: "Serra Angel" },
                { cardId: "c7", cardName: "Counterspell" },
                { cardId: "c8", cardName: "Wrath of God" },
                { cardId: "c9", cardName: "Plains" },
                { cardId: "c10", cardName: "Forest" },
            ],
        },
        {
            id: "p2",
            name: "Bob",
            bgColor: "#ddeeff",
            deck: [
                { cardId: "c11", cardName: "Swamp" },
                { cardId: "c12", cardName: "Dark Ritual" },
                { cardId: "c13", cardName: "Hypnotic Specter" },
                { cardId: "c14", cardName: "Terror" },
                { cardId: "c15", cardName: "Sengir Vampire" },
                { cardId: "c16", cardName: "Duress" },
                { cardId: "c17", cardName: "Hymn to Tourach" },
                { cardId: "c18", cardName: "Necropotence" },
                { cardId: "c19", cardName: "Badlands" },
                { cardId: "c20", cardName: "Bayou" },
            ],
        },
    ]);
}

function findCardInState(
    state: ReturnType<typeof freshState>,
    instanceId: string
) {
    for (const player of state.players) {
        for (const arr of [
            player.hand,
            player.library,
            player.battlefield,
            player.graveyard,
            player.exile,
        ]) {
            const card = arr.find((c) => c.id === instanceId);
            if (card) return { card, player, arr };
        }
    }
    return null;
}

function moveToBattlefield(
    state: ReturnType<typeof freshState>,
    instanceId: string
) {
    for (const player of state.players) {
        const idx = player.hand.findIndex((c) => c.id === instanceId);
        if (idx !== -1) {
            const [card] = player.hand.splice(idx, 1);
            card.zone = "battlefield";
            player.battlefield.push(card);
            return;
        }
    }
}

function getPlayer(state: ReturnType<typeof freshState>, playerId: string) {
    return state.players.find((p) => p.id === playerId)!;
}

// Manual-mode QA round 3, item 1 — a game STARTED before cards carried their
// name has nameless instances, and those are exactly the games whose log reads
// as a column of raw UUIDs. `manualVerbHandler` runs this on every verb off
// the decklists already on the game row, so such a game repairs itself on the
// next action instead of staying broken for its whole life.
describe("backfillManualCardNames", () => {
    function namelessState() {
        const state = freshState();
        for (const player of state.players) {
            for (const zone of [
                player.hand,
                player.library,
                player.battlefield,
            ]) {
                for (const card of zone) delete card.name;
            }
        }
        return state;
    }

    it("names every card the decklists know, in every zone", () => {
        const state = namelessState();
        const changed = backfillManualCardNames(
            state,
            new Map([
                ["c1", "Mountain"],
                ["c11", "Swamp"],
            ])
        );

        expect(changed).toBe(true);
        const named = [
            ...getPlayer(state, "p1").hand,
            ...getPlayer(state, "p1").library,
        ].filter((c) => c.name !== undefined);
        expect(named).toHaveLength(1);
        expect(named[0].card.id).toBe("c1");
        expect(named[0].name).toBe("Mountain");
    });

    it("never overwrites a name a card already has", () => {
        const state = freshState();
        const card = getPlayer(state, "p1").hand[0];
        const before = card.name;
        backfillManualCardNames(state, new Map([[card.card.id, "Wrong Name"]]));
        expect(findCardInState(state, card.id)!.card.name).toBe(before);
    });

    it("reports no change when there is nothing to repair", () => {
        expect(backfillManualCardNames(freshState(), new Map())).toBe(false);
    });
});

describe("manual verbs - table driven", () => {
    it("moveCard: moves card between zones", () => {
        const state = freshState();
        const card = getPlayer(state, "p1").hand[0];
        const result = manualMoveCard(state, card.id, "graveyard");

        expect(findCardInState(result.state, card.id)!.card.zone).toBe(
            "graveyard"
        );
        expect(getPlayer(result.state, "p1").hand).toHaveLength(6);
        expect(getPlayer(result.state, "p1").graveyard).toHaveLength(1);
        expect(result.log.text).toContain("Alice");
        expect(result.log.text).toContain("graveyard");
        // #2350 made the log stop interpolating raw ids; manual-mode QA
        // round 3 item 1 finished the job — an instance that knows its own
        // name is interpolated as PLAIN TEXT, so `cards` (the client-side
        // catalogue placeholder path) is not needed at all.
        expect(result.log.text).toContain(card.name!);
        expect(result.log.text).not.toContain(card.id);
        expect(result.log.cards).toBeUndefined();
    });

    it("moveCard: battlefield untaps on entry", () => {
        const state = freshState();
        const card = getPlayer(state, "p1").hand[0];
        card.isTapped = true;
        const result = manualMoveCard(state, card.id, "battlefield");

        const moved = findCardInState(result.state, card.id)!;
        expect(moved.card.zone).toBe("battlefield");
        expect(moved.card.isTapped).toBe(false);
    });

    it("moveCard: missing card returns unchanged state", () => {
        const state = freshState();
        const result = manualMoveCard(state, "nonexistent", "graveyard");
        expect(result.state).toEqual(state);
    });

    it("setTapped: taps a permanent", () => {
        const state = freshState();
        const card = getPlayer(state, "p1").hand[0];
        moveToBattlefield(state, card.id);
        const result = manualSetTapped(state, card.id, true);

        expect(findCardInState(result.state, card.id)!.card.isTapped).toBe(
            true
        );
        expect(result.log.text).toContain("taps");
        expect(result.log.cards).toBeUndefined();
    });

    it("setTapped: untaps a permanent", () => {
        const state = freshState();
        const card = getPlayer(state, "p1").hand[0];
        moveToBattlefield(state, card.id);
        card.isTapped = true;
        const result = manualSetTapped(state, card.id, false);

        expect(findCardInState(result.state, card.id)!.card.isTapped).toBe(
            false
        );
        expect(result.log.text).toContain("untaps");
        expect(result.log.cards).toBeUndefined();
    });

    it("untapAll: untaps every card owned by a player", () => {
        const state = freshState();
        for (const card of getPlayer(state, "p1").hand.slice(0, 3)) {
            card.isTapped = true;
        }
        const result = manualUntapAll(state, "p1");

        for (const card of getPlayer(result.state, "p1").hand) {
            expect(card.isTapped).toBe(false);
        }
    });

    it("adjustLife: adds positive delta", () => {
        const state = freshState();
        const result = manualAdjustLife(state, "p2", 3);
        expect(getPlayer(result.state, "p2").life).toBe(23);
        expect(result.log.text).toContain("20 → 23");
    });

    it("adjustLife: subtracts negative delta", () => {
        const state = freshState();
        const result = manualAdjustLife(state, "p1", -13);
        expect(getPlayer(result.state, "p1").life).toBe(7);
        expect(result.log.text).toContain("20 → 7");
    });

    it("adjustCounter: adds a counter", () => {
        const state = freshState();
        const card = getPlayer(state, "p1").hand[0];
        moveToBattlefield(state, card.id);
        const result = manualAdjustCounter(state, card.id, "+1/+1", 3);

        const found = findCardInState(result.state, card.id)!;
        expect(found.card.counters!["+1/+1"]).toBe(3);
    });

    it("adjustCounter: removes a counter completely when reaching zero", () => {
        const state = freshState();
        const card = getPlayer(state, "p1").hand[0];
        moveToBattlefield(state, card.id);
        card.counters = { "+1/+1": 2, damage: 1 };
        const result = manualAdjustCounter(state, card.id, "+1/+1", -2);

        const found = findCardInState(result.state, card.id)!;
        expect(found.card.counters).toEqual({ damage: 1 });
    });

    it("adjustCounter: damage counter", () => {
        const state = freshState();
        const card = getPlayer(state, "p1").hand[0];
        moveToBattlefield(state, card.id);
        const result = manualAdjustCounter(state, card.id, "damage", 3);

        const found = findCardInState(result.state, card.id)!;
        expect(found.card.counters!["damage"]).toBe(3);
        expect(result.log.text).toContain("damage");
        expect(result.log.cards).toBeUndefined();
    });

    it("setFaceDown: sets card face down", () => {
        const state = freshState();
        const card = getPlayer(state, "p1").hand[0];
        moveToBattlefield(state, card.id);
        const result = manualSetFaceDown(state, card.id, true);

        expect(findCardInState(result.state, card.id)!.card.faceDown).toBe(
            true
        );
        expect(result.log.text).toContain(card.name!);
        expect(result.log.cards).toBeUndefined();
    });

    it("setFaceDown: sets card face up (removes field)", () => {
        const state = freshState();
        const card = getPlayer(state, "p1").hand[0];
        moveToBattlefield(state, card.id);
        card.faceDown = true;
        const result = manualSetFaceDown(state, card.id, false);

        expect(
            findCardInState(result.state, card.id)!.card.faceDown
        ).toBeUndefined();
    });

    it("setLane: sets lane to combat", () => {
        const state = freshState();
        const card = getPlayer(state, "p1").hand[0];
        moveToBattlefield(state, card.id);
        const result = manualSetLane(state, card.id, "combat");

        expect(findCardInState(result.state, card.id)!.card.lane).toBe(
            "combat"
        );
        expect(result.log.cards).toBeUndefined();
    });

    it("setLane: sets lane to main", () => {
        const state = freshState();
        const card = getPlayer(state, "p1").hand[0];
        moveToBattlefield(state, card.id);
        const result = manualSetLane(state, card.id, "main");

        expect(findCardInState(result.state, card.id)!.card.lane).toBe("main");
    });

    // The back row's two columns — the manual stand-in for the GRE board's
    // automatic land/non-land split, which a Manual Game cannot derive (it
    // never learns a card is a land).
    it("setBackColumn: records the column the player put the card in", () => {
        const state = freshState();
        const card = getPlayer(state, "p1").hand[0];
        moveToBattlefield(state, card.id);
        const result = manualSetBackColumn(state, card.id, "left");

        expect(findCardInState(result.state, card.id)!.card.backColumn).toBe(
            "left"
        );
        expect(result.log.text).toContain("in the left column");
        expect(result.log.text).toContain(card.name!);
    });

    it("setBackColumn: moving to the other column replaces the first", () => {
        const state = freshState();
        const card = getPlayer(state, "p1").hand[0];
        moveToBattlefield(state, card.id);
        const left = manualSetBackColumn(state, card.id, "left").state;
        const right = manualSetBackColumn(left, card.id, "right").state;

        expect(findCardInState(right, card.id)!.card.backColumn).toBe("right");
    });

    it("attach: sets attachedTo", () => {
        const state = freshState();
        const card = getPlayer(state, "p1").hand[0];
        const target = getPlayer(state, "p1").hand[1];
        moveToBattlefield(state, card.id);
        moveToBattlefield(state, target.id);
        const result = manualAttach(state, card.id, target.id);

        expect(findCardInState(result.state, card.id)!.card.attachedTo).toBe(
            target.id
        );
        expect(result.log.text).toContain("attaches");
        expect(result.log.text).toContain(card.name!);
        expect(result.log.text).toContain(target.name!);
        // Two DIFFERENT cards — attach was previously interpolating the raw
        // instance id for the acting card only; the target's print id was
        // never looked up at all.
        expect(result.log.cards).toBeUndefined();
    });

    it("setArrow: adds arrow from source to target", () => {
        const state = freshState();
        const card = getPlayer(state, "p1").hand[0];
        const target = getPlayer(state, "p2").hand[0];
        moveToBattlefield(state, card.id);
        moveToBattlefield(state, target.id);
        const result = manualSetArrow(state, card.id, target.id);

        expect(findCardInState(result.state, card.id)!.card.arrows).toContain(
            target.id
        );
        expect(result.log.cards).toBeUndefined();
    });

    it("setArrow: adds multiple arrows", () => {
        const state = freshState();
        const card = getPlayer(state, "p1").hand[0];
        const t1 = getPlayer(state, "p2").hand[0];
        const t2 = getPlayer(state, "p2").hand[1];
        moveToBattlefield(state, card.id);
        moveToBattlefield(state, t1.id);
        moveToBattlefield(state, t2.id);
        const s2 = manualSetArrow(state, card.id, t1.id);
        const result = manualSetArrow(s2.state, card.id, t2.id);

        expect(findCardInState(result.state, card.id)!.card.arrows).toEqual([
            t1.id,
            t2.id,
        ]);
    });

    it("setArrow: re-declaring the same target is a no-op, not a duplicate entry (#2338)", () => {
        // Shift-dragging A onto B twice is a normal action — there is no
        // toggle-off — so `arrows` must stay `["bear"]`, never `["bear",
        // "bear"]`. A duplicate would collide on `buildManualArrowPairs`'
        // `manual:from->to` key and crash React with a duplicate-key error.
        const state = freshState();
        const card = getPlayer(state, "p1").hand[0];
        const target = getPlayer(state, "p2").hand[0];
        moveToBattlefield(state, card.id);
        moveToBattlefield(state, target.id);
        const s2 = manualSetArrow(state, card.id, target.id);
        const result = manualSetArrow(s2.state, card.id, target.id);

        expect(findCardInState(result.state, card.id)!.card.arrows).toEqual([
            target.id,
        ]);
    });

    it("clearArrows: clears all arrows", () => {
        const state = freshState();
        const card = getPlayer(state, "p1").hand[0];
        const target = getPlayer(state, "p2").hand[0];
        moveToBattlefield(state, card.id);
        moveToBattlefield(state, target.id);
        card.arrows = [target.id];
        const result = manualClearArrows(state, "p1");

        expect(
            findCardInState(result.state, card.id)!.card.arrows
        ).toBeUndefined();
    });

    it("clearArrow: clears only the acting card's arrows, not a sibling's (#2171)", () => {
        const state = freshState();
        const bolt = getPlayer(state, "p1").hand[0];
        const other = getPlayer(state, "p1").hand[1];
        const target = getPlayer(state, "p2").hand[0];
        moveToBattlefield(state, bolt.id);
        moveToBattlefield(state, other.id);
        moveToBattlefield(state, target.id);
        bolt.arrows = [target.id];
        other.arrows = [target.id];

        const result = manualClearArrow(state, bolt.id);

        expect(
            findCardInState(result.state, bolt.id)!.card.arrows
        ).toBeUndefined();
        expect(result.log.text).toContain(bolt.name!);
        expect(result.log.cards).toBeUndefined();
        // The sibling card's own arrow survives — a per-card clear must not
        // reach for `manualClearArrows`' board-wide sweep.
        expect(findCardInState(result.state, other.id)!.card.arrows).toEqual([
            target.id,
        ]);
    });

    it("clearArrow: a card with no arrows is a no-op, not an error", () => {
        const state = freshState();
        const card = getPlayer(state, "p1").hand[0];
        moveToBattlefield(state, card.id);

        const result = manualClearArrow(state, card.id);

        expect(
            findCardInState(result.state, card.id)!.card.arrows
        ).toBeUndefined();
    });

    it("draw: draws cards from library to hand", () => {
        const state = freshState();
        const libLen = getPlayer(state, "p1").library.length;
        const handLen = getPlayer(state, "p1").hand.length;
        const result = manualDraw(state, "p1", 2);

        expect(getPlayer(result.state, "p1").hand).toHaveLength(handLen + 2);
        expect(getPlayer(result.state, "p1").library).toHaveLength(libLen - 2);
    });

    it("draw: clamps at empty library", () => {
        const state = freshState();
        getPlayer(state, "p1").library = [];
        const result = manualDraw(state, "p1", 5);

        expect(getPlayer(result.state, "p1").hand).toHaveLength(7);
        expect(result.log.text).toContain("0 card");
    });

    it("mill: mills cards from library to graveyard", () => {
        const state = freshState();
        const result = manualMill(state, "p1", 2);

        expect(getPlayer(result.state, "p1").graveyard).toHaveLength(2);
        expect(getPlayer(result.state, "p1").library).toHaveLength(1);
        expect(getPlayer(result.state, "p1").graveyard[0].zone).toBe(
            "graveyard"
        );
    });

    it("exileTop: exiles face-down from top", () => {
        const state = freshState();
        const result = manualExileTop(state, "p2", 1);

        expect(getPlayer(result.state, "p2").exile).toHaveLength(1);
        expect(getPlayer(result.state, "p2").exile[0].zone).toBe("exile");
        expect(getPlayer(result.state, "p2").exile[0].faceDown).toBe(true);
    });

    it("peek: names the top N in order, and does not change state", () => {
        const state = freshState();
        const result = manualPeek(state, "p1", 2);

        expect(result.state).toEqual(state);
        expect(result.log.text).toContain("looks at top 2 of library");
        // Top first — `library`'s last entry is the top of the library (draw
        // is a `pop`), so the entry reads in the order the player saw them.
        const top2 = getPlayer(state, "p1").library.slice(-2).reverse();
        expect(result.log.text).toContain(`${top2[0].name}, ${top2[1].name}`);
        expect(result.log.cards).toBeUndefined();
    });

    it("peek: a peek as deep as the library reads as searching it", () => {
        const state = freshState();
        const size = getPlayer(state, "p1").library.length;
        const result = manualPeek(state, "p1", size);

        // What "Peek all" dispatches (`manual-pile-actions.ts` passes the
        // library's own count) — "looks at top 3 of library" for a 3-card
        // library is technically true and reads as a lie.
        expect(result.log.text).toContain("looks at their whole library");
    });

    it("shuffle: preserves card count", () => {
        const state = freshState();
        const before = getPlayer(state, "p1").library.length;
        const result = manualShuffle(state, "p1");

        expect(getPlayer(result.state, "p1").library).toHaveLength(before);
    });

    it("createToken: creates token on battlefield", () => {
        const state = freshState();
        const initCount = getPlayer(state, "p1").battlefield.length;
        const result = manualCreateToken(state, "token-card-id", "p1", "p1");

        const bf = getPlayer(result.state, "p1").battlefield;
        expect(bf).toHaveLength(initCount + 1);
        const token = bf[bf.length - 1];
        expect(token.card.id).toBe("token-card-id");
        expect(token.zone).toBe("battlefield");
        expect(token.controllerId).toBe("p1");
        expect(token.ownerId).toBe("p1");
        expect(token.isTapped).toBe(false);
        expect(result.log.text).toContain("{{card:0}}");
        expect(result.log.cards).toEqual(["token-card-id"]);
    });

    it("roll: logs the roll result without changing state", () => {
        const state = freshState();
        const result = manualRoll(state, 20);

        expect(result.state).toEqual(state);
        expect(result.log.text).toMatch(/rolled d20: \d+/);
    });

    it("setNote: sets a note on a card", () => {
        const state = freshState();
        const card = getPlayer(state, "p1").hand[0];
        const result = manualSetNote(state, card.id, "Copied from GY");

        expect(findCardInState(result.state, card.id)!.card.note).toBe(
            "Copied from GY"
        );
        expect(result.log.text).toContain(card.name!);
        expect(result.log.cards).toBeUndefined();
    });

    it("setNote: clears a note with empty string", () => {
        const state = freshState();
        const card = getPlayer(state, "p1").hand[0];
        card.note = "some note";
        const result = manualSetNote(state, card.id, "");

        expect(
            findCardInState(result.state, card.id)!.card.note
        ).toBeUndefined();
    });

    it("setPhase: sets the game phase", () => {
        const state = freshState();
        const result = manualSetPhase(state, "COMBAT");

        expect(result.state.phase).toBe("COMBAT");
        expect(result.log.text).toContain("Phase: COMBAT");
    });

    it("setActivePlayer: changes the active player", () => {
        const state = freshState();
        expect(state.activePlayerId).toBe("p1");
        const result = manualSetActivePlayer(state, "p2");

        expect(result.state.activePlayerId).toBe("p2");
        expect(result.log.text).toContain("Active player: Bob");
    });

    it("endTurn: clears damage counters", () => {
        const state = freshState();
        const card = getPlayer(state, "p1").hand[0];
        moveToBattlefield(state, card.id);
        card.counters = { damage: 3, "+1/+1": 1 };
        const result = manualEndTurn(state, "p1");

        const found = findCardInState(result.state, card.id)!;
        expect(found.card.counters).toEqual({ "+1/+1": 1 });
    });

    // Manual-mode QA round 3, item 5 — "End Turn" used to clear damage and
    // NOTHING else, so the turn counter read 1 all game and the active seat
    // never moved. At a table that marker is set by hand; this is the verb
    // that sets it.
    it("endTurn: hands the turn to the next seat and resets the phase marker", () => {
        const state = freshState();
        state.phase = "END_STEP";
        const result = manualEndTurn(state, "p1");

        expect(result.state.turn).toBe(2);
        expect(result.state.activePlayerId).toBe("p2");
        expect(result.state.phase).toBe("UNTAP");
        expect(result.log.text).toContain("turn 2");
        expect(result.log.text).toContain("Bob is active");
    });

    it("endTurn: wraps back to the first seat", () => {
        const state = freshState();
        const afterP1 = manualEndTurn(state, "p1").state;
        const afterP2 = manualEndTurn(afterP1, "p2").state;

        expect(afterP2.activePlayerId).toBe("p1");
        expect(afterP2.turn).toBe(3);
    });

    it("endTurn: passes from the ACTIVE seat, not from whoever pressed it", () => {
        const state = freshState();
        // Either player may end the turn at a table ("ok, you're done") —
        // what moves is the active seat, which is not necessarily theirs.
        const result = manualEndTurn(state, "p2");

        expect(result.state.activePlayerId).toBe("p2");
    });

    it("concede: sets concededBy", () => {
        const state = freshState();
        const result = manualConcede(state, "p2");

        expect(result.state.concededBy).toBe("p2");
        expect(result.log.text).toContain("Bob concedes");
    });

    it("reveal: sets revealedTo on the card", () => {
        const state = freshState();
        const card = getPlayer(state, "p1").hand[0];
        const result = manualReveal(state, card.id, ["p2"]);

        const revealed = findCardInState(result.state, card.id)!;
        expect(revealed.card.revealedTo).toEqual(["p2"]);
        expect(result.log.text).toContain("Alice reveals");
        expect(result.log.text).toContain("Bob");
        // #2350: `reveal` isn't in the issue's example list but is the same
        // bug — it interpolated the raw instance id too.
        expect(result.log.text).toContain(card.name!);
        expect(result.log.text).not.toContain(card.id);
        expect(result.log.cards).toBeUndefined();
    });

    // Manual-mode QA round 3, item 3 — "show me your hand" had no verb at
    // all: the per-card reveal existed, the table action did not.
    it("revealHand: opens EVERY card in the hand to the listed players", () => {
        const state = freshState();
        const hand = getPlayer(state, "p1").hand;
        const result = manualRevealHand(state, "p1", ["p2"]);

        for (const card of hand) {
            expect(
                findCardInState(result.state, card.id)!.card.revealedTo
            ).toEqual(["p2"]);
        }
        // ONE line, not one per card — it is one action at the table.
        expect(result.log.text).toBe(
            `Alice reveals their hand (${hand.length} card(s)) to Bob`
        );
    });

    it("revealHand: accumulates with a card's previous reveal", () => {
        const state = freshState();
        const card = getPlayer(state, "p1").hand[0];
        card.revealedTo = ["p3"];
        const result = manualRevealHand(state, "p1", ["p2"]);

        expect(findCardInState(result.state, card.id)!.card.revealedTo).toEqual(
            expect.arrayContaining(["p2", "p3"])
        );
    });

    it("revealHand: leaves the OTHER player's hand alone", () => {
        const state = freshState();
        const result = manualRevealHand(state, "p1", ["p2"]);

        for (const card of getPlayer(result.state, "p2").hand) {
            expect(card.revealedTo).toBeUndefined();
        }
    });

    it("reveal: to multiple players accumulates revealedTo", () => {
        const state = freshState();
        const card = getPlayer(state, "p1").hand[0];
        const result = manualReveal(state, card.id, ["p2", "p1"]);

        const revealed = findCardInState(result.state, card.id)!;
        expect(revealed.card.revealedTo).toEqual(
            expect.arrayContaining(["p1", "p2"])
        );
        expect(result.log.text).toContain("Alice reveals");
        expect(result.log.text).toContain("Bob");
        expect(result.log.text).toContain("Alice");
    });

    it("reveal: accumulates with previous reveals", () => {
        const state = freshState();
        const card = getPlayer(state, "p1").hand[0];
        const r1 = manualReveal(state, card.id, ["p2"]);
        const r2 = manualReveal(r1.state, card.id, ["p1"]);

        const revealed = findCardInState(r2.state, card.id)!;
        expect(revealed.card.revealedTo).toEqual(
            expect.arrayContaining(["p1", "p2"])
        );
    });
});
