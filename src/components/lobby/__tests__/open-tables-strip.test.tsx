// Tables other players opened (issue #2726) — extracted from the retired
// `dashboard-play-box.tsx`, and carrying forward the two things its own tests
// guarded: the joiner sees the creator's Bo1/Bo3 format BEFORE committing
// (PRD #387 / #397), and a row whose table mode the current game mode cannot
// join is disabled rather than dispatched into a server rejection (ADR 0080).
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import OpenTablesStrip, { type OpenGame } from "../open-tables-strip";

function makeGame(overrides: Partial<OpenGame> = {}): OpenGame {
    return {
        _id: "game-1",
        _creationTime: 0,
        name: "Tester's game",
        status: "waiting",
        players: [{ id: "user-1", nickname: "Tester" }],
        bestOf: 1,
        ...overrides,
    } as unknown as OpenGame;
}

function renderStrip(
    overrides: Partial<React.ComponentProps<typeof OpenTablesStrip>> = {}
) {
    const props: React.ComponentProps<typeof OpenTablesStrip> = {
        openGames: [makeGame()],
        mode: "arena",
        onJoin: vi.fn(),
        canAct: true,
        ...overrides,
    };
    return { ...render(<OpenTablesStrip {...props} />), props };
}

describe("OpenTablesStrip (issue #2726)", () => {
    it("renders nothing at all when no table is waiting", () => {
        const { container } = renderStrip({ openGames: [] });
        expect(container.innerHTML).toBe("");
        const undef = render(
            <OpenTablesStrip
                openGames={undefined}
                mode="arena"
                onJoin={vi.fn()}
                canAct
            />
        );
        expect(undef.container.innerHTML).toBe("");
    });

    it("shows the creator's match format on the row, before joining (PRD #397)", () => {
        const { getByText, unmount } = renderStrip({
            openGames: [makeGame({ bestOf: 3 })],
        });
        expect(getByText("Bo3 Match")).toBeTruthy();
        unmount();
        expect(
            renderStrip({ openGames: [makeGame({ bestOf: 1 })] }).getByText(
                "Bo1 Match"
            )
        ).toBeTruthy();
    });

    it("joins with the row's game id", () => {
        const onJoin = vi.fn();
        const { getByRole } = renderStrip({ onJoin });
        fireEvent.click(getByRole("button", { name: /Tester's game/ }));
        expect(onJoin).toHaveBeenCalledWith("game-1");
    });

    it("disables every row when the shared gate refuses", () => {
        const { getByRole } = renderStrip({ canAct: false });
        expect(
            (
                getByRole("button", {
                    name: /Tester's game/,
                }) as HTMLButtonElement
            ).disabled
        ).toBe(true);
    });

    it("disables a Manual table in Arena mode, and an Arena table in Cockatrice mode (ADR 0080)", () => {
        const manual = renderStrip({
            openGames: [makeGame({ mode: "manual" } as Partial<OpenGame>)],
            mode: "arena",
        });
        const manualRow = manual.getByRole("button", {
            name: /Tester's game/,
        }) as HTMLButtonElement;
        expect(manualRow.disabled).toBe(true);
        expect(manualRow.title).toContain("switch to Cockatrice mode");
        expect(manual.getByText("Manual Game")).toBeTruthy();
        manual.unmount();

        const arena = renderStrip({ mode: "cockatrice" });
        const arenaRow = arena.getByRole("button", {
            name: /Tester's game/,
        }) as HTMLButtonElement;
        expect(arenaRow.disabled).toBe(true);
        expect(arenaRow.title).toContain("switch to Arena mode");
    });
});
