// CR 702.62b (issue #10495) — the Exile pile's plate for a SUSPENDED card,
// driven through the REAL projection: the badge reads `suspended` and the time
// counters the wire carries, for both players, and disappears with the last
// counter.
import { describe, expect, it, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { CardInstance } from "~/types/game";
import SuspendedBadge from "../suspended-badge";
import { projectPublicState } from "@convex/gameProjections";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "@convex/cards/__tests__/setup.helper";
import { registerTokenDefinition } from "@convex/cards";

const SUSPENDER = "test-suspended-badge-card";
registerTokenDefinition({
    id: SUSPENDER,
    name: SUSPENDER,
    rarity: "common",
    manaCost: { X: 2, R: 1 },
    types: ["Sorcery"],
    staticAbilities: ["suspend 3"],
    suspend: { R: 1 },
    effects: [{ op: "gainLife", player: "controller", amount: 3 }],
});

function exiledFor(viewer: string, time: number | undefined): CardInstance {
    const state = makeState({
        players: [
            makePlayer("me", {
                exile: [
                    makeInstance(SUSPENDER, {
                        id: "s",
                        controllerId: "me",
                        ownerId: "me",
                        zone: "exile",
                        ...(time !== undefined ? { counters: { time } } : {}),
                    }),
                ],
            }),
            makePlayer("them"),
        ],
    });
    return projectPublicState(state, 1, viewer).players[0]
        .exile[0] as unknown as CardInstance;
}

afterEach(cleanup);

describe("SuspendedBadge (CR 702.62b)", () => {
    it.each(["me", "them"])(
        "shows the clock of a suspended card to %s",
        (viewer) => {
            render(<SuspendedBadge card={exiledFor(viewer, 2)} />);
            expect(screen.getByText("Suspended · 2 time")).toBeTruthy();
        }
    );

    it("renders nothing once the last time counter is gone", () => {
        const { container } = render(
            <SuspendedBadge card={exiledFor("me", undefined)} />
        );
        expect(container.querySelector("[data-suspended-badge]")).toBeNull();
    });
});
