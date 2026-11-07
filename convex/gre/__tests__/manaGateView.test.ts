// CR 602.5b / 613.4 — the `TriggerStateView` a mana ability's `canActivate` gate
// is evaluated against carries the characteristics the rest of the engine reads,
// whatever the source of each. Nothing here is keyed to a particular card with
// such a gate: the predicates are synthetic, the fixtures are plain creatures.

import { describe, expect, it } from "vitest";
import { getCardByName, getDefinition } from "../../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { SORIN_LORD_OF_INNISTRAD_EMBLEM_ID } from "../../cards/emblems";
import { withTemporaryDefinition } from "../../cards/registry";
import type { ActivatedAbility, CardDefinition } from "../../cards/types";
import { tapSourceIntoPayment } from "../../game";
import {
    getManaTapOptionsDetailed,
    manaGateBattlefields,
    manaGateStateView,
    minimalManaGateView,
} from "../constants";
import type { ContinuousEffect } from "../continuousEffects";
import { getEffectivePower, getEffectiveToughness } from "../layers";
import type { CardInstanceState, GameState } from "../state";

const LIONS = getCardByName("Savannah Lions").id;
const CRUSADE = getCardByName("Crusade").id;
const LHURGOYF = getCardByName("Lhurgoyf").id;
const BEARS = getCardByName("Grizzly Bears").id;

function layer7(
    sublayer: "7b" | "7c" | "7d",
    payload: ContinuousEffect["payload"],
    instanceId: string
): ContinuousEffect {
    return {
        id: `ce-${sublayer}`,
        layer: 7,
        sublayer,
        timestamp: 10,
        expiry: { kind: "indefinite", controllerId: "p1" },
        affected: { kind: "instances", instanceIds: [instanceId] },
        payload,
        characteristicDefining: false,
    } as ContinuousEffect;
}

/** Each row: a board where the subject's effective P/T differs from what its
 *  instance stores, by a different route through CR 613.4. */
const LAYER_7_ROUTES: ReadonlyArray<{
    route: string;
    build: (subject: CardInstanceState) => Partial<GameState> & {
        extraBattlefield?: CardInstanceState[];
        graveyard?: CardInstanceState[];
    };
    subject?: string;
}> = [
    {
        route: "+1/+1 counters (7c)",
        build: (subject) => {
            subject.counters = { "+1/+1": 2 };
            return {};
        },
    },
    {
        route: "an anthem-style static effect (7c)",
        build: () => ({
            extraBattlefield: [makeInstance(CRUSADE, { id: "anthem" })],
        }),
    },
    {
        route: "a set-P/T registry entry (7b)",
        build: (subject) => ({
            continuousEffects: [
                layer7(
                    "7b",
                    { kind: "pt-set", power: 5, toughness: 5 },
                    subject.id
                ),
            ],
        }),
    },
    {
        route: "an until-boundary pump registry entry (7c)",
        build: (subject) => ({
            continuousEffects: [
                layer7(
                    "7c",
                    { kind: "pt-modify", power: 3, toughness: 3 },
                    subject.id
                ),
            ],
        }),
    },
    {
        route: "a P/T switch registry entry (7d)",
        build: (subject) => ({
            continuousEffects: [
                layer7("7d", { kind: "pt-switch" }, subject.id),
            ],
        }),
    },
    {
        route: "a command-zone emblem anthem (CR 114)",
        build: () => ({
            emblems: [
                {
                    id: "emblem-1",
                    ownerId: "p1",
                    emblemId: SORIN_LORD_OF_INNISTRAD_EMBLEM_ID,
                    name: "Sorin, Lord of Innistrad emblem",
                    text: "Creatures you control get +1/+0.",
                },
            ],
        }),
    },
    {
        route: "a graveyard-counting characteristic-defining ability (7a)",
        subject: LHURGOYF,
        build: () => ({
            graveyard: [
                makeInstance(BEARS, { id: "dead-1", zone: "graveyard" }),
                makeInstance(BEARS, { id: "dead-2", zone: "graveyard" }),
            ],
        }),
    },
];

function boardFor(route: (typeof LAYER_7_ROUTES)[number]) {
    const subject = makeInstance(route.subject ?? LIONS, { id: "subject" });
    const { extraBattlefield, graveyard, ...stateFields } =
        route.build(subject);
    const state = makeState({
        players: [
            makePlayer("p1", {
                battlefield: [subject, ...(extraBattlefield ?? [])],
                graveyard: graveyard ?? [],
            }),
            makePlayer("p2"),
        ],
        ...stateFields,
    });
    return { state, subject };
}

describe("the mana-gate view's P/T are the layer system's (CR 613.4)", () => {
    for (const route of LAYER_7_ROUTES) {
        it(`agrees with getEffectivePower/Toughness under ${route.route}`, () => {
            const { state, subject } = boardFor(route);
            const power = getEffectivePower(state, subject);
            const toughness = getEffectiveToughness(state, subject);
            // Not vacuous: the route really moved a value off the stored one.
            expect([power, toughness]).not.toEqual([
                subject.power,
                subject.toughness,
            ]);

            const row = minimalManaGateView(
                manaGateBattlefields(state)
            ).players[0]!.battlefield.find((c) => c.id === subject.id)!;
            expect([row.power, row.toughness]).toEqual([power, toughness]);
        });
    }
});

