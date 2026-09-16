// Count-rewriting replacement effects (CR 614, issue #3230).
//
// Two `ReplacementEventKind`s that rewrite HOW MANY objects an event produces
// rather than WHERE they go:
//   * `"token-created"` — "twice that many of those tokens are created
//     instead" (CR 111.1, Elspeth, Storm Slayer / Doubling Season);
//   * `"counter-placed"` — "that many plus one +1/+1 counters are put on it
//     instead" (CR 122.1, Michelangelo, Weirdness to 11 / Hardened Scales).
//
// This suite proves the FRAMEWORK with SYNTHETIC sources, so the seams are
// asserted independently of the two shipped cards (whose own behaviour lives in
// `cards/sets/tdm/__tests__/white.test.ts` and
// `cards/sets/tmt/__tests__/green.test.ts`) — the shape
// `entersBattlefieldReplacement.test.ts` already uses for Containment Priest.
//
// The arithmetic is deliberately NOT a multiplier flag: one synthetic source
// doubles and one adds, because CR 614.5's own example compounds doublers while
// the shipped counter card is "plus one", and the two do not commute.
import { describe, it, expect, beforeAll } from "vitest";
import type { CardInstanceState } from "../state";
import {
    addCounterToCard,
    buildSpellContext,
    createTokenPermanents,
    flushPendingEvents,
} from "../state";
import { registerTokenDefinition } from "../../cards";
import type { CardDefinition, TokenSpec } from "../../cards/types";
import { makePlayer, makeState, pushSpell } from "../../cards/__tests__/setup";

const TOKEN_DOUBLER_ID = "test-token-created-doubler";
const COUNTER_ADDER_ID = "test-counter-placed-adder";
const COUNTER_NULLIFIER_ID = "test-counter-placed-nullifier";
const BEAR_ID = "test-count-replacement-bear";
const COUNTER_BEAR_ID = "test-count-replacement-entering-bear";

/** How many times each synthetic `appliesTo` was consulted — the only way to
 *  assert that an event kind is NOT fired at a chokepoint (a replacement that
 *  is never asked cannot be distinguished from one that declines, and "the
 *  token doubler must not see a permanent merely entering" is exactly that
 *  distinction, CR 111.1). Reset per test. */
const consulted: Record<string, number> = {};

const tokenDoublerDef: CardDefinition = {
    id: TOKEN_DOUBLER_ID,
    name: "Test Token Doubler",
    rarity: "common",
    types: ["Enchantment"],
    replacementEffects: [
        {
            id: "test-token-doubler",
            oracleText:
                "If one or more tokens would be created under your control, twice that many of those tokens are created instead.",
            eventKind: "token-created",
            appliesTo: (event, self) => {
                consulted.token = (consulted.token ?? 0) + 1;
                return (
                    event.kind === "token-created" &&
                    event.controllerId === self.controllerId
                );
            },
            replace: (event) => {
                if (event.kind !== "token-created") {
                    throw new Error("unexpected event kind");
                }
                return {
                    kind: "modified",
                    event: { ...event, count: event.count * 2 },
                };
            },
        },
    ],
};

const counterAdderDef: CardDefinition = {
    id: COUNTER_ADDER_ID,
    name: "Test Counter Adder",
    rarity: "common",
    types: ["Enchantment"],
    replacementEffects: [
        {
            id: "test-counter-adder",
            oracleText:
                "If one or more +1/+1 counters would be put on a creature you control, that many plus one +1/+1 counters are put on it instead.",
            eventKind: "counter-placed",
            appliesTo: (event, self) => {
                consulted.counter = (consulted.counter ?? 0) + 1;
                return (
                    event.kind === "counter-placed" &&
                    event.counterType === "+1/+1" &&
                    event.controllerId === self.controllerId &&
                    event.types.includes("Creature")
                );
            },
            replace: (event) => {
                if (event.kind !== "counter-placed") {
                    throw new Error("unexpected event kind");
                }
                return {
                    kind: "modified",
                    event: { ...event, count: event.count + 1 },
                };
            },
        },
    ],
};

/** A rewrite to ZERO — the shape that proves "no counters are put on it" is
 *  expressible as a count, so this event kind never needs a `"consumed"`
 *  result (CR 614.1a's "instead" with nothing on the other side). */
const counterNullifierDef: CardDefinition = {
    id: COUNTER_NULLIFIER_ID,
    name: "Test Counter Nullifier",
    rarity: "common",
    types: ["Enchantment"],
    replacementEffects: [
        {
            id: "test-counter-nullifier",
            oracleText:
                "If one or more +1/+1 counters would be put on a creature, no counters are put on it instead.",
            eventKind: "counter-placed",
            appliesTo: (event) =>
                event.kind === "counter-placed" &&
                event.counterType === "+1/+1",
            replace: (event) => {
                if (event.kind !== "counter-placed") {
                    throw new Error("unexpected event kind");
                }
                return { kind: "modified", event: { ...event, count: 0 } };
            },
        },
    ],
};

