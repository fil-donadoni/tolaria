// CR 601.2c (issue #4193) — the target prompt's per-announced-target roster.
//
// Driven through the REAL view reducer (`projectPublicState`), per
// `.claude/rules/gre-development.md` § Frontend wiring analysis: the engine
// derives the roles at announcement and the board is only a view of them, so a
// hand-built `PendingTarget` here would assert the component against a field
// the projection is free to drop — the exact "all server tests pass, nothing
// appears" class this rule exists for.
//
// Two halves, and the second is the acceptance criterion that is easy to
// lose: an ASYMMETRIC announcement (kicked Jilt) grows a roster, and a
// SYMMETRIC one (kicked Magma Burst) renders exactly what it rendered before
// this issue — no roster node at all.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "@convex/cards/__tests__/setup";
import { getCardByName } from "@convex/cards";
import { announcedTargetRoleFields } from "@convex/game";
import { projectPublicState } from "@convex/gameProjections";
import { pendingTargetFiltersFromRequirement } from "@convex/gre/rules";
import type { PendingTarget, Player } from "~/types/game";

vi.mock("convex/react", () => ({
    useMutation: () => vi.fn(),
    useQuery: () => undefined,
}));
vi.mock("@convex/_generated/api", () => ({
    api: { game: { cancelTarget: {}, confirmTargets: {} } },
}));

import TargetSelectionBanner from "../target-selection-banner";

afterEach(cleanup);

/** A live kicked announcement for `cardName`, projected for its caster — the
 *  same shape `announceCast` leaves behind, with `selected` already holding
 *  `picks` permanents. */
function projectAnnouncement(cardName: string, picks: string[]) {
    const def = getCardByName(cardName);
    const spell = makeInstance(def.id, {
        id: "spell",
        controllerId: "p1",
        ownerId: "p1",
        zone: "hand",
    });
    const state = makeState({
        players: [makePlayer("p1", { hand: [spell] }), makePlayer("p2")],
    });
    const requirement = def.kickedTargetRequirement!;
    state.pendingTarget = {
        playerId: "p1",
        cardInstanceId: "spell",
        targetType: requirement.type,
        count: 2,
        selected: picks.map((id) => ({ type: "permanent" as const, id })),
        kickerPayments: { kicker: 1 },
        ...pendingTargetFiltersFromRequirement(requirement, undefined),
        ...announcedTargetRoleFields(def, undefined, 2),
    };
    const view = projectPublicState(state, 1, "p1");
    return {
        pendingTarget: view.pendingTarget as unknown as PendingTarget,
        me: view.players[0] as unknown as Player,
    };
}

function renderBanner(cardName: string, picks: string[]) {
    const { pendingTarget, me } = projectAnnouncement(cardName, picks);
    render(
        <TargetSelectionBanner
            pendingTarget={pendingTarget}
            me={me}
            stack={[]}
            gameId={"g1" as never}
            playerId="p1"
        />
    );
}

describe("target prompt — per-announced-target roles (CR 601.2c, issue #4193)", () => {
    it("names both halves of a kicked Jilt, and marks the pick being made now", () => {
        renderBanner("Jilt", []);
        const roster = document.querySelector("[data-announced-target-roles]");
        expect(roster).not.toBeNull();
        const rows = [
            ...roster!.querySelectorAll("[data-target-role-slot]"),
        ].map((el) => [
            el.getAttribute("data-target-role-slot"),
            el.getAttribute("data-target-role-status"),
            el.textContent,
        ]);
        expect(rows).toEqual([
            ["1", "current", "1. returned to its owner's hand — pick now"],
            ["2", "pending", "2. dealt 2 damage"],
        ]);
    });

    it("moves the marker to the second announced target once the first is picked", () => {
        renderBanner("Jilt", ["angel"]);
        const statuses = [
            ...document.querySelectorAll("[data-target-role-slot]"),
        ].map((el) => el.getAttribute("data-target-role-status"));
        expect(statuses).toEqual(["picked", "current"]);
        expect(screen.getByText(/dealt 2 damage — pick now/)).toBeTruthy();
    });

    it("a SYMMETRIC kicked spell's prompt grows nothing (Magma Burst)", () => {
        renderBanner("Magma Burst", []);
        expect(
            document.querySelector("[data-announced-target-roles]")
        ).toBeNull();
        // The rest of the prompt is untouched: source, hint and progress chip.
        expect(screen.getByText("Magma Burst")).toBeTruthy();
        expect(
            document.querySelector("[data-target-count-chip]")?.textContent
        ).toBe("0 / 2");
    });
});
