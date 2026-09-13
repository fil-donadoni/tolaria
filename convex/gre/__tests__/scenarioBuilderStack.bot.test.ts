// CR 405.1 / 601.2 / 602.2a (issue #3513, PRD #3397) — the scenario spec's
// DECLARED STACK: a position with objects in flight is written down, not
// reached by replaying the moves that put them there (ADR 0125).
//
// Every LIVE position here is built by the ENGINE — `buildBladeState` walks a
// quiet board forward through the real cast / activation pipeline
// (`enumerateMoves` + `applyMoveInSearch`, ADR 0070 §4) — and never by hand.
// A hand-written stack item can describe a spell no game could have cast, so a
// round trip asserted against one would prove nothing about the class this
// field exists for.
//
// A `.bot.test.ts` because `ai/blade/runner` is a bot-only module
// (`scripts/__tests__/bot-suite-boundary.test.ts`).

import { describe, expect, it } from "vitest";
import { buildBladeState } from "../ai/blade/runner";
import { buildBladeBaseState } from "../ai/blade/baseState";
import {
    assertLoadableIntoLiveGame,
    buildStateFromScenario,
    specFromState,
    STACK_DROPPED_PREFIX,
} from "../scenarioBuilder";
import { counterspell } from "../../cards/sets/lea/blue";
import { grizzlyBears } from "../../cards/sets/lea/green";
import { lightningBolt } from "../../cards/sets/lea/red";
import { prodigalSorcerer } from "../../cards/sets/lea/blue";
import { gristTheHungerTide } from "../../cards/sets/mh2/multicolor";
import type { BladeSetupStep } from "../ai/blade/types";
import type { GameState, StackItem } from "../state";
import type { ScenarioSpec } from "../../debugScenarioSpec";

/** The fingerprint a rebuilt stack is compared on — every fact the spec claims
 *  to carry: order, seat, object identity, targets and `x`. Names and seats,
 *  never instance ids, which each build allocates for itself. */
function stackShape(state: GameState, mySeatId: string): string[] {
    const seat = (playerId: string) => (playerId === mySeatId ? "me" : "opp");
    const nameOf = (id: string): string => {
        for (const player of state.players) {
            for (const zone of [player.battlefield, player.graveyard]) {
                const card = zone.find((c) => c.id === id);
                if (card)
                    return `${seat(player.id)}:${(card.card as { id?: string }).id}`;
            }
        }
        const index = state.stack.findIndex((s) => s.id === id);
        return index === -1 ? `?${id}` : `stack#${index}`;
    };
    return state.stack.map((item: StackItem) => {
        const targets = (item.targets ?? [])
            .map((t) =>
                t.type === "player"
                    ? `player:${seat(t.id)}`
                    : `${t.type}:${nameOf(t.id)}`
            )
            .join(",");
        return [
            seat(item.castById),
            (item.card as { id?: string }).id,
            item.abilityId ? `ability:${item.abilityId}` : "spell",
            `targets[${targets}]`,
            `x=${item.chosenX ?? "-"}`,
        ].join(" ");
    });
}

/** Build a LIVE position through the engine, then lower it from `seat`'s view
 *  and rebuild it — the exact pair `lowerDecision` runs. */
function roundTrip(
    spec: ScenarioSpec,
    setup: BladeSetupStep[],
    seatIndex: 0 | 1
): {
    live: GameState;
    liveSeatId: string;
    rebuilt: GameState;
    lowered: ScenarioSpec;
    dropped: string[];
} {
    const live = buildBladeState({
        label: "declared stack fixture",
        spec,
        setup,
        bot: "me",
        budget: { iterations: 1 },
        tier: "must",
        expect: { moves: [] },
    });
    const liveSeatId = live.players[seatIndex].id;
    const { spec: lowered, dropped } = specFromState(live, {
        mySeatId: liveSeatId,
    });
    const rebuilt = buildStateFromScenario(buildBladeBaseState(), lowered);
    return { live, liveSeatId, rebuilt, lowered, dropped };
}

/** A board with a Bolt in the opponent's hand and a Tim on ours — enough for
 *  every shape below. */