const bearDef: CardDefinition = {
    id: BEAR_ID,
    name: "Test Count Replacement Bear",
    rarity: "common",
    types: ["Creature"],
    subtypes: ["Bear"],
    power: 2,
    toughness: 2,
};

/** CR 614.1c — "this permanent enters with a +1/+1 counter on it", the SECOND
 *  counter seam (`applyEntersWithCounters`, which writes `card.counters`
 *  directly and cannot route through `addCounterToCard`). */
const enteringBearDef: CardDefinition = {
    ...bearDef,
    id: COUNTER_BEAR_ID,
    name: "Test Count Replacement Entering Bear",
    entersWith: { counters: [{ type: "+1/+1", count: 1 }] },
};

const SOLDIER: TokenSpec = {
    name: "Soldier",
    types: ["Creature"],
    subtypes: ["Soldier"],
    colors: ["W"],
    power: 1,
    toughness: 1,
};

beforeAll(() => {
    registerTokenDefinition(tokenDoublerDef);
    registerTokenDefinition(counterAdderDef);
    registerTokenDefinition(counterNullifierDef);
    registerTokenDefinition(bearDef);
    registerTokenDefinition(enteringBearDef);
});

function permanent(
    defId: string,
    id: string,
    controllerId: string,
    overrides: Partial<CardInstanceState> = {}
): CardInstanceState {
    const def =
        defId === BEAR_ID
            ? bearDef
            : defId === COUNTER_BEAR_ID
              ? enteringBearDef
              : undefined;
    return {
        id,
        card: { id: defId },
        types: def?.types ?? ["Enchantment"],
        subtypes: def?.subtypes ?? [],
        power: def?.power,
        toughness: def?.toughness,
        staticAbilities: [],
        controllerId,
        ownerId: controllerId,
        zone: "battlefield",
        isTapped: false,
        ...overrides,
    };
}

describe("token-created replacement (CR 111.1 / 614, issue #3230)", () => {
    it("doubles the tokens created under the doubler's controller's control", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        permanent(TOKEN_DOUBLER_ID, "doubler1", "p1"),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        const ids = createTokenPermanents(state, SOLDIER, "p1", 1);
        expect(ids).toHaveLength(2);
        expect(
            state.players[0].battlefield.filter((c) => c.isToken)
        ).toHaveLength(2);
    });

    it("CR 614.5 — each doubler applies ONCE per creation: two doublers give 4, not an unbounded number", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        permanent(TOKEN_DOUBLER_ID, "doubler1", "p1"),
                        permanent(TOKEN_DOUBLER_ID, "doubler2", "p1"),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        expect(createTokenPermanents(state, SOLDIER, "p1", 1)).toHaveLength(4);
    });

    it("CR 111.2 — scopes on the token's prospective CONTROLLER, not on the creating effect", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        permanent(TOKEN_DOUBLER_ID, "doubler1", "p1"),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        expect(createTokenPermanents(state, SOLDIER, "p2", 1)).toHaveLength(1);
    });

    it("the batch TOKENS_CREATED event carries the POST-replacement count", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        permanent(TOKEN_DOUBLER_ID, "doubler1", "p1"),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        createTokenPermanents(state, SOLDIER, "p1", 3);
        const created = flushPendingEvents(state).filter(
            (e) => e.type === "TOKENS_CREATED"
        );
        expect(created).toHaveLength(1);
        expect(created[0]).toMatchObject({ count: 6, controllerId: "p1" });
    });

    it("CR 111.1 — a permanent merely ENTERING is not a token being created: the seam is never consulted", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    graveyard: [
                        permanent(BEAR_ID, "bear", "p1", { zone: "graveyard" }),
                    ],
                    battlefield: [
                        permanent(TOKEN_DOUBLER_ID, "doubler1", "p1"),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        consulted.token = 0;
        const stackItem = pushSpell(state, TOKEN_DOUBLER_ID, "p1");
        const ctx = buildSpellContext(state, stackItem);
        expect(ctx.returnToBattlefield("p1", "bear", "graveyard")).toBe(true);
        expect(consulted.token).toBe(0);
    });
});

