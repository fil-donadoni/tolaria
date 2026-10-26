import { describe, it, expect } from "vitest";
import {
    isStackChoiceCandidate,
    pendingChoiceCollapsesStack,
    pendingChoiceRoutesToBattlefield,
    pendingChoiceRequiresBoardTap,
    pendingChoiceSpansAllBattlefields,
} from "../pending-choice-labels";
import type { PendingChoice } from "~/types/game";

function choice(over: Partial<PendingChoice>): PendingChoice {
    return {
        stackItemId: "stk",
        step: 0,
        choiceId: "me",
        playerId: "me",
        kind: "may-pay",
        count: 1,
        prompt: "Pay?",
        ...over,
    } as PendingChoice;
}

describe("pendingChoiceRoutesToBattlefield (issue #1823 review fixup)", () => {
    it("is true iff zone === 'battlefield', regardless of kind", () => {
        expect(
            pendingChoiceRoutesToBattlefield(
                choice({ kind: "choose-permanents", zone: "battlefield" })
            )
        ).toBe(true);
        expect(
            pendingChoiceRoutesToBattlefield(
                choice({ kind: "search-library", zone: "library" })
            )
        ).toBe(false);
        expect(
            pendingChoiceRoutesToBattlefield(choice({ kind: "may-pay" }))
        ).toBe(false);
    });

    // The discriminator this predicate exists for (review fixup #1823,
    // finding 1): a zone-less `may-pay` with a payable MANA leg (Echo,
    // cumulative upkeep, "unless you pay {mana}" triggers — CR 702.30 echo / 117.3a)
    // never sets `zone` (`requestMayPay` only sets it for a real
    // sacrifice/discard victim pick). If this predicate wrongly returned
    // `true` for it, `useBattlefieldInteraction.tsx`'s click router would
    // toggle the board-tap buffer instead of leaving the click alone for the
    // mana picker, AND `usePendingChoicePrimaryAction.ts` would gate Pay on a
    // buffered board pick that never gets satisfied — Pay stays permanently
    // disabled. 815 other tests stay green either way; only this exact
    // assertion catches the regression. `pendingChoiceRequiresBoardTap` is the
    // WIDER predicate built for exactly this shape — its own describe block
    // below covers the `true` twin.
    it("is false for a zone-less may-pay with a payable mana leg (Echo / cumulative upkeep shape) — the exact case the wider pendingChoiceRequiresBoardTap predicate exists to catch instead", () => {
        expect(
            pendingChoiceRoutesToBattlefield(
                choice({ kind: "may-pay", cost: { R: 1 } })
            )
        ).toBe(false);
    });
});

describe("pendingChoiceRequiresBoardTap (issue #1813, review fixup #1823 finding 1)", () => {
    it("is true for every zone: 'battlefield' choice (unchanged #1813 behavior)", () => {
        expect(
            pendingChoiceRequiresBoardTap(
                choice({ kind: "choose-permanents", zone: "battlefield" })
            )
        ).toBe(true);
        expect(
            pendingChoiceRequiresBoardTap(
                choice({ kind: "choose-aura-host", zone: "battlefield" })
            )
        ).toBe(true);
    });

    it("is false for a zone-less non-may-pay choice (option-pick, name-card, yes/no)", () => {
        expect(
            pendingChoiceRequiresBoardTap(choice({ kind: "option-pick" }))
        ).toBe(false);
        expect(
            pendingChoiceRequiresBoardTap(choice({ kind: "name-card" }))
        ).toBe(false);
        expect(
            pendingChoiceRequiresBoardTap(choice({ kind: "land-entry-tapped" }))
        ).toBe(false);
    });

    it("is false for a zone-less may-pay with no cost, or a pure life/sacrifice/discard/energy cost", () => {
        expect(pendingChoiceRequiresBoardTap(choice({ kind: "may-pay" }))).toBe(
            false
        );
        expect(
            pendingChoiceRequiresBoardTap(
                choice({ kind: "may-pay", cost: { life: 2 } })
            )
        ).toBe(false);
        expect(
            pendingChoiceRequiresBoardTap(
                choice({
                    kind: "may-pay",
                    cost: { energy: 3 },
                })
            )
        ).toBe(false);
    });

    // The regression this fixup exists for: Echo / cumulative upkeep / "unless
    // you pay {mana}" triggers request a may-pay with a MANA leg and NO zone
    // (`requestMayPay` only sets `zone` for a real sacrifice/discard victim
    // pick — never for a mana leg). `zone === "battlefield"` alone missed
    // these entirely.
    it("is true for a zone-less may-pay whose cost has a payable mana leg (Echo / cumulative upkeep / Sunken City shape)", () => {
        // Bare ManaCost historical shape (Echo).
        expect(
            pendingChoiceRequiresBoardTap(
                choice({ kind: "may-pay", cost: { R: 1 } })
            )
        ).toBe(true);
        // Union shape with a mana leg alongside another leg.
        expect(
            pendingChoiceRequiresBoardTap(
                choice({
                    kind: "may-pay",
                    cost: { mana: { generic: 2 }, life: 1 },
                })
            )
        ).toBe(true);
        // Variable {X} mana leg.
        expect(
            pendingChoiceRequiresBoardTap(
                choice({ kind: "may-pay", cost: { mana: { X: "X" } } })
            )
        ).toBe(true);
    });

    // Review fixup #1823 (note 3) — before this fixup, `hybrid` (an array)
    // and `phyrexian` (an object) both silently failed the `typeof value ===
    // "number"` numeric-pip check and were ignored: a false negative. Today
    // unreachable (no shipped card routes a hybrid/Phyrexian-only leg through
    // `may-pay`), but the predicate must not silently mis-classify one if it
    // ever does.
    it("is true for a zone-less may-pay whose mana leg is guild-hybrid or Phyrexian pips only (CR 202.1a / 107.4f)", () => {
        expect(
            pendingChoiceRequiresBoardTap(
                choice({
                    kind: "may-pay",
                    cost: { mana: { hybrid: [["B", "G"]] } },
                })
            )
        ).toBe(true);
        expect(
            pendingChoiceRequiresBoardTap(
                choice({
                    kind: "may-pay",
                    cost: { mana: { phyrexian: { U: 1 } } },
                })
            )
        ).toBe(true);
    });

    it("is false for an empty hybrid array or an all-zero phyrexian leg", () => {
        expect(
            pendingChoiceRequiresBoardTap(
                choice({
                    kind: "may-pay",
                    cost: { mana: { hybrid: [] } },
                })
            )
        ).toBe(false);
        expect(
            pendingChoiceRequiresBoardTap(
                choice({
                    kind: "may-pay",
                    cost: { mana: { phyrexian: { U: 0 } } },
                })
            )
        ).toBe(false);
    });

    it("is false for a degenerate all-zero mana leg", () => {
        expect(
            pendingChoiceRequiresBoardTap(
                choice({ kind: "may-pay", cost: { generic: 0 } })
            )
        ).toBe(false);
        expect(
            pendingChoiceRequiresBoardTap(
                choice({
                    kind: "may-pay",
                    cost: { mana: { generic: 0 }, life: 3 },
                })
            )
        ).toBe(false);
    });

    it("ignores a mana leg on a non-may-pay kind (mana leg only means something for may-pay)", () => {
        // land-entry-tapped never carries a `cost` in practice, but the
        // predicate must not treat a stray cost-shaped field as a mana leg
        // for a kind other than may-pay.
        expect(
            pendingChoiceRequiresBoardTap(
                choice({
                    kind: "land-entry-tapped",
                    cost: { R: 1 } as never,
                })
            )
        ).toBe(false);
    });
});