const BOARD: ScenarioSpec = {
    cards: [
        { name: lightningBolt.name, owner: "opp", zone: "hand" },
        { name: "Mountain", owner: "opp", count: 3 },
        { name: prodigalSorcerer.name, owner: "me" },
        { name: grizzlyBears.name, owner: "me" },
    ],
    phase: "PRECOMBAT_MAIN",
    turn: 5,
    landCount: 0,
    libraryCount: 20,
};

/** The same board on the OPPONENT's turn, so they hold priority and can cast
 *  at sorcery timing — the board the spell-only fixtures need. */
const OPP_TURN: ScenarioSpec = { ...BOARD, activePlayer: "opp" };

describe("a cast spell in flight round-trips (issue #3513)", () => {
    it("lowers the opponent's cast and rebuilds the same object, seat and target", () => {
        const { live, liveSeatId, rebuilt, lowered, dropped } = roundTrip(
            OPP_TURN,
            [
                {
                    kind: "cast",
                    card: lightningBolt.name,
                    by: "opp",
                    target: grizzlyBears.name,
                },
            ],
            0
        );

        expect(live.stack).toHaveLength(1);
        expect(
            dropped.filter((d) => d.startsWith(STACK_DROPPED_PREFIX))
        ).toEqual([]);
        expect(lowered.stack).toEqual([
            {
                kind: "spell",
                name: lightningBolt.name,
                controller: "opp",
                targets: [
                    { kind: "permanent", name: grizzlyBears.name, seat: "me" },
                ],
            },
        ]);
        expect(stackShape(rebuilt, rebuilt.players[0].id)).toEqual(
            stackShape(live, liveSeatId)
        );
    });

    it("keeps a SECOND card of the same name in `cards` as its own object", () => {
        // The spec names CARDS, not instances, so a Bolt in flight and a Bolt
        // still in hand are two entries of one name. The stack entry is not
        // taken out of `cards` and does not consume one: the builder creates a
        // fresh instance for it.
        //
        // Worth asserting because the shape is ordinary — a caster holding a
        // second copy of what they just cast — and a name-collision rule that
        // refused "a card declared both on the stack and in `cards`" would
        // refuse it, which is a round-trip failure on a position
        // `specFromState` produces verbatim.
        const { lowered } = roundTrip(
            OPP_TURN,
            [
                {
                    kind: "cast",
                    card: lightningBolt.name,
                    by: "opp",
                    target: grizzlyBears.name,
                },
            ],
            0
        );
        expect(lowered.stack).toHaveLength(1);
        expect(lowered.cards.some((c) => c.name === lightningBolt.name)).toBe(
            false
        );

        const withSpare: ScenarioSpec = {
            ...lowered,
            cards: [
                ...lowered.cards,
                { name: lightningBolt.name, owner: "opp", zone: "hand" },
            ],
        };
        const rebuilt = buildStateFromScenario(
            buildBladeBaseState(),
            withSpare
        );
        expect(rebuilt.stack).toHaveLength(1);
        expect(rebuilt.players[1].hand).toHaveLength(1);
        // Two objects, not one: different instance ids, same card.
        expect(rebuilt.players[1].hand[0].id).not.toBe(rebuilt.stack[0].id);
        expect(rebuilt.players[1].hand[0].card).toEqual(rebuilt.stack[0].card);
    });
});

