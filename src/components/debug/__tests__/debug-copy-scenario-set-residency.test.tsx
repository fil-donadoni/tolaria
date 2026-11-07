// "Copy as scenario" on a page holding only its game's Sets (issue #8728): a
// token's name comes from the token catalogue, a walk of every hand-written Set.

import { beforeAll, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock(
    "@convex/cards/compiledPool",
    () => import("~/lib/catalogue/compiled-pool.browser")
);
vi.mock(
    "@convex/cards/setModules",
    () => import("~/lib/catalogue/set-modules.browser")
);
const { copyMinified } = vi.hoisted(() => ({
    copyMinified: vi.fn<(value: unknown) => Promise<void>>(() =>
        Promise.resolve()
    ),
}));
vi.mock("~/lib/clipboard", () => ({ copyMinified }));

import { tokenDefinitionId } from "@convex/cards";
import { GOBLIN_TOKEN } from "@convex/cards/sharedTokens";
import { makeState } from "@convex/cards/__tests__/setup.helper";
import type { FullGameState } from "@convex/gameProjections";
import type { CardInstanceState } from "@convex/gre/state";
import { installShards, isSetResident } from "~/lib/catalogue/definitionShards";
import DebugCopyScenario from "../debug-copy-scenario";

/** Installing every Set means transforming every Set under vitest. */
const INSTALL_MS = 120_000;

describe("Copy as scenario with only the game's Sets resident (issue #8728)", () => {
    beforeAll(async () => {
        await installShards(["lea"]);
    });

    it(
        "copies a board holding a token",
        async () => {
            expect(isSetResident("leb")).toBe(false);
            const state = makeState();
            const seat = state.players[0];
            seat.battlefield.push({
                ...GOBLIN_TOKEN,
                id: "token-instance",
                card: { id: tokenDefinitionId(GOBLIN_TOKEN) },
                isToken: true,
                controllerId: seat.id,
                ownerId: seat.id,
                zone: "battlefield",
                isTapped: false,
                staticAbilities: [],
            } as unknown as CardInstanceState);

            render(
                <DebugCopyScenario
                    state={state as unknown as FullGameState}
                    mySeatId={seat.id}
                />
            );
            fireEvent.click(
                screen.getByRole("button", { name: "Copy as scenario" })
            );

            await waitFor(() => expect(copyMinified).toHaveBeenCalledTimes(1), {
                timeout: INSTALL_MS,
            });
            const [spec] = copyMinified.mock.calls[0] as [
                { cards: { name: string; token?: boolean }[] },
            ];
            expect(spec.cards).toContainEqual(
                expect.objectContaining({ name: "Goblin", token: true })
            );
        },
        INSTALL_MS
    );
});
