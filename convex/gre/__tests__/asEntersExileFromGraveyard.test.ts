// The as-enters GRAVEYARD EXILE leg (CR 614.1c / 614.12a / 607.2b, issue
// #6528): "As this creature enters, exile any number of creature cards from
// your graveyard" (Sutured Ghoul).
//
//   614.12a If a replacement effect that modifies how a permanent enters the
//           battlefield requires a choice, that choice is made before the
//           permanent enters the battlefield.
//   607.2b  … an ability … that generates a replacement effect which causes
//           one or more cards to be exiled and an ability … that refers … to
//           cards "exiled with [this object]" … are linked.
//
// The trap this file pins: the exile happens BEFORE the permanent exists, and
// every battlefield-entry funnel drops exile links pointing at the entering id
// (CR 400.7, `clearExileLinksToEnteringSource`). Left in the entry tail, that
// clear erased the pile the answer had just made. The clear now runs when the
// entry is PARKED, so a previous incarnation's links still die and this one's
// survive.
//
// Sutured Ghoul's characteristic-defining P/T reads the pile through PR #6514
// (issue #5367), not yet on base: the hand-built definition
// (`suturedGhoulProbe.fixture.ts`) is printed 2/2 so the sweep does not bin
// it, and the pile is read straight off the CR 607 authority
// (`getCardsExiledWith`).
import { describe, expect, it } from "vitest";
import {
    putReanimatedSetOnBattlefield,
    resolveTopOfStack,
    type CardInstanceState,
    type GameState,
} from "../state";
import { applyPendingChoiceSubmit } from "../pendingChoiceSubmit";
import { compactState, expandState } from "../serialize";
import { getCardsExiledWith } from "../exileLinks";
import { applyPlayLand } from "../playLand";
import { projectPublicState } from "../../gameProjections";
import type { GameEvent } from "../../cards/types";
import { withTemporaryDefinition } from "../../cards/registry";
import type { CardDefinition } from "../../cards/types";
import { GHOUL_ID, suturedGhoul } from "./fixtures/suturedGhoulProbe.fixture";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup.helper";
import {
    forest,
    grizzlyBears,
    serraAngel,
} from "../../cards/sets/lea/index.cards";

const withGhoul = <T>(fn: () => T): T =>
    withTemporaryDefinition(suturedGhoul, fn);

// --- Helpers ---------------------------------------------------------------

function gy(defId: string, id: string, owner = "p1"): CardInstanceState {
    return makeInstance(defId, {
        id,
        controllerId: owner,
        ownerId: owner,
        zone: "graveyard",
    });
}

function exiled(defId: string, id: string, linkedTo?: string) {
    return makeInstance(defId, {
        id,
        controllerId: "p1",
        ownerId: "p1",
        zone: "exile",
        ...(linkedTo ? { exiledBySourceId: linkedTo } : {}),
    });
}

/** p1's graveyard: two creature cards and a land; p2's: one creature card. */
function board(extra: { exile?: CardInstanceState[] } = {}): GameState {
    return makeState({
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        players: [
            makePlayer("p1", {
                graveyard: [
                    gy(grizzlyBears().id, "bears"),
                    gy(forest().id, "forest"),
                    gy(serraAngel().id, "angel"),
                ],
                exile: extra.exile ?? [],
            }),
            makePlayer("p2", {
                graveyard: [gy(grizzlyBears().id, "opp-bears", "p2")],
            }),
        ],
    });
}

function head(state: GameState) {
    return (state.pendingChoices ?? [])[0];
}

/** Answers the head as-enters prompt through the REAL submit path. */
function answer(state: GameState, ids: string[]): void {
    const h = head(state);
    applyPendingChoiceSubmit(state, {
        playerId: h.playerId,
        stackItemId: h.stackItemId,
        step: h.step,
        choiceId: h.choiceId,
        cardInstanceIds: ids,
    });
}

function castGhoul(state: GameState): string {
    const spell = pushSpell(state, GHOUL_ID, "p1");
    resolveTopOfStack(state);
    return spell.id;
}

function reanimate(state: GameState, id: string): void {
    const yard = state.players[0].graveyard;
    const [card] = yard.splice(
        yard.findIndex((c) => c.id === id),
        1
    );
    putReanimatedSetOnBattlefield(state, [{ card, controllerId: "p1" }]);
}

const pileOf = (state: GameState, sourceId: string): string[] =>
    getCardsExiledWith(state, sourceId)
        .map((e) => e.card.id)
        .sort();

const onBattlefield = (state: GameState, id: string): boolean =>
    state.players[0].battlefield.some((c) => c.id === id);

// --- Cast path ---------------------------------------------------------------