describe("an activated ability answered by a spell round-trips (issue #3513)", () => {
    const SETUP: BladeSetupStep[] = [
        {
            kind: "activate",
            card: prodigalSorcerer.name,
            controller: "me",
            target: "opp",
        },
        {
            kind: "cast",
            card: lightningBolt.name,
            by: "opp",
            target: grizzlyBears.name,
        },
    ];

    it("carries both objects, in order, with the ability named by its source", () => {
        const { live, liveSeatId, rebuilt, lowered, dropped } = roundTrip(
            BOARD,
            SETUP,
            0
        );

        expect(live.stack).toHaveLength(2);
        expect(
            dropped.filter((d) => d.startsWith(STACK_DROPPED_PREFIX))
        ).toEqual([]);
        expect(lowered.stack?.map((i) => i.kind)).toEqual(["ability", "spell"]);
        expect(lowered.stack?.[0]).toMatchObject({
            kind: "ability",
            name: prodigalSorcerer.name,
            controller: "me",
            targets: [{ kind: "player", seat: "opp" }],
        });
        // CR 601.2 / 307.1 (issue #2473) — the opponent's Bolt is a RESPONSE:
        // a sorcery could not have been cast right now, and the announcement
        // snapshot says so. Re-deriving it from the rebuilt board answers a
        // different question, so the spec carries it.
        expect(lowered.stack?.[1]).toMatchObject({
            castOffSorceryTiming: true,
        });
        expect(stackShape(rebuilt, rebuilt.players[0].id)).toEqual(
            stackShape(live, liveSeatId)
        );
    });

    it("rebuilds the ability item with the source permanent's own id (CR 113.7a)", () => {
        const { rebuilt, lowered } = roundTrip(BOARD, SETUP, 0);
        const ability = rebuilt.stack[0];
        const source = rebuilt.players[0].battlefield.find(
            (c) => c.id === ability.id
        );
        expect(lowered.stack?.[0].kind).toBe("ability");
        // `buildActivatedAbilityStackItem` keeps the source's id; a rebuild
        // that allocated a fresh one would lose every effect that reads
        // `stackSourceId` (Tishana's Tidebinder) silently.
        expect(source).toBeDefined();
        expect(source?.card).toEqual(ability.card);
    });
});

describe("a spell targeting another object on the stack (issue #3513)", () => {
    it("round-trips as an INDEX and rebuilds the engine's own stackSourceId", () => {
        const spec: ScenarioSpec = {
            ...OPP_TURN,
            cards: [
                ...OPP_TURN.cards,
                { name: counterspell.name, owner: "me", zone: "hand" },
                { name: "Island", owner: "me", count: 2 },
            ],
        };
        const { live, liveSeatId, rebuilt, lowered, dropped } = roundTrip(
            spec,
            [
                {
                    kind: "cast",
                    card: lightningBolt.name,
                    by: "opp",
                    target: grizzlyBears.name,
                },
                {
                    kind: "cast",
                    card: counterspell.name,
                    by: "me",
                    target: lightningBolt.name,
                },
            ],
            0
        );

        expect(live.stack).toHaveLength(2);
        expect(
            dropped.filter((d) => d.startsWith(STACK_DROPPED_PREFIX))
        ).toEqual([]);
        expect(lowered.stack?.[1]).toMatchObject({
            kind: "spell",
            name: counterspell.name,
            controller: "me",
            targets: [{ kind: "stack", index: 0 }],
        });

        const [bolt, counter] = rebuilt.stack;
        const target = counter.targets?.[0];
        expect(target?.type).toBe("spell");
        expect(target?.id).toBe(bolt.id);
        // CR 113.7a — `triggerSourceId ?? item.id`, the engine's own rule.
        expect(target?.stackSourceId).toBe(bolt.triggerSourceId ?? bolt.id);
        expect(stackShape(rebuilt, rebuilt.players[0].id)).toEqual(
            stackShape(live, liveSeatId)
        );
    });
});

describe("duplicate-name targets resolve to the SAME instance (issue #3513)", () => {
    it("points the rebuilt spell at the second Grizzly Bears, not the first", () => {
        // The failure a name-only reference cannot see: two same-named
        // permanents, one of them damaged, and a candidate list that is
        // identical either way. `nth` is what makes the reference exact.
        const spec: ScenarioSpec = {
            ...BOARD,
            cards: [
                { name: lightningBolt.name, owner: "opp", zone: "hand" },
                { name: "Mountain", owner: "opp", count: 3 },
                { name: prodigalSorcerer.name, owner: "me" },
                { name: grizzlyBears.name, owner: "me" },
                { name: grizzlyBears.name, owner: "me", damageMarked: 1 },
            ],
        };
        const live = buildBladeState({
            label: "duplicate-name fixture",
            spec,
            setup: [
                {
                    kind: "activate",
                    card: prodigalSorcerer.name,
                    controller: "me",
                    target: "opp",
                },
            ],
            bot: "me",
            budget: { iterations: 1 },
            tier: "must",
            expect: { moves: [] },
        });
        // Re-point the live ability at the SECOND Bears through the engine's
        // own selection shape, then lower: the question is whether the spec
        // can say WHICH one.
        const bears = live.players[0].battlefield.filter(
            (c) => (c.card as { id?: string }).id === grizzlyBears.id
        );
        expect(bears).toHaveLength(2);
        live.stack[0].targets = [{ type: "permanent", id: bears[1].id }];

        const { spec: lowered } = specFromState(live, {
            mySeatId: live.players[0].id,
        });
        expect(lowered.stack?.[0].targets).toEqual([
            { kind: "permanent", name: grizzlyBears.name, seat: "me", nth: 1 },
        ]);

        const rebuilt = buildStateFromScenario(buildBladeBaseState(), lowered);
        const rebuiltBears = rebuilt.players[0].battlefield.filter(
            (c) => (c.card as { id?: string }).id === grizzlyBears.id
        );
        expect(rebuilt.stack[0].targets?.[0].id).toBe(rebuiltBears[1].id);
        // And it is the DAMAGED one, which is the whole point.
        expect(rebuiltBears[1].damageMarked).toBe(1);
    });
});

