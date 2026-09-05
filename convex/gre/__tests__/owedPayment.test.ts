// ADR 0091 / issue #1209 — the owed-payment seam and its key census.
//
// Two things are guarded here, and they are guarded differently on purpose:
//
//  - **The census is exhaustive.** `CAST_KEY_CENSUS` / `ACTIVATION_KEY_CENSUS`
//    are typed `Record<keyof PendingCast, …>` / `Record<keyof
//    PendingActivation, …>`, so an UNCLASSIFIED key is a COMPILE error
//    (`bun run check:ts`) — the same shape `PERSISTED_OPTIONAL_KEYS` /
//    `TRANSIENT_KEYS` use in `serialize.ts`. The runtime assertions below cover
//    what the type cannot: that the two derived key lists really partition, that
//    every key classified `"park"` has a matching `ParkKind` (and therefore a
//    branch in `nextOwedPayment` and a pick in `paymentPicks.ts`), and that a
//    fully-populated container carries no key the census has never seen.
//  - **The ORDER is behaviour.** Convoke must be reported BEFORE the delve /
//    flashback exile park, because the convoke pick is what builds the delve
//    picker; `manaSpendChoice` must be reported last.

import { describe, expect, it } from "vitest";
import { getCardByName } from "../../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import {
    ACTIVATION_KEY_CENSUS,
    CAST_KEY_CENSUS,
    NON_PARK_KEYS_ACTIVATION,
    NON_PARK_KEYS_CAST,
    PARK_KEYS_ACTIVATION,
    PARK_KEYS_CAST,
    PARK_KINDS,
    nextOwedPayment,
} from "../owedPayment";
import type { PendingActivation, PendingCast } from "../state";

const P1 = "p1";
const BEAR = getCardByName("Grizzly Bears").id;
const WURM = getCardByName("Craw Wurm").id;

/** A `PendingCast` with EVERY key populated. `Required<PendingCast>` makes a
 *  missing key a compile error, so this literal tracks the type — which is what
 *  lets the runtime assertion below notice a key the census never saw. */
const FULL_CAST: Required<PendingCast> = {
    playerId: P1,
    cardInstanceId: "spell",
    manaCost: { X: 1 },
    tappedLandIds: [],
    keepPriority: false,
    chosenX: 0,
    kickerPayments: {},
    buybackPaid: false,
    targetAmounts: {},
    payLife: 0,
    chosenModeId: "m",
    additionalCostLegId: "leg-life",
    // CR 702.37a/c — the morph face-down cast-mode marker (issue #2705).
    morphed: false,
    actingPlayerId: P1,
    additionalCost: { kind: "exile", filter: {}, pickedId: undefined },
    sacrificeSelection: {
        playerId: P1,
        reason: "r",
        requirements: [],
        picked: [],
    },
    exileFromGraveyardChoice: { count: 1, excludeInstanceId: "spell" },
    alternativeCostHandChoice: {
        action: "exile",
        requirements: [],
        excludeInstanceId: "spell",
    },
    evoked: false,
    dashed: false,
    bestowed: false,
    castOffSorceryTiming: false,
    improviseTappedArtifactIds: [],
    convokeCreatureChoice: { min: 1, max: 1, hybridPips: [] },
    manaSpendChoice: { generic: 1, candidateColors: ["R"] },
};

/** A `PendingActivation` with EVERY key populated (see {@link FULL_CAST}). */
const FULL_ACTIVATION: Required<PendingActivation> = {
    playerId: P1,
    cardInstanceId: "src",
    fromGraveyard: false,
    fromHand: false,
    abilityId: "a1",
    chosenModeId: "m",
    manaCost: { X: 1 },
    tappedLandIds: [],
    tapSource: false,
    sacrificeSource: false,
    returnUnblockedAttacker: false,
    sacrificeSelection: {
        playerId: P1,
        reason: "r",
        requirements: [],
        picked: [],
    },
    exileFromGraveyardChoice: { count: 1 },
    tapOtherChoice: { filter: {}, count: 1, pickedIds: [] },
    removeCounterCost: { type: "charge", count: 1 },
    lifeCost: 0,
    discardLastDrawnSource: false,
    discardThisSource: false,
    cyclingCost: false,
    exileThisSource: false,
    discardAtRandomCount: 0,
    discardFilterChoice: { filter: {}, count: 1 },
    chosenX: 0,
    keepPriority: false,
    targets: [],
    targetAmounts: {},
    grantedSourceCardId: "c",
    noteManaSpent: false,
    manaSpendChoice: { generic: 1, candidateColors: ["R"] },
};

