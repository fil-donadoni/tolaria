// Face-down card preview — the copy treatment, generalized (issue #2904).
//
// CR 708.5: "At any time, you may look at a face-down spell you control on the
// stack or a face-down permanent you control." That entitlement is a SECOND
// preview face beside the anonymous one, never the board face and never the
// real card's text struck through on the primary face.
//
// Driven through the REAL wire projection (`projectPublicState`), per
// `.claude/rules/gre-development.md` § Frontend wiring analysis: a hand-built
// view would mask exactly the per-viewer gating this test exists to prove.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, fireEvent, act } from "@testing-library/react";
import { makeState, makeInstance } from "@convex/cards/__tests__/setup";
import { getCardByName, FACE_DOWN_CARD_ID } from "@convex/cards";
import { turnFaceDown } from "@convex/gre/faceDown";
import { exileFaceDownCard } from "@convex/gre/state";
import { projectPublicState } from "@convex/gameProjections";
import { GameContext } from "~/hooks/useGameContext";
import type { Id } from "@convex/_generated/dataModel";
import type { CardInstance } from "~/types/game";
import CardImage from "../card-image";
import { resetPreviewSingleton } from "../card-preview-singleton";

const SERRA = getCardByName("Serra Angel");

function ctxFor(allPlayers: unknown) {
    return {
        gameId: "g1" as Id<"games">,
        playerId: "p1",
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        phase: "PRECOMBAT_MAIN" as const,
        turn: 1,
        engineTurn: 1,
        stackCount: 0,
        stackItems: [],
        allPlayers: allPlayers as never,
        showAllCards: false,
        debugAllActions: false,
        onSwitchGame: () => {},
    };
}

function openPreview(root: HTMLElement) {
    act(() => {
        fireEvent.pointerDown(root, { button: 2 });
    });
    act(() => {
        fireEvent(window, new Event("pointerup"));
    });
}

const anchored = () =>
    document.querySelector(
        "[data-card-preview-anchored]"
    ) as HTMLElement | null;

/** The two-face composition's column whose label is `label` — the assertion
 *  has to be per-FACE, since the real card's name and text legitimately appear
 *  on the second one and would satisfy a panel-wide `toContain` from either. */
function faceColumn(panel: HTMLElement, label: string): HTMLElement {
    const tag = Array.from(panel.querySelectorAll("div")).find(
        (d) => d.textContent === label
    );
    expect(tag, `no preview face labeled "${label}"`).toBeTruthy();
    return tag!.parentElement as HTMLElement;
}

/** A face-down morph permanent on p1's battlefield, projected for `viewerId`. */
function projectFaceDownPermanent(viewerId: "p1" | "p2") {
    const morph = makeInstance(SERRA.id, {
        id: "fd-serra",
        controllerId: "p1",
        ownerId: "p1",
        zone: "battlefield",
    });
    turnFaceDown(morph, "morph");
    const base = makeState();
    const state = makeState({
        players: [
            { ...base.players[0], id: "p1", battlefield: [morph] },
            base.players[1],
        ],
    });
    const projected = projectPublicState(state, 1, viewerId);
    return {
        slim: projected.players[0].battlefield[0] as CardInstance,
        players: projected.players,
    };
}

describe("Face-down card preview (CR 708.5 / CR 406.3, issue #2904)", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        resetPreviewSingleton();
    });
    afterEach(() => {
        vi.runOnlyPendingTimers();
        vi.useRealTimers();
        cleanup();
    });

    it("gives the ENTITLED viewer two labeled faces: the anonymous object, and the real card beside it", () => {
        const { slim, players } = projectFaceDownPermanent("p1");
        // Sanity on the wire shape this whole feature branches on.
        expect(slim.card.id).toBe(FACE_DOWN_CARD_ID);
        expect(slim.faceDown).toBe(true);
        expect(slim.faceDownBy).toBe("morph");
        expect(slim.knownCardId).toBe(SERRA.id);

        const { container } = render(
            <GameContext value={ctxFor(players)}>
                <CardImage card={slim} />
            </GameContext>
        );
        openPreview(container.firstElementChild as HTMLElement);

        const panel = anchored();
        expect(panel).toBeTruthy();
        // PRIMARY face — the CR 708.2a object, honestly: no real name, no mana
        // cost, and none of Serra Angel's printed abilities (which the old
        // chimera rendered STRUCK THROUGH, since the instance carries the
        // vanilla characteristics and the ability differ marked every printed
        // one as lost).
        const primary = faceColumn(panel!, "Face down").textContent ?? "";
        expect(primary).not.toContain("Serra Angel");
        expect(primary).not.toContain("Vigilance");
        expect(primary).not.toContain("Flying");
        expect(primary).not.toContain("4/4");
        expect(primary).toContain("2/2");

        // SECONDARY face — the real card's pure printed identity (CR 708.5).
        const secondary = faceColumn(panel!, "Actual card").textContent ?? "";
        expect(secondary).toContain("Serra Angel");
        expect(secondary).toContain("4/4");
    });

    it("gives a NON-entitled viewer one anonymous face and no real identity in any form", () => {
        const { slim, players } = projectFaceDownPermanent("p2");
        expect(slim.knownCardId).toBeUndefined();
        expect(slim.faceDownOf).toBeUndefined();

        const { container } = render(
            <GameContext value={ctxFor(players)}>
                <CardImage card={slim} />
            </GameContext>
        );
        openPreview(container.firstElementChild as HTMLElement);

        const panel = anchored();
        // Criterion: a face-down card is never PREVIEW-LESS. The affordance is
        // present for this viewer too; only the number of faces differs.
        expect(panel).toBeTruthy();
        const text = panel!.textContent ?? "";
        expect(text).not.toContain("Serra Angel");
        expect(text).not.toContain("Actual card");
        // One face → no labels at all (the two-face composition adds them).
        expect(text).not.toContain("Face down");
    });

    it("a face-down EXILED card (CR 406.3) previews the same way for its knower", () => {
        const card = makeInstance(SERRA.id, {
            id: "fd-exiled",
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        });
        const base = makeState();
        const state = makeState({
            players: [
                { ...base.players[0], id: "p1", library: [card] },
                base.players[1],
            ],
        });
        exileFaceDownCard(state.players[0], "fd-exiled", "library", "p1");

        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].exile[0] as CardInstance;
        // The wire marker the client branches on — added by the projection,
        // never inferred from the absence of a sentinel id (criterion 5).
        expect(slim.faceDown).toBe(true);
        expect(slim.faceDownBy).toBe("face-down-exile");
        // The knower keeps the REAL id here: CR 406.3a lets them PLAY the card.
        expect(slim.card.id).toBe(SERRA.id);

        const { container } = render(
            <GameContext value={ctxFor(projected.players)}>
                <CardImage card={slim} />
            </GameContext>
        );
        openPreview(container.firstElementChild as HTMLElement);

        const text = anchored()!.textContent ?? "";
        expect(text).toContain("Face down");
        expect(text).toContain("Actual card");
        expect(text).toContain("Serra Angel");
        // CR 406.3a — "A card exiled face down has no characteristics": the
        // primary face is not a 2/2 creature, it is a card.
        expect(text).not.toContain("2/2");
    });
});
