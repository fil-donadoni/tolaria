// Modal cardinality C (issue #2265, PRD #2261, ADR 0094) — the Bot's two-level
// cast enumeration: every announceable mode COMBINATION is enumerated, only the
// moves beneath a combination are budgeted, every cut is reported, and a
// multi-mode cast is valued by COMPOSITION rather than best-of.
//
// No shipped card declares a `modeSelection` yet (slice D, issue #2266, ships
// them), so the fixtures are variants of Darigaaz's Charm — three scripted
// modes, "return target creature card" / "3 damage to any target" / "+3/+3" —
// registered through `withTemporaryDefinition`. Nothing below reads the card's
// name: it is a fixture for "a mode list with targeted Effect Script modes".

import { describe, expect, it } from "vitest";
import { getCardByName, withTemporaryDefinition } from "../../cards";
import type { CardDefinition, ModeSelection } from "../../cards/types";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import {
    enumerateMoves,
    MAX_COMBINATIONS,
    modeCombinationBudget,
    type ModeCombinationTruncation,
    type Move,
} from "../moves";
import { announceableModeCombinations } from "../modeSelection";
import { dslSpellScriptOpValue } from "../ai/cardScriptValue";
import { misdirectedTargetCount } from "../ai/beneficence";
import type { GameState } from "../state";
import { buildStateFromScenario } from "../scenarioBuilder";
import { createInitialGameState, type PlayerInput } from "../setup";
import { umezawasJitte } from "../../cards/sets/bok/colorless";

type CastMove = Extract<Move, { kind: "cast-spell" }>;

const BOT = "p1";
const OPP = "p2";
const CHARM = getCardByName("Darigaaz's Charm");
const GRIZZLY = getCardByName("Grizzly Bears").id;

function charmWith(modeSelection: ModeSelection): CardDefinition {
    return { ...CHARM, modeSelection };
}

const NO_FACTS = { controls: () => false, kicked: false };

/** The bot holds the charm with {B}{R}{G} up; `oppCreatures` Grizzly Bears on
 *  the opponent's side, `graveyardCreatures` in the bot's graveyard. */
function board(opts: {
    oppCreatures?: number;
    graveyardCreatures?: number;
    oppLife?: number;
}): GameState {
    const land = (name: string, i: number) =>
        makeInstance(getCardByName(name).id, {
            id: `${name}-${i}`,
            controllerId: BOT,
            ownerId: BOT,
            zone: "battlefield",
        });
    const state = makeState({
        players: [
            makePlayer(BOT, {
                hand: [
                    makeInstance(CHARM.id, {
                        id: "charm",
                        controllerId: BOT,
                        ownerId: BOT,
                        zone: "hand",
                    }),
                ],
                battlefield: [
                    land("Swamp", 0),
                    land("Mountain", 0),
                    land("Forest", 0),
                ],
                graveyard: Array.from(
                    { length: opts.graveyardCreatures ?? 0 },
                    (_, i) =>
                        makeInstance(GRIZZLY, {
                            id: `gy-bear-${i}`,
                            controllerId: BOT,
                            ownerId: BOT,
                            zone: "graveyard",
                        })
                ),
            }),
            makePlayer(OPP, {
                battlefield: Array.from(
                    { length: opts.oppCreatures ?? 0 },
                    (_, i) =>
                        makeInstance(GRIZZLY, {
                            id: `opp-bear-${i}`,
                            controllerId: OPP,
                            ownerId: OPP,
                            zone: "battlefield",
                            summoningSick: false,
                        })
                ),
            }),
        ],
        activePlayerId: BOT,
        priorityPlayerId: BOT,
    });
    if (opts.oppLife !== undefined) state.players[1].life = opts.oppLife;
    return state;
}

const castsOf = (
    state: GameState,
    onTruncated?: (t: ModeCombinationTruncation) => void
): CastMove[] =>
    enumerateMoves(state, BOT, { onTruncated }).filter(
        (m): m is CastMove =>
            m.kind === "cast-spell" && m.cardInstanceId === "charm"
    );

const combinationsOf = (moves: CastMove[]): string[] =>
    [...new Set(moves.map((m) => (m.chosenModeIds ?? []).join("+")))].sort();