describe("payment park census (ADR 0091, issue #1209)", () => {
    it("partitions every PendingCast key exactly once", () => {
        const park = new Set<string>(PARK_KEYS_CAST);
        const nonPark = new Set<string>(NON_PARK_KEYS_CAST);
        for (const k of park) expect(nonPark.has(k)).toBe(false);
        expect(park.size + nonPark.size).toBe(
            Object.keys(CAST_KEY_CENSUS).length
        );
        // A populated container may carry no key the census has never seen.
        for (const k of Object.keys(FULL_CAST)) {
            expect(park.has(k) || nonPark.has(k)).toBe(true);
        }
        expect(Object.keys(FULL_CAST).sort()).toEqual(
            Object.keys(CAST_KEY_CENSUS).sort()
        );
    });

    it("partitions every PendingActivation key exactly once", () => {
        const park = new Set<string>(PARK_KEYS_ACTIVATION);
        const nonPark = new Set<string>(NON_PARK_KEYS_ACTIVATION);
        for (const k of park) expect(nonPark.has(k)).toBe(false);
        expect(park.size + nonPark.size).toBe(
            Object.keys(ACTIVATION_KEY_CENSUS).length
        );
        for (const k of Object.keys(FULL_ACTIVATION)) {
            expect(park.has(k) || nonPark.has(k)).toBe(true);
        }
        expect(Object.keys(FULL_ACTIVATION).sort()).toEqual(
            Object.keys(ACTIVATION_KEY_CENSUS).sort()
        );
    });

    it("gives every park key a ParkKind (and so a gate branch + a pick)", () => {
        const kinds = new Set<string>(PARK_KINDS);
        for (const key of PARK_KEYS_CAST)
            expect(kinds.has(`cast:${key}`)).toBe(true);
        for (const key of PARK_KEYS_ACTIVATION) {
            expect(kinds.has(`activation:${key}`)).toBe(true);
        }
        // ...and no ParkKind without a park key behind it.
        expect(PARK_KINDS.length).toBe(
            PARK_KEYS_CAST.length + PARK_KEYS_ACTIVATION.length
        );
    });

    it("classifies the ten documented parks and nothing else", () => {
        expect([...PARK_KEYS_CAST].sort()).toEqual([
            "additionalCost",
            "alternativeCostHandChoice",
            "convokeCreatureChoice",
            "exileFromGraveyardChoice",
            "manaSpendChoice",
            "sacrificeSelection",
        ]);
        expect([...PARK_KEYS_ACTIVATION].sort()).toEqual([
            "discardFilterChoice",
            "exileFromGraveyardChoice",
            "manaSpendChoice",
            "sacrificeSelection",
            "tapOtherChoice",
        ]);
    });
});

function castState(pc: Partial<PendingCast>) {
    return makeState({
        players: [makePlayer(P1), makePlayer("p2")],
        pendingCast: {
            playerId: P1,
            cardInstanceId: "spell",
            manaCost: {},
            tappedLandIds: [],
            ...pc,
        },
    });
}

function activationState(
    pa: Partial<PendingActivation>,
    battlefield = [] as ReturnType<typeof makeInstance>[]
) {
    return makeState({
        players: [makePlayer(P1, { battlefield }), makePlayer("p2")],
        pendingActivation: {
            playerId: P1,
            cardInstanceId: "src",
            abilityId: "a1",
            manaCost: {},
            tappedLandIds: [],
            tapSource: false,
            sacrificeSource: false,
            ...pa,
        },
    });
}

const UNMET_SACRIFICE: NonNullable<PendingCast["sacrificeSelection"]> = {
    playerId: P1,
    reason: "r",
    requirements: [{ filter: {}, count: 1 }],
    picked: [],
};

