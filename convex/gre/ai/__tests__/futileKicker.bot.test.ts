// Issue #6904 — `withoutFutileKickerVariants`: a Kicker whose only payoff is a
// gated targeted ETB trigger with no legal target (CR 603.3d) is dropped from
// the Bot's cast variants; a Kicker read anywhere else keeps its variants. The
// human/server cast path (`announceCast`) is untouched (CR 702.33a).

import { describe, expect, it } from "vitest";
import { buildPositionFromSpec } from "../blade/build";
import { enumerateMoves, type Move } from "../../moves";
import { getCardByName } from "../../../cards";
import type { ScenarioSpec } from "../../../debugScenarioSpec";
import type { GameState } from "../../state";
import { resolveKickerPayments } from "../../kicker";

function castsOf(state: GameState, name: string) {
    const pid = state.players[0].id;
    return enumerateMoves(state, pid).filter(
        (m): m is Extract<Move, { kind: "cast-spell" }> =>
            m.kind === "cast-spell" &&
            state.players[0].hand.find((c) => c.id === m.cardInstanceId)?.card
                .id === getCardByName(name).id
    );
}

const paid = (m: Extract<Move, { kind: "cast-spell" }>, id: string) =>
    (m.kickerPayments?.[id] ?? 0) > 0;

const BATTLEMAGE: ScenarioSpec = {
    cards: [
        { name: "Thornscape Battlemage", owner: "me", zone: "hand" },
        { name: "Forest", owner: "me", zone: "battlefield", count: 3 },
        { name: "Plains", owner: "me", zone: "battlefield" },
        { name: "Mountain", owner: "me", zone: "battlefield" },
    ],
    phase: "PRECOMBAT_MAIN",
    turn: 4,
    libraryCount: 20,
};

describe("futile Kicker prune (CR 702.33a / 603.3d)", () => {
    it("drops the {W}-paying variants with no artifact; keeps unkicked and {R}", () => {
        const casts = castsOf(
            buildPositionFromSpec(BATTLEMAGE),
            "Thornscape Battlemage"
        );
        expect(casts.some((m) => !m.kickerPayments)).toBe(true);
        expect(casts.some((m) => paid(m, "kicker-r"))).toBe(true);
        expect(casts.some((m) => paid(m, "kicker-w"))).toBe(false);
    });

    it("offers the {W}-kicked variants again with an artifact on the board", () => {
        const state = buildPositionFromSpec({
            ...BATTLEMAGE,
            cards: [
                ...BATTLEMAGE.cards,
                { name: "Sol Ring", owner: "opp", zone: "battlefield" },
            ],
        });
        const casts = castsOf(state, "Thornscape Battlemage");
        expect(casts.some((m) => paid(m, "kicker-w"))).toBe(true);
    });

    it("keeps every variant of a Kicker read by a spell effect", () => {
        const state = buildPositionFromSpec({
            cards: [
                { name: "Illuminate", owner: "me", zone: "hand" },
                {
                    name: "Mountain",
                    owner: "me",
                    zone: "battlefield",
                    count: 4,
                },
                { name: "Island", owner: "me", zone: "battlefield", count: 4 },
                { name: "Grizzly Bears", owner: "opp", zone: "battlefield" },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 6,
            libraryCount: 20,
        });
        const casts = castsOf(state, "Illuminate");
        expect(casts.some((m) => paid(m, "kicker-r"))).toBe(true);
        expect(casts.some((m) => paid(m, "kicker-u"))).toBe(true);
    });

    it("leaves the human cast path alone: the futile Kicker may still be announced", () => {
        // `resolveKickerPayments` is the validator `announceCast` runs on the
        // caster's declared payments — no Bot filter sits on it.
        const def = getCardByName("Thornscape Battlemage");
        expect(resolveKickerPayments(def, { "kicker-w": 1 })).toEqual({
            "kicker-w": 1,
        });
    });
});
