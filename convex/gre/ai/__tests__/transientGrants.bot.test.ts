// A this-turn evasion / combat keyword grant is not lasting material
// (issue #5927).
//
// Two subjects. (1) `evaluateCreature`'s take-back of the flat `KEYWORD_BONUS`
// credit for a keyword that reached the creature through a duration-scoped
// grant (`ai/defensiveGrants.ts`' `temporaryCombatKeywords`) — the keyword
// twin of the until-end-of-turn P/T exclusion (ADR 0020 §2), unconditional
// where the defensive rows (issue #2937) keep their threat gate. (2) The
// prune of a grant with no combat window left before it expires
// (`ai/futileShield.ts`' `isFutileThisTurnMove`, the this-turn shield rule of
// issue #5493 read for a combat keyword), and the misdirection prune of the
// same grant aimed at the opponent's creature (`isMisdirectedThisTurnMove`).
//
// Every position is built through the REAL blade builder; the grant on the
// board is the one a live activation produces (CR 611.2a), never a
// hand-written `staticAbilities` literal.

import { describe, expect, it } from "vitest";
import { buildBladeState } from "../blade/runner";
import { getCardByName } from "../../../cards";
import { seatPlayerId } from "../blade/matcher";
import {
    applyMoveInSearch,
    decidingPlayer,
    searchWithTrace,
} from "../../search";
import { enumerateMoves, type Move } from "../../moves";
import {
    isFutileThisTurnMove,
    isMisdirectedThisTurnMove,
} from "../futileShield";
import { evaluateCreature } from "../../evaluate";
import { creatureValueRaw } from "../../creatureBody";
import {
    lastingStaticAbilities,
    temporaryCombatKeywords,
    temporaryDefensiveKeywords,
} from "../defensiveGrants";
import type { BladeScenario } from "../blade/types";
import type { CardInstanceState, GameState } from "../../state";
import type { ScenarioSpec } from "../../../debugScenarioSpec";

const DISCIPLE = "Disciple of Kangee";
const BEARS = "Grizzly Bears";

/** The shared board: the Disciple and a ready 2/2 against one opposing
 *  blocker, with {U} open on both sides. */
function boardSpec(
    blocker: string,
    overrides: Partial<ScenarioSpec> = {}
): ScenarioSpec {
    return {
        cards: [
            {
                name: DISCIPLE,
                owner: "me",
                zone: "battlefield",
                summoningSick: false,
            },
            {
                name: BEARS,
                owner: "me",
                zone: "battlefield",
                summoningSick: false,
            },
            { name: "Island", owner: "me", zone: "battlefield", count: 2 },
            { name: "Plains", owner: "me", zone: "battlefield", count: 2 },
            { name: blocker, owner: "opp", zone: "battlefield" },
            { name: "Island", owner: "opp", zone: "battlefield", count: 2 },
            { name: "Plains", owner: "opp", zone: "battlefield", count: 2 },
        ],
        phase: "BEGINNING_OF_COMBAT",
        turn: 5,
        libraryCount: 20,
        ...overrides,
    };
}

function scenario(label: string, spec: ScenarioSpec): BladeScenario {
    return {
        label,
        spec,
        bot: "me",
        budget: { iterations: 200 },
        seeds: [1],
        tier: "must",
        expect: { forbidden: [{ kind: "pass" }] },
    };
}

/** A battlefield permanent by definition name. Throws rather than guessing. */
function permanent(state: GameState, name: string): CardInstanceState {
    const found = state.players
        .flatMap((p) => p.battlefield)
        .filter(
            (c) => (c.card as { id?: string }).id === getCardByName(name).id
        );
    expect(found).toHaveLength(1);
    return found[0];
}

/** Activate the Disciple on the Bears and let the ability resolve, so the
 *  board carries the real duration-scoped layer-6 grant. */
