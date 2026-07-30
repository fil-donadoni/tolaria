import { describe, it, expect } from "vitest";
import {
    isZonePickConfirmEnabled,
    pendingChoiceMin,
    pendingChoiceMax,
} from "../pending-choice-confirm";
import { planarOverlay } from "@convex/cards/sets/pls/blue";
import { plains, tundra } from "@convex/cards/sets/lea";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "@convex/cards/__tests__/setup";
import { resolveTopOfStack } from "@convex/gre/state";
import { projectPublicState } from "@convex/gameProjections";

// The Sylvan Library redesign (#438) relies on the shared zone-pick confirm
// gate enabling Done at the MINIMUM allowed selection of a ranged choice
// (CR 608.2 — the player may topdeck 0..N cards drawn this turn).
describe("isZonePickConfirmEnabled (Done/Skip gate, CR 608.2)", () => {
    it("treats a fixed-N count as exactly N", () => {
        expect(isZonePickConfirmEnabled(2, 1)).toBe(false);
        expect(isZonePickConfirmEnabled(2, 2)).toBe(true);
        expect(isZonePickConfirmEnabled(2, 3)).toBe(false);
    });

    it("enables Done at min === 0 with an empty buffer (Sylvan: keep all N)", () => {
        // N = 2, life permits keeping both → range {0,2}. Done is enabled with
        // nothing selected (Skip = pay 4 × N).
        expect(isZonePickConfirmEnabled({ min: 0, max: 2 }, 0)).toBe(true);
        expect(isZonePickConfirmEnabled({ min: 0, max: 2 }, 1)).toBe(true);
        expect(isZonePickConfirmEnabled({ min: 0, max: 2 }, 2)).toBe(true);
    });

    it("rejects selecting past max (range guard)", () => {
        expect(isZonePickConfirmEnabled({ min: 0, max: 2 }, 3)).toBe(false);
    });

    it("forces a non-zero minimum when life can't cover keeping all N (CR 119.4)", () => {
        // life 6 → keep at most 1 of 2 → at least 1 must be topdecked → {1,2}.
        expect(isZonePickConfirmEnabled({ min: 1, max: 2 }, 0)).toBe(false);
        expect(isZonePickConfirmEnabled({ min: 1, max: 2 }, 1)).toBe(true);
        expect(isZonePickConfirmEnabled({ min: 1, max: 2 }, 2)).toBe(true);
    });

    it("with life < 4 the minimum equals N (all must be topdecked)", () => {
        expect(isZonePickConfirmEnabled({ min: 2, max: 2 }, 1)).toBe(false);
        expect(isZonePickConfirmEnabled({ min: 2, max: 2 }, 2)).toBe(true);
    });

    it("min/max readers handle both count shapes", () => {
        expect(pendingChoiceMin(2)).toBe(2);
        expect(pendingChoiceMax(2)).toBe(2);
        expect(pendingChoiceMin({ min: 0, max: 2 })).toBe(0);
        expect(pendingChoiceMax({ min: 0, max: 2 })).toBe(2);
    });

    // issue #1945 — a CATEGORIZED pick (`look-distribute` / `choose-categorized`)
    // adds a constraint the count bounds alone cannot express: the
    // hand/battlefield toggle has no per-click categorized gate (unlike the
    // richer library grid picker), so an in-bounds-COUNT-but-illegal-MATCHING
    // buffer must be caught here or Done would submit a combination the
    // server rejects.
    describe("categorized pick (issue #1945)", () => {
        const categories = [
            { label: "White", cardIds: ["w"] },
            { label: "Blue", cardIds: ["u"] },
        ];

        it("enables Done for a legal per-category assignment within bounds", () => {
            expect(
                isZonePickConfirmEnabled({ min: 2, max: 2 }, 2, {
                    categories,
                    pickedIds: ["w", "u"],
                })
            ).toBe(true);
        });

        it("disables Done for an in-bounds count that still fails the bipartite matching", () => {
            // Two cards, both only satisfying "White" — legal COUNT (2), but
            // no injective assignment exists (only one White seat).
            const clashing = [
                { label: "White", cardIds: ["w1", "w2"] },
                { label: "Blue", cardIds: [] },
            ];
            expect(
                isZonePickConfirmEnabled({ min: 1, max: 1 }, 1, {
                    categories: clashing,
                    pickedIds: ["w1"],
                })
            ).toBe(true);
            expect(
                isZonePickConfirmEnabled({ min: 2, max: 2 }, 2, {
                    categories: clashing,
                    pickedIds: ["w1", "w2"],
                })
            ).toBe(false);
        });

        it("is a no-op (count-only) when no `categorized` argument is supplied", () => {
            expect(isZonePickConfirmEnabled(2, 2)).toBe(true);
        });

        it("applies the COVER rule when the choice declares it: a category left unanswered blocks Done", () => {
            const lands = [
                { label: "Plains", cardIds: ["plains", "dual"] },
                { label: "Island", cardIds: ["dual"] },
            ];
            // The dual answers BOTH types — one land is a complete answer.
            expect(
                isZonePickConfirmEnabled({ min: 1, max: 2 }, 1, {
                    categories: lands,
                    pickedIds: ["dual"],
                    rule: "cover",
                })
            ).toBe(true);
            // The plain Plains alone is the same COUNT but leaves "Island"
            // unanswered — the count bounds cannot see this.
            expect(
                isZonePickConfirmEnabled({ min: 1, max: 2 }, 1, {
                    categories: lands,
                    pickedIds: ["plains"],
                    rule: "cover",
                })
            ).toBe(false);
            // …and under the injective rule (the default) that same buffer is
            // fine — the two rules genuinely differ, so the gate must read the
            // choice's own rule rather than assume one.
            expect(
                isZonePickConfirmEnabled({ min: 1, max: 2 }, 1, {
                    categories: lands,
                    pickedIds: ["plains"],
                })
            ).toBe(true);
        });
    });

    // Frontend wiring analysis, item 4 (`.claude/rules/gre-development.md`):
    // the Done gate is a SURFACE the new `choose-categorized` kind newly
    // depends on, and it reads TWO fields off the projected choice
    // (`categories` and `categoryRule`). A hand-built `categories` object —
    // every case above — cannot catch the projection dropping either one, so
    // this drives the same assertion through `projectPublicState`.
    describe("Done gate through the wire projection (issue #1945)", () => {
        const projectedHead = () => {
            const state = makeState({
                players: [
                    makePlayer("p1", {
                        battlefield: [
                            makeInstance(plains.id, {
                                id: "p1-plains",
                                controllerId: "p1",
                                ownerId: "p1",
                            }),
                            // A Plains/Island dual — it alone answers both
                            // categories (Gatherer's dual-land ruling).
                            makeInstance(tundra.id, {
                                id: "p1-tundra",
                                controllerId: "p1",
                                ownerId: "p1",
                            }),
                        ],
                    }),
                    makePlayer("p2"),
                ],
            });
            pushSpell(state, planarOverlay.id, "p1");
            resolveTopOfStack(state);
            const projected = projectPublicState(state, 1, "p1");
            return projected.pendingChoices![0];
        };

        it("carries `categories` and `categoryRule` across the wire", () => {
            const head = projectedHead();
            expect(head.kind).toBe("choose-categorized");
            expect(head.categoryRule).toBe("cover");
            expect(head.categories).toEqual([
                { label: "Plains", cardIds: ["p1-plains", "p1-tundra"] },
                { label: "Island", cardIds: ["p1-tundra"] },
                { label: "Swamp", cardIds: [] },
                { label: "Mountain", cardIds: [] },
                { label: "Forest", cardIds: [] },
            ]);
        });

        it("enables Done for the 1-land answer and blocks the uncovering one, off the PROJECTED choice", () => {
            const head = projectedHead();
            const gate = (pickedIds: string[]) =>
                isZonePickConfirmEnabled(head.count, pickedIds.length, {
                    categories: head.categories!,
                    pickedIds,
                    rule: head.categoryRule ?? "injective",
                });
            expect(gate(["p1-tundra"])).toBe(true); // the dual answers both types
            expect(gate(["p1-plains", "p1-tundra"])).toBe(true); // the 2-land answer
            expect(gate(["p1-plains"])).toBe(false); // "Island" unanswered
        });
    });
});
