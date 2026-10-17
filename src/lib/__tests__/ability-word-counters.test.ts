// Live count-based ability-word counters of the card preview (issue #5491).
// Ability words have no rules meaning (CR 207.2c); each count is the engine's
// own pure function, read through the PROJECTED client state.
import { describe, it, expect } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "@convex/cards/__tests__/setup.helper";
import {
    forest,
    island,
    mountain,
    plains,
    swamp,
    tundra,
} from "@convex/cards/sets/lea/colorless.cards";
import { lightningBolt } from "@convex/cards/sets/lea/red.cards";
import { grizzlyBears } from "@convex/cards/sets/lea/green.cards";
import { tribalFlames } from "@convex/cards/sets/inv/red.cards";
import { moxOpal } from "@convex/cards/sets/som/colorless.cards";
import { thassasOracle } from "@convex/cards/sets/thb/blue.cards";
import { unholyHeat } from "@convex/cards/sets/mh2/red.cards";
import { countDomain } from "@convex/cards/types";
import { projectPublicState } from "@convex/gameProjections";
import type { CardInstanceState, GameState } from "@convex/gre/state";
import {
    ABILITY_WORD_COUNTERS,
    ABILITY_WORD_SOURCE,
    computeAbilityWordCounters,
    formatAbilityWordCounter,
    rowForMatch,
} from "../ability-word-counters";
import { buildPreviewBody } from "../preview-body";
import type { Player } from "~/types/game";

function stateWith(p1: {
    battlefield?: CardInstanceState[];
    graveyard?: CardInstanceState[];
}): GameState {
    return makeState({
        players: [
            makePlayer("p1", {
                battlefield: p1.battlefield ?? [],
                graveyard: p1.graveyard ?? [],
            }),
            // The opponent's permanents never count toward p1's total.
            makePlayer("p2", {
                battlefield: [
                    makeInstance(moxOpal().id, { controllerId: "p2" }),
                    makeInstance(swamp().id, { controllerId: "p2" }),
                ],
            }),
        ],
    });
}

function projectedPlayers(state: GameState): Player[] {
    return (
        projectPublicState(state, 1, "p1") as unknown as { players: Player[] }
    ).players;
}

function counterFor(state: GameState, text: string) {
    return computeAbilityWordCounters([text], projectedPlayers(state), "p1");
}

const onField = (id: string) => makeInstance(id, { controllerId: "p1" });
const inGrave = (id: string) =>
    makeInstance(id, { controllerId: "p1", zone: "graveyard" });

describe("ability-word counter table — every row's pattern is live", () => {
    for (const row of ABILITY_WORD_COUNTERS) {
        for (const form of row.oracleForms) {
            it(`${row.key} matches its own oracle form: "${form.slice(0, 40)}…"`, () => {
                const hits = [
                    ...form.matchAll(new RegExp(ABILITY_WORD_SOURCE, "g")),
                ].map((m) => rowForMatch(m[0])?.key);
                expect(hits).toContain(row.key);
            });
        }
    }

    it("matches whole words only — Covenant is not Coven", () => {
        const words = [
            ..."Covenant of Minds. Domains.".matchAll(
                new RegExp(ABILITY_WORD_SOURCE, "g")
            ),
        ];
        expect(words).toEqual([]);
    });

    it("placeholder rows (no engine count) render no counter", () => {
        const placeholders = ABILITY_WORD_COUNTERS.filter((r) => !r.count);
        expect(placeholders.map((r) => r.key).sort()).toEqual(
            [
                "coven",
                "corrupted",
                "descend-4",
                "descend-8",
                "fateful-hour",
                "ferocious",
                "formidable",
                "hellbent",
                "party",
                "spell-mastery",
            ].sort()
        );
        const state = stateWith({});
        for (const row of placeholders) {
            expect(counterFor(state, row.oracleForms[0])).toBeNull();
        }
    });
});

describe("Domain (CR 305.6) — engine count over the projected state", () => {
    it("equals countDomain on the same engine state, opponent lands excluded", () => {
        const state = stateWith({
            battlefield: [
                onField(plains().id),
                onField(plains().id),
                onField(tundra().id), // Plains Island — two types, one new
                onField(forest().id),
            ],
        });
        const counter = counterFor(state, tribalFlames().oracleText!)!.get(
            "Domain"
        )!;
        expect(counter.have).toBe(countDomain(state as never, "p1"));
        expect(counter.have).toBe(3);
        expect(formatAbilityWordCounter(counter)).toBe("3/5");
        expect(counter.met).toBe(false);
    });

    it("is met only at five types — the opponent's Swamp never completes it", () => {
        const four = [plains, island, mountain, forest, tundra].map((c) =>
            onField(c().id)
        );
        expect(
            counterFor(stateWith({ battlefield: four }), "Domain — x")!.get(
                "Domain"
            )
        ).toEqual(expect.objectContaining({ have: 4, met: false }));
        const five = [...four, onField(swamp().id)];
        expect(
            counterFor(stateWith({ battlefield: five }), "Domain — x")!.get(
                "Domain"
            )
        ).toEqual(expect.objectContaining({ have: 5, met: true }));
    });

    it("chips the unprefixed phrase too", () => {
        const state = stateWith({ battlefield: [onField(island().id)] });
        const counters = counterFor(
            state,
            "costs {1} less for each basic land type among lands you control."
        )!;
        expect(
            counters.get("basic land type among lands you control")!.have
        ).toBe(1);
    });

    it("a previewed Domain card carries the controller's count", () => {
        const state = stateWith({
            battlefield: [onField(island().id), onField(forest().id)],
            graveyard: [],
        });
        const players = projectedPlayers(state);
        const flames = makeInstance(tribalFlames().id, {
            controllerId: "p1",
            zone: "hand",
        });
        const body = buildPreviewBody(tribalFlames().id, flames as never, {
            allPlayers: players,
            playerId: "p1",
        });
        expect(body.abilityWordCounters?.get("Domain")?.have).toBe(2);
        // Deck builder (no game context): no counters at all.
        expect(
            buildPreviewBody(tribalFlames().id).abilityWordCounters
        ).toBeNull();
    });
});