describe("announceableModeCombinations — the mode level (CR 700.2a / 700.2d)", () => {
    const four = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
    const three = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const all = {
        facts: NO_FACTS,
        isModeLegal: () => true,
        ownerName: "fixture",
    };

    it("'choose two' of four is C(4,2) = 6 distinct pairs, printed order", () => {
        const combos = announceableModeCombinations({
            ...all,
            modes: four,
            selection: { min: 2, max: 2 },
        });
        expect(combos).toEqual([
            ["a", "b"],
            ["a", "c"],
            ["a", "d"],
            ["b", "c"],
            ["b", "d"],
            ["c", "d"],
        ]);
    });

    it("a repeatable 3-of-3 list is the 10-member multiset, repeats consecutive", () => {
        const combos = announceableModeCombinations({
            ...all,
            modes: three,
            selection: { min: 3, max: 3, repeats: true },
        });
        expect(combos).toHaveLength(10);
        expect(combos).toContainEqual(["a", "a", "a"]);
        expect(combos).toContainEqual(["a", "b", "c"]);
        expect(combos).not.toContainEqual(["b", "a", "a"]);
    });

    it("no selection is one single-mode list per mode — the pre-ADR-0094 shape", () => {
        expect(
            announceableModeCombinations({
                ...all,
                modes: three,
                selection: undefined,
            })
        ).toEqual([["a"], ["b"], ["c"]]);
    });

    it("a CR 609.3 shortfall admits the smaller list only when too few modes are legal", () => {
        const onlyA = (id: string) => id === "a";
        const combos = announceableModeCombinations({
            ...all,
            isModeLegal: onlyA,
            modes: three,
            selection: { min: 2, max: 2 },
        });
        // Every single is admitted by the COUNT rule (one legal mode < min 2);
        // the target level then drops the illegal ones.
        expect(combos.filter((c) => c.length === 1)).toHaveLength(3);
        expect(
            announceableModeCombinations({
                ...all,
                modes: three,
                selection: { min: 2, max: 2 },
            }).every((c) => c.length === 2)
        ).toBe(true);
    });
});

describe("two-level cast enumeration (issue #2265)", () => {
    it("a 'choose two' card enumerates two-mode casts only, and every legal combination", () => {
        withTemporaryDefinition(charmWith({ min: 2, max: 2 }), () => {
            const casts = castsOf(
                board({ oppCreatures: 1, graveyardCreatures: 1 })
            );
            expect(casts.length).toBeGreaterThan(0);
            // A single-mode announcement is one `announceCast` rejects — the
            // bot-stall shape this slice exists to close.
            expect(casts.every((m) => m.chosenModeIds?.length === 2)).toBe(
                true
            );
            expect(combinationsOf(casts)).toEqual([
                "damage+pump",
                "regrowth-creature+damage",
                "regrowth-creature+pump",
            ]);
        });
    });

    it("stamps per-instance spans that cover the flat target list", () => {
        withTemporaryDefinition(charmWith({ min: 2, max: 2 }), () => {
            const casts = castsOf(
                board({ oppCreatures: 1, graveyardCreatures: 1 })
            );
            for (const m of casts) {
                expect(m.modeTargetCounts).toHaveLength(2);
                expect(m.modeTargetCounts!.reduce((a, b) => a + b, 0)).toBe(
                    m.targets.length
                );
            }
        });
    });

    it("a combination naming a mode with no legal target yields no move (CR 700.2a)", () => {
        withTemporaryDefinition(charmWith({ min: 2, max: 2 }), () => {
            // Empty graveyard: the regrowth mode can't be chosen.
            const casts = castsOf(board({ oppCreatures: 1 }));
            expect(combinationsOf(casts)).toEqual(["damage+pump"]);
        });
    });

    it("the same object may be targeted by two instances of a repeated mode (CR 700.2d)", () => {
        withTemporaryDefinition(
            charmWith({ min: 2, max: 2, repeats: true }),
            () => {
                const casts = castsOf(board({ oppLife: 6 }));
                expect(
                    casts.some(
                        (m) =>
                            m.chosenModeIds?.join("+") === "damage+damage" &&
                            m.targets.every(
                                (t) => t.type === "player" && t.id === OPP
                            )
                    )
                ).toBe(true);
            }
        );
    });

    it("every combination survives a board wide enough to cut the target level, and each cut is reported", () => {
        withTemporaryDefinition(
            charmWith({ min: 2, max: 2, repeats: true }),
            () => {
                const truncations: ModeCombinationTruncation[] = [];
                // 10 creatures: "any target" has 12 answers, so damage+damage
                // alone has 144 tuples — far past one combination's share.
                const casts = castsOf(
                    board({ oppCreatures: 10, graveyardCreatures: 1 }),
                    (t) => truncations.push(t)
                );
                const combinations = combinationsOf(casts);
                // 3 modes, pairs with repeats: C(4,2) = 6 — none starved.
                expect(combinations).toHaveLength(6);
                const budget = modeCombinationBudget(6);
                expect(budget).toBeLessThan(MAX_COMBINATIONS);
                for (const combo of combinations) {
                    expect(
                        casts.filter(
                            (m) => m.chosenModeIds?.join("+") === combo
                        ).length
                    ).toBeLessThanOrEqual(budget);
                }
                const cut = truncations.find(
                    (t) => t.chosenModeIds.join("+") === "damage+damage"
                );
                expect(cut).toMatchObject({
                    cardInstanceId: "charm",
                    cardName: CHARM.name,
                    emitted: budget,
                });
                expect(cut!.dropped).toBeGreaterThan(0);
                // Reported iff cut: a combination under budget is not listed.
                expect(
                    truncations.every(
                        (t) => t.emitted === budget && t.dropped > 0
                    )
                ).toBe(true);
            }
        );
    });

    it("a non-modal enumeration reports nothing and keeps the whole window", () => {
        expect(modeCombinationBudget(1)).toBe(MAX_COMBINATIONS);
        const truncations: ModeCombinationTruncation[] = [];
        castsOf(board({ oppCreatures: 10, graveyardCreatures: 1 }), (t) =>
            truncations.push(t)
        );
        // Darigaaz's Charm as printed: three single-mode combinations, none
        // over its 21-move share on this board.
        expect(truncations).toEqual([]);
    });
});