describe("a stack the spec cannot carry is REFUSED whole (issue #3513)", () => {
    it("names the item AND the field, and withholds the entire stack", () => {
        const live = buildBladeState({
            label: "residue fixture",
            spec: OPP_TURN,
            setup: [
                {
                    kind: "cast",
                    card: lightningBolt.name,
                    by: "opp",
                    target: grizzlyBears.name,
                },
            ],
            bot: "me",
            budget: { iterations: 1 },
            tier: "must",
            expect: { moves: [] },
        });
        // CR 707.10 — a COPY on the stack. The spec has no field for it, and a
        // copy fingerprints exactly as its original does.
        live.stack[0].isCopy = true;

        const { spec: lowered, dropped } = specFromState(live, {
            mySeatId: live.players[0].id,
        });
        expect(lowered.stack).toBeUndefined();
        const notes = dropped.filter((d) => d.startsWith(STACK_DROPPED_PREFIX));
        expect(notes).toHaveLength(1);
        expect(notes[0]).toContain(`index 0 (opp ${lightningBolt.name} spell)`);
        expect(notes[0]).toContain('"isCopy"');
    });

    it("refuses a trigger, with no special case for it", () => {
        // `placeTriggersOnStack` always writes `triggerEvent`, which is not on
        // the allowlist — so the trigger slice is a widening of the allowlist,
        // never a hole that had to be plugged.
        const live = buildBladeState({
            label: "trigger fixture",
            spec: OPP_TURN,
            setup: [
                {
                    kind: "cast",
                    card: lightningBolt.name,
                    by: "opp",
                    target: grizzlyBears.name,
                },
            ],
            bot: "me",
            budget: { iterations: 1 },
            tier: "must",
            expect: { moves: [] },
        });
        live.stack[0].triggeredAbilityId = "some-trigger";
        live.stack[0].triggerEvent = {
            type: "SPELL_CAST",
        } as StackItem["triggerEvent"];

        const { spec: lowered, dropped } = specFromState(live, {
            mySeatId: live.players[0].id,
        });
        expect(lowered.stack).toBeUndefined();
        const fields = dropped
            .filter((d) => d.startsWith(STACK_DROPPED_PREFIX))
            .join(" ");
        expect(fields).toContain('"triggerEvent"');
        expect(fields).toContain('"triggeredAbilityId"');
    });
});

describe("a declared stack is not loadable into a live game (issue #3513)", () => {
    it("refuses, naming the surfaces that DO accept it", () => {
        expect(() =>
            assertLoadableIntoLiveGame({
                cards: [],
                stack: [
                    {
                        kind: "spell",
                        name: lightningBolt.name,
                        controller: "me",
                    },
                ],
            })
        ).toThrow(/stack.*verdict quiz|verdict quiz/);
        expect(() =>
            assertLoadableIntoLiveGame({ cards: [], stack: [] })
        ).not.toThrow();
        expect(() => assertLoadableIntoLiveGame({ cards: [] })).not.toThrow();
    });
});

