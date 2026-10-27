// A this-turn evasion / combat keyword grant is not lasting material
// (issue #5927).
//
// Two subjects. (1) `evaluateCreature`'s take-back of the flat `KEYWORD_BONUS`
// credit for a keyword that reached the creature through a duration-scoped
// grant (`ai/defensiveGrants.ts`' `temporaryCombatKeywords`) — the keyword
// twin of the until-end-of-turn P/T exclusion (ADR 0020 §2), unconditional
// where the defensive rows (issue #2937) keep their threat gate. (2) The
// transient-spend shape of the `standing-spend-hold` root rule, which holds
// such an activation when its settled position is no better than passing.
//
// Every position is built through the REAL blade builder; the grant on the
// board is the one a live activation produces (CR 611.2a), never a
// hand-written `staticAbilities` literal.

import { afterEach, describe, expect, it } from "vitest";
import { buildBladeState } from "../blade/runner";
import { getCardByName } from "../../../cards";
import { seatPlayerId } from "../blade/matcher";
import {
    applyMoveInSearch,
    decidingPlayer,
    searchWithTrace,
} from "../../search";
import { enumerateMoves } from "../../moves";
import { evaluateCreature } from "../../evaluate";
import { creatureValueRaw } from "../../creatureBody";
import {
    lastingStaticAbilities,
    temporaryCombatKeywords,
    temporaryDefensiveKeywords,
} from "../defensiveGrants";
import { setSearchVariant } from "../searchVariant";
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

describe("the transient-spend hold (#5927, `standing-spend-hold`)", () => {
    afterEach(() => setSearchVariant(null));

    /** The root decision of `spec` for the bot seat, seed 1, 200 iterations. */
    function decide(spec: ScenarioSpec) {
        const state = buildBladeState(scenario("decision", spec));
        const botId = seatPlayerId(state, "me");
        const { trace } = searchWithTrace(state, botId, { iterations: 200 }, 1);
        expect(trace).not.toBeNull();
        return trace!;
    }

    it("holds a flying grant into a reach blocker, and the rule is what holds it", () => {
        const spec = boardSpec("Giant Spider");
        const held = decide(spec);
        expect(held.chosen).toBe("pass");
        expect(held.mechanism).toBe("standing-spend-hold");

        // With the rule off the same search spends the grant: the pick is the
        // search's own tie-break reading rollout noise, which is the blunder.
        setSearchVariant({
            name: "no-hold",
            disabledRootRules: ["standing-spend-hold"],
        });
        const spent = decide(spec);
        expect(spent.chosen).toMatch(/^activate Disciple of Kangee/);
    });

    it("still takes the grant that converts: flying past a ground blocker for lethal", () => {
        const won = decide(boardSpec("Hill Giant", { life: { opp: 2 } }));
        expect(won.chosen).toBe(`activate ${DISCIPLE} → ${BEARS}`);
        expect(won.mechanism).not.toBe("standing-spend-hold");
    });
});
