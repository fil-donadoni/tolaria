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
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
}

const selected = (id: string) =>
    document
        .querySelector(`[data-grid-deck="${id}"] [data-deck-tile]`)
        ?.getAttribute("data-selected");

beforeEach(() => {
    localStorage.clear();
    created.mockClear();
    nextId = 0;
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
});
