// CR 202.2 — a `permanent-guard` narrowed by the COLOUR of the targeting
// source (`targetSourceColorFilter`, issue #2120). Raiding Party: "This
// enchantment can't be the target of white spells or abilities from white
// sources." A spell is its own source; an ability's source is the object that
// generated it (CR 113.7), so one colour filter covers both halves of the line.
//
// Three layers, each through the real authority: the predicate itself
// (`isGuardedAgainst`), its colour word read through a text change on the
// guarding permanent (CR 612.1, Sleight of Mind), and the CR 608.2b
// resolution re-check judging the source by its LIVE colour.

import { describe, expect, it } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup.helper";
import { isGuardedAgainst } from "../permanentGuard";
import { resolveTopOfStack, type GameState } from "../state";
import { raidingParty } from "../../cards/sets/fem/red.cards";
import { desertTwister } from "../../cards/sets/arn/green.cards";
import { sleightOfMind } from "../../cards/sets/lea/blue.cards";
import type { CardInstanceState } from "../state";

/** p2 controls Raiding Party (`party`); p1 controls nothing. */
function boardWithParty(extra: Partial<CardInstanceState> = {}): GameState {
    const party = makeInstance(raidingParty().id, {
        id: "party",
        controllerId: "p2",
        ownerId: "p2",
        ...extra,
    });
    return makeState({
        players: [makePlayer("p1"), makePlayer("p2", { battlefield: [party] })],
    });
}

function partyOf(state: GameState): CardInstanceState | undefined {
    return state.players[1].battlefield.find((c) => c.id === "party");
}

describe("CR 202.2 — targetSourceColorFilter in isGuardedAgainst (Raiding Party)", () => {
    const guarded = (state: GameState, colors?: string[], isSpell = true) =>
        isGuardedAgainst(state, partyOf(state)!, "cantBeTargeted", {
            types: ["Instant"],
            isSpell,
            colors: colors as never,
            controllerId: "p1",
        });

    it("bars a white spell", () => {
        expect(guarded(boardWithParty(), ["W"])).toBe(true);
    });

    it("bars an ability from a white source (CR 113.7)", () => {
        expect(guarded(boardWithParty(), ["W"], false)).toBe(true);
    });

    it("bars a multicolour source that includes white", () => {
        expect(guarded(boardWithParty(), ["W", "U"])).toBe(true);
    });

    it("must-NOT — a non-white source is not barred", () => {
        expect(guarded(boardWithParty(), ["G"])).toBe(false);
    });

    it("must-NOT — a colourless source is not barred (CR 105.2c)", () => {
        expect(guarded(boardWithParty(), [])).toBe(false);
        expect(guarded(boardWithParty(), undefined)).toBe(false);
    });
});

describe("CR 612.1 — the guard's colour word reads through a text change", () => {
    const whiteToBlue = {
        textChangeHolds: [
            {
                change: {
                    kind: "color-word" as const,
                    from: "white",
                    to: "blue",
                },
                seq: 1,
            },
        ],
    };

    it("white → blue on Raiding Party bars BLUE sources instead", () => {
        const state = boardWithParty(whiteToBlue);
        const party = partyOf(state)!;
        const bars = (colors: ("W" | "U")[]) =>
            isGuardedAgainst(state, party, "cantBeTargeted", {
                isSpell: true,
                colors,
                controllerId: "p1",
            });
        expect(bars(["U"])).toBe(true);
        expect(bars(["W"])).toBe(false);
    });
});

describe("CR 612.1 — Sleight of Mind can name the guard's colour word", () => {
    it("resolving Sleight of Mind (white → blue) on Raiding Party re-keys the guard to blue", () => {
        const state = boardWithParty();
        const spell = pushSpell(state, sleightOfMind().id, "p1", [
            { type: "permanent", id: "party" },
        ]);
        spell.chosenModeIds = ["blue"];
        resolveTopOfStack(state);

        const party = partyOf(state)!;
        const bars = (colors: ("W" | "U")[]) =>
            isGuardedAgainst(state, party, "cantBeTargeted", {
                isSpell: true,
                colors,
                controllerId: "p1",
            });
        expect(bars(["U"])).toBe(true);
        expect(bars(["W"])).toBe(false);
    });
});

describe("CR 608.2b — the source's LIVE colour is judged at resolution", () => {
    it("a green spell that turned WHITE in response is countered; the enchantment survives", () => {
        const state = boardWithParty();
        const spell = pushSpell(state, desertTwister().id, "p1", [
            { type: "permanent", id: "party" },
        ]);
        // CR 105.3 — a colour-setting effect makes the spell white after it
        // was legally announced as a green spell.
        spell.colorOverride = ["W"];
        resolveTopOfStack(state);

        expect(partyOf(state)).toBeDefined();
        expect(state.stack).toHaveLength(0);
    });

    it("must-NOT — the same green spell, still green, destroys it", () => {
        const state = boardWithParty();
        pushSpell(state, desertTwister().id, "p1", [
            { type: "permanent", id: "party" },
        ]);
        resolveTopOfStack(state);

        expect(partyOf(state)).toBeUndefined();
    });
});
