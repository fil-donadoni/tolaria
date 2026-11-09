// CR 606.3 / 606.4 (issue #8729) — a tick-up loyalty activation whose
// resolution changes nothing but its own tick is dominated by a sibling
// loyalty ability of the same permanent that costs at least as much and does
// something. The Elk is made the way a game makes it: Oko's +1 resolves on
// turn 12, both players pass to turn 14, and Oko's loyalty is available again.

import { describe, expect, it } from "vitest";
import type { GameState } from "../../state";
import type { Move } from "../../moves";
import { enumerateMoves } from "../../moves";
import { enumerateRootMoves, searchWithTrace } from "../../search";
import { buildBladeState } from "../blade/runner";
import type { BladeScenario, BladeSetupStep } from "../blade/types";
import { PASSES_TO_OWN_NEXT_MAIN } from "../blade/scenarioPredicates";
import { tickOnlyLoyaltyMovesDominated } from "../dominance";
import { instanceIdsForName } from "../blade/matcher";
import { getCardByName, withTemporaryDefinition } from "../../../cards";
import { getEffectivePT } from "../../layers";

const OKO = "Oko, Thief of Crowns";
const PLUS2 = "oko-thief-of-crowns-plus2";
const PLUS1 = "oko-thief-of-crowns-plus1";

type Card = BladeScenario["spec"]["cards"][number];

/** Turn 12: Oko on 4 elks the opposing Talisman. Turn 14: Oko on 5, the Elk
 *  still an Elk, and `extra` steps applied on top (an announcement there is
 *  resolved by the opponent's pass, which hands priority back, CR 117.3b). */
function elkBoard(cards: Card[] = [], extra: BladeSetupStep[] = []): GameState {
    return buildBladeState({
        label: "loyalty-tick-dominance",
        spec: {
            phase: "PRECOMBAT_MAIN",
            turn: 12,
            landCount: 0,
            libraryCount: 20,
            cards: [
                {
                    name: OKO,
                    owner: "me",
                    zone: "battlefield",
                    counters: { loyalty: 4 },
                },
                {
                    name: "Talisman of Curiosity",
                    owner: "opp",
                    zone: "battlefield",
                },
                ...cards,
            ],
        },
        setup: [
            {
                kind: "activate",
                card: OKO,
                ability: PLUS1,
                target: "Talisman of Curiosity",
            },
            { kind: "resolve-top" },
            ...PASSES_TO_OWN_NEXT_MAIN,
            ...extra,
        ],
        bot: "me",
        budget: { iterations: 1 },
        tier: "must",
        expect: { moves: [{ kind: "pass" }] },
    });
}

function me(state: GameState): string {
    return state.players[0].id;
}

function elkId(state: GameState): string {
    const [id] = instanceIdsForName(state, "Talisman of Curiosity", "opp");
    return id;
}

function okoMoves(moves: Move[], abilityId: string, targetId?: string) {
    return moves.filter(
        (m) =>
            m.kind === "activate-ability" &&
            m.abilityId === abilityId &&
            (targetId === undefined ||
                m.targets.some((t) => "id" in t && t.id === targetId))
    );
}

