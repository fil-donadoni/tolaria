// "Lands you control enter untapped" — the static clause frame for the
// set-wide enters-untapped replacement (CR 614.1d), which its controller
// applies after any tapped-entry replacement (CR 616.1), issue #8586.
//
// Every corpus card printing the sentence (Spelunking, Horizon Explorer, The
// Wandering Minstrel, Warp Speed) prints a second line that is a different
// gap, so no card compiles whole: the sentence is pinned at the clause and
// lowering level instead, as untapLocks.test.ts pins Stasis.
//
// Three layers:
//
//  1. GOLDEN — the corpus cards' one shared line routes to the static slot, reads to the
//     clause and lowers to exactly this JSON-pure descriptor.
//  2. REFUSALS — the neighbours of the sentence stay unparsed.
//  3. BEHAVIOUR — the lowered descriptor, registered as-is, untaps a land its
//     controller plays that would enter tapped, at the real `applyPlayLand`
//     seam; a control run without it, and one where the OPPONENT controls it,
//     leave the land tapped.

import { describe, expect, it } from "vitest";
import { withTemporaryDefinition } from "../../cards/registry";
import type { CardDefinition } from "../../cards/types";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { applyPlayLand } from "../../gre/playLand";
import { routeLine } from "../grammar/router";
import { staticSlot } from "../grammar/slots/staticSlot";
import { lowerStaticClause } from "../lowerStatic";
import { parseContext } from "./oracle.fixture";

const SENTENCE = "Lands you control enter untapped.";

const CLAUSE = {
    kind: "enters-untapped-replacement",
    filter: { types: ["Land"], controllerRelation: "you" },
} as const;

/** The clause alone, through the static slot. */
function clause(line: string) {
    const parsed = staticSlot.run(line, parseContext());
    expect(parsed.ok, `expected "${line}" to parse`).toBe(true);
    if (!parsed.ok || parsed.value.kind !== "static")
        throw new Error("not a static clause");
    return parsed.value.clause;
}

function lowered(prefix: string) {
    const result = lowerStaticClause(
        CLAUSE,
        SENTENCE,
        (suffix) => `${prefix}-${suffix}`
    );
    if (!result.ok) throw new Error(result.reason);
    return result.lowered;
}

describe("enters-untapped replacement — golden (CR 614.1d / 616.1)", () => {
    it("Spelunking: the sentence reads to the clause and lowers to the engine's enters-untapped-replacement", () => {
        expect(clause(SENTENCE)).toEqual(CLAUSE);
        expect(lowered("spelunking")).toEqual({
            effects: [
                {
                    kind: "enters-untapped-replacement",
                    id: "spelunking-enters-untapped",
                    oracleText: SENTENCE,
                    filter: { types: "Land", controllerRelation: "you" },
                },
            ],
        });
    });

    it("the descriptor is JSON-pure", () => {
        const value = lowered("spelunking");
        expect(JSON.parse(JSON.stringify(value))).toEqual(value);
    });

    it("the printed line (all four cards print it verbatim) routes to the static slot", () => {
        const routed = routeLine(SENTENCE, parseContext());
        expect(routed.ok).toBe(true);
        if (routed.ok) expect(routed.value.slot).toBe("static");
    });
});

describe("enters-untapped replacement — refusals (fail-closed neighbours)", () => {
    const refused = [
        // Whose permanents: only the controller's own, as printed.
        "Lands enter untapped.",
        "Lands your opponents control enter untapped.",
        // A qualified subject the replacement does not read.
        "Nonbasic lands you control enter untapped.",
        "Tapped lands you control enter untapped.",
        // A singular subject is the self rider, not a set.
        "This land enters untapped.",
        // Another set: no card prints it, so the subject is no wildcard.
        "Creatures you control enter untapped.",
        "Artifacts and lands you control enter untapped.",
        // A different event wording.
        "Lands you control enter the battlefield untapped.",
        "Lands you control untap.",
    ];
    for (const line of refused) {
        it(`REFUSES "${line}"`, () => {
            expect(staticSlot.run(line, parseContext()).ok).toBe(false);
        });
    }
});

describe("enters-untapped replacement — the lowered descriptor at the real land play (CR 614.1d / 616.1)", () => {
    const SOURCE_ID = "compiled-spelunking-static";
    const TAPLAND_ID = "test-enters-tapped-land";

    const source: CardDefinition = {
        id: SOURCE_ID,
        rarity: "uncommon",
        name: "Spelunking",
        types: ["Enchantment"],
        compiledStaticEffects: lowered("spelunking").effects as never,
    };

    /** A land printing "This land enters tapped." (CR 614.1d). */
    const tapland: CardDefinition = {
        id: TAPLAND_ID,
        rarity: "common",
        name: "Tapped Entry Land",
        types: ["Land"],
        entersTapped: true,
    } as CardDefinition;

    function playTapland(sourceController: "p1" | "p2" | null) {
        return withTemporaryDefinition(source, () =>
            withTemporaryDefinition(tapland, () => {
                const land = makeInstance(TAPLAND_ID, {
                    id: "land",
                    zone: "hand",
                });
                const untapper = (controllerId: "p1" | "p2") =>
                    makeInstance(SOURCE_ID, {
                        id: "untapper",
                        controllerId,
                        ownerId: controllerId,
                    });
                const state = makeState({
                    players: [
                        makePlayer("p1", {
                            hand: [land],
                            battlefield:
                                sourceController === "p1"
                                    ? [untapper("p1")]
                                    : [],
                        }),
                        makePlayer("p2", {
                            battlefield:
                                sourceController === "p2"
                                    ? [untapper("p2")]
                                    : [],
                        }),
                    ],
                });
                const player = state.players[0];
                applyPlayLand(state, player, "land");
                return player.battlefield.find((c) => c.id === "land")!
                    .isTapped;
            })
        );
    }

    it("a land its controller plays enters untapped despite its own 'enters tapped'", () => {
        expect(playTapland("p1")).toBeFalsy();
    });

    it("control: without the source the same land enters tapped", () => {
        expect(playTapland(null)).toBe(true);
    });

    it("an OPPONENT's source does not apply ('you control')", () => {
        expect(playTapland("p2")).toBe(true);
    });
});
