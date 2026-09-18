// CR 614.1c / 702.33e–f (issue #3864) — the three JSON surfaces a kicked entry
// rider compiles to, driven through `resolveTopOfStack` with kicked, unkicked
// and both-kickers-paid stack items:
//
//   1. `entersWith.counters[].count: { additionalCostPaid: "<id>" }` — entry
//      counters read off ONE kicker's payment record ("if this creature was
//      kicked with its {1}{U} kicker, it enters with two +1/+1 counters");
//   2. a `keyword-grant` descriptor scoped `self-if-kicked` — "… and with
//      flying", bare (any kicker) or per kicker id;
//   3. an `activated-grant` descriptor scoped `self-if-kicked` — '… and with
//      "Pay 3 life: Regenerate this creature."' (CR 113.1a).
//
// The definitions are the compiler's own output shape for Anavolver / Kavu
// Titan (neither is in the hand-written catalogue as a descriptor card), so
// they are registered for the test's duration via `withTemporaryDefinition`.

import { describe, expect, it } from "vitest";
import { withTemporaryDefinition } from "../../cards";
import type { CardDefinition } from "../../cards/types";
import { projectPublicState } from "../../gameProjections";
import { makePlayer, makeState, pushSpell } from "../../cards/__tests__/setup";
import { getEffectiveActivatedAbilities } from "../activatedAbilities";
import {
    exileWithAttachments,
    resolveTopOfStack,
    returnExiledForSource,
    type CardInstanceState,
    type GameState,
} from "../state";

/** Anavolver as compiled: two kickers, a per-kicker keyword and a per-kicker
 *  quoted ability. */
const PER_KICKER: CardDefinition = {
    id: "test-kicked-rider-per-kicker",
    rarity: "common",
    name: "Per-Kicker Volver",
    types: ["Creature"],
    subtypes: ["Volver"],
    manaCost: { X: 3, G: 1 },
    power: 3,
    toughness: 3,
    kickers: [
        { id: "kicker-u", description: "Kicker {1}{U}", mana: { X: 1, U: 1 } },
        { id: "kicker-b", description: "Kicker {B}", mana: { B: 1 } },
    ],
    entersWith: {
        counters: [
            { type: "+1/+1", count: { additionalCostPaid: "kicker-u" } },
            { type: "+1/+1", count: { additionalCostPaid: "kicker-u" } },
            { type: "+1/+1", count: { additionalCostPaid: "kicker-b" } },
        ],
    },
    compiledStaticEffects: [
        {
            kind: "keyword-grant",
            keyword: "flying",
            appliesTo: "self-if-kicked",
            kickerId: "kicker-u",
        },
        {
            kind: "activated-grant",
            abilityId: "per-kicker-regen",
            appliesTo: "self-if-kicked",
            kickerId: "kicker-b",
        },
    ],
    grantTemplates: [
        {
            id: "per-kicker-regen",
            oracleText: "Pay 3 life: Regenerate this creature.",
            cost: { life: 3 },
            useStack: true,
            effects: [{ op: "regenerate", target: { ref: "$source" } }],
        },
    ],
};

/** Kavu Titan as compiled: one kicker, the bare "if it was kicked" gate. */
const SINGLE_KICKER: CardDefinition = {
    id: "test-kicked-rider-single",
    rarity: "common",
    name: "Single-Kicker Kavu",
    types: ["Creature"],
    subtypes: ["Kavu"],
    manaCost: { X: 1, G: 1 },
    power: 2,
    toughness: 2,
    kickers: [
        { id: "kicker", description: "Kicker {2}{G}", mana: { X: 2, G: 1 } },
    ],
    entersWith: {
        counters: [
            { type: "+1/+1", count: "kicker" },
            { type: "+1/+1", count: "kicker" },
            { type: "+1/+1", count: "kicker" },
        ],
    },
    compiledStaticEffects: [
        {
            kind: "keyword-grant",
            keyword: "trample",
            appliesTo: "self-if-kicked",
        },
    ],
};

/** A kicked creature with no rider of its own — the bystander the self gate
 *  must never reach. */
const PLAIN_KICKER: CardDefinition = {
    id: "test-kicked-rider-plain",
    rarity: "common",
    name: "Plain Kicker Bear",
    types: ["Creature"],
    subtypes: ["Bear"],
    manaCost: { X: 1, G: 1 },
    power: 2,
    toughness: 2,
    kickers: [{ id: "kicker", description: "Kicker {1}", mana: { X: 1 } }],
};

function resolveWith(
    def: CardDefinition,
    payments: Record<string, number> | undefined
): { state: GameState; live: CardInstanceState } {
    const state = makeState({ players: [makePlayer("p1"), makePlayer("p2")] });
    const item = pushSpell(state, def.id, "p1");
    if (payments !== undefined) item.kickerPayments = payments;
    resolveTopOfStack(state);
    const live = state.players[0]!.battlefield.find((c) => c.id === item.id)!;
    expect(state.stack).toEqual([]);
    return { state, live };
}

const grantedIds = (card: CardInstanceState): string[] =>
    getEffectiveActivatedAbilities(card).map((a) => a.ability.id);