describe("the builder refuses an incoherent declared stack (issue #3513)", () => {
    it("refuses a stack reference that points at itself or forward", () => {
        expect(() =>
            buildStateFromScenario(buildBladeBaseState(), {
                ...BOARD,
                stack: [
                    {
                        kind: "spell",
                        name: counterspell.name,
                        controller: "me",
                        targets: [{ kind: "stack", index: 0 }],
                    },
                ],
            })
        ).toThrow(/points LOWER than its own index/);
    });

    it("refuses an ability entry with no abilityId", () => {
        expect(() =>
            buildStateFromScenario(buildBladeBaseState(), {
                ...BOARD,
                stack: [
                    {
                        kind: "ability",
                        name: prodigalSorcerer.name,
                        controller: "me",
                    },
                ],
            })
        ).toThrow(/no abilityId/);
    });

    it("refuses a target name that matches no such object", () => {
        expect(() =>
            buildStateFromScenario(buildBladeBaseState(), {
                ...BOARD,
                stack: [
                    {
                        kind: "spell",
                        name: lightningBolt.name,
                        controller: "opp",
                        targets: [
                            {
                                kind: "permanent",
                                name: grizzlyBears.name,
                                seat: "me",
                                nth: 3,
                            },
                        ],
                    },
                ],
            })
        ).toThrow(/nth 3/);
    });
});

