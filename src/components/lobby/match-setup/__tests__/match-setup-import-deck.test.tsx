// Strict Import deck on steps 4 and 5 (PRD #5334 stories 41–48, issue #5343):
// a refused paste lists its problems and saves nothing; an accepted one saves
// a normal user deck that the grid shows and the originating step selects.
import { useEffect, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { getAllCardNames } from "@convex/cards";
import type { LobbyDeck } from "~/lib/deckTypes";
import { applyChange, loadSetup, type MatchSetup } from "~/lib/matchSetup";
import MatchSetupPanes from "../match-setup-panes";

const NAME = getAllCardNames()[0];
const created = vi.fn();
let nextId = 0;
let addDeck: (d: LobbyDeck) => void = () => {};

vi.mock("~/hooks/useUserDecks", () => ({
    useUserDeckMutations: () => ({
        create: async (payload: Record<string, unknown>) => {
            created(payload);
            const id = `new${++nextId}`;
            addDeck({
                kind: "user",
                userDeckId: id,
                presetId: id,
                ...payload,
                featuredCardId: null,
                isLegal: true,
                reasons: [],
            } as unknown as LobbyDeck);
            return id;
        },
    }),
}));
vi.mock("~/lib/useEarliestPrintFetcher", () => ({
    useEarliestPrintFetcher: () => async () => new Map(),
}));
// The dialog loads the parser and the catalogue when it opens (issue #5584).
// The test graph already holds the catalogue, so the load is the parser alone
// — gated on `release` so a test can observe the loading state.
let release: () => void = () => {};
let loaded: Promise<void> = Promise.resolve();
let loadFailure: Error | null = null;
vi.mock("~/lib/strictImportLoader", () => ({
    loadedStrictImport: () => null,
    loadStrictImport: async () => {
        await loaded;
        if (loadFailure) throw loadFailure;
        return await import("~/lib/matchSetupDeckImport");
    },
}));

function Harness({ initial }: { initial: MatchSetup }) {
    const [setup, setSetup] = useState(initial);
    const [decks, setDecks] = useState<LobbyDeck[]>([]);
    useEffect(() => {
        addDeck = (d) => setDecks((cur) => [...cur, d]);
    }, []);
    return (
        <MatchSetupPanes
            setup={setup}
            decks={decks}
            tables={[]}
            onChange={(patch, imported) =>
                setSetup((s) =>
                    applyChange(
                        s,
                        patch,
                        imported ? [...decks, imported] : decks
                    )
                )
            }
            canStart={false}
            busy={false}
            error={null}
            onStart={() => {}}
        />
    );
}

const base = (patch: Partial<MatchSetup>): MatchSetup => ({
    ...loadSetup(),
    mode: "arena",
    opponent: "bot",
    matchFormat: "freeform",
    ...patch,
});

async function importList(name: string, list: string) {
    fireEvent.click(screen.getByRole("button", { name: "Import deck" }));
    fireEvent.change(screen.getByLabelText("Deck name"), {
        target: { value: name },
    });
    fireEvent.change(screen.getByLabelText("Decklist"), {
        target: { value: list },
    });
    const importButton = screen.getByRole("button", { name: "Import" });
    await waitFor(() =>
        expect(importButton.hasAttribute("disabled")).toBe(false)
    );
    fireEvent.click(importButton);
}

const selected = (id: string) =>
    document
        .querySelector(`[data-grid-deck="${id}"] [data-deck-tile]`)
        ?.getAttribute("data-selected");

beforeEach(() => {
    localStorage.clear();
    created.mockClear();
    nextId = 0;
    loaded = Promise.resolve();
    loadFailure = null;
});

describe("Import deck", () => {
    it("step 4: an unsupported line refuses the import and saves nothing", async () => {
        render(<Harness initial={base({})} />);
        await importList("Mine", `4 ${NAME}\n4 Not A Real Card`);
        expect(
            await screen.findByText("Unsupported line: 4 Not A Real Card")
        ).toBeTruthy();
        expect(created).not.toHaveBeenCalled();
    });

    it("step 4: an accepted import appears in the grid and is selected", async () => {
        render(<Harness initial={base({})} />);
        await importList("Mine", `4 ${NAME}`);
        await waitFor(() => expect(created).toHaveBeenCalledTimes(1));
        expect(created.mock.calls[0][0]).toMatchObject({
            name: "Mine",
            format: "freeform",
        });
        await waitFor(() =>
            expect(
                document.querySelector('[data-slot="panel-title"]')?.textContent
            ).toBe("Bot deck & difficulty")
        );
    });

    it("step 5: the imported deck is the Bot's deck, un-pressing Mirror", async () => {
        render(<Harness initial={base({ myDeckId: "x" })} />);
        // Step 4 needs a deck first: import one, then import again on step 5.
        await importList("Mine", `4 ${NAME}`);
        await waitFor(() =>
            expect(
                document.querySelector('[data-slot="panel-title"]')?.textContent
            ).toBe("Bot deck & difficulty")
        );
        await importList("Theirs", `3 ${NAME}`);
        await waitFor(() => expect(created).toHaveBeenCalledTimes(2));
        await waitFor(() => expect(selected("new2")).toBe("true"));
        expect(
            document
                .querySelector('[data-setup-choice="mirror"]')
                ?.getAttribute("aria-pressed")
        ).toBe("false");
    });

    it("loads the parser when the dialog opens: Import waits for it, with a loading status", async () => {
        loaded = new Promise((resolve) => {
            release = resolve;
        });
        render(<Harness initial={base({})} />);
        fireEvent.click(screen.getByRole("button", { name: "Import deck" }));
        fireEvent.change(screen.getByLabelText("Decklist"), {
            target: { value: `4 ${NAME}` },
        });
        expect(screen.getByRole("status").textContent).toBe("Loading cards…");
        const importButton = screen.getByRole("button", { name: "Import" });
        expect(importButton.hasAttribute("disabled")).toBe(true);
        release();
        await waitFor(() =>
            expect(importButton.hasAttribute("disabled")).toBe(false)
        );
        expect(screen.queryByRole("status")).toBeNull();
    });

    it("a failed load is named, and Import stays disabled", async () => {
        loadFailure = new Error("catalogue artifact: HTTP 503");
        render(<Harness initial={base({})} />);
        fireEvent.click(screen.getByRole("button", { name: "Import deck" }));
        fireEvent.change(screen.getByLabelText("Decklist"), {
            target: { value: `4 ${NAME}` },
        });
        expect(
            await screen.findByText("catalogue artifact: HTTP 503")
        ).toBeTruthy();
        expect(
            screen
                .getByRole("button", { name: "Import" })
                .hasAttribute("disabled")
        ).toBe(true);
        expect(created).not.toHaveBeenCalled();
    });

    it("Tabletop offers no Import deck (no Full Catalogue resolver here)", () => {
        render(<Harness initial={base({ matchFormat: "manual" })} />);
        expect(
            screen.queryByRole("button", { name: "Import deck" })
        ).toBeNull();
    });
});
