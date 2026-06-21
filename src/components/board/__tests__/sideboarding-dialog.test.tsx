// Sideboarding step editor: the Ready gate (blocked until the Maindeck returns
// to its locked size; enabled at a valid partition) and the Maindeck↔Sideboard
// swap action (issue #395). See `../sideboarding-dialog`.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, within } from "@testing-library/react";
import type { PublicMatch } from "@convex/matches";
import SideboardingDialog from "../sideboarding-dialog";

const submitSideboard = vi.fn(() => Promise.resolve(undefined));
const setReady = vi.fn(() => Promise.resolve({ gameId: null }));

vi.mock("convex/react", () => ({
    useMutation: (ref: { _name: string }) =>
        ref._name === "submitSideboard" ? submitSideboard : setReady,
}));
vi.mock("@convex/_generated/api", () => ({
    api: {
        game: {
            submitSideboard: { _name: "submitSideboard" },
            setReady: { _name: "setReady" },
        },
    },
}));

function card(id: string) {
    return { cardId: id, cardName: id };
}

function baseMatch(overrides: Partial<PublicMatch> = {}): PublicMatch {
    return {
        matchId: "m1" as PublicMatch["matchId"],
        bestOf: 3,
        status: "sideboarding",
        currentGameNumber: 1,
        solo: false,
        vsAi: false,
        players: [
            {
                id: "me",
                name: "Me",
                bgColor: "#000",
                score: 0,
                ready: false,
                deck: {
                    id: "d",
                    name: "Deck",
                    format: "vintage",
                    maindeck: [card("m1"), card("m2")],
                    sideboard: [card("s1")],
                },
            },
            {
                id: "opp",
                name: "Opp",
                bgColor: "#111",
                score: 1,
                ready: false,
            },
        ],
        ...overrides,
    };
}

describe("SideboardingDialog Ready gate (issue #395)", () => {
    beforeEach(() => {
        submitSideboard.mockClear();
        setReady.mockClear();
    });

    it("Ready is enabled at the locked size and dispatches submit + ready", async () => {
        const { getByRole } = render(
            <SideboardingDialog match={baseMatch()} viewerId="me" />
        );
        const ready = getByRole("button", {
            name: "Ready",
        }) as HTMLButtonElement;
        // No swaps yet → Maindeck still at the locked size of 2 → enabled.
        expect(ready.disabled).toBe(false);
        fireEvent.click(ready);
        await Promise.resolve();
        expect(submitSideboard).toHaveBeenCalledOnce();
        expect(setReady).toHaveBeenCalledOnce();
    });

    it("Ready is blocked while the Maindeck size differs from the lock", () => {
        const { getByRole, getAllByRole } = render(
            <SideboardingDialog match={baseMatch()} viewerId="me" />
        );
        // Move one card out of the Maindeck → size 1 ≠ locked 2.
        const toSide = getAllByRole("button", { name: "→ Side" })[0];
        fireEvent.click(toSide);
        const ready = getByRole("button", {
            name: "Ready",
        }) as HTMLButtonElement;
        expect(ready.disabled).toBe(true);
    });

    it("swapping a card back to the Maindeck re-enables Ready", () => {
        const { getByRole, getAllByRole } = render(
            <SideboardingDialog match={baseMatch()} viewerId="me" />
        );
        // out then bring a Sideboard card in → size back to 2.
        fireEvent.click(getAllByRole("button", { name: "→ Side" })[0]);
        fireEvent.click(getAllByRole("button", { name: "→ Main" })[0]);
        const ready = getByRole("button", {
            name: "Ready",
        }) as HTMLButtonElement;
        expect(ready.disabled).toBe(false);
    });

    it("shows a play/draw chooser only for the previous Game's loser", () => {
        const { queryByRole, rerender } = render(
            <SideboardingDialog
                match={baseMatch({ playDrawChooserId: "opp" })}
                viewerId="me"
            />
        );
        // Viewer is NOT the chooser → no Play button.
        expect(queryByRole("button", { name: "Play" })).toBeNull();
        rerender(
            <SideboardingDialog
                match={baseMatch({ playDrawChooserId: "me" })}
                viewerId="me"
            />
        );
        expect(queryByRole("button", { name: "Play" })).not.toBeNull();
    });

    it("shows a waiting notice when the viewer has no seat to sideboard", () => {
        // The projection strips the opponent's deck contents; a viewer whose own
        // seat carries no deck copy (e.g. already submitted, waiting on the
        // other player) has nothing to edit → waiting state.
        const m = baseMatch();
        m.players = m.players.map((p) => ({ ...p, deck: undefined }));
        const { getByText } = render(
            <SideboardingDialog match={m} viewerId="me" />
        );
        expect(getByText(/waiting/i)).toBeTruthy();
        // sanity: the editor's swap controls are absent
        expect(
            within(document.body).queryByRole("button", { name: "Ready" })
        ).toBeNull();
    });
});

