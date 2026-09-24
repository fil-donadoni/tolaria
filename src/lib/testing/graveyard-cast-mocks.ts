// The mutation doubles shared by the graveyard cast-affordance suites
// (`player-graveyard-{cast-grant,cast-permission,permanent-cast-permission,
// play-land,retrace}.test.tsx`, issue #4491). `useHandCardCommit` reaches the
// server through `useMutation(api.game.*)`; these suites route each ref to a
// spy so they can assert WHICH public mutation a click dispatches.
//
// Wire them from the suite with a factory that imports this module, so the
// spies the component calls are the very ones the suite asserts on:
//
//   vi.mock("convex/react", () =>
//       import("~/lib/testing/graveyard-cast-mocks").then((m) => m.convexReactMock)
//   );
//   vi.mock("@convex/_generated/api", () =>
//       import("~/lib/testing/graveyard-cast-mocks").then((m) => m.gameApiMock)
//   );
//
// This module must import nothing that imports `convex/react` itself — the
// factory above runs while that module is being mocked.
import { vi } from "vitest";

export const playCard = vi.fn();
export const announceCast = vi.fn();
export const selectTarget = vi.fn();

export const convexReactMock = {
    useMutation: (ref: { _name: string }) => {
        if (ref._name === "playCard") return playCard;
        if (ref._name === "announceCast") return announceCast;
        return selectTarget;
    },
};

export const gameApiMock = {
    api: {
        game: {
            playCard: { _name: "playCard" },
            announceCast: { _name: "announceCast" },
            selectTarget: { _name: "selectTarget" },
        },
    },
};
