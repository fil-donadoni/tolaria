// Per-Kicker CHECK-TIME predicate (CR 702.33 / CR 603.4, issue #2015).
//
// `additionalCostPaidCondition(id)` is the gate that decides whether a Battlemage's
// "if it was kicked with its {A} kicker" ETB trigger is EVER PUT ON THE STACK.
// That makes its failure mode asymmetric: a false negative loses an ability,
// but a false POSITIVE announces a target and emits a real `BECAME_TARGET`
// event (`emitBecameTargetEvents`, `gre/rules.ts`) for an ability CR 603.4 says
// never came into being — taxing the chosen permanent's controller through a
// ward / "becomes the target of a spell or ability" trigger. Hence the
// fail-CLOSED rows below carry the weight of this file: every shape that is not
// an unambiguous "this exact Kicker was paid at least once" must read false.
import { describe, expect, it } from "vitest";
import { additionalCostPaidCondition } from "../shared";
import { additionalCostPaidCount } from "../../../../gre/kicker";
import type { CardType, PermanentView } from "../../../types";

function makeSelf(overrides: Partial<PermanentView> = {}): PermanentView {
    return {
        id: "self",
        controllerId: "p1",
        ownerId: "p1",
        types: ["Creature"] as CardType[],
        subtypes: [],
        isTapped: false,
        card: {},
        ...overrides,
    };
}

describe("additionalCostPaidCondition (CR 702.33 / 603.4 per-Kicker check-time gate, issue #2015)", () => {
    it("true only for the NAMED Kicker when a two-Kicker card was partially kicked", () => {
        const self = makeSelf({ kickerPayments: { "kicker-g": 1 } });
        expect(additionalCostPaidCondition("kicker-g")(self)).toBe(true);
        // The whole point of the issue: the OTHER Kicker's trigger must not
        // fire. `wasKicked` would be true here ("kicked with something"), which
        // is exactly why the aggregate flag is not a usable per-Kicker gate.
        expect(additionalCostPaidCondition("kicker-b")(self)).toBe(false);
    });

    it("true for both when both Kickers were paid", () => {
        const self = makeSelf({
            kickerPayments: { "kicker-b": 1, "kicker-g": 1 },
        });
        expect(additionalCostPaidCondition("kicker-b")(self)).toBe(true);
        expect(additionalCostPaidCondition("kicker-g")(self)).toBe(true);
    });

    it("true for a Multikicker paid more than once (CR 702.33e)", () => {
        const self = makeSelf({ kickerPayments: { kicker: 3 } });
        expect(additionalCostPaidCondition("kicker")(self)).toBe(true);
    });

    // ── fail-closed rows ───────────────────────────────────────────────────
    const failClosed: Array<{ label: string; self: PermanentView }> = [
        {
            label: "no payment record at all (token, reanimated card, cast unkicked)",
            self: makeSelf(),
        },
        {
            label: "an empty payment record",
            self: makeSelf({ kickerPayments: {} }),
        },
        {
            label: "a record naming only OTHER Kickers",
            self: makeSelf({ kickerPayments: { "kicker-other": 2 } }),
        },
        {
            label: "an explicit zero for this Kicker (declined)",
            self: makeSelf({ kickerPayments: { "kicker-b": 0 } }),
        },
        {
            label: "a negative count (corrupt record)",
            self: makeSelf({ kickerPayments: { "kicker-b": -1 } }),
        },
        {
            label: "a non-numeric count (corrupt record)",
            self: makeSelf({
                kickerPayments: { "kicker-b": "1" } as unknown as Record<
                    string,
                    number
                >,
            }),
        },
    ];

    for (const row of failClosed) {
        it(`fails CLOSED: ${row.label}`, () => {
            expect(additionalCostPaidCondition("kicker-b")(row.self)).toBe(
                false
            );
        });
    }

    it("fails CLOSED on an inherited Object.prototype key (no spurious true from `toString`)", () => {
        const self = makeSelf({ kickerPayments: {} });
        expect(additionalCostPaidCondition("toString")(self)).toBe(false);
        expect(additionalCostPaidCondition("constructor")(self)).toBe(false);
    });

    // ── the SIBLING record (CR 702.175a / ADR 0085) ────────────────────────
    // A per-id question is about ONE cost entry, never about kicked-ness, so a
    // permanent whose OFFSPRING cost was paid — and which therefore carries no
    // `kickerPayments` at all — must still answer true for that entry's id.
    it("true for an id recorded in the UNKICKED sibling record only", () => {
        const self = makeSelf({ unkickedCostPayments: { offspring: 1 } });
        expect(additionalCostPaidCondition("offspring")(self)).toBe(true);
        expect(additionalCostPaidCondition("kicker")(self)).toBe(false);
    });

    it("answers both records on a permanent that paid one of each", () => {
        const self = makeSelf({
            kickerPayments: { kicker: 1 },
            unkickedCostPayments: { offspring: 1 },
        });
        expect(additionalCostPaidCondition("kicker")(self)).toBe(true);
        expect(additionalCostPaidCondition("offspring")(self)).toBe(true);
    });

    it("fails CLOSED on a corrupt entry in the sibling record", () => {
        const self = makeSelf({
            unkickedCostPayments: { offspring: "1" } as unknown as Record<
                string,
                number
            >,
        });
        expect(additionalCostPaidCondition("offspring")(self)).toBe(false);
    });

    it("agrees with `gre/kicker.ts`'s resolution-time authority on every shape", () => {
        // The check-time predicate deliberately reads the two payment records
        // locally rather than importing `additionalCostPaidCount` (that import
        // would drag `gre/state.ts` into every card module's init graph — see
        // the helper's doc comment). This is the test that keeps the two in
        // lockstep, across BOTH halves of the ADR 0085 split.
        const records: Array<Record<string, number> | undefined> = [
            undefined,
            {},
            { "kicker-b": 1 },
            { "kicker-b": 0 },
            { "kicker-b": -1 },
            { "kicker-b": 3, "kicker-g": 1 },
            { "kicker-g": 1 },
            { offspring: 1 },
        ];
        for (const kicked of records) {
            for (const unkicked of records) {
                for (const id of [
                    "kicker-b",
                    "kicker-g",
                    "offspring",
                    "nope",
                ]) {
                    expect(
                        additionalCostPaidCondition(id)(
                            makeSelf({
                                kickerPayments: kicked,
                                unkickedCostPayments: unkicked,
                            })
                        )
                    ).toBe(
                        additionalCostPaidCount(
                            {
                                kickerPayments: kicked,
                                unkickedCostPayments: unkicked,
                            },
                            id
                        ) >= 1
                    );
                }
            }
        }
    });
    // The predicate is deliberately CHECK-TIME ONLY: it must never be wired
    // as the ability's `interveningIf`. The engine re-evaluates an
    // `interveningIf` against the LIVE battlefield permanent (found by
    // `triggerSourceId`), and a CR 400.7 return of the same instance —
    // blink/flicker — arrives with `kickerPayments` already deleted by
    // `resetBattlefieldTransientState`, so the re-check would read a cleared
    // record and fizzle a trigger CR 603.10 says resolves off last known
    // information. The end-to-end lock for that is the Ephemerate regression
    // test in `cards/sets/pls/__tests__/red.test.ts`; here we just pin the
    // module surface so a re-added helper can't slip back in unnoticed.
    it("exposes no `interveningIf` variant for card authors to wire up", async () => {
        const shared = await import("../shared");
        expect(
            Object.keys(shared).filter((k) =>
                k.startsWith("additionalCostPaid")
            )
        ).toEqual(["additionalCostPaidCondition"]);
    });
});
