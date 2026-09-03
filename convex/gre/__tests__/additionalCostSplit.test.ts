// The additional-cost payment record splits at the WRITE (CR 702.33d /
// CR 702.175a, ADR 0085, issue #2078).
//
// Several keywords share Kicker's cost half word for word — CR 702.33a "You may
// pay an additional [cost] as you cast this spell" is also, verbatim, the first
// half of CR 702.175a Offspring — so they share the whole cost subsystem
// (ADR 0079). What they do NOT share is CR 702.33d: "If a spell's controller
// declares the intention to pay any of that spell's KICKER costs, that spell has
// been 'kicked.'" A spell whose offspring cost was paid was never kicked.
//
// The separation is enforced by WHERE the record is written, not by how it is
// read: `additionalCostPaymentSnapshot` partitions one cast's payments by
// keyword onto the resulting stack item, so `kickerPayments` holds only the
// kicked-counting entries and every kicked-ness reader stays correct with no
// edit — including the one that runs on the CLIENT, which receives a slim stack
// item with no card definition and therefore cannot be made definition-aware.
//
// This file proves that at each of the consequences a kick actually has, driving
// the REAL commit path (`finalizeTargetSelection`, `convex/game.ts`) and the
// REAL resolution (`resolveTopOfStack`) rather than hand-building a stack item.
// The client consequence is proven where the client lives:
// `src/lib/__tests__/spell-property-target-integration.test.ts`.

import { describe, it, expect } from "vitest";
import { finalizeTargetSelection } from "../../game";
import {
    ADDITIONAL_COST_KEYWORDS,
    additionalCostPaidCount,
    additionalCostPaymentSnapshot,
    kickedCountOfPayments,
    kickedTargetRequirement,
    resolveKickerPayments,
    totalKickerCount,
} from "../kicker";
import { getLegalTargets, NO_TARGETING_SOURCE } from "../rules";
import {
    getPlayer,
    resolveTopOfStack,
    type GameState,
    type PendingTarget,
} from "../state";
import { compactState, expandState } from "../serialize";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup";
import { registerTokenDefinition } from "../../cards";
import type { CardDefinition, TargetRequirement } from "../../cards/types";
import { grizzlyBears } from "../../cards/sets/lea";

// ---------------------------------------------------------------------------
// Probes
// ---------------------------------------------------------------------------
//
// A matched PAIR, identical in every respect except the one word this ticket
// adds. That is what makes each assertion below a statement about the KEYWORD
// rather than about the probe: the kicked twin is the control, and every row
// runs both. No shipped card declares a non-kicker additional cost yet (issue
// #2079 ships the first), so a synthetic probe is the only way to exercise it —
// and the twin proves the machinery it rides is the same machinery every
// shipped Kicker card uses.

/** CR 702.33a — the control: an ordinary Kicker. `keyword` omitted, which is
 *  exactly how all 47 shipped Kicker cards read. */
const KICKER_TWIN_ID = "test:adr0085-kicker-twin";
const kickerTwin: CardDefinition = {
    id: KICKER_TWIN_ID,
    rarity: "common",
    name: "Kicker Twin Probe",
    manaCost: { X: 1 },
    types: ["Creature"],
    subtypes: ["Rabbit"],
    power: 1,
    toughness: 1,
    kickers: [{ id: "extra", description: "Kicker {1}", mana: { X: 1 } }],
    // CR 702.33c / 614.1c — "a +1/+1 counter for each time it was kicked".
    entersWith: { counters: [{ type: "+1/+1", count: "kicker" }] },
    effects: [],
};
registerTokenDefinition(kickerTwin);

/** CR 702.175a — the same cost, under the keyword whose table row says it is
 *  NOT a kick. Same id (`"extra"`) as the twin on purpose: the per-id read must
 *  answer for both, and only the KEYWORD may change the kicked-ness. */
const OFFSPRING_PROBE_ID = "test:adr0085-offspring-probe";
const offspringProbe: CardDefinition = {
    id: OFFSPRING_PROBE_ID,
    rarity: "common",
    name: "Offspring Probe",
    manaCost: { X: 1 },
    types: ["Creature"],
    subtypes: ["Rabbit"],
    power: 1,
    toughness: 1,
    kickers: [
        {
            id: "extra",
            description: "Offspring {1}",
            mana: { X: 1 },
            keyword: "offspring",
        },
    ],
    entersWith: { counters: [{ type: "+1/+1", count: "kicker" }] },
    effects: [],
};
registerTokenDefinition(offspringProbe);

/** CR 601.2b — a card whose target set CHANGES when it is kicked (the
 *  Bloodchief's Thirst shape), in both keyword flavours, so the requirement
 *  swap can be asked of each. */