function withFlyingGranted(state: GameState): GameState {
    const botId = seatPlayerId(state, "me");
    const bearsId = permanent(state, BEARS).id;
    const activation = enumerateMoves(state, botId).find(
        (m) =>
            m.kind === "activate-ability" &&
            m.targets.some((t) => t.type === "permanent" && t.id === bearsId)
    );
    expect(
        activation,
        "the grant on the Bears must be enumerable"
    ).toBeDefined();
    applyMoveInSearch(state, botId, activation!);
    for (let i = 0; i < 4 && state.stack.length > 0; i++) {
        const owed = decidingPlayer(state);
        if (!owed) break;
        applyMoveInSearch(state, owed, { kind: "pass" });
    }
    expect(permanent(state, BEARS).staticAbilities).toContain("flying");
    return state;
}

describe("a this-turn keyword grant is not lasting material (#5927, CR 514.2)", () => {
    it("flying granted until end of turn moves the creature's realized worth not at all", () => {
        const state = buildBladeState(
            scenario("transient-grant", boardSpec("Hill Giant"))
        );
        const before = evaluateCreature(state, permanent(state, BEARS));

        withFlyingGranted(state);
        const bears = permanent(state, BEARS);
        expect(temporaryCombatKeywords(state, bears)).toEqual(["flying"]);
        expect(temporaryDefensiveKeywords(state, bears)).toEqual([]);
        // The raw body DOES carry the credit — the leaf is what takes it back.
        const mv = 2;
        expect(
            creatureValueRaw(2, 2, mv, bears.staticAbilities)
        ).toBeGreaterThan(
            creatureValueRaw(2, 2, mv, lastingStaticAbilities(state, bears))
        );
        expect(evaluateCreature(state, bears)).toBe(before);
    });

    it("a creature that can't attack loses the granted keyword once, not twice (review finding)", () => {
        // The opposing Bears under Manacles of Decay ("Enchanted creature
        // can't attack"): the restriction discount prices the attack share
        // off the LASTING keywords, so granting flying moves the restricted
        // body's worth not at all either — before the fix it read −15 (the
        // attack share's 0.75 × 20 on top of the full take-back), which the
        // Bot saw as a +15 gain from giving an opposing Pacified creature
        // flying.
        const state = buildBladeState(
            scenario(
                "restricted-grant",
                boardSpec("Hill Giant", {
                    cards: [
                        ...boardSpec("Hill Giant").cards,
                        {
                            name: "Manacles of Decay",
                            owner: "me",
                            zone: "battlefield",
                            attachedTo: BEARS,
                        },
                    ],
                })
            )
        );
        const before = evaluateCreature(state, permanent(state, BEARS));
        withFlyingGranted(state);
        const bears = permanent(state, BEARS);
        expect(temporaryCombatKeywords(state, bears)).toEqual(["flying"]);
        expect(evaluateCreature(state, bears)).toBe(before);
    });

    it("a PRINTED keyword is not a transient grant and keeps its flat worth", () => {
        const state = buildBladeState(
            scenario("printed-reach", boardSpec("Giant Spider"))
        );
        const spider = permanent(state, "Giant Spider");
        expect(spider.staticAbilities).toContain("reach");
        expect(temporaryCombatKeywords(state, spider)).toEqual([]);
    });
});

