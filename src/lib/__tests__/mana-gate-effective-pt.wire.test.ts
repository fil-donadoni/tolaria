// CR 613.4 / 602.1b — a mana ability's `canActivate` gate through the wire. The
// board crosses the real projection and the client's own mana-choice helper,
// which must produce the list the server resolves the submitted index against.
// A server-only test passes while the prompt offers the wrong amounts.

import { describe, expect, it } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "@convex/cards/__tests__/setup.helper";
import { getCardByName } from "@convex/cards";
import { projectPublicState } from "@convex/gameProjections";
import {
    getManaTapOptions,
    manaGateBattlefields,
    minimalManaGateView,
} from "@convex/gre/constants";
import type { ContinuousEffect } from "@convex/gre/continuousEffects";
import { SORIN_LORD_OF_INNISTRAD_EMBLEM_ID } from "@convex/cards/emblems";
import type { CardInstanceState, GameState } from "@convex/gre/state";
import type { CardInstance, Player } from "~/types/game";
import {
    buildTriggerStateView,
    getManaChoices,
    hasManaAbility,
    withManaLayers,
} from "../card-utils";

const FANATIC = getCardByName("Fanatic of Rhonas").id;
const ANGEL = getCardByName("Serra Angel").id; // printed 4/4
const GIANT = getCardByName("Hill Giant").id; // printed 3/3
const LIONS = getCardByName("Savannah Lions").id; // printed 2/1, white
const CRUSADE = getCardByName("Crusade").id;
const GREEN = { G: 1 };
const FEROCIOUS = { G: 4 };

