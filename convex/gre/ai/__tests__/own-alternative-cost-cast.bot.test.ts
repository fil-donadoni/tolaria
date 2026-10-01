/**
 * Issue #4900 — a card's OWN alternative cost (CR 118.9: `alternativeCosts[]`
 * and Evoke, CR 702.74a) is a cast the Bot can enumerate and the search can
 * pay, whatever the land count.
 *
 * The defect: `enumerateCastMoves` reached a cast only through the PRINTED
 * cost, so Solitude with zero lands and a white card in hand — the position
 * its pitch evoke exists for — offered only `pass`, and the Bot died to a
 * lethal attacker. These pin the three seams the fix crosses: the enumerator
 * (`moves.ts`), the search's payment of the hand leg (`applyMove.ts`), and the
 * fail-closed hybrid mana leg the Bot's planner cannot price yet.
 */
import { describe, expect, it } from "vitest";
import type { GameState } from "../../state";
import { enumerateMoves, type Move } from "../../moves";
import { applyMoveForSearch } from "../../applyMove";
import { buildBladeState } from "../blade/runner";
import type { BladeScenario } from "../blade/types";
import { tryGetDefinition } from "../../../cards";
import type { CardInstanceState } from "../../state";

function build(spec: BladeScenario["spec"]): GameState {
    return buildBladeState({
        label: "own-alternative-cost-unit",
        spec,
        bot: "me",
        budget: { iterations: 1 },
        tier: "must",
        expect: { moves: [{ kind: "pass" }] },
    });
}

const me = (state: GameState) => state.players[0];

const cardName = (c: CardInstanceState) =>
    tryGetDefinition((c.card as { id?: string }).id ?? "")?.name;

function nameOf(state: GameState, id: string): string | undefined {
    for (const p of state.players) {
        for (const zone of [p.hand, p.battlefield, p.graveyard, p.exile]) {
            const c = zone.find((x) => x.id === id);
            if (c) return cardName(c);
        }
    }
    return undefined;
}

function castsOf(
    state: GameState,
    name: string
): Extract<Move, { kind: "cast-spell" }>[] {
    return enumerateMoves(state, me(state).id).filter(
        (m): m is Extract<Move, { kind: "cast-spell" }> =>
            m.kind === "cast-spell" && nameOf(state, m.cardInstanceId) === name
    );
}

/** The blade position of issue #4895: a lethal Serra Angel attacking a
 *  four-life Bot with no lands, Solitude and `pitch` in hand. */
function solitudeFacingLethal(pitch: string): GameState {
    return build({
        cards: [
            { name: "Solitude", owner: "me", zone: "hand" },
            { name: pitch, owner: "me", zone: "hand" },
            {
                name: "Serra Angel",
                owner: "opp",
                zone: "battlefield",
                summoningSick: false,
            },
        ],
        phase: "DECLARE_ATTACKERS",
        turn: 5,
        landCount: 0,
        libraryCount: 20,
        life: { me: 4 },
        activePlayer: "opp",
        priority: "me",
        combat: { attackers: ["Serra Angel"], confirmed: true },
    });
}

describe("own alternative cost cast (issue #4900, CR 118.9 / 702.74a)", () => {
    it("CR 702.74a — a zero-land Solitude with a white card in hand enumerates its evoke cast", () => {
        const state = solitudeFacingLethal("Savannah Lions");
        const casts = castsOf(state, "Solitude");
        expect(casts.length).toBeGreaterThan(0);
        expect(casts.every((m) => m.alternativeCostId === "evoke")).toBe(true);
        expect(casts.every((m) => m.tapPlan.length === 0)).toBe(true);
    });

    it("CR 118.9 — no white card to exile, no evoke cast (the hand leg gates it)", () => {
        const state = solitudeFacingLethal("Grizzly Bears");
        expect(castsOf(state, "Solitude")).toEqual([]);
    });

    it("CR 601.2h — the search pays the hand leg: the pitched card is exiled and the spell is evoked", () => {
        const state = solitudeFacingLethal("Savannah Lions");
        const [cast] = castsOf(state, "Solitude");
        const after = applyMoveForSearch(state, me(state).id, cast);
        const self = me(after);
        expect(self.hand.map(cardName)).toEqual([]);
        expect(self.exile.map(cardName)).toContain("Savannah Lions");
        const onStackOrField = [...after.stack, ...self.battlefield].find(
            (c) => cardName(c) === "Solitude"
        );
        expect(onStackOrField?.evoked).toBe(true);
    });

    it("CR 702.74a — an evoke whose every ETB trigger has no legal target is pruned (the body is sacrificed for nothing)", () => {
        // Solitude's only ETB exiles "up to one OTHER target creature": with
        // no creature on the battlefield the evoke trades two cards for
        // nothing, and the Bot never offers it.
        const state = build({
            cards: [
                { name: "Solitude", owner: "me", zone: "hand" },
                { name: "Savannah Lions", owner: "me", zone: "hand" },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 3,
            landCount: 0,
            libraryCount: 20,
        });
        expect(castsOf(state, "Solitude")).toEqual([]);
    });

    it("fail closed — a hybrid evoke (unplannable by `planManaPayment`) is not offered on zero lands", () => {
        const state = build({
            cards: [{ name: "Wistfulness", owner: "me", zone: "hand" }],
            phase: "PRECOMBAT_MAIN",
            turn: 3,
            landCount: 0,
            libraryCount: 20,
        });
        expect(castsOf(state, "Wistfulness")).toEqual([]);
    });
});
