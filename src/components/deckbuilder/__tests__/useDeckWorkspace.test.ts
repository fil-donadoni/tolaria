import { describe, it, expect, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { WorkingDeck } from "../deckBuilderVariant";
import { useDeckWorkspace, type DeckSaveSink } from "../useDeckWorkspace";

const EMPTY = {
    name: "Deck",
    format: "freeform",
    cards: [],
    sideboard: [],
} as unknown as WorkingDeck;

const card = (cardName: string) => ({ cardId: cardName, cardName });

function mount(save: DeckSaveSink) {
    return renderHook(() =>
        useDeckWorkspace({
            initial: () => EMPTY,
            initialIdentity: "deck-1",
            save,
        })
    ).result;
}

function addCard(workspace: ReturnType<typeof mount>, cardName: string): void {
    act(() => {
        workspace.current.updateDeck((d) => ({
            ...d,
            sideboard: [...d.sideboard, card(cardName)],
        }));
    });
}

const savedNames = (save: ReturnType<typeof vi.fn>, call: number) =>
    (save.mock.calls[call][0] as WorkingDeck).sideboard.map((c) => c.cardName);

describe("useDeckWorkspace — a failed save", () => {
    it("rejects the flush, reports the error and keeps the edit for the retry", async () => {
        const failure = new Error("refused");
        const save = vi
            .fn<DeckSaveSink>()
            .mockRejectedValueOnce(failure)
            .mockResolvedValue("deck-1");
        const workspace = mount(save);
        addCard(workspace, "Bolt");

        await act(async () => {
            await expect(workspace.current.flush()).rejects.toBe(failure);
        });
        expect(workspace.current.saveError).toBe(failure);

        await act(async () => {
            await expect(workspace.current.flush()).resolves.toBe("deck-1");
        });
        expect(savedNames(save, 1)).toEqual(["Bolt"]);
        expect(workspace.current.saveError).toBeNull();
    });

    it("lets an edit made during the failed write win over the restored one", async () => {
        let fail: (error: Error) => void = () => {};
        const save = vi
            .fn<DeckSaveSink>()
            .mockImplementationOnce(
                () => new Promise((_, reject) => (fail = reject))
            )
            .mockResolvedValue("deck-1");
        const workspace = mount(save);
        addCard(workspace, "Bolt");
        let first!: Promise<unknown>;
        act(() => {
            first = workspace.current.flush().catch(() => null);
        });
        addCard(workspace, "Serra");
        await act(async () => {
            fail(new Error("refused"));
            await first;
            await workspace.current.flush();
        });
        expect(savedNames(save, 1)).toEqual(["Bolt", "Serra"]);
    });

    it("a flush waits for the write another flush started, and rejects with it", async () => {
        let fail: (error: Error) => void = () => {};
        const save = vi
            .fn<DeckSaveSink>()
            .mockResolvedValueOnce("deck-1")
            .mockImplementationOnce(
                () => new Promise((_, reject) => (fail = reject))
            )
            .mockRejectedValue(new Error("still refused"));
        const workspace = mount(save);
        addCard(workspace, "Bolt");
        let firstWrite!: Promise<unknown>;
        act(() => {
            firstWrite = workspace.current.flush();
        });
        addCard(workspace, "Serra");
        let settled!: Promise<unknown>;
        let leaving!: Promise<unknown>;
        act(() => {
            settled = workspace.current.flush().catch(() => null);
            leaving = workspace.current.flush();
        });
        const outcome = expect(leaving).rejects.toThrow("still refused");
        await act(async () => {
            await firstWrite;
            await Promise.resolve();
            fail(new Error("refused"));
            await settled;
            await outcome;
        });
        expect(workspace.current.saveError).toBeInstanceOf(Error);
        act(() => {
            workspace.current.discard();
        });
    });

    it("`discard` drops the edit, clears the error and returns the identity", async () => {
        const save = vi.fn<DeckSaveSink>().mockRejectedValue(new Error("no"));
        const workspace = mount(save);
        addCard(workspace, "Bolt");
        await act(async () => {
            await workspace.current.flush().catch(() => null);
        });
        let identity: string | null = null;
        act(() => {
            identity = workspace.current.discard();
        });
        expect(identity).toBe("deck-1");
        expect(workspace.current.saveError).toBeNull();
        await act(async () => {
            await workspace.current.flush();
        });
        expect(save).toHaveBeenCalledTimes(1);
    });
});
