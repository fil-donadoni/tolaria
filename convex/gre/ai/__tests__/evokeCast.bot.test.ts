// Issue #9864 — `isEvokeCast` names the bot's own cast of a card for its evoke
// cost (CR 702.74a: an alternative cost, and the permanent is sacrificed as it
// enters), so the search keeps it out of the rollout's random draw and out of
// the tree below the root. The `pass` subtree then no longer reads as "evoke a
// little later".

import { describe, expect, it } from "vitest";
import type { ScenarioSpec } from "../../../debugScenarioSpec";
import type { Move } from "../../moves";
import { enumerateMoves } from "../../moves";
import { buildStateFromScenario } from "../../scenarioBuilder";
import { isEvokeCast } from "../../search";
import { buildBladeBaseState } from "../blade/baseState";
import { findBladeScenario } from "../blade/registry";
import { runBladeScenario } from "../blade/runner";

const position = (cards: ScenarioSpec["cards"]) => {
    const base = buildBladeBaseState();
    const meId = base.players[0]!.id;
    const state = buildStateFromScenario(
        base,
        {
            cards,
            phase: "PRECOMBAT_MAIN",
            turn: 5,
            landCount: 0,
            libraryCount: 20,
        },
        meId
    );
    const oppId = state.players.find((p) => p.id !== meId)!.id;
    const casts = enumerateMoves(state, meId).filter(
        (m): m is Extract<Move, { kind: "cast-spell" }> =>
            m.kind === "cast-spell"
    );
    return { state, meId, oppId, casts };
};

const ornithopter: ScenarioSpec["cards"][number] = {
    name: "Ornithopter",
    owner: "opp",
    zone: "battlefield",
    summoningSick: false,
};

describe("isEvokeCast (issue #9864, CR 702.74a)", () => {
    it("names the bot's own evoke cast that pitches a card", () => {
        const { state, meId, casts } = position([
            { name: "Solitude", owner: "me", zone: "hand" },
            { name: "Savannah Lions", owner: "me", zone: "hand" },
            ornithopter,
        ]);
        const evoke = casts.filter((m) => m.alternativeCostId);
        expect(evoke.length).toBeGreaterThan(0);
        for (const m of evoke) {
            expect(isEvokeCast(state, meId, meId, m)).toBe(true);
        }
    });

    it("names an evoke cast paid with mana", () => {
        const { state, meId, casts } = position([
            { name: "Wistfulness", owner: "me", zone: "hand" },
            { name: "Island", owner: "me", zone: "battlefield", count: 2 },
        ]);
        const evoke = casts.filter((m) => m.alternativeCostId);
        expect(evoke.length).toBeGreaterThan(0);
        for (const m of evoke) {
            expect(isEvokeCast(state, meId, meId, m)).toBe(true);
        }
    });

    it("keeps the OPPONENT's evoke in the tree", () => {
        const { state, meId, oppId, casts } = position([
            { name: "Solitude", owner: "me", zone: "hand" },
            { name: "Savannah Lions", owner: "me", zone: "hand" },
            ornithopter,
        ]);
        const evoke = casts.find((m) => m.alternativeCostId)!;
        expect(isEvokeCast(state, meId, oppId, evoke)).toBe(false);
    });

    it("leaves the same card's cast for its mana cost alone", () => {
        const { state, meId, casts } = position([
            { name: "Wistfulness", owner: "me", zone: "hand" },
            { name: "Island", owner: "me", zone: "battlefield", count: 5 },
        ]);
        const hard = casts.filter((m) => m.alternativeCostId === undefined);
        expect(hard.length).toBeGreaterThan(0);
        for (const m of hard) {
            expect(isEvokeCast(state, meId, meId, m)).toBe(false);
        }
    });

    it("leaves another alternative cost alone", () => {
        const { state, meId, casts } = position([
            { name: "Fireblast", owner: "me", zone: "hand" },
            {
                name: "Mountain",
                owner: "me",
                zone: "battlefield",
                tapped: true,
                count: 2,
            },
        ]);
        const sacrifice = casts.filter((m) => m.alternativeCostId);
        expect(sacrifice.length).toBeGreaterThan(0);
        for (const m of sacrifice) {
            expect(isEvokeCast(state, meId, meId, m)).toBe(false);
        }
    });
});

describe("the search keeps an evoke out of the `pass` subtree (issue #9864)", () => {
    it("passes rather than evoke two cards into a 0/2 with no ability", () => {
        const entry = findBladeScenario(
            "evoke: Solitude is never evoked with no threat, spending two cards"
        )!;
        const result = runBladeScenario(entry);
        expect(result.failureMessage).toBe("");
        expect(result.ok).toBe(true);
    });
});
