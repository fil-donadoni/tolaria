// Board-granted CASTING PERMISSIONS — CR 601.3 (a rule or effect allows the
// cast), CR 118.9 ("a cost … applied to it from another effect"), CR 601.3b /
// 702.8a ("as though they had flash" = "any time you could cast an instant"),
// CR 101.2 (a restriction beats a permission).
//
// The mechanism, not the card: Aluren (TMP, issue #2706) is the shipped
// `cast-permission` static, but every assertion below is about the KIND —
// grantee scoping, the declarative filter, the two independent terms, the
// CR 118.9a mutual exclusion with a card's own alternative costs, and the
// permission ceasing the instant its source leaves the battlefield.

import { describe, expect, it } from "vitest";
import { aluren } from "../../cards/sets/tmp/green";
import { grizzlyBears } from "../../cards/sets/lea/green";
import { lightningBolt, shivanDragon } from "../../cards/sets/lea/red";
import { forest } from "../../cards/sets/lea/colorless";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import { withTemporaryDefinition } from "../../cards/registry";
import type { CardDefinition } from "../../cards/types";
import {
    CAST_PERMISSION_ALT_COST_PREFIX,
    castOptionAlternativeCosts,
    castPermissionAltCosts,
    collectCastPermissions,
    hasCastPermissionFlash,
} from "../castPermissions";
import { castPermissionRequiredFor, getLegalActions } from "../rules";
import { getPlayer } from "../state";
import type { CardInstanceState, GameState } from "../state";

const ALUREN_ALT_COST_ID = `${CAST_PERMISSION_ALT_COST_PREFIX}aluren-creature-permission`;

/** p1 controls `alurens` copies of Aluren; `handOf` names the card each player
 *  holds. Nobody has a land untapped by default — a cast that happens here
 *  happened because the permission paid for it, not because the mana did. */
function board(opts: {
    alurens?: number;
    p1Hand?: string[];
    p2Hand?: string[];
    forests?: number;
    activePlayerId?: string;
    priorityPlayerId?: string;
    phase?: GameState["phase"];
}): GameState {
    const {
        alurens = 1,
        p1Hand = [],
        p2Hand = [],
        forests = 0,
        activePlayerId = "p1",
        priorityPlayerId = "p1",
        phase,
    } = opts;
    const hand = (owner: string, ids: string[]): CardInstanceState[] =>
        ids.map((id, i) =>
            makeInstance(id, {
                id: `${owner}-hand-${i}`,
                controllerId: owner,
                ownerId: owner,
                zone: "hand",
            })
        );
    return makeState({
        players: [
            makePlayer("p1", {
                hand: hand("p1", p1Hand),
                battlefield: [
                    ...Array.from({ length: alurens }, (_, i) =>
                        makeInstance(aluren.id, {
                            id: `aluren-${i}`,
                            controllerId: "p1",
                            ownerId: "p1",
                        })
                    ),
                    ...Array.from({ length: forests }, (_, i) =>
                        makeInstance(forest.id, {
                            id: `forest-${i}`,
                            controllerId: "p1",
                            ownerId: "p1",
                        })
                    ),
                ],
            }),
            makePlayer("p2", { hand: hand("p2", p2Hand) }),
        ],
        activePlayerId,
        priorityPlayerId,
        ...(phase ? { phase } : {}),
    });
}

const handCard = (state: GameState, playerId: string, index = 0) =>
    getPlayer(state, playerId).hand[index];

describe("cast-permission static (CR 601.3 / 118.9)", () => {
    it("grants to EITHER player — Aluren says 'any player', so the opponent's own hand is covered too", () => {
        const state = board({
            p1Hand: [grizzlyBears.id],
            p2Hand: [grizzlyBears.id],
        });

        expect(
            collectCastPermissions(state, "p1", handCard(state, "p1")).map(
                (p) => p.id
            )
        ).toEqual(["aluren-creature-permission"]);
        // The permission's SOURCE is p1's, but the grantee is "any-player".
        expect(
            collectCastPermissions(state, "p2", handCard(state, "p2")).map(
                (p) => p.id
            )
        ).toEqual(["aluren-creature-permission"]);
    });

    it("filters by the declared EffectCardFilter — a creature over the mana-value ceiling and a cheap noncreature are both out (CR 202.3)", () => {
        const state = board({
            p1Hand: [grizzlyBears.id, shivanDragon.id, lightningBolt.id],
        });
        const covered = (i: number) =>
            collectCastPermissions(state, "p1", handCard(state, "p1", i))
                .length;

        expect(covered(0)).toBe(1); // Grizzly Bears — Creature, MV 2
        expect(covered(1)).toBe(0); // Shivan Dragon — Creature, MV 6
        expect(covered(2)).toBe(0); // Lightning Bolt — MV 1, not a creature
    });

    it("ends the moment the source leaves the battlefield — nothing is materialized to unwind (CR 603.10)", () => {
        const state = board({ p1Hand: [grizzlyBears.id] });
        expect(hasCastPermissionFlash(state, "p1", handCard(state, "p1"))).toBe(
            true
        );

        state.players[0].battlefield = state.players[0].battlefield.filter(
            (c) => c.id !== "aluren-0"
        );

        expect(hasCastPermissionFlash(state, "p1", handCard(state, "p1"))).toBe(
            false
        );
        expect(
            castPermissionAltCosts(state, "p1", handCard(state, "p1"))
        ).toEqual([]);
    });

    it("two sources grant ONE permission, not two cast options (CR 118.9a — one alternative cost per spell)", () => {
        const state = board({ alurens: 2, p1Hand: [grizzlyBears.id] });

        expect(
            castPermissionAltCosts(state, "p1", handCard(state, "p1"))
        ).toHaveLength(1);
    });
});