describe("tick-only loyalty activation vs a sibling (CR 606.3, 606.4)", () => {
    it("the walk reaches turn 14 with the Elk made and Oko's loyalty available", () => {
        const state = elkBoard();
        expect(state.turn).toBe(14);
        expect(state.phase).toBe("PRECOMBAT_MAIN");
        const oko = state.players[0].battlefield.find(
            (c) => (c.card as { id?: string }).id === getCardByName(OKO)?.id
        )!;
        expect(oko.counters?.loyalty).toBe(5);
        expect(oko.loyaltyActivationsThisTurn ?? 0).toBe(0);
        const elk = state.players[1].battlefield.find(
            (c) => c.id === elkId(state)
        )!;
        expect(elk.types).toEqual(["Creature"]);
        expect(elk.subtypes).toEqual(["Elk"]);
    });

    it("denies the +1 on the Elk at the root while the +2 and a real +1 stay", () => {
        const state = elkBoard([
            {
                name: "Craw Wurm",
                owner: "opp",
                zone: "battlefield",
                summoningSick: false,
            },
        ]);
        const pid = me(state);
        const elk = elkId(state);
        const [wurm] = instanceIdsForName(state, "Craw Wurm", "opp");

        const offered = enumerateMoves(state, pid);
        expect(okoMoves(offered, PLUS1, elk)).toHaveLength(1);

        const pruned: Move[] = [];
        const root = enumerateRootMoves(state, pid, {
            onPruned: (m) => pruned.push(m),
        });
        expect(okoMoves(root, PLUS1, elk)).toHaveLength(0);
        expect(okoMoves(pruned, PLUS1, elk)).toHaveLength(1);
        expect(okoMoves(root, PLUS2)).toHaveLength(1);
        // A target that is not an Elk yet: re-typing it is a real effect.
        expect(okoMoves(root, PLUS1, wurm)).toHaveLength(1);
    });

    it("counters on the Elk survive the re-application, so they change nothing", () => {
        const state = elkBoard();
        const elk = state.players[1].battlefield.find(
            (c) => c.id === elkId(state)
        )!;
        elk.counters = { ...elk.counters, "+1/+1": 2 };
        expect(getEffectivePT(state, elk)).toEqual({ power: 5, toughness: 5 });
        const root = enumerateRootMoves(state, me(state));
        expect(okoMoves(root, PLUS1, elkId(state))).toHaveLength(0);
    });

    it("keeps the +1 on an Elk that gained an ability after it was elked", () => {
        const state = elkBoard(
            [
                { name: "Jump", owner: "me", zone: "hand" },
                { name: "Island", owner: "me", zone: "battlefield" },
            ],
            [
                { kind: "cast", card: "Jump", target: "Talisman of Curiosity" },
                { kind: "pass", seat: "opp" },
            ]
        );
        const elk = state.players[1].battlefield.find(
            (c) => c.id === elkId(state)
        )!;
        expect(elk.staticAbilities).toContain("flying");
        const root = enumerateRootMoves(state, me(state));
        expect(okoMoves(root, PLUS1, elk.id)).toHaveLength(1);
    });

    it("keeps the +1 on an Elk with a later P/T-setting effect", () => {
        const state = elkBoard(
            [
                {
                    name: "Sorceress Queen",
                    owner: "me",
                    zone: "battlefield",
                    summoningSick: false,
                },
            ],
            [
                {
                    kind: "activate",
                    card: "Sorceress Queen",
                    target: "Talisman of Curiosity",
                },
                { kind: "pass", seat: "opp" },
            ]
        );
        const elk = state.players[1].battlefield.find(
            (c) => c.id === elkId(state)
        )!;
        expect(getEffectivePT(state, elk)).toEqual({ power: 0, toughness: 2 });
        const root = enumerateRootMoves(state, me(state));
        expect(okoMoves(root, PLUS1, elk.id)).toHaveLength(1);
    });

    describe("a walker with no qualifying sibling", () => {
        const oko = getCardByName(OKO)!;
        const withoutPlus2 = {
            ...oko,
            activatedAbilities: oko.activatedAbilities!.filter(
                (a) => a.id !== PLUS2
            ),
        };

        it("keeps its tick: only a lower-cost sibling (the -5) is left", () => {
            withTemporaryDefinition(withoutPlus2, () => {
                const state = elkBoard();
                const pid = me(state);
                const offered = enumerateMoves(state, pid);
                expect(
                    tickOnlyLoyaltyMovesDominated(state, pid, offered).size
                ).toBe(0);
                const root = enumerateRootMoves(state, pid);
                expect(okoMoves(root, PLUS1, elkId(state))).toHaveLength(1);
            });
        });

        it("still values the tick above pass", () => {
            withTemporaryDefinition(withoutPlus2, () => {
                const state = elkBoard();
                const pid = me(state);
                const { trace } = searchWithTrace(
                    state,
                    pid,
                    { iterations: 200 },
                    1
                );
                const total = (match: (m: Move) => boolean) =>
                    trace!.candidates.find((c) => match(c.move))!.eval.total;
                const tick = total(
                    (m) =>
                        m.kind === "activate-ability" &&
                        m.abilityId === PLUS1 &&
                        m.targets.some(
                            (t) => "id" in t && t.id === elkId(state)
                        )
                );
                expect(tick).toBeGreaterThan(total((m) => m.kind === "pass"));
            });
        });
    });
});