describe("per-kicker entry counters — { additionalCostPaid } (CR 702.33f)", () => {
    it.each([
        ["unkicked", undefined, 0],
        ["only {1}{U} paid", { "kicker-u": 1 }, 2],
        ["only {B} paid", { "kicker-b": 1 }, 1],
        ["both kickers paid", { "kicker-u": 1, "kicker-b": 1 }, 3],
    ] as const)("%s → %d +1/+1 counters", (_label, payments, expected) => {
        withTemporaryDefinition(PER_KICKER, () => {
            const { live } = resolveWith(
                PER_KICKER,
                payments === undefined ? undefined : { ...payments }
            );
            expect(live.counters?.["+1/+1"] ?? 0).toBe(expected);
        });
    });
});

describe("kicker-gated self keyword grant — appliesTo: self-if-kicked", () => {
    it("per kicker id: flying only when ITS kicker was paid", () => {
        withTemporaryDefinition(PER_KICKER, () => {
            expect(
                resolveWith(PER_KICKER, undefined).live.staticAbilities
            ).not.toContain("flying");
            expect(
                resolveWith(PER_KICKER, { "kicker-b": 1 }).live.staticAbilities
            ).not.toContain("flying");
            expect(
                resolveWith(PER_KICKER, { "kicker-u": 1 }).live.staticAbilities
            ).toContain("flying");
            expect(
                resolveWith(PER_KICKER, { "kicker-u": 1, "kicker-b": 1 }).live
                    .staticAbilities
            ).toContain("flying");
        });
    });

    it("bare gate: trample when any kicker was paid, never when unkicked", () => {
        withTemporaryDefinition(SINGLE_KICKER, () => {
            const kicked = resolveWith(SINGLE_KICKER, { kicker: 1 }).live;
            expect(kicked.counters?.["+1/+1"]).toBe(3);
            expect(kicked.staticAbilities).toContain("trample");
            const unkicked = resolveWith(SINGLE_KICKER, undefined).live;
            expect(unkicked.counters?.["+1/+1"] ?? 0).toBe(0);
            expect(unkicked.staticAbilities).not.toContain("trample");
        });
    });

    it("the grant belongs to the permanent itself, never to another KICKED creature", () => {
        // The gate reads the recipient's own kick, so the self half is what
        // stops a kicked Kavu from granting trample to every OTHER creature
        // that was itself kicked on the way in.
        withTemporaryDefinition(SINGLE_KICKER, () =>
            withTemporaryDefinition(PLAIN_KICKER, () => {
                const state = makeState({
                    players: [makePlayer("p1"), makePlayer("p2")],
                });
                const source = pushSpell(state, SINGLE_KICKER.id, "p1");
                source.kickerPayments = { kicker: 1 };
                resolveTopOfStack(state);
                const other = pushSpell(state, PLAIN_KICKER.id, "p1");
                other.kickerPayments = { kicker: 1 };
                resolveTopOfStack(state);
                const bf = state.players[0]!.battlefield;
                expect(
                    bf.find((c) => c.id === source.id)!.staticAbilities
                ).toContain("trample");
                const plain = bf.find((c) => c.id === other.id)!;
                expect(plain.wasKicked).toBe(true);
                expect(plain.staticAbilities).not.toContain("trample");
            })
        );
    });
});

describe("kicker-gated quoted ability — activated-grant, appliesTo: self-if-kicked (CR 113.1a)", () => {
    it.each([
        ["unkicked", undefined, false],
        ["only {1}{U} paid", { "kicker-u": 1 }, false],
        ["only {B} paid", { "kicker-b": 1 }, true],
        ["both kickers paid", { "kicker-u": 1, "kicker-b": 1 }, true],
    ] as const)(
        "%s → has 'Pay 3 life: Regenerate': %s",
        (_label, payments, has) => {
            withTemporaryDefinition(PER_KICKER, () => {
                const { live } = resolveWith(
                    PER_KICKER,
                    payments === undefined ? undefined : { ...payments }
                );
                expect(grantedIds(live).includes("per-kicker-regen")).toBe(has);
            });
        }
    );

    it("CR 400.7 — a kicked permanent that leaves and returns uncast loses both grants", () => {
        // Blink: the returning object is a new object that was never cast
        // (CR 400.7), so neither `kickerPayments` gate can still read paid.
        withTemporaryDefinition(PER_KICKER, () => {
            const { state, live } = resolveWith(PER_KICKER, {
                "kicker-u": 1,
                "kicker-b": 1,
            });
            expect(live.staticAbilities).toContain("flying");
            expect(
                exileWithAttachments(state, live.id, {
                    sourceId: "blinker",
                    returnTapped: false,
                })
            ).not.toBeNull();
            returnExiledForSource(state, "blinker");
            const back = state.players[0]!.battlefield.find(
                (c) => c.id === live.id
            )!;
            expect(back.kickerPayments).toBeUndefined();
            expect(back.counters?.["+1/+1"] ?? 0).toBe(0);
            expect(back.staticAbilities).not.toContain("flying");
            expect(grantedIds(back)).not.toContain("per-kicker-regen");
        });
    });

    it("survives the wire projection (the client sees the keyword and the ability)", () => {
        withTemporaryDefinition(PER_KICKER, () => {
            const { state, live } = resolveWith(PER_KICKER, {
                "kicker-u": 1,
                "kicker-b": 1,
            });
            const slim = projectPublicState(state, 1, "p1")
                .players.flatMap((p) => p.battlefield)
                .find((c) => c.id === live.id)!;
            expect(slim.staticAbilities).toContain("flying");
            expect(slim.counters?.["+1/+1"]).toBe(3);
            expect(grantedIds(slim as unknown as CardInstanceState)).toContain(
                "per-kicker-regen"
            );
        });
    });
});
