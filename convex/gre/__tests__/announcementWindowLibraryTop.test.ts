// CR 401.5 sentences 2-3 — the announcement-window freeze on revealed and
// looked-at library tops: "If the top card of the player's library changes
// while a spell is being cast, the new top card won't be revealed and can't be
// looked at until the spell becomes cast" (CR 601.2i); the same for an ability
// being activated and a special action being taken.
//
// The window is derived from the announcement containers; its record (the tops
// before it opened) is kept by `syncAnnouncementWindow`, the persistence seam's
// one call. These tests drive that call and then read the two derivations every
// consumer goes through (the wire projection and the Bot's determinization).

import { describe, expect, it } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { bolassCitadel } from "../../cards/sets/war/black.cards";
import { forest, island, mountain } from "../../cards/sets/lea/colorless.cards";
import {
    computeLibraryTopLookedAtPlayers,
    computeLibraryTopRevealedPlayers,
    isAnnouncementWindowOpen,
    syncAnnouncementWindow,
} from "../libraryReveal";
import { drawCard, type GameState } from "../state";
import { projectPublicState } from "../../gameProjections";
import { getDefinition } from "../../cards/index";

const goblinSpy = () => getDefinition("2a89a099-8805-4b26-babd-5d9f48ee406a");

function board(sourceId: string): GameState {
    return makeState({
        players: [
            makePlayer("p1", {
                battlefield: [
                    makeInstance(sourceId, {
                        id: "source",
                        controllerId: "p1",
                        ownerId: "p1",
                    }),
                ],
                library: [mountain().id, forest().id, island().id].map(
                    (cardId, i) =>
                        makeInstance(cardId, {
                            id: `p1-lib-${i}`,
                            controllerId: "p1",
                            ownerId: "p1",
                            zone: "library",
                        })
                ),
            }),
            makePlayer("p2"),
        ],
        phase: "PRECOMBAT_MAIN",
        activePlayerId: "p1",
        priorityPlayerId: "p1",
    });
}

/** A spell parked in its payment step (CR 601.2g-h). */
function openCast(state: GameState): void {
    state.pendingCast = {
        playerId: "p1",
        cardInstanceId: "spell",
        manaCost: { G: 1 },
        tappedLandIds: [],
        keepPriority: false,
    };
}

/** Persist a stable point: the seam reads the snapshot saved before it. */
function save(state: GameState, previous: GameState): GameState {
    syncAnnouncementWindow(state, previous);
    return structuredClone(state);
}

describe("announcement window (CR 401.5, CR 601.2i)", () => {
    it("is open while a spell is cast, an ability activated or a companion summoned, and for their target steps only", () => {
        const state = board(goblinSpy().id);
        expect(isAnnouncementWindowOpen(state)).toBe(false);
        openCast(state);
        expect(isAnnouncementWindowOpen(state)).toBe(true);
        state.pendingCast = undefined;
        state.pendingCompanionPay = {
            playerId: "p1",
            manaCost: { X: 3 },
            tappedLandIds: [],
        };
        expect(isAnnouncementWindowOpen(state)).toBe(true);
        state.pendingCompanionPay = undefined;
        const target = {
            playerId: "p1",
            cardInstanceId: "spell",
            targetType: "Creature" as const,
            count: 1,
            selected: [],
        };
        // CR 601.2c — a cast's own target step (no kind = a cast).
        state.pendingTarget = target;
        expect(isAnnouncementWindowOpen(state)).toBe(true);
        state.pendingTarget = { ...target, kind: "ability" };
        expect(isAnnouncementWindowOpen(state)).toBe(true);
        // CR 603.3d — a trigger's targets are chosen outside any announcement.
        state.pendingTarget = { ...target, kind: "trigger" };
        expect(isAnnouncementWindowOpen(state)).toBe(false);
        state.pendingTarget = { ...target, kind: "retarget" };
        expect(isAnnouncementWindowOpen(state)).toBe(false);
    });

    it("an unchanged top stays revealed through the window", () => {
        const before = board(goblinSpy().id);
        const during = structuredClone(before);
        openCast(during);
        const saved = save(during, before);
        expect(saved.announcementLibraryTops).toEqual(["p1-lib-0"]);
        expect(computeLibraryTopRevealedPlayers(saved).has("p1")).toBe(true);
    });

    it("a NEW top is not revealed until the spell becomes cast (CR 401.5 s2)", () => {
        const before = board(goblinSpy().id);
        const opened = structuredClone(before);
        openCast(opened);
        const parked = save(opened, before);

        // The top changes mid-window; the next stable point carries the record.
        const moved = structuredClone(parked);
        drawCard(moved.players[0]);
        const frozen = save(moved, parked);
        expect(computeLibraryTopRevealedPlayers(frozen).has("p1")).toBe(false);
        // Neither seat sees the new top on the wire, nor the record's ids.
        for (const viewer of ["p1", "p2"]) {
            const projected = projectPublicState(frozen, 3, viewer);
            const library = projected.players[0].library as {
                known: { index: number }[];
            };
            expect(library.known).toEqual([]);
            expect(projected.announcementLibraryTops).toBeUndefined();
        }

        // CR 601.2i — the spell becomes cast: the window closes, its record goes.
        const cast = structuredClone(frozen);
        cast.pendingCast = undefined;
        const after = save(cast, frozen);
        expect(after.announcementLibraryTops).toBeUndefined();
        expect(computeLibraryTopRevealedPlayers(after).has("p1")).toBe(true);
    });

    it("the record is the top BEFORE the opening action, so a move in that same action is frozen out too", () => {
        const before = board(goblinSpy().id);
        const opened = structuredClone(before);
        drawCard(opened.players[0]);
        openCast(opened);
        const saved = save(opened, before);
        expect(saved.announcementLibraryTops).toEqual(["p1-lib-0"]);
        expect(computeLibraryTopRevealedPlayers(saved).has("p1")).toBe(false);
    });

    it("the freeze binds a look-at-top permission too, not only a reveal", () => {
        const before = board(bolassCitadel().id);
        expect(computeLibraryTopLookedAtPlayers(before).has("p1")).toBe(true);
        const opened = structuredClone(before);
        openCast(opened);
        const parked = save(opened, before);
        const moved = structuredClone(parked);
        drawCard(moved.players[0]);
        const frozen = save(moved, parked);
        expect(computeLibraryTopLookedAtPlayers(frozen).has("p1")).toBe(false);
    });
});
