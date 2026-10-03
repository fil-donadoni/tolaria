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
 * hybrid mana leg (issue #4934) the planner and the cast gate now price.
 */
import { describe, expect, it } from "vitest";
import type { GameState } from "../../state";
import { enumerateMoves, planManaPayment, type Move } from "../../moves";
import { getLegalActions } from "../../rules";
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

    it("CR 118.9 / 119.4 — a targeted pitch (Force of Will) is enumerated against the spell and charges its life and its blue card", () => {
        const state = build({
            cards: [
                { name: "Force of Will", owner: "me", zone: "hand" },
                { name: "Brainstorm", owner: "me", zone: "hand" },
            ],
            stack: [
                { kind: "spell", name: "Ancestral Recall", controller: "opp" },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 4,
            landCount: 0,
            libraryCount: 20,
            activePlayer: "opp",
            priority: "me",
        });
        const casts = castsOf(state, "Force of Will");
        expect(casts).toHaveLength(1);
        const [cast] = casts;
        expect(cast.alternativeCostId).toBe("pitch-pay-1-life-exile-blue");
        expect(cast.targets).toHaveLength(1);
        expect(cast.payLife).toBe(1);
        const after = applyMoveForSearch(state, me(state).id, cast);
        expect(me(after).life).toBe(me(state).life - 1);
        expect(me(after).exile.map(cardName)).toEqual(["Brainstorm"]);
    });

    it('issue #4900 review — a pitch that would decline every target of an "up to" spell is pruned (Force of Vigor with nothing to destroy)', () => {
        const spec = (
            oppPermanents: { name: string; owner: "opp"; zone: "battlefield" }[]
        ) =>
            build({
                cards: [
                    { name: "Force of Vigor", owner: "me", zone: "hand" },
                    { name: "Grizzly Bears", owner: "me", zone: "hand" },
                    ...oppPermanents,
                ],
                phase: "PRECOMBAT_MAIN",
                turn: 4,
                landCount: 0,
                libraryCount: 20,
                activePlayer: "opp",
                priority: "me",
            });
        expect(castsOf(spec([]), "Force of Vigor")).toEqual([]);
        const withTarget = castsOf(
            spec([{ name: "Sol Ring", owner: "opp", zone: "battlefield" }]),
            "Force of Vigor"
        );
        expect(withTarget.length).toBeGreaterThan(0);
        expect(withTarget.every((m) => m.targets.length > 0)).toBe(true);
    });

    it("CR 107.4e — planManaPayment prices a hybrid pip: null on no lands, a two-tap plan on two Forests", () => {
        const empty = build({
            cards: [],
            phase: "PRECOMBAT_MAIN",
            turn: 3,
            landCount: 0,
            libraryCount: 20,
        });
        expect(planManaPayment(empty, me(empty), { "G/U": 2 })).toBeNull();
        const forests = build({
            cards: [
                { name: "Forest", owner: "me", zone: "battlefield" },
                { name: "Forest", owner: "me", zone: "battlefield" },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 3,
            landCount: 0,
            libraryCount: 20,
        });
        expect(
            planManaPayment(forests, me(forests), { "G/U": 2 })
        ).toHaveLength(2);
        expect(planManaPayment(forests, me(forests), { "G/U": 3 })).toBeNull();
    });

    it("CR 118.9 / 107.4e — Wistfulness: no cast on zero lands, no printed cast on three Forests, evoke on two Forests with a two-land plan", () => {
        const forestsSpec = (n: number): BladeScenario["spec"] => ({
            cards: [
                { name: "Wistfulness", owner: "me", zone: "hand" },
                ...Array.from({ length: n }, () => ({
                    name: "Forest",
                    owner: "me" as const,
                    zone: "battlefield" as const,
                })),
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 3,
            landCount: 0,
            libraryCount: 20,
        });
        const zero = build(forestsSpec(0));
        const wist = me(zero).hand.find((c) => cardName(c) === "Wistfulness")!;
        expect(getLegalActions(zero, me(zero), wist)).not.toContain("cast");
        expect(castsOf(zero, "Wistfulness")).toEqual([]);

        const three = build(forestsSpec(3));
        const printed = castsOf(three, "Wistfulness").filter(
            (m) => !m.alternativeCostId
        );
        expect(printed).toEqual([]);

        const two = build(forestsSpec(2));
        const evokes = castsOf(two, "Wistfulness");
        expect(evokes.length).toBeGreaterThan(0);
        expect(evokes.every((m) => m.tapPlan?.length === 2)).toBe(true);
    });
});