describe("nextOwedPayment order (CR 601.2f/601.2g/602.1)", () => {
    it("reports nothing when no announcement is parked", () => {
        expect(nextOwedPayment(makeState({}), P1)).toBeNull();
    });

    it("reports nothing for a park owed by the OTHER player", () => {
        const state = castState({ sacrificeSelection: UNMET_SACRIFICE });
        expect(nextOwedPayment(state, "p2")).toBeNull();
    });

    it("reports the cast parks in gate order", () => {
        const all: Partial<PendingCast> = {
            sacrificeSelection: UNMET_SACRIFICE,
            additionalCost: { kind: "exile", filter: {} },
            convokeCreatureChoice: { min: 1, max: 1, hybridPips: [] },
            exileFromGraveyardChoice: { count: 1, excludeInstanceId: "spell" },
            alternativeCostHandChoice: {
                action: "exile",
                requirements: [],
                excludeInstanceId: "spell",
            },
            manaSpendChoice: { generic: 1, candidateColors: ["R"] },
        };
        const seen: string[] = [];
        const remaining = { ...all };
        for (let i = 0; i < 6; i++) {
            const owed = nextOwedPayment(castState(remaining), P1);
            expect(owed).not.toBeNull();
            seen.push(owed!.kind);
            delete remaining[owed!.key as keyof PendingCast];
        }
        expect(seen).toEqual([
            "cast:sacrificeSelection",
            "cast:additionalCost",
            "cast:convokeCreatureChoice",
            "cast:exileFromGraveyardChoice",
            "cast:alternativeCostHandChoice",
            "cast:manaSpendChoice",
        ]);
        expect(nextOwedPayment(castState(remaining), P1)).toBeNull();
    });

    it("reports convoke BEFORE the delve/flashback exile park (issue #1338)", () => {
        // The convoke pick pays the coloured/hybrid pips and reduces the
        // generic, so the delve picker is only BUILT after convoke resolves —
        // reporting delve first would offer a pick that does not exist yet.
        const owed = nextOwedPayment(
            castState({
                convokeCreatureChoice: { min: 1, max: 1, hybridPips: [] },
                exileFromGraveyardChoice: {
                    count: 1,
                    excludeInstanceId: "spell",
                    offsetGeneric: { min: 1, max: 3 },
                },
            }),
            P1
        );
        expect(owed?.kind).toBe("cast:convokeCreatureChoice");
    });

    it("reports the activation parks in gate order", () => {
        const all: Partial<PendingActivation> = {
            sacrificeSelection: UNMET_SACRIFICE,
            exileFromGraveyardChoice: { count: 1 },
            tapOtherChoice: { filter: {}, count: 1, pickedIds: [] },
            discardFilterChoice: { filter: {}, count: 1 },
            manaSpendChoice: { generic: 1, candidateColors: ["R"] },
        };
        const seen: string[] = [];
        const remaining = { ...all };
        for (let i = 0; i < 5; i++) {
            const owed = nextOwedPayment(activationState(remaining), P1);
            expect(owed).not.toBeNull();
            seen.push(owed!.kind);
            delete remaining[owed!.key as keyof PendingActivation];
        }
        expect(seen).toEqual([
            "activation:sacrificeSelection",
            "activation:exileFromGraveyardChoice",
            "activation:tapOtherChoice",
            "activation:discardFilterChoice",
            "activation:manaSpendChoice",
        ]);
        expect(nextOwedPayment(activationState(remaining), P1)).toBeNull();
    });

    it("clears a park once its pick is recorded", () => {
        expect(
            nextOwedPayment(
                castState({
                    exileFromGraveyardChoice: {
                        count: 1,
                        excludeInstanceId: "spell",
                        pickedCardIds: ["gy0"],
                    },
                }),
                P1
            )
        ).toBeNull();
    });

    it("holds a crew park open until enough total power is picked (CR 702.122a)", () => {
        // Grizzly Bears (2 power) does not pay Crew 5 on its own; the Craw Wurm
        // (6 power) does.
        const bear = makeInstance(BEAR, { id: "bear", controllerId: P1 });
        const wurm = makeInstance(WURM, { id: "wurm", controllerId: P1 });
        const partial = activationState(
            {
                tapOtherChoice: {
                    filter: {},
                    totalPower: 5,
                    pickedIds: ["bear"],
                },
            },
            [bear, wurm]
        );
        expect(nextOwedPayment(partial, P1)?.kind).toBe(
            "activation:tapOtherChoice"
        );
        const paid = activationState(
            {
                tapOtherChoice: {
                    filter: {},
                    totalPower: 5,
                    pickedIds: ["wurm"],
                },
            },
            [bear, wurm]
        );
        expect(nextOwedPayment(paid, P1)).toBeNull();
    });

    it("suppresses ONLY the mana-spend park under gateOwnsManaSpend", () => {
        const state = castState({
            manaSpendChoice: { generic: 1, candidateColors: ["R"] },
        });
        expect(nextOwedPayment(state, P1)?.kind).toBe("cast:manaSpendChoice");
        expect(
            nextOwedPayment(state, P1, { gateOwnsManaSpend: true })
        ).toBeNull();
        // A real pick park is still reported under the same flag — the gates
        // must keep blocking on it.
        const both = castState({
            sacrificeSelection: UNMET_SACRIFICE,
            manaSpendChoice: { generic: 1, candidateColors: ["R"] },
        });
        expect(
            nextOwedPayment(both, P1, { gateOwnsManaSpend: true })?.kind
        ).toBe("cast:sacrificeSelection");
    });

    it("never mutates the state it reads", () => {
        const state = castState({ sacrificeSelection: UNMET_SACRIFICE });
        const before = structuredClone(state);
        nextOwedPayment(state, P1);
        expect(state).toEqual(before);
    });
});