describe("the mana-gate view's player state is real (CR 602.5b)", () => {
    it("carries life, hand size, graveyard and the active player", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    life: 13,
                    hand: [makeInstance(BEARS, { zone: "hand" })],
                    graveyard: [
                        makeInstance(LIONS, { id: "dead", zone: "graveyard" }),
                    ],
                    drawnThisTurn: ["drawn-1"],
                    leftGraveyardThisTurn: 2,
                }),
                makePlayer("p2"),
            ],
            activePlayerId: "p2",
        });
        const view = minimalManaGateView(manaGateBattlefields(state));
        const p1 = view.players[0]!;
        expect(p1.life).toBe(13);
        expect(p1.hand.length).toBe(1);
        expect(p1.graveyard?.map((c) => c.id)).toEqual(["dead"]);
        expect(p1.drawnThisTurn).toEqual(["drawn-1"]);
        expect(p1.leftGraveyardThisTurn).toBe(2);
        expect(view.activePlayerId).toBe("p2");
    });

    it("carries each permanent's live characteristics", () => {
        const token = makeInstance(LIONS, { id: "token", isToken: true });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [token] }),
                makePlayer("p2"),
            ],
        });
        const row = minimalManaGateView(manaGateBattlefields(state)).players[0]!
            .battlefield[0]!;
        expect(row.isToken).toBe(true);
        expect(row.colors).toEqual(["W"]);
        expect(row.supertypes).toEqual([]);
        // CR 613.1d — the layer-4 walk stamps its output on the instance.
        expect(row.types).toBe(token.types);
    });
});

/** A permanent whose ONLY mana ability is gated on `gate`: the shape where the
 *  first-ability readers (`getActivatedManaAbility`, `hasManaAbility`) are the
 *  gate too, not just the option list. */
function gatedManaSource(
    gate: ActivatedAbility["canActivate"]
): CardDefinition {
    return {
        ...getDefinition(LIONS),
        activatedAbilities: [
            {
                id: "gated-mana",
                oracleText: "{T}: Add {G}. Activate only if the gate holds.",
                cost: { tap: true },
                useStack: false,
                manaProduced: { G: 1 },
                canActivate: gate,
            },
        ],
    };
}

function pumpedBoard(source: CardInstanceState, pump: number) {
    return makeState({
        players: [
            makePlayer("p1", { battlefield: [source] }),
            makePlayer("p2"),
        ],
        continuousEffects: [
            layer7(
                "7c",
                { kind: "pt-modify", power: pump, toughness: 0 },
                source.id
            ),
        ],
    });
}

describe("a mana gate reading P/T sees effective values at every reader", () => {
    it("the option list hands the predicate an effective `source` (CR 613.4)", () => {
        const def = gatedManaSource((source) => (source.power ?? 0) >= 4);
        withTemporaryDefinition(def, () => {
            const source = makeInstance(def.id, { id: "source" });
            const options = (state: GameState) =>
                getManaTapOptionsDetailed(
                    source,
                    "p1",
                    manaGateBattlefields(state)
                );
            expect(options(pumpedBoard(source, 2))).toHaveLength(1);
            expect(options(pumpedBoard(source, 1))).toHaveLength(0);
        });
    });

    it("the payment tap resolves its ability through the view: a gate open only under a pump still has a {T} cost (CR 302.6)", () => {
        const def = gatedManaSource(
            (_source, view) =>
                (view.players[0]!.battlefield[0]!.power ?? 0) >= 4
        );
        withTemporaryDefinition(def, () => {
            // Summoning-sick: the refusal needs the ABILITY's {T} leg, which a
            // gate wrongly read as shut would have hidden from this tap.
            const source = makeInstance(def.id, {
                id: "source",
                isSummoningSick: true,
            });
            const pumped = pumpedBoard(source, 2);
            expect(
                manaGateStateView(pumped).players[0]!.battlefield[0]!.power
            ).toBe(getEffectivePower(pumped, source));
            expect(() =>
                tapSourceIntoPayment(
                    pumped,
                    pumped.players[0]!,
                    source,
                    undefined,
                    []
                )
            ).toThrow("Creature has summoning sickness");
        });
    });
});

describe("a hand-built board keeps working (CR 602.5b)", () => {
    it("reads counters and statics off the rows it was given", () => {
        const subject = makeInstance(LIONS, {
            id: "subject",
            counters: { "+1/+1": 2 },
        });
        const anthem = makeInstance(CRUSADE, { id: "anthem" });
        const view = minimalManaGateView([
            { playerId: "p1", battlefield: [subject, anthem] },
        ]);
        // 2/1 base, +2 from counters (7c), +1 from Crusade (7c).
        expect(view.players[0]!.battlefield[0]!.power).toBe(5);
        expect(view.players[0]!.life).toBe(0);
    });

    it("threads an explicit registry when the rows carry no layer input", () => {
        const subject = makeInstance(LIONS, { id: "subject" });
        const view = minimalManaGateView(
            [{ playerId: "p1", battlefield: [subject] }],
            [layer7("7b", { kind: "pt-set", power: 6 }, subject.id)]
        );
        expect(view.players[0]!.battlefield[0]!.power).toBe(6);
    });

    it("no board at all is the empty view: a board-dependent gate stays shut", () => {
        expect(minimalManaGateView(undefined)).toEqual({ players: [] });
    });
});
