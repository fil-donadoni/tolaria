// CR 115.5 — "A spell or ability on the stack is an illegal target for
// itself." Issue #10991: the client's stack-target highlighting must never
// mark the item choosing targets (a triggered ability, chosen once on the
// stack, CR 603.3d) as selectable — the same `checkSpellTargetFilters` refusal
// the server's offered and accepted sets apply.
import { describe, it, expect } from "vitest";
import { matchesSpellPendingTarget } from "~/lib/card-utils";
import type { PendingTarget } from "~/types/game";

const ctx = { playerId: "p2", activePlayerId: "p1", players: [] };

function pending(kind: PendingTarget["kind"]): PendingTarget {
    return {
        playerId: "p2",
        cardInstanceId: "trig",
        kind,
        targetType: "spell",
        count: { min: 0, max: 1 },
        selected: [],
        spellStackKind: "ability",
    } as unknown as PendingTarget;
}

const trigger = { id: "trig", card: { id: "x" }, triggeredAbilityId: "t" };
const other = { id: "bear", card: { id: "y" }, abilityId: "a" };

describe("CR 115.5 — client stack highlighting excludes the targeting item itself (issue #10991)", () => {
    it("a trigger choosing targets never lights its own stack item", () => {
        const pt = pending("trigger");
        expect(matchesSpellPendingTarget(trigger, pt, ctx)).toBe(false);
        expect(matchesSpellPendingTarget(other, pt, ctx)).toBe(true);
    });

    it("an ability activated from the battlefield is not on the stack yet: no self-exclusion by id", () => {
        // CR 602.2b — targets chosen while activating, before the item exists;
        // `cardInstanceId` names the permanent, not a stack item.
        const pt = { ...pending("ability"), cardInstanceId: "bear" };
        expect(matchesSpellPendingTarget(other, pt, ctx)).toBe(true);
    });
});