describe("the cost half is an ALTERNATIVE cost (CR 118.9 / 118.5 / 601.2b)", () => {
    it("offers a zero-mana option the caster announces, and makes an otherwise unaffordable creature castable", () => {
        const state = board({ p1Hand: [grizzlyBears.id] });
        const card = handCard(state, "p1");
        const player = getPlayer(state, "p1");

        const options = castOptionAlternativeCosts(state, player, card);
        expect(options.map((o) => o.id)).toEqual([ALUREN_ALT_COST_ID]);
        // CR 118.9 — the cost is nothing at all: no mana, no legs.
        expect(options[0].mana).toBeUndefined();
        expect(options[0].permanent).toBeUndefined();
        // With no untapped land the printed {1}{G} is unpayable, so "cast"
        // being legal proves the alternative cost is what carried the gate.
        expect(getLegalActions(state, player, card)).toContain("cast");
    });

    it("STACKS with the card's own alternative costs — both appear as choices (CR 118.9a is a choice, not a suppression)", () => {
        const probe: CardDefinition = {
            ...grizzlyBears,
            alternativeCosts: [
                {
                    id: "probe-free-alt",
                    description: "Probe alternative cost",
                    life: 1,
                },
            ],
        };
        withTemporaryDefinition(probe, () => {
            const state = board({ p1Hand: [grizzlyBears.id] });
            const ids = castOptionAlternativeCosts(
                state,
                getPlayer(state, "p1"),
                handCard(state, "p1")
            ).map((o) => o.id);

            expect(ids).toContain("probe-free-alt");
            expect(ids).toContain(ALUREN_ALT_COST_ID);
        });
    });

    it("offers nothing to a permission that only widens TIMING — such a cast pays its printed cost", () => {
        const orrery: CardDefinition = {
            ...aluren,
            staticEffects: [
                {
                    kind: "cast-permission",
                    id: "probe-timing-only",
                    grantee: "controller",
                    filter: { type: "Creature" },
                    asThoughFlash: true,
                    oracleText:
                        "You may cast creature spells as though they had flash.",
                },
            ],
        };
        withTemporaryDefinition(orrery, () => {
            const state = board({ p1Hand: [shivanDragon.id] });
            const card = handCard(state, "p1");

            expect(hasCastPermissionFlash(state, "p1", card)).toBe(true);
            expect(castPermissionAltCosts(state, "p1", card)).toEqual([]);
        });
    });
});

describe("the timing half (CR 601.3b / 702.8a) and its mandatory pairing (CR 118.9b)", () => {
    it("makes a creature castable on the opponent's turn, and forces the free cast there", () => {
        // p2 holds priority during p1's turn: outside p2's own sorcery window
        // (CR 307.1), so only the permission licenses this cast at all.
        const state = board({
            p2Hand: [grizzlyBears.id],
            activePlayerId: "p1",
            priorityPlayerId: "p2",
        });
        const card = handCard(state, "p2");

        expect(getLegalActions(state, getPlayer(state, "p2"), card)).toContain(
            "cast"
        );
        expect(castPermissionRequiredFor(state, "p2", card)).toBe(true);
    });

    it("leaves the free cast OPTIONAL inside the caster's own sorcery window — the printed cast is still available there (CR 307.1)", () => {
        const state = board({ p1Hand: [grizzlyBears.id], forests: 2 });
        const card = handCard(state, "p1");

        expect(castPermissionRequiredFor(state, "p1", card)).toBe(false);
        expect(
            castOptionAlternativeCosts(state, getPlayer(state, "p1"), card).map(
                (o) => o.id
            )
        ).toEqual([ALUREN_ALT_COST_ID]);
    });

    it("forces nothing when a timing-only permission already licenses the off-window cast", () => {
        const both: CardDefinition = {
            ...aluren,
            staticEffects: [
                ...(aluren.staticEffects ?? []),
                {
                    kind: "cast-permission",
                    id: "probe-timing-only",
                    grantee: "any-player",
                    filter: { type: "Creature" },
                    asThoughFlash: true,
                    oracleText:
                        "Any player may cast creature spells as though they had flash.",
                },
            ],
        };
        withTemporaryDefinition(both, () => {
            const state = board({
                p2Hand: [grizzlyBears.id],
                activePlayerId: "p1",
                priorityPlayerId: "p2",
            });
            // The free cast stays on offer; it is simply no longer compulsory,
            // because the printed price now buys the same timing.
            expect(
                castPermissionRequiredFor(state, "p2", handCard(state, "p2"))
            ).toBe(false);
        });
    });

    it("a sorcery-speed LOCK beats the permission (CR 101.2) — no off-window cast, and nothing is forced", () => {
        const lock: CardDefinition = {
            ...aluren,
            id: "11111111-1111-4111-8111-111111111111",
            name: "Probe Lock",
            staticEffects: [
                {
                    kind: "cast-timing-lock",
                    id: "probe-lock",
                    locks: (caster: string) => caster === "p2",
                    oracleText:
                        "Each opponent can cast spells only any time they could cast a sorcery.",
                },
            ],
        };
        withTemporaryDefinition(lock, () => {
            const state = board({
                p2Hand: [grizzlyBears.id],
                activePlayerId: "p1",
                priorityPlayerId: "p2",
            });
            state.players[0].battlefield.push(
                makeInstance(lock.id, {
                    id: "probe-lock-perm",
                    controllerId: "p1",
                    ownerId: "p1",
                })
            );
            const card = handCard(state, "p2");

            expect(
                getLegalActions(state, getPlayer(state, "p2"), card)
            ).not.toContain("cast");
            expect(castPermissionRequiredFor(state, "p2", card)).toBe(false);
        });
    });
});
