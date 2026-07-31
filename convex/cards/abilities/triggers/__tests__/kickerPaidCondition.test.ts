// Per-Kicker CHECK-TIME predicate (CR 702.33 / CR 603.4, issue #2015).
//
// `kickerPaidCondition(id)` is the gate that decides whether a Battlemage's
// "if it was kicked with its {A} kicker" ETB trigger is EVER PUT ON THE STACK.
// That makes its failure mode asymmetric: a false negative loses an ability,
// but a false POSITIVE announces a target and emits a real `BECAME_TARGET`
// event (`emitBecameTargetEvents`, `gre/rules.ts`) for an ability CR 603.4 says
// never came into being — taxing the chosen permanent's controller through a
// ward / "becomes the target of a spell or ability" trigger. Hence the
// fail-CLOSED rows below carry the weight of this file: every shape that is not
// an unambiguous "this exact Kicker was paid at least once" must read false.
import { describe, expect, it } from "vitest";
import { kickerPaidCondition } from "../shared";
import { kickerPaidCount } from "../../../../gre/kicker";
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

describe("kickerPaidCondition (CR 702.33 / 603.4 per-Kicker check-time gate, issue #2015)", () => {
    it("true only for the NAMED Kicker when a two-Kicker card was partially kicked", () => {
        const self = makeSelf({ kickerPayments: { "kicker-g": 1 } });
        expect(kickerPaidCondition("kicker-g")(self)).toBe(true);
        // The whole point of the issue: the OTHER Kicker's trigger must not
        // fire. `wasKicked` would be true here ("kicked with something"), which
        // is exactly why the aggregate flag is not a usable per-Kicker gate.
        expect(kickerPaidCondition("kicker-b")(self)).toBe(false);
    });

    it("true for both when both Kickers were paid", () => {
        const self = makeSelf({
            kickerPayments: { "kicker-b": 1, "kicker-g": 1 },
        });
        expect(kickerPaidCondition("kicker-b")(self)).toBe(true);
        expect(kickerPaidCondition("kicker-g")(self)).toBe(true);
    });

    it("true for a Multikicker paid more than once (CR 702.33e)", () => {
        const self = makeSelf({ kickerPayments: { kicker: 3 } });
        expect(kickerPaidCondition("kicker")(self)).toBe(true);
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
            expect(kickerPaidCondition("kicker-b")(row.self)).toBe(false);
        });
    }

    it("fails CLOSED on an inherited Object.prototype key (no spurious true from `toString`)", () => {
        const self = makeSelf({ kickerPayments: {} });
        expect(kickerPaidCondition("toString")(self)).toBe(false);
        expect(kickerPaidCondition("constructor")(self)).toBe(false);
    });

    it("agrees with `gre/kicker.ts`'s resolution-time authority on every shape", () => {
        // The check-time predicate deliberately reads `kickerPayments` locally
        // rather than importing `kickerPaidCount` (that import would drag
        // `gre/state.ts` into every card module's init graph — see the helper's
        // doc comment). This is the test that keeps the two in lockstep.
        const records: Array<Record<string, number> | undefined> = [
            undefined,
            {},
            { "kicker-b": 1 },
            { "kicker-b": 0 },
            { "kicker-b": -1 },
            { "kicker-b": 3, "kicker-g": 1 },
            { "kicker-g": 1 },
        ];
        for (const rec of records) {
            for (const id of ["kicker-b", "kicker-g", "nope"]) {
                expect(
                    kickerPaidCondition(id)(makeSelf({ kickerPayments: rec }))
                ).toBe(kickerPaidCount(rec, id) >= 1);
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
            Object.keys(shared).filter((k) => k.startsWith("kickerPaid"))
        ).toEqual(["kickerPaidCondition"]);
    });
});