function layer7(
    sublayer: "7b" | "7c",
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

/** `battlefield` beside a Fanatic, on the server and across the wire. */
function bothSides(
    battlefield: CardInstanceState[],
    fields: Partial<GameState> = {}
) {
    const fanatic = makeInstance(FANATIC, { id: "fanatic" });
    const state = makeState({
        players: [
            makePlayer("p1", { battlefield: [fanatic, ...battlefield] }),
            makePlayer("p2"),
        ],
        ...fields,
    });
    const projected = projectPublicState(state, 1, "p1");
    const players = projected.players as unknown as Player[];
    const manaPlayers = withManaLayers(
        players,
        projected.activePlayerId,
        projected.emblems,
        projected.continuousEffects
    );
    const slim = players[0]!.battlefield.find(
        (c) => c.id === "fanatic"
    ) as CardInstance;
    return {
        server: getManaTapOptions(fanatic, "p1", manaGateBattlefields(state)),
        client: getManaChoices(slim, manaPlayers),
        state,
        players,
        projected,
        slim,
        manaPlayers,
    };
}

const giant = () => makeInstance(GIANT, { id: "giant" });
const angel = () => makeInstance(ANGEL, { id: "angel" });

const OFFERED: ReadonlyArray<[string, () => ReturnType<typeof bothSides>]> = [
    ["a printed 4-power creature", () => bothSides([angel()])],
    [
        "a 3/3 with two +1/+1 counters (7c)",
        () =>
            bothSides([
                makeInstance(GIANT, {
                    id: "giant",
                    counters: { "+1/+1": 2 },
                }),
            ]),
    ],
    [
        "an anthem-style static effect (7c)",
        () =>
            bothSides([
                makeInstance(LIONS, { id: "lions" }),
                makeInstance(CRUSADE, { id: "anthem-1" }),
                makeInstance(CRUSADE, { id: "anthem-2" }),
            ]),
    ],
    [
        "a set-P/T effect (7b)",
        () =>
            bothSides([giant()], {
                continuousEffects: [
                    layer7("7b", { kind: "pt-set", power: 5 }, "giant"),
                ],
            }),
    ],
    [
        "an until-boundary pump (7c)",
        () =>
            bothSides([giant()], {
                continuousEffects: [
                    layer7(
                        "7c",
                        { kind: "pt-modify", power: 1, toughness: 1 },
                        "giant"
                    ),
                ],
            }),
    ],
    [
        "an emblem anthem (CR 114)",
        () =>
            bothSides([giant()], {
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
    ],
];

const NOT_OFFERED: ReadonlyArray<[string, () => ReturnType<typeof bothSides>]> =
    [
        ["a printed 3-power creature", () => bothSides([giant()])],
        [
            "a printed 4-power creature shrunk below 4 (7c)",
            () =>
                bothSides([angel()], {
                    continuousEffects: [
                        layer7(
                            "7c",
                            { kind: "pt-modify", power: -1, toughness: -1 },
                            "angel"
                        ),
                    ],
                }),
        ],
        [
            "a printed 4-power creature set below 4 (7b)",
            () =>
                bothSides([angel()], {
                    continuousEffects: [
                        layer7("7b", { kind: "pt-set", power: 1 }, "angel"),
                    ],
                }),
        ],
    ];

describe("Ferocious through projectPublicState (CR 613.4 / 602.1b)", () => {
    for (const [name, build] of OFFERED) {
        it(`${name}: server and client both list {G} and {G}{G}{G}{G}`, () => {
            const { server, client } = build();
            expect(server).toEqual([GREEN, FEROCIOUS]);
            expect(client).toEqual(server);
        });
    }

    for (const [name, build] of NOT_OFFERED) {
        it(`${name}: neither lists {G}{G}{G}{G}, so no prompt opens`, () => {
            const { server, client } = build();
            expect(server).toEqual([GREEN]);
            // One option is a plain tap: `manaTapNeedsChoice` and
            // `getManaChoices` both skip the prompt.
            expect(client).toBeNull();
        });
    }

    it("a player list with no layer input still reads counters and statics off the wire", () => {
        const { players, slim } = bothSides([
            makeInstance(GIANT, { id: "giant", counters: { "+1/+1": 2 } }),
        ]);
        expect(getManaChoices(slim, players)).toEqual([GREEN, FEROCIOUS]);
    });

    it("hasManaAbility hands a gated-only source the same layer input", () => {
        const { slim, manaPlayers, players, projected } = bothSides([giant()], {
            continuousEffects: [
                layer7(
                    "7c",
                    { kind: "pt-modify", power: 1, toughness: 1 },
                    "giant"
                ),
            ],
        });
        const view = buildTriggerStateView(
            players,
            projected.activePlayerId,
            undefined,
            undefined,
            undefined,
            projected.continuousEffects,
            projected.emblems
        );
        expect(hasManaAbility(slim, view, manaPlayers)).toBe(true);
    });
});

describe("the two view builders agree on one board (CR 602.1b)", () => {
    it("every row of the server's gate view equals the client's", () => {
        const { state, players, projected } = bothSides(
            [
                makeInstance(GIANT, {
                    id: "giant",
                    counters: { "+1/+1": 2 },
                }),
                makeInstance(LIONS, { id: "lions", isToken: true }),
                makeInstance(CRUSADE, { id: "anthem" }),
            ],
            {
                continuousEffects: [
                    layer7("7b", { kind: "pt-set", power: 6 }, "lions"),
                ],
            }
        );
        const server = minimalManaGateView(manaGateBattlefields(state));
        const client = buildTriggerStateView(
            players,
            projected.activePlayerId,
            undefined,
            undefined,
            undefined,
            projected.continuousEffects,
            projected.emblems
        );
        const row = ({ card, ...rest }: Record<string, unknown>) => ({
            ...rest,
            // The wire slims a definition reference to its id; everything else
            // must match field for field.
            cardId: (card as { id: string }).id,
        });
        expect(
            server.players.map((p) => p.battlefield.map(row as never))
        ).toEqual(client.players.map((p) => p.battlefield.map(row as never)));
        expect(
            server.players.map((p) => [p.id, p.life, p.hand.length])
        ).toEqual(client.players.map((p) => [p.id, p.life, p.hand.length]));
    });
});