describe("SideboardingDialog opponent ready-state (issue #397)", () => {
    it("shows the opponent's 'sideboarding…' indicator in a 2-player Match", () => {
        // Opponent not yet ready → editor shows the live opponent status.
        const { getByText } = render(
            <SideboardingDialog match={baseMatch()} viewerId="me" />
        );
        expect(getByText(/sideboarding…/i)).toBeTruthy();
        // The opponent is identified by name in the indicator.
        expect(getByText(/Opp/)).toBeTruthy();
    });

    it("shows the opponent's 'ready' indicator once they have readied", () => {
        const m = baseMatch();
        m.players = m.players.map((p) =>
            p.id === "opp" ? { ...p, ready: true } : p
        );
        const { getByText, queryByText } = render(
            <SideboardingDialog match={m} viewerId="me" />
        );
        // Viewer still editing → editor visible, opponent shown as ready. The
        // indicator uses a lowercase "ready" badge (distinct from the "Ready"
        // submit button); match it exactly.
        expect(getByText("ready")).toBeTruthy();
        expect(queryByText(/sideboarding…/i)).toBeNull();
    });

    it("once the viewer readies, it shows the both-ready waiting barrier", () => {
        // The viewer's own seat is ready but the opponent isn't → the editor is
        // replaced by the waiting barrier (no Ready button, opponent status).
        const m = baseMatch();
        m.players = m.players.map((p) =>
            p.id === "me" ? { ...p, ready: true } : p
        );
        const { getByText, queryByRole } = render(
            <SideboardingDialog match={m} viewerId="me" />
        );
        expect(getByText(/You are ready/i)).toBeTruthy();
        expect(getByText(/both players are ready/i)).toBeTruthy();
        // The editor's Ready button is gone — the swap can't change post-ready.
        expect(queryByRole("button", { name: "Ready" })).toBeNull();
    });

    it("does NOT show an opponent indicator in Solo", () => {
        const m = baseMatch({ solo: true });
        // Solo: both seats carry decks; the viewer drives both — no human
        // opponent indicator.
        m.players = [
            {
                id: "u-p1",
                name: "P1",
                bgColor: "#000",
                score: 0,
                ready: false,
                deck: {
                    id: "d",
                    name: "Deck",
                    format: "vintage",
                    maindeck: [card("m1"), card("m2")],
                    sideboard: [card("s1")],
                },
            },
            {
                id: "u-p2",
                name: "P2",
                bgColor: "#111",
                score: 1,
                ready: false,
                deck: {
                    id: "d2",
                    name: "Deck2",
                    format: "vintage",
                    maindeck: [card("n1"), card("n2")],
                    sideboard: [card("t1")],
                },
            },
        ];
        const { queryByText } = render(
            <SideboardingDialog match={m} viewerId="u" />
        );
        expect(queryByText(/sideboarding…/i)).toBeNull();
    });
});