const SWAP_KICKER_ID = "test:adr0085-swap-kicker";
const SWAP_OFFSPRING_ID = "test:adr0085-swap-offspring";
// The Bloodchief's Thirst shape: a narrow base requirement that widens when
// the spell is kicked.
const BASE_REQ: TargetRequirement = {
    type: "Creature",
    count: 1,
    mvFilter: { max: 2 },
};
const KICKED_REQ: TargetRequirement = {
    type: "Creature",
    count: 1,
};
const swapKicker: CardDefinition = {
    id: SWAP_KICKER_ID,
    rarity: "common",
    name: "Swap Kicker Probe",
    manaCost: { X: 1 },
    types: ["Sorcery"],
    kickers: [{ id: "extra", description: "Kicker {1}", mana: { X: 1 } }],
    targetRequirement: BASE_REQ,
    kickedTargetRequirement: KICKED_REQ,
    effects: [],
};
const swapOffspring: CardDefinition = {
    ...swapKicker,
    id: SWAP_OFFSPRING_ID,
    name: "Swap Offspring Probe",
    kickers: [
        {
            id: "extra",
            description: "Offspring {1}",
            mana: { X: 1 },
            keyword: "offspring",
        },
    ],
};
registerTokenDefinition(swapKicker);
registerTokenDefinition(swapOffspring);

/** Cast `cardId` paying its one additional cost, through the REAL commit path,
 *  and return the state plus the stack item that landed. */
function castPayingTheCost(cardId: string): {
    state: GameState;
    item: NonNullable<GameState["stack"][number]>;
} {
    const card = makeInstance(cardId, {
        controllerId: "p1",
        ownerId: "p1",
        zone: "hand",
        id: "probe1",
    });
    const state = makeState({
        players: [
            makePlayer("p1", {
                hand: [card],
                // {1} printed + {1} additional.
                manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 2 },
            }),
            makePlayer("p2"),
        ],
    });
    const pt: PendingTarget = {
        playerId: "p1",
        cardInstanceId: "probe1",
        targetType: "any",
        count: 0,
        selected: [],
        kickerPayments: { extra: 1 },
    };
    finalizeTargetSelection(state, pt, "p1");
    const item = state.stack.find((s) => s.id === "probe1");
    expect(item, "the probe never reached the stack").toBeDefined();
    return { state, item: item! };
}

describe("ADR 0085 — the table is the only thing that answers kicked-ness (CR 702.33d)", () => {
    it("says kicker is a kick and offspring is not", () => {
        expect(ADDITIONAL_COST_KEYWORDS.kicker.countsAsKicked).toBe(true);
        expect(ADDITIONAL_COST_KEYWORDS.offspring.countsAsKicked).toBe(false);
    });

    it("partitions one cast's payments by keyword", () => {
        expect(additionalCostPaymentSnapshot(kickerTwin, { extra: 1 })).toEqual(
            { kickerPayments: { extra: 1 } }
        );
        expect(
            additionalCostPaymentSnapshot(offspringProbe, { extra: 1 })
        ).toEqual({ unkickedCostPayments: { extra: 1 } });
    });

    it("fails CLOSED on an id the card does not declare — it can never invent a kick", () => {
        // `resolveKickerPayments` already rejects such an id at announcement;
        // this is the second line, for the Bot's sandboxes, which build stack
        // items straight from a Move.
        expect(additionalCostPaymentSnapshot(kickerTwin, { nope: 1 })).toEqual({
            unkickedCostPayments: { nope: 1 },
        });
        expect(additionalCostPaymentSnapshot(undefined, { extra: 1 })).toEqual({
            unkickedCostPayments: { extra: 1 },
        });
    });

    it("emits neither field for a cast that paid nothing", () => {
        expect(
            additionalCostPaymentSnapshot(offspringProbe, undefined)
        ).toEqual({});
        expect(additionalCostPaymentSnapshot(offspringProbe, {})).toEqual({});
    });

    it("CR 702.175a — an offspring entry may not be repeated (allowsMulti)", () => {
        expect(ADDITIONAL_COST_KEYWORDS.offspring.allowsMulti).toBe(false);
        const repeatable: CardDefinition = {
            ...offspringProbe,
            kickers: [{ ...offspringProbe.kickers![0], multi: true }],
        };
        expect(() => resolveKickerPayments(repeatable, { extra: 1 })).toThrow();
        // CR 702.33c — a MULTIKICKER, which is a kicker cost, still may.
        const multiKicker: CardDefinition = {
            ...kickerTwin,
            kickers: [{ ...kickerTwin.kickers![0], multi: true }],
        };
        expect(resolveKickerPayments(multiKicker, { extra: 3 })).toEqual({
            extra: 3,
        });
    });
});