describe("Devotion (CR 700.5) — uncapped, per named colour", () => {
    it("counts the named colour's pips among the controller's permanents", () => {
        // Thassa's Oracle {U}{U}: devotion to blue 2; Mox Opal adds none.
        const state = stateWith({
            battlefield: [onField(thassasOracle().id), onField(moxOpal().id)],
        });
        const counter = counterFor(state, thassasOracle().oracleText!)!.get(
            "devotion to blue"
        )!;
        expect(counter.have).toBe(2);
        expect(counter.met).toBeNull();
        expect(formatAbilityWordCounter(counter)).toBe("2");
    });

    it("refuses the two-colour form the engine does not count", () => {
        const state = stateWith({});
        expect(counterFor(state, "your devotion to blue and red")).toBeNull();
    });
});

describe("Metalcraft — three or more artifacts", () => {
    it("is unmet at 2 and met at 3 controlled artifacts", () => {
        const two = stateWith({
            battlefield: [onField(moxOpal().id), onField(moxOpal().id)],
        });
        expect(counterFor(two, "Metalcraft — x")!.get("Metalcraft")).toEqual(
            expect.objectContaining({ have: 2, met: false })
        );
        const three = stateWith({
            battlefield: [1, 2, 3].map(() => onField(moxOpal().id)),
        });
        expect(counterFor(three, "Metalcraft — x")!.get("Metalcraft")).toEqual(
            expect.objectContaining({ have: 3, met: true })
        );
    });
});

describe("Delirium — four card types in your graveyard", () => {
    it("is unmet at 3 distinct types and met at 4", () => {
        const three = [
            inGrave(lightningBolt().id),
            inGrave(lightningBolt().id),
            inGrave(grizzlyBears().id),
            inGrave(plains().id),
        ];
        const at3 = counterFor(
            stateWith({ graveyard: three }),
            unholyHeat().oracleText!
        )!.get("Delirium")!;
        expect(at3).toEqual(expect.objectContaining({ have: 3, met: false }));
        expect(formatAbilityWordCounter(at3)).toBe("3/4");
        const at4 = counterFor(
            stateWith({ graveyard: [...three, inGrave(moxOpal().id)] }),
            "Delirium — x"
        )!.get("Delirium")!;
        expect(at4).toEqual(expect.objectContaining({ have: 4, met: true }));
    });
});

describe("Threshold — seven cards in your graveyard", () => {
    it("is unmet at 6 cards and met at 7", () => {
        const cards = (n: number) =>
            Array.from({ length: n }, () => inGrave(grizzlyBears().id));
        expect(
            counterFor(
                stateWith({ graveyard: cards(6) }),
                "Threshold — x"
            )!.get("Threshold")
        ).toEqual(expect.objectContaining({ have: 6, met: false }));
        expect(
            counterFor(
                stateWith({ graveyard: cards(7) }),
                "Threshold — x"
            )!.get("Threshold")
        ).toEqual(expect.objectContaining({ have: 7, met: true }));
    });
});

describe("perspective — the card's controller, then owner, then viewer", () => {
    // Viewer p1: Island + Forest (Domain 2). p2: a Swamp (Domain 1).
    const state = stateWith({
        battlefield: [onField(island().id), onField(forest().id)],
    });
    const players = projectedPlayers(state);
    const domainOf = (overrides: Partial<CardInstanceState>) =>
        buildPreviewBody(
            tribalFlames().id,
            makeInstance(tribalFlames().id, {
                zone: "battlefield",
                ...overrides,
            }) as never,
            { allPlayers: players, playerId: "p1" }
        ).abilityWordCounters?.get("Domain")?.have;

    it("reads the controller's board, not the viewer's", () => {
        expect(domainOf({ controllerId: "p2", ownerId: "p1" })).toBe(1);
    });

    it("falls back to the owner when there is no controller", () => {
        expect(
            domainOf({ controllerId: undefined as never, ownerId: "p2" })
        ).toBe(1);
    });

    it("shows no chip for a seat absent from the projected players", () => {
        expect(domainOf({ controllerId: "ghost", ownerId: "ghost" })).toBe(
            undefined
        );
    });
});
