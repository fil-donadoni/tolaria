// The client's half of the server-side Phase Stop drain (ADR 0077): the stored
// preferences reach the server on game entry and on every change, for exactly
// the seats this client speaks for.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type { Id } from "@convex/_generated/dataModel";
import {
    DEFAULT_SKIP_PREFS,
    togglePhaseStop,
    type PhaseSkipPrefs,
} from "~/lib/skip-phase-prefs";
import { useSyncSkipPrefs } from "~/hooks/useSyncSkipPrefs";

const calls: { ref: string; args: unknown }[] = [];
// One stable sender, as `useMutation` returns: a fresh function per render
// would re-fire the effect and hide a real resend.
const send = (args: unknown) => {
    calls.push({ ref: "gamePrefs:setSkipPrefs", args });
    return Promise.resolve(null);
};
vi.mock("convex/react", () => ({ useMutation: () => send }));
vi.mock("@convex/_generated/api", () => ({
    api: { gamePrefs: { setSkipPrefs: "gamePrefs:setSkipPrefs" } },
}));

const GAME = "game-1" as Id<"games">;

type Props = { seats: string[]; prefs: PhaseSkipPrefs };

function mount(initial: Props) {
    return renderHook(
        ({ seats, prefs }: Props) => useSyncSkipPrefs(GAME, seats, prefs),
        { initialProps: initial }
    );
}

describe("useSyncSkipPrefs (ADR 0077)", () => {
    beforeEach(() => {
        calls.length = 0;
    });

    it("sends the preferences for the named seats on entry", () => {
        mount({ seats: ["u1-p1", "u1-p2"], prefs: DEFAULT_SKIP_PREFS });
        expect(calls).toEqual([
            {
                ref: "gamePrefs:setSkipPrefs",
                args: {
                    gameId: GAME,
                    playerIds: ["u1-p1", "u1-p2"],
                    skipPrefs: DEFAULT_SKIP_PREFS,
                },
            },
        ]);
    });

    it("does not resend on a re-render that changed nothing", () => {
        const view = mount({ seats: ["p1"], prefs: DEFAULT_SKIP_PREFS });
        view.rerender({ seats: ["p1"], prefs: { ...DEFAULT_SKIP_PREFS } });
        expect(calls).toHaveLength(1);
    });

    it("resends when a Phase Stop is toggled", () => {
        const view = mount({ seats: ["p1"], prefs: DEFAULT_SKIP_PREFS });
        const toggled = togglePhaseStop(DEFAULT_SKIP_PREFS, "UPKEEP", "self");
        view.rerender({ seats: ["p1"], prefs: toggled });
        expect(calls).toHaveLength(2);
        expect(calls[1].args).toMatchObject({ skipPrefs: toggled });
    });

    it("sends nothing while no seat is known", () => {
        mount({ seats: [], prefs: DEFAULT_SKIP_PREFS });
        expect(calls).toHaveLength(0);
    });
});