describe("placement is not creation (issue #3230 review)", () => {
    it("`placement` skips BOTH count replacements: the token count and its entry counters are exactly the spec's", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        permanent(TOKEN_DOUBLER_ID, "doubler1", "p1"),
                        permanent(COUNTER_ADDER_ID, "adder1", "p1"),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        const incubated: TokenSpec = {
            ...SOLDIER,
            entersWith: { counters: [{ type: "+1/+1", count: 2 }] },
        };
        const ids = createTokenPermanents(
            state,
            incubated,
            "p1",
            1,
            undefined,
            {
                placement: true,
            }
        );
        expect(ids).toHaveLength(1);
        const token = state.players[0].battlefield.find(
            (c) => c.id === ids[0]
        )!;
        expect(token.counters).toEqual({ "+1/+1": 2 });

        // Control: the same call as a real CREATION runs both.
        const created = createTokenPermanents(state, incubated, "p1", 1);
        expect(created).toHaveLength(2);
        for (const id of created) {
            expect(
                state.players[0].battlefield.find((c) => c.id === id)!.counters
            ).toEqual({ "+1/+1": 3 });
        }
    });
});

describe("counter-placed replacement (CR 122.1 / 614, issue #3230)", () => {
    it("adds one to every +1/+1 placement on a creature its controller controls", () => {
        const bear = permanent(BEAR_ID, "bear", "p1");
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        permanent(COUNTER_ADDER_ID, "adder1", "p1"),
                        bear,
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        addCounterToCard(state, state.players[0].battlefield[1], "+1/+1", 2);
        expect(state.players[0].battlefield[1].counters).toEqual({
            "+1/+1": 3,
        });
        const added = flushPendingEvents(state).filter(
            (e) => e.type === "COUNTER_ADDED"
        );
        expect(added).toHaveLength(1);
        expect(added[0]).toMatchObject({ added: 3, total: 3 });
    });

    it("CR 614.5 — two adders each apply once: 1 becomes 3", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        permanent(COUNTER_ADDER_ID, "adder1", "p1"),
                        permanent(COUNTER_ADDER_ID, "adder2", "p1"),
                        permanent(BEAR_ID, "bear", "p1"),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        addCounterToCard(state, state.players[0].battlefield[2], "+1/+1", 1);
        expect(state.players[0].battlefield[2].counters).toEqual({
            "+1/+1": 3,
        });
    });

    it("scopes on the counter TYPE and on the object's controller", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        permanent(COUNTER_ADDER_ID, "adder1", "p1"),
                        permanent(BEAR_ID, "mine", "p1"),
                    ],
                }),
                makePlayer("p2", {
                    battlefield: [permanent(BEAR_ID, "theirs", "p2")],
                }),
            ],
        });
        addCounterToCard(state, state.players[0].battlefield[1], "-1/-1", 1);
        expect(state.players[0].battlefield[1].counters).toEqual({
            "-1/-1": 1,
        });
        addCounterToCard(state, state.players[1].battlefield[0], "+1/+1", 1);
        expect(state.players[1].battlefield[0].counters).toEqual({
            "+1/+1": 1,
        });
    });

    it("CR 614.1c — the entry seam applies it too: a permanent entering with one +1/+1 counter enters with two", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    graveyard: [
                        permanent(COUNTER_BEAR_ID, "bear", "p1", {
                            zone: "graveyard",
                        }),
                    ],
                    battlefield: [permanent(COUNTER_ADDER_ID, "adder1", "p1")],
                }),
                makePlayer("p2"),
            ],
        });
        const stackItem = pushSpell(state, COUNTER_ADDER_ID, "p1");
        const ctx = buildSpellContext(state, stackItem);
        expect(ctx.returnToBattlefield("p1", "bear", "graveyard")).toBe(true);
        const entered = state.players[0].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(entered.counters).toEqual({ "+1/+1": 2 });
        const added = flushPendingEvents(state).filter(
            (e) => e.type === "COUNTER_ADDED"
        );
        expect(added).toHaveLength(1);
        expect(added[0]).toMatchObject({ added: 2, instanceId: "bear" });
    });

    it("a rewrite to ZERO puts no counters on and announces nothing — at BOTH seams", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    graveyard: [
                        permanent(COUNTER_BEAR_ID, "entering", "p1", {
                            zone: "graveyard",
                        }),
                    ],
                    battlefield: [
                        permanent(COUNTER_NULLIFIER_ID, "null1", "p1"),
                        permanent(BEAR_ID, "bear", "p1"),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        addCounterToCard(state, state.players[0].battlefield[1], "+1/+1", 4);
        expect(state.players[0].battlefield[1].counters).toBeUndefined();

        const stackItem = pushSpell(state, COUNTER_NULLIFIER_ID, "p1");
        const ctx = buildSpellContext(state, stackItem);
        expect(ctx.returnToBattlefield("p1", "entering", "graveyard")).toBe(
            true
        );
        const entered = state.players[0].battlefield.find(
            (c) => c.id === "entering"
        )!;
        expect(entered.counters ?? {}).toEqual({});
        expect(
            flushPendingEvents(state).filter((e) => e.type === "COUNTER_ADDED")
        ).toHaveLength(0);
    });
});