describe("as-enters exileFromGraveyard — cast (CR 614.12a / 607.2b, issue #6528)", () => {
    it("offers the controller's own matching graveyard cards, any number, before the permanent exists", () => {
        withGhoul(() => {
            const state = board();
            const ghoulId = castGhoul(state);

            const h = head(state);
            expect(h.kind).toBe("choose-graveyard-card");
            expect(h.asEntersKind).toBe("exileFromGraveyard");
            expect(h.zone).toBe("graveyard");
            expect(h.playerId).toBe("p1");
            // The filter excludes the land; the opponent's graveyard is not
            // "your graveyard".
            expect(h.candidateIds).toEqual(["bears", "angel"]);
            expect(h.count).toEqual({ min: 0, max: 2 });
            // CR 614.12a — the choice comes first: nothing has entered.
            expect(onBattlefield(state, ghoulId)).toBe(false);
        });
    });

    it("exiles the picks linked to the permanent, and the pile survives its entry", () => {
        withGhoul(() => {
            const state = board();
            const ghoulId = castGhoul(state);

            answer(state, ["bears", "angel"]);

            expect(onBattlefield(state, ghoulId)).toBe(true);
            expect(state.players[0].graveyard.map((c) => c.id)).toEqual([
                "forest",
            ]);
            // CR 607.2b — the linked pile, read through the one authority.
            expect(pileOf(state, ghoulId)).toEqual(["angel", "bears"]);
            expect(state.pendingChoices ?? []).toHaveLength(0);
        });
    });

    it("one instruction is one CARDS_EXILED event (CR 603.2c)", () => {
        withGhoul(() => {
            const state = board();
            castGhoul(state);
            // The finalize drains `pendingEvents` into the trigger scan before
            // `answer` returns, so every write to the queue is recorded.
            const seen: GameEvent[] = [];
            let queue = state.pendingEvents;
            Object.defineProperty(state, "pendingEvents", {
                configurable: true,
                get: () => queue,
                set: (next: GameEvent[] | undefined) => {
                    const prior = queue ?? [];
                    seen.push(
                        ...(next ?? []).filter((e) => !prior.includes(e))
                    );
                    queue = next;
                },
            });

            answer(state, ["bears", "angel"]);

            const events = seen.filter(
                (e): e is Extract<GameEvent, { type: "CARDS_EXILED" }> =>
                    e.type === "CARDS_EXILED"
            );
            expect(events).toHaveLength(1);
            const cards = events[0].cards.map((c) => c.cardInstanceId);
            expect(cards).toEqual(["bears", "angel"]);
        });
    });

    it("zero is a legal number: the permanent enters with an empty pile", () => {
        withGhoul(() => {
            const state = board();
            const ghoulId = castGhoul(state);

            answer(state, []);

            expect(onBattlefield(state, ghoulId)).toBe(true);
            expect(pileOf(state, ghoulId)).toEqual([]);
            expect(state.players[0].graveyard).toHaveLength(3);
        });
    });

    it("no matching card — auto-answered with zero, never a prompt", () => {
        withGhoul(() => {
            const state = board();
            state.players[0].graveyard = [gy(forest().id, "forest")];
            const ghoulId = castGhoul(state);

            expect(state.pendingChoices ?? []).toHaveLength(0);
            expect(onBattlefield(state, ghoulId)).toBe(true);
            expect(pileOf(state, ghoulId)).toEqual([]);
        });
    });

    it("fail-closed: a pick that left the graveyard after the offer is skipped, not moved", () => {
        withGhoul(() => {
            const state = board();
            const ghoulId = castGhoul(state);
            // The angel leaves for the hand while the prompt is open.
            const yard = state.players[0].graveyard;
            const [angel] = yard.splice(
                yard.findIndex((c) => c.id === "angel"),
                1
            );
            angel.zone = "hand";
            state.players[0].hand.push(angel);

            answer(state, ["bears", "angel"]);

            expect(pileOf(state, ghoulId)).toEqual(["bears"]);
            expect(state.players[0].hand.map((c) => c.id)).toContain("angel");
        });
    });
});

// --- Non-cast path, CR 400.7 -------------------------------------------------