describe("ADR 0085 — a non-kicker additional cost is not a kick, at every consequence", () => {
    it("consequence 1: the kicked target-requirement swap does not fire (CR 601.2b / 702.33)", () => {
        // The `moves.ts` twin of `game.ts`'s private
        // `castAdjustedTargetRequirement`, both routed through the same split.
        expect(kickedTargetRequirement(swapKicker, { extra: 1 })).toEqual(
            KICKED_REQ
        );
        expect(kickedTargetRequirement(swapOffspring, { extra: 1 })).toEqual(
            BASE_REQ
        );
        expect(kickedCountOfPayments(swapKicker, { extra: 1 })).toBe(1);
        expect(kickedCountOfPayments(swapOffspring, { extra: 1 })).toBe(0);
    });

    it('consequence 2+3: no `wasKicked` flag and no `count: "kicker"` ETB counters (CR 702.33d / 614.1c)', () => {
        const kicked = castPayingTheCost(KICKER_TWIN_ID);
        resolveTopOfStack(kicked.state);
        const kickedPerm = getPlayer(kicked.state, "p1").battlefield.find(
            (c) => c.id === "probe1"
        )!;
        expect(kickedPerm.wasKicked).toBe(true);
        expect(kickedPerm.counters?.["+1/+1"] ?? 0).toBe(1);

        const off = castPayingTheCost(OFFSPRING_PROBE_ID);
        resolveTopOfStack(off.state);
        const offPerm = getPlayer(off.state, "p1").battlefield.find(
            (c) => c.id === "probe1"
        )!;
        expect(offPerm.wasKicked).toBeUndefined();
        expect(offPerm.counters?.["+1/+1"] ?? 0).toBe(0);
        // …but the permanent still REMEMBERS the payment, per id — that is
        // what the offspring trigger (issue #2079) will read.
        expect(offPerm.unkickedCostPayments).toEqual({ extra: 1 });
        expect(additionalCostPaidCount(offPerm, "extra")).toBe(1);
    });

    it("consequence 4: `{ kickerCount: true }` reads 0 while `{ additionalCostPaid }` reads 1", () => {
        const { item } = castPayingTheCost(OFFSPRING_PROBE_ID);
        // Both DSL values are computed from these two exports — `kickerCount`
        // off `kickerPayments` alone, `additionalCostPaid` off both records.
        expect(totalKickerCount(item.kickerPayments)).toBe(0);
        expect(additionalCostPaidCount(item, "extra")).toBe(1);

        const twin = castPayingTheCost(KICKER_TWIN_ID);
        expect(totalKickerCount(twin.item.kickerPayments)).toBe(1);
        expect(additionalCostPaidCount(twin.item, "extra")).toBe(1);
    });

    it("consequence 5: the `spellWasKicked` target filter does not match it (CR 702.33a, issue #1956)", () => {
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", {
                    battlefield: [
                        makeInstance(grizzlyBears.id, {
                            id: "bear",
                            controllerId: "p2",
                            ownerId: "p2",
                        }),
                    ],
                }),
            ],
        });
        const kicked = pushSpell(state, KICKER_TWIN_ID, "p2", []);
        Object.assign(
            kicked,
            additionalCostPaymentSnapshot(kickerTwin, { extra: 1 })
        );
        const offspring = pushSpell(state, OFFSPRING_PROBE_ID, "p2", []);
        Object.assign(
            offspring,
            additionalCostPaymentSnapshot(offspringProbe, { extra: 1 })
        );
        const req: TargetRequirement = {
            type: "spell",
            count: 1,
            spellWasKicked: true,
        };
        expect(
            getLegalTargets(state, req, NO_TARGETING_SOURCE, "p1").map(
                (t) => t.id
            )
        ).toEqual([kicked.id]);
    });
});

describe("ADR 0085 — the sibling record survives serialization (schema drift guard)", () => {
    it("round-trips on a stack item, and the restored item is still unkicked", () => {
        const state = makeState();
        const item = pushSpell(state, OFFSPRING_PROBE_ID, "p1", []);
        Object.assign(
            item,
            additionalCostPaymentSnapshot(offspringProbe, { extra: 1 })
        );
        const round = expandState(compactState(state));
        const restored = round.stack.find((s) => s.id === item.id)!;
        expect(restored.unkickedCostPayments).toEqual({ extra: 1 });
        expect(restored.kickerPayments).toBeUndefined();
        expect(additionalCostPaidCount(restored, "extra")).toBe(1);
        expect(totalKickerCount(restored.kickerPayments)).toBe(0);
    });

    it("round-trips on a battlefield permanent (the CR 603.4 re-check window)", () => {
        const perm = makeInstance(OFFSPRING_PROBE_ID, {
            id: "perm1",
            controllerId: "p1",
            ownerId: "p1",
        });
        perm.unkickedCostPayments = { extra: 1 };
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [perm] }),
                makePlayer("p2"),
            ],
        });
        const round = expandState(compactState(state));
        const restored = getPlayer(round, "p1").battlefield.find(
            (c) => c.id === "perm1"
        )!;
        expect(restored.unkickedCostPayments).toEqual({ extra: 1 });
    });
});
