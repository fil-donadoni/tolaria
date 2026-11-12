/**
 * The prune of wholly misdirected variants (`isWhollyMisdirectedMove`,
 * `withoutMisdirectedVariants`, `search.ts`) below a cost-unlocking retype.
 * The tree backs up MEAN rewards, so a burn spell's own-side targets — as
 * many edges as its real ones — used to drag a retype-then-cast line (CR
 * 305.7: the land gains the new type's mana ability) below `pass`.
 */
import { describe, expect, it } from "vitest";
import { isWhollyMisdirectedMove } from "../search";
import { enumerateMoves } from "../moves";
import { describeMove } from "../describeMove";
import { findBladeScenario } from "../ai/blade/registry";
import { buildBladeState } from "../ai/blade/build";
import { seatPlayerId } from "../ai/blade/matcher";
import { runBladeScenario } from "../ai/blade/runner";
import type { BladeScenario } from "../ai/blade/types";

const ANCHOR =
    "land-type change: Reef Shaman makes a Mountain for the Flame Slash that kills the Hill Giant";

function anchor(): BladeScenario {
    const scenario = findBladeScenario(ANCHOR);
    if (!scenario) throw new Error(`no blade entry "${ANCHOR}"`);
    return scenario;
}

describe("wholly misdirected variants below a cost-unlocking retype (CR 305.7)", () => {
    it("flags Flame Slash at each of the mover's own creatures, never at the opponent's", () => {
        const base = anchor();
        const state = buildBladeState({
            ...base,
            spec: {
                ...base.spec,
                cards: [
                    ...base.spec.cards,
                    { name: "Mountain", owner: "me", zone: "battlefield" },
                ],
            },
        });
        const botId = seatPlayerId(state, "me");
        const verdicts = new Map(
            enumerateMoves(state, botId).map((m) => [
                describeMove(m, state),
                isWhollyMisdirectedMove(state, botId, m),
            ])
        );

        expect(verdicts.get("cast Flame Slash → Hill Giant")).toBe(false);
        for (const own of [
            "Reef Shaman",
            "Grizzly Bears",
            "Merfolk of the Pearl Trident",
        ]) {
            expect(verdicts.get(`cast Flame Slash → ${own}`)).toBe(true);
        }
        expect(verdicts.get("pass")).toBe(false);
    });

    it("lets the search find activate → land-type choice → resolve → cast at 200 iterations", () => {
        const result = runBladeScenario({
            ...anchor(),
            budget: { iterations: 200 },
            seeds: [0xb1ade, 4],
        });
        expect(result.ok, result.failureMessage).toBe(true);
    });
});