describe("a grant with no combat window is pruned (#5927, `isFutileThisTurnMove`)", () => {
    /** The root decision of `spec` for the bot seat, seed 1, 200 iterations.
     *  The trace is null when the prune left `pass` as the only candidate. */
    function decide(spec: ScenarioSpec) {
        const state = buildBladeState(scenario("decision", spec));
        const botId = seatPlayerId(state, "me");
        return searchWithTrace(state, botId, { iterations: 200 }, 1);
    }

    /** The Disciple's activations the bot can make, by target name. */
    function grantsOn(state: GameState, target: string): Move[] {
        const botId = seatPlayerId(state, "me");
        const targetId = permanent(state, target).id;
        return enumerateMoves(state, botId).filter(
            (m) =>
                m.kind === "activate-ability" &&
                m.cardInstanceId === permanent(state, DISCIPLE).id &&
                m.targets.some(
                    (t) => t.type === "permanent" && t.id === targetId
                )
        );
    }

    function onlyGrantOn(state: GameState, target: string): Move {
        const grants = grantsOn(state, target);
        expect(grants).toHaveLength(1);
        return grants[0];
    }

    it("prunes a flying grant into a reach blocker: the block set is unchanged (CR 702.17b)", () => {
        const spec = boardSpec("Giant Spider");
        const state = buildBladeState(scenario("reach", spec));
        const grant = onlyGrantOn(state, BEARS);
        expect(isFutileThisTurnMove(state, grant)).toBe(true);
        // Wired into the root enumeration's dominance prune.
        const botId = seatPlayerId(state, "me");
        expect(
            enumerateMoves(state, botId, { pruneDominatedNoOps: true })
        ).not.toContainEqual(grant);
        expect(decide(spec).move).toEqual({ kind: "pass" });
    });

    it("keeps the grant that converts: flying past a ground blocker for lethal (CR 702.9b)", () => {
        const spec = boardSpec("Hill Giant", { life: { opp: 2 } });
        const state = buildBladeState(scenario("ground", spec));
        expect(isFutileThisTurnMove(state, onlyGrantOn(state, BEARS))).toBe(
            false
        );
        const won = decide(spec);
        expect(won.trace?.chosen).toBe(`activate ${DISCIPLE} → ${BEARS}`);
    });

    it("keeps the grant on the bot's own declared attacker while blocks are open (CR 509.1b)", () => {
        const state = buildBladeState(
            scenario(
                "attacking",
                boardSpec("Hill Giant", {
                    phase: "DECLARE_ATTACKERS",
                    combat: { attackers: [BEARS], confirmed: true },
                })
            )
        );
        expect(isFutileThisTurnMove(state, onlyGrantOn(state, BEARS))).toBe(
            false
        );
    });

    it("prunes the grant at the opponent's end step: no combat is left before cleanup (CR 514.2)", () => {
        const state = buildBladeState(
            scenario(
                "end-step",
                boardSpec("Hill Giant", {
                    phase: "END_STEP",
                    turn: 6,
                    activePlayer: "opp",
                    priority: "me",
                })
            )
        );
        expect(isFutileThisTurnMove(state, onlyGrantOn(state, BEARS))).toBe(
            true
        );
    });

    it("keeps the grant on the opponent's turn once attackers are declared: the Bears may block (CR 509.1a)", () => {
        const state = buildBladeState(
            scenario(
                "blocking",
                boardSpec("Hill Giant", {
                    phase: "DECLARE_ATTACKERS",
                    turn: 6,
                    activePlayer: "opp",
                    priority: "me",
                    combat: { attackers: ["Hill Giant"], confirmed: true },
                })
            )
        );
        expect(isFutileThisTurnMove(state, onlyGrantOn(state, BEARS))).toBe(
            false
        );
    });

    it("keeps the flying grant that is what lets the creature attack under Moat", () => {
        const base = boardSpec("Hill Giant");
        const state = buildBladeState(
            scenario("moat", {
                ...base,
                cards: [
                    ...base.cards,
                    { name: "Moat", owner: "opp", zone: "battlefield" },
                ],
            })
        );
        expect(isFutileThisTurnMove(state, onlyGrantOn(state, BEARS))).toBe(
            false
        );
    });

    it("keeps the grant on the opposing creature while the bot holds a keyword reader (Hurricane)", () => {
        const base = boardSpec("Hill Giant", {
            phase: "END_STEP",
            turn: 6,
            activePlayer: "opp",
            priority: "me",
        });
        const state = buildBladeState(
            scenario("reader", {
                ...base,
                cards: [
                    ...base.cards.filter((c) => c.name !== BEARS),
                    { name: "Hurricane", owner: "me", zone: "hand" },
                ],
            })
        );
        const botId = seatPlayerId(state, "me");
        const grant = onlyGrantOn(state, "Hill Giant");
        expect(isFutileThisTurnMove(state, grant)).toBe(false);
        expect(isMisdirectedThisTurnMove(state, grant, botId)).toBe(false);
    });

    it("keeps the colour rider while a colour reader is in hand (Terror's nonblack)", () => {
        const base = boardSpec("Hill Giant", {
            phase: "END_STEP",
            turn: 6,
            activePlayer: "opp",
            priority: "me",
        });
        const state = buildBladeState(
            scenario("colour-reader", {
                ...base,
                cards: [
                    ...base.cards,
                    { name: "Terror", owner: "me", zone: "hand" },
                ],
            })
        );
        expect(isFutileThisTurnMove(state, onlyGrantOn(state, BEARS))).toBe(
            false
        );
    });

    it("keeps the grant on its own tapping source while an untap effect is in hand (Twiddle)", () => {
        const base = boardSpec("Hill Giant", { life: { opp: 2 } });
        const state = buildBladeState(
            scenario("untap", {
                ...base,
                cards: [
                    ...base.cards.filter((c) => c.name !== BEARS),
                    { name: "Twiddle", owner: "me", zone: "hand" },
                ],
            })
        );
        expect(isFutileThisTurnMove(state, onlyGrantOn(state, DISCIPLE))).toBe(
            false
        );
    });

    it("prunes a first-strike grant before attackers are declared, keeps it on the declared attacker (CR 510.4)", () => {
        const LEITBUR = "Order of Leitbur";
        const grantId = getCardByName(LEITBUR).activatedAbilities!.find((a) =>
            a.effects?.some((op) => "op" in op && op.op === "grantAbility")
        )!.id;
        const spec = (overrides: Partial<ScenarioSpec>): ScenarioSpec => ({
            cards: [
                {
                    name: LEITBUR,
                    owner: "me",
                    zone: "battlefield",
                    summoningSick: false,
                },
                { name: "Plains", owner: "me", zone: "battlefield", count: 2 },
                { name: "Hill Giant", owner: "opp", zone: "battlefield" },
            ],
            phase: "BEGINNING_OF_COMBAT",
            turn: 5,
            libraryCount: 20,
            ...overrides,
        });
        const grantOf = (state: GameState): Move => {
            const botId = seatPlayerId(state, "me");
            const found = enumerateMoves(state, botId).filter(
                (m) => m.kind === "activate-ability" && m.abilityId === grantId
            );
            expect(found).toHaveLength(1);
            return found[0];
        };
        const before = buildBladeState(scenario("leitbur-main", spec({})));
        expect(isFutileThisTurnMove(before, grantOf(before))).toBe(true);
        const attacking = buildBladeState(
            scenario(
                "leitbur-attacking",
                spec({
                    phase: "DECLARE_ATTACKERS",
                    combat: { attackers: [LEITBUR], confirmed: true },
                })
            )
        );
        expect(isFutileThisTurnMove(attacking, grantOf(attacking))).toBe(false);
    });

    it("prunes the grant on its own tapping source and misdirects the one on the opposing creature", () => {
        const base = boardSpec("Hill Giant", {
            phase: "END_STEP",
            turn: 6,
            activePlayer: "opp",
            priority: "me",
        });
        const state = buildBladeState(
            scenario("opponent-only", {
                ...base,
                cards: base.cards.filter((c) => c.name !== BEARS),
            })
        );
        const botId = seatPlayerId(state, "me");
        // CR 508.1a / 509.1a — the {T} in the cost leaves the source unable
        // to attack or block before the grant expires.
        expect(isFutileThisTurnMove(state, onlyGrantOn(state, DISCIPLE))).toBe(
            true
        );
        const gift = onlyGrantOn(state, "Hill Giant");
        expect(isMisdirectedThisTurnMove(state, gift, botId)).toBe(true);
        expect(
            enumerateMoves(state, botId, { pruneDominatedNoOps: true }).filter(
                (m) => m.kind === "activate-ability"
            )
        ).toEqual([]);
    });
});
