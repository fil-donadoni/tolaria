// The lobby's shared start/join gate (issue #2726). Ported from the gating
// half of the retired `dashboard-play-box.test.tsx`: the Play box owned both
// the gate and every gated action, so its tests could only ever assert the two
// together. The v4 lobby spends that gate on two surfaces (the Loadout's
// primary action + "Join by code", and the open-table rows), which is exactly
// why the rule now lives in one pure function with its own table of cases.
import { describe, it, expect } from "vitest";
import { lobbyActionGate } from "../lobbyGate";
import type { LobbyDeck } from "../deckTypes";

function deck(overrides: Partial<LobbyDeck> = {}): LobbyDeck {
    return {
        kind: "preset",
        presetId: "mono-red-burn",
        name: "Mono Red Burn",
        format: "old-school",
        colors: ["R"],
        cards: [{ id: "card-a", quantity: 4 }],
        sideboard: [],
        featuredCardId: null,
        isLegal: true,
        reasons: [],
        ...overrides,
    } as LobbyDeck;
}

const base = { busy: false, hasActiveGame: false } as const;

describe("lobbyActionGate (issue #2726)", () => {
    it("allows a legal Arena deck in Arena mode", () => {
        expect(
            lobbyActionGate({ deck: deck(), mode: "arena", ...base }).canAct
        ).toBe(true);
    });

    it("refuses with no deck selected at all", () => {
        const gate = lobbyActionGate({ deck: null, mode: "arena", ...base });
        expect(gate.canAct).toBe(false);
        // "No deck" is NOT "illegal deck" — the Loadout's chip tells them
        // apart, so the gate must too.
        expect(gate.deckLegal).toBe(true);
        expect(gate.deckMatchesMode).toBe(true);
    });

    it("refuses an illegal deck (ADR 0036, issue #512)", () => {
        const gate = lobbyActionGate({
            deck: deck({ isLegal: false }),
            mode: "arena",
            ...base,
        });
        expect(gate.deckLegal).toBe(false);
        expect(gate.canAct).toBe(false);
    });

    it("refuses a Manual Deck in Arena mode and a real deck in Cockatrice mode (ADR 0080)", () => {
        const manual = deck({ format: "manual" });
        expect(
            lobbyActionGate({ deck: manual, mode: "arena", ...base })
                .deckMatchesMode
        ).toBe(false);
        expect(
            lobbyActionGate({ deck: manual, mode: "arena", ...base }).canAct
        ).toBe(false);
        expect(
            lobbyActionGate({ deck: deck(), mode: "cockatrice", ...base })
                .deckMatchesMode
        ).toBe(false);
        expect(
            lobbyActionGate({ deck: deck(), mode: "cockatrice", ...base })
                .canAct
        ).toBe(false);
    });

    it("refuses an EMPTY Manual Deck even though the manual Format validates nothing", () => {
        const gate = lobbyActionGate({
            deck: deck({ format: "manual", cards: [] }),
            mode: "cockatrice",
            ...base,
        });
        // The tell that this is the interesting case: it is "legal" and it
        // matches the mode, and it still must not start a game.
        expect(gate.deckLegal).toBe(true);
        expect(gate.deckMatchesMode).toBe(true);
        expect(gate.manualDeckHasCards).toBe(false);
        expect(gate.canAct).toBe(false);
    });

    it("allows a non-empty Manual Deck in Cockatrice mode", () => {
        expect(
            lobbyActionGate({
                deck: deck({ format: "manual" }),
                mode: "cockatrice",
                ...base,
            }).canAct
        ).toBe(true);
    });

    it("refuses while another action is in flight, and while a game is already held (#155)", () => {
        expect(
            lobbyActionGate({
                deck: deck(),
                mode: "arena",
                busy: true,
                hasActiveGame: false,
            }).canAct
        ).toBe(false);
        expect(
            lobbyActionGate({
                deck: deck(),
                mode: "arena",
                busy: false,
                hasActiveGame: true,
            }).canAct
        ).toBe(false);
    });
});