// CR 609.7a (issue #5601) — the "source of your choice" pool: every permanent,
// whoever controls it, and every spell on the stack.
describe("the battlefield-or-stack source pool (issue #5601)", () => {
    const sourcePick = (over: Partial<PendingChoice> = {}) =>
        choice({
            kind: "pick-source",
            zone: "battlefield-or-stack",
            candidateIds: ["bolt", "ogre"],
            ...over,
        });

    it("routes battlefield clicks, on every player's battlefield", () => {
        expect(pendingChoiceRoutesToBattlefield(sourcePick())).toBe(true);
        expect(pendingChoiceSpansAllBattlefields(sourcePick())).toBe(true);
        expect(
            pendingChoiceSpansAllBattlefields(
                choice({ kind: "choose-permanents", zone: "battlefield" })
            )
        ).toBe(false);
        // Issue #6941 — an "any target" pick (cascade free cast, Word of
        // Command) declares no `allControllers` yet its candidates sit on the
        // opponent's battlefield.
        expect(
            pendingChoiceSpansAllBattlefields(
                choice({ kind: "choose-damage-target", zone: "battlefield" })
            )
        ).toBe(true);
    });

    it("offers a stack object only to the chooser, and only off the allow-list", () => {
        expect(isStackChoiceCandidate(sourcePick(), "me", "bolt")).toBe(true);
        expect(isStackChoiceCandidate(sourcePick(), "me", "growth")).toBe(
            false
        );
        expect(isStackChoiceCandidate(sourcePick(), "opp", "bolt")).toBe(false);
        // A battlefield-only pick never reaches the stack.
        expect(
            isStackChoiceCandidate(
                choice({
                    kind: "choose-permanents",
                    zone: "battlefield",
                    candidateIds: ["bolt"],
                }),
                "me",
                "bolt"
            )
        ).toBe(false);
        expect(isStackChoiceCandidate(undefined, "me", "bolt")).toBe(false);
    });

    it("keeps the compact stack panel open while a stack object is a candidate (CR 609.7a)", () => {
        const stack = [{ id: "bolt" }, { id: "cop" }];
        expect(pendingChoiceCollapsesStack(sourcePick(), "me", stack)).toBe(
            false
        );
        // Battlefield candidates only: an ordinary board tap, panel aside.
        expect(
            pendingChoiceCollapsesStack(
                sourcePick({ candidateIds: ["ogre"] }),
                "me",
                stack
            )
        ).toBe(true);
        // Another seat's choice never collapses this viewer's panel.
        expect(
            pendingChoiceCollapsesStack(
                sourcePick({ candidateIds: ["ogre"] }),
                "opp",
                stack
            )
        ).toBe(false);
        expect(pendingChoiceCollapsesStack(undefined, "me", stack)).toBe(false);
    });
});