describe("the vocabulary's remaining shapes (issue #3513 review)", () => {
    it("rebuilds a stack spell with its CR 113.6c off-battlefield characteristics", () => {
        // Grist, the Hunger Tide is a 1/1 Insect CREATURE everywhere except
        // the battlefield — the stack included. A live cast carries that
        // because the card was already materialised in hand; the rebuild
        // builds from the printed definition, and
        // `refreshOffBattlefieldCharacteristics` walks the four PLAYER zones
        // and never the stack. Without `applyZoneCharacteristics` the rebuilt
        // Grist is a bare Planeswalker with no P/T, so a
        // counter-target-creature-spell answer the live position offered
        // simply is not in the rebuilt candidate list — and `types` /
        // `subtypes` / `power` / `toughness` are all allowlisted, so nothing
        // would have reported it.
        const rebuilt = buildStateFromScenario(buildBladeBaseState(), {
            ...BOARD,
            stack: [
                {
                    kind: "spell",
                    name: gristTheHungerTide.name,
                    controller: "opp",
                },
            ],
        });
        const grist = rebuilt.stack[0];
        expect(grist.types).toContain("Creature");
        expect(grist.subtypes).toContain("Insect");
        expect(grist.power).toBe(1);
        expect(grist.toughness).toBe(1);
    });

    it("carries `sourceSeat` when the ACTIVATOR is not the source's controller (CR 113.3c)", () => {
        const rebuilt = buildStateFromScenario(buildBladeBaseState(), {
            ...BOARD,
            stack: [
                {
                    kind: "ability",
                    name: prodigalSorcerer.name,
                    controller: "opp",
                    sourceSeat: "me",
                    abilityId: prodigalSorcerer.activatedAbilities![0].id,
                    targets: [{ kind: "player", seat: "me" }],
                },
            ],
        });
        const item = rebuilt.stack[0];
        // CR 602.1 — `castById` is the ACTIVATOR; the clone keeps the source's
        // own controller, which is the other seat.
        expect(item.castById).toBe(rebuilt.players[1].id);
        expect(item.controllerId).toBe(rebuilt.players[0].id);
        expect(
            rebuilt.players[0].battlefield.some((c) => c.id === item.id)
        ).toBe(true);
    });

    it("round-trips a graveyard target and an X value", () => {
        const spec: ScenarioSpec = {
            ...BOARD,
            cards: [
                ...BOARD.cards,
                { name: lightningBolt.name, owner: "opp", zone: "graveyard" },
            ],
            stack: [
                {
                    kind: "spell",
                    name: counterspell.name,
                    controller: "me",
                    x: 3,
                    targets: [
                        {
                            kind: "graveyard-card",
                            name: lightningBolt.name,
                            seat: "opp",
                        },
                    ],
                },
            ],
        };
        const rebuilt = buildStateFromScenario(buildBladeBaseState(), spec);
        const item = rebuilt.stack[0];
        expect(item.chosenX).toBe(3);
        expect(item.targets?.[0]).toEqual({
            type: "graveyard-card",
            id: rebuilt.players[1].graveyard[0].id,
            playerId: rebuilt.players[1].id,
        });

        const { spec: lowered, dropped } = specFromState(rebuilt, {
            mySeatId: rebuilt.players[0].id,
        });
        expect(
            dropped.filter((d) => d.startsWith(STACK_DROPPED_PREFIX))
        ).toEqual([]);
        expect(lowered.stack).toEqual(spec.stack);
    });

    it("resolves `nth` against NON-ADJACENT same-named permanents", () => {
        // The invariant `nth` rests on: `specFromState` emits one `cards` entry
        // per live battlefield card, in live order, and the placement loop
        // pushes them in that order. A future `lowerCard` that grouped
        // identical entries into `count` would silently re-point every `nth`,
        // and nothing else would go red.
        const rebuilt = buildStateFromScenario(buildBladeBaseState(), {
            ...BOARD,
            cards: [
                { name: grizzlyBears.name, owner: "me" },
                { name: prodigalSorcerer.name, owner: "me" },
                { name: grizzlyBears.name, owner: "me", damageMarked: 1 },
            ],
            stack: [
                {
                    kind: "spell",
                    name: lightningBolt.name,
                    controller: "opp",
                    targets: [
                        {
                            kind: "permanent",
                            name: grizzlyBears.name,
                            seat: "me",
                            nth: 1,
                        },
                    ],
                },
            ],
        });
        const targetId = rebuilt.stack[0].targets?.[0].id;
        const targeted = rebuilt.players[0].battlefield.find(
            (c) => c.id === targetId
        );
        expect(targeted?.damageMarked).toBe(1);

        const { spec: lowered } = specFromState(rebuilt, {
            mySeatId: rebuilt.players[0].id,
        });
        expect(lowered.stack?.[0].targets).toEqual([
            { kind: "permanent", name: grizzlyBears.name, seat: "me", nth: 1 },
        ]);
    });

    it("withholds an EARLIER item when a LATER one is refused", () => {
        // Fail-closed as a whole: a partial stack is a position that looks
        // complete and is not. Every other refusal test uses a one-item stack,
        // so this is the one that exercises the cross-item invariant.
        const live = buildStateFromScenario(buildBladeBaseState(), {
            ...BOARD,
            stack: [
                {
                    kind: "spell",
                    name: lightningBolt.name,
                    controller: "opp",
                    targets: [
                        {
                            kind: "permanent",
                            name: grizzlyBears.name,
                            seat: "me",
                        },
                    ],
                },
                {
                    kind: "spell",
                    name: counterspell.name,
                    controller: "me",
                    targets: [{ kind: "stack", index: 0 }],
                },
            ],
        });
        // CR 707.10 — only the SECOND object is unlowerable.
        live.stack[1].isCopy = true;

        const { spec: lowered, dropped } = specFromState(live, {
            mySeatId: live.players[0].id,
        });
        expect(lowered.stack).toBeUndefined();
        const notes = dropped.filter((d) => d.startsWith(STACK_DROPPED_PREFIX));
        expect(notes).toHaveLength(1);
        expect(notes[0]).toContain("index 1");
    });

    it("REFUSES a face-down object and a face-down target (CR 708.2)", () => {
        // A face-down permanent presents the sentinel definition, which is
        // registered by id only — so `getCardByName` throws on the name a
        // reference would carry. Refused rather than named, which keeps a Bolt
        // on a morph a counted refusal instead of a `rebuild-threw` far from
        // the cause.
        const live = buildStateFromScenario(buildBladeBaseState(), {
            ...BOARD,
            cards: [
                ...BOARD.cards,
                {
                    name: grizzlyBears.name,
                    owner: "opp",
                    faceDown: true,
                },
            ],
            stack: [
                {
                    kind: "spell",
                    name: lightningBolt.name,
                    controller: "opp",
                    targets: [
                        {
                            kind: "permanent",
                            name: grizzlyBears.name,
                            seat: "me",
                        },
                    ],
                },
            ],
        });
        const morph = live.players[1].battlefield.find((c) => c.faceDown);
        expect(morph).toBeDefined();
        live.stack[0].targets = [{ type: "permanent", id: morph!.id }];

        const { spec: lowered, dropped } = specFromState(live, {
            mySeatId: live.players[0].id,
        });
        expect(lowered.stack).toBeUndefined();
        expect(
            dropped.filter((d) => d.startsWith(STACK_DROPPED_PREFIX))
        ).toHaveLength(1);
    });
});
