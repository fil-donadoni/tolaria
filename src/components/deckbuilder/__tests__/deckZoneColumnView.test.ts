// Issue #5402 — the Ordering follows the Grouping (Mana Value ↔ Colour) until
// the player picks one by hand.
import { beforeEach, describe, expect, it } from "vitest";
import { orderingFollowingGrouping } from "@convex/deckLayout";
import type { GroupingKind, OrderingKind } from "@convex/deckLayout";
import { loadGrouping, loadOrdering, saveOrdering } from "~/lib/deckViewPrefs";
import {
    recordGroupingChange,
    viewAfterGroupingChange,
} from "../deckZoneColumnView";

const view = (grouping: GroupingKind, ordering: OrderingKind) => ({
    grouping,
    ordering,
});

describe("orderingFollowingGrouping", () => {
    it("couples Mana Value to Colour and back", () => {
        expect(orderingFollowingGrouping("mv")).toBe("color");
        expect(orderingFollowingGrouping("color")).toBe("mv");
    });

    it("leaves type and none uncoupled", () => {
        expect(orderingFollowingGrouping("type")).toBeNull();
        expect(orderingFollowingGrouping("none")).toBeNull();
    });
});

describe("viewAfterGroupingChange", () => {
    it("sets the coupled Ordering on a Grouping change", () => {
        expect(viewAfterGroupingChange(view("color", "mv"), "mv")).toEqual(
            view("mv", "color")
        );
        expect(viewAfterGroupingChange(view("mv", "color"), "color")).toEqual(
            view("color", "mv")
        );
    });

    it("keeps a hand-picked Ordering until the Grouping changes again", () => {
        const picked = view("mv", "rarity");
        // An Ordering change never touches the Grouping, so the pair is intact.
        expect(picked.ordering).toBe("rarity");
        // The next Grouping change replaces it with the coupled default.
        expect(viewAfterGroupingChange(picked, "color").ordering).toBe("mv");
    });

    it("keeps today's Ordering for uncoupled Groupings", () => {
        expect(viewAfterGroupingChange(view("mv", "rarity"), "type")).toEqual(
            view("type", "rarity")
        );
        expect(viewAfterGroupingChange(view("mv", "name"), "none")).toEqual(
            view("none", "name")
        );
    });
});

describe("recordGroupingChange persistence", () => {
    beforeEach(() => localStorage.clear());

    it("persists the coupled Ordering beside the Grouping", () => {
        recordGroupingChange("maindeck", "mv");
        expect(loadGrouping("maindeck")).toBe("mv");
        expect(loadOrdering("maindeck")).toBe("color");
        recordGroupingChange("maindeck", "color");
        expect(loadOrdering("maindeck")).toBe("mv");
    });

    it("leaves the stored Ordering alone for uncoupled Groupings", () => {
        saveOrdering("maindeck", "rarity");
        recordGroupingChange("maindeck", "type");
        expect(loadGrouping("maindeck")).toBe("type");
        expect(loadOrdering("maindeck")).toBe("rarity");
    });
});