describe("multi-mode valuation composes (issue #2265)", () => {
    it("a 'choose two' list is worth its two best modes together, not its best one", () => {
        const single = dslSpellScriptOpValue(CHARM)!;
        const pair = withTemporaryDefinition(
            charmWith({ min: 2, max: 2 }),
            () => dslSpellScriptOpValue(charmWith({ min: 2, max: 2 }))!
        );
        expect(pair.points).toBeGreaterThan(single.points);
    });

    it("no selection keeps the best single mode", () => {
        const single = dslSpellScriptOpValue(CHARM)!;
        const perMode = CHARM.modes!.map(
            (mode) =>
                dslSpellScriptOpValue({
                    ...CHARM,
                    modes: undefined,
                    effects: mode.effects,
                })!.points
        );
        expect(single.points).toBe(Math.max(...perMode));
    });
});

describe("target-slot beneficence reads each instance's own mode (issue #2265)", () => {
    it("a pump instance pointed at the opponent's creature is misdirected; the damage instance at the opponent is not", () => {
        withTemporaryDefinition(charmWith({ min: 2, max: 2 }), () => {
            const state = board({ oppCreatures: 1 });
            const casts = castsOf(state);
            const at = (pumpTarget: string, damageTarget: string) =>
                casts.find(
                    (m) =>
                        m.chosenModeIds?.join("+") === "damage+pump" &&
                        m.targets[0]?.id === damageTarget &&
                        m.targets[1]?.id === pumpTarget
                )!;
            const bad = at("opp-bear-0", OPP);
            expect(bad).toBeDefined();
            expect(misdirectedTargetCount(state, bad, BOT)).toBe(1);
            const selfBurn = at("opp-bear-0", BOT);
            expect(misdirectedTargetCount(state, selfBurn, BOT)).toBe(2);
        });
    });
});

describe("two-level ACTIVATION enumeration (CR 602.2b / 700.2, issue #2265)", () => {
    const JITTE_MODES = "umezawas-jitte-modes";
    /** A modal ability that chooses one or two DISTINCT modes. */
    const jitteChoosingUpToTwo: CardDefinition = {
        ...umezawasJitte,
        activatedAbilities: umezawasJitte.activatedAbilities!.map((a) =>
            a.id === JITTE_MODES
                ? { ...a, modeSelection: { min: 1, max: 2 } }
                : a
        ),
    };
    const seat = (id: string): PlayerInput => {
        const filler = getCardByName("Plains");
        return {
            id,
            name: id,
            bgColor: "#000000",
            deck: {
                id: `deck-${id}`,
                name: "test",
                format: "freeform",
                cards: Array.from({ length: 40 }, () => ({
                    cardId: filler.id,
                    cardName: filler.name,
                })),
            },
        };
    };

    it("offers every single and every distinct pair, each pair with its instance spans", () => {
        withTemporaryDefinition(jitteChoosingUpToTwo, () => {
            const state = buildStateFromScenario(
                createInitialGameState([seat(BOT), seat(OPP)], 0x2265),
                {
                    cards: [
                        {
                            name: "Grizzly Bears",
                            owner: "me",
                            zone: "battlefield",
                            summoningSick: false,
                        },
                        {
                            name: "Umezawa's Jitte",
                            owner: "me",
                            zone: "battlefield",
                            attachedTo: "Grizzly Bears",
                        },
                        {
                            name: "Hill Giant",
                            owner: "opp",
                            zone: "battlefield",
                            summoningSick: false,
                        },
                    ],
                    phase: "PRECOMBAT_MAIN",
                    turn: 3,
                }
            );
            const jitte = state.players[0].battlefield.find(
                (c) => (c.card as { id?: string }).id === umezawasJitte.id
            )!;
            jitte.counters = { ...(jitte.counters ?? {}), charge: 2 };
            const activations = enumerateMoves(
                state,
                state.players[0].id
            ).filter(
                (m): m is Extract<Move, { kind: "activate-ability" }> =>
                    m.kind === "activate-ability" && m.abilityId === JITTE_MODES
            );
            const combos = [
                ...new Set(
                    activations.map((m) => (m.chosenModeIds ?? []).join("+"))
                ),
            ].sort();
            expect(combos).toEqual(
                [
                    "gain-life",
                    "pump-equipped",
                    "pump-equipped+gain-life",
                    "pump-equipped+shrink-target",
                    "shrink-target",
                    "shrink-target+gain-life",
                ].sort()
            );
            for (const m of activations) {
                if ((m.chosenModeIds?.length ?? 0) < 2) {
                    expect(m.modeTargetCounts).toBeUndefined();
                    continue;
                }
                expect(m.modeTargetCounts!.reduce((a, b) => a + b, 0)).toBe(
                    m.targets.length
                );
            }
        });
    });
});
