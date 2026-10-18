// Issue #5445 — `isManaBaseSacrificeCast` names a cast whose alternative cost
// SACRIFICES the caster's lands (CR 118.9 / 701.21a), so the search keeps it
// out of the rollout and of the tree below the root.

import { describe, expect, it } from "vitest";
import { getCardByName, withTemporaryDefinition } from "../../../cards";
import type { CardDefinition } from "../../../cards/types";
import type { ScenarioSpec } from "../../../debugScenarioSpec";
import type { Move } from "../../moves";
import { enumerateMoves } from "../../moves";
import { buildStateFromScenario } from "../../scenarioBuilder";
import { isManaBaseSacrificeCast } from "../../search";
import { buildBladeBaseState } from "../blade/baseState";

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

const twoTapped = (name: string): ScenarioSpec["cards"] => [
    { name, owner: "me", zone: "battlefield", tapped: true },
    { name, owner: "me", zone: "battlefield", tapped: true },
];

describe("isManaBaseSacrificeCast (issue #5445)", () => {
    it("names the bot's own cast that sacrifices its lands", () => {
        const { state, meId, casts } = position([
            { name: "Fireblast", owner: "me", zone: "hand" },
            ...twoTapped("Mountain"),
        ]);
        const sacrifice = casts.filter((m) => m.alternativeCostId);
        expect(sacrifice.length).toBeGreaterThan(0);
        for (const m of sacrifice) {
            expect(isManaBaseSacrificeCast(state, meId, meId, m)).toBe(true);
        }
    });

    it("keeps the OPPONENT's land sacrifice in the tree", () => {
        const { state, meId, oppId, casts } = position([
            { name: "Fireblast", owner: "me", zone: "hand" },
            ...twoTapped("Mountain"),
        ]);
        const cast = casts.find((m) => m.alternativeCostId)!;
        expect(isManaBaseSacrificeCast(state, meId, oppId, cast)).toBe(false);
    });

    it("leaves a RETURN leg alone — the land comes back to hand", () => {
        const { state, meId, casts } = position([
            { name: "Gush", owner: "me", zone: "hand" },
            ...twoTapped("Island"),
        ]);
        const returning = casts.filter((m) => m.alternativeCostId);
        expect(returning.length).toBeGreaterThan(0);
        for (const m of returning) {
            expect(isManaBaseSacrificeCast(state, meId, meId, m)).toBe(false);
        }
    });

    it("leaves a sacrifice of NONLAND permanents alone", () => {
        const printed = getCardByName("Fireblast");
        const creatureLeg: CardDefinition = {
            ...printed,
            alternativeCosts: [
                {
                    id: "sacrifice-two-creatures",
                    description: "Sacrifice two creatures",
                    permanent: {
                        action: "sacrifice",
                        count: 2,
                        filter: { types: "Creature" },
                    },
                },
            ],
        };
        withTemporaryDefinition(creatureLeg, () => {
            const { state, meId, casts } = position([
                { name: "Fireblast", owner: "me", zone: "hand" },
                { name: "Grizzly Bears", owner: "me", zone: "battlefield" },
                { name: "Grizzly Bears", owner: "me", zone: "battlefield" },
                ...twoTapped("Mountain"),
            ]);
            const sacrifice = casts.filter((m) => m.alternativeCostId);
            expect(sacrifice.length).toBeGreaterThan(0);
            for (const m of sacrifice) {
                expect(isManaBaseSacrificeCast(state, meId, meId, m)).toBe(
                    false
                );
            }
        });
    });

    it("leaves a cast paid with mana alone", () => {
        const { state, meId, casts } = position([
            { name: "Lightning Bolt", owner: "me", zone: "hand" },
            { name: "Mountain", owner: "me", zone: "battlefield" },
        ]);
        expect(casts.length).toBeGreaterThan(0);
        for (const m of casts) {
            expect(isManaBaseSacrificeCast(state, meId, meId, m)).toBe(false);
        }
    });
});