describe("as-enters exileFromGraveyard — put onto the battlefield (CR 400.7, issue #6528)", () => {
    it("a previous incarnation's links are dropped, this entry's pile is kept", () => {
        withGhoul(() => {
            // "old" was exiled with the Ghoul in a previous battlefield
            // existence: CR 400.7 makes the returning Ghoul a new object.
            const state = board({
                exile: [exiled(grizzlyBears().id, "old", "ghoul")],
            });
            state.players[0].graveyard.push(gy(GHOUL_ID, "ghoul"));

            reanimate(state, "ghoul");
            expect(head(state).asEntersKind).toBe("exileFromGraveyard");
            answer(state, ["angel"]);

            expect(onBattlefield(state, "ghoul")).toBe(true);
            expect(pileOf(state, "ghoul")).toEqual(["angel"]);
        });
    });

    it("two entering together: the second prompt shrinks to what the first left", () => {
        withGhoul(() => {
            const state = board();
            const a = gy(GHOUL_ID, "ghoul-a");
            const b = gy(GHOUL_ID, "ghoul-b");
            putReanimatedSetOnBattlefield(state, [
                { card: a, controllerId: "p1" },
                { card: b, controllerId: "p1" },
            ]);
            expect(state.pendingChoices).toHaveLength(2);
            expect(state.pendingChoices![1].candidateIds).toEqual([
                "bears",
                "angel",
            ]);

            answer(state, ["bears"]);

            expect(head(state).asEntersCardId).toBe("ghoul-b");
            expect(head(state).candidateIds).toEqual(["angel"]);
            expect(head(state).count).toEqual({ min: 0, max: 1 });

            answer(state, ["angel"]);
            expect(pileOf(state, "ghoul-a")).toEqual(["bears"]);
            expect(pileOf(state, "ghoul-b")).toEqual(["angel"]);
        });
    });
});

// --- Played land (the third entry funnel) ------------------------------------

/** A land declaring the same clause unfiltered: the play-a-land funnel
 *  (`settleEnteredLand`) is the third that drops exile links on entry. */
const LAND_ID = "test-6528-exile-land";
const exileLand: CardDefinition = {
    id: LAND_ID,
    rarity: "common",
    name: "Test 6528 Exile Land",
    oracleText:
        "As this land enters, exile any number of cards from your graveyard.",
    manaCost: {},
    types: ["Land"],
    entersWith: { asEnters: [{ kind: "exileFromGraveyard" }] },
};

describe("as-enters exileFromGraveyard — played land (CR 305.1 / 614.12a, issue #6528)", () => {
    it("a replayed land keeps this entry's pile and drops its previous one", () => {
        withTemporaryDefinition(exileLand, () => {
            const state = board({
                exile: [exiled(grizzlyBears().id, "old", "land")],
            });
            const land = makeInstance(LAND_ID, {
                id: "land",
                controllerId: "p1",
                ownerId: "p1",
                zone: "hand",
            });
            state.players[0].hand.push(land);

            applyPlayLand(state, state.players[0], "land");
            expect(head(state).asEntersKind).toBe("exileFromGraveyard");
            // Unfiltered: the land card is as good a pick as a creature card.
            expect(head(state).candidateIds).toEqual([
                "bears",
                "forest",
                "angel",
            ]);
            answer(state, ["forest"]);

            expect(onBattlefield(state, "land")).toBe(true);
            expect(pileOf(state, "land")).toEqual(["forest"]);
        });
    });
});

// --- Wire + persistence ------------------------------------------------------

describe("as-enters exileFromGraveyard — projection and save point (issue #6528)", () => {
    it("the prompt crosses the wire with its allow-list, and the pile pins to the permanent", () => {
        withGhoul(() => {
            const state = board();
            const ghoulId = castGhoul(state);

            const before = projectPublicState(state, 1, "p1");
            const h = before.pendingChoices![0];
            expect(h.kind).toBe("choose-graveyard-card");
            expect(h.asEntersKind).toBe("exileFromGraveyard");
            expect(h.zone).toBe("graveyard");
            expect(h.candidateIds).toEqual(["bears", "angel"]);
            expect(h.count).toEqual({ min: 0, max: 2 });

            answer(state, ["bears", "angel"]);

            const after = projectPublicState(state, 1, "p2");
            const exile = after.players[0].exile;
            for (const id of ["bears", "angel"]) {
                expect(
                    exile.find((c) => c.id === id)?.exiledByPermanentId
                ).toBe(ghoulId);
            }
        });
    });

    it("the outstanding choice survives the DB round-trip, and the reload answers it", () => {
        withGhoul(() => {
            const state = board();
            const ghoulId = castGhoul(state);

            const reloaded = expandState(compactState(state));
            expect(reloaded.stagedEntries![0].owed).toEqual([
                { kind: "exileFromGraveyard", filter: { type: "Creature" } },
            ]);

            answer(reloaded, ["angel"]);
            expect(onBattlefield(reloaded, ghoulId)).toBe(true);
            expect(pileOf(reloaded, ghoulId)).toEqual(["angel"]);
        });
    });
});
