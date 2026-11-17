// Focus fallback when the focused row disappears (issue #9819): the next row,
// else the previous, else the dialog title — never the Popup / <body>.
import { afterEach, describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useState } from "react";
import GameDialog from "~/components/ui/game-dialog";
import SideboardSwapList from "../sideboard-swap-list";
import type { DeckCard } from "~/types/game";

const card = (id: string): DeckCard =>
    ({ cardId: id, cardName: id }) as DeckCard;

function Harness({ initial }: { initial: DeckCard[] }) {
    const [cards, setCards] = useState(initial);
    return (
        <GameDialog open title="Sideboarding">
            <SideboardSwapList
                title="Maindeck"
                cards={cards}
                moveLabel="→ Side"
                onMove={(id) =>
                    setCards((cs) => cs.filter((c) => c.cardId !== id))
                }
                emptyMessage="empty"
            />
        </GameDialog>
    );
}

const moveButton = (name: string) =>
    screen.getByText(name).closest("li")!.querySelector("button")!;

// Scroll-lock leaves an inline style on the shared body (dom-shared, issue #10106).
afterEach(() => {
    document.body.removeAttribute("style");
});

describe("SideboardSwapList focus fallback (issue #9819)", () => {
    it("moves focus to the next row when the focused row is removed", () => {
        render(<Harness initial={[card("A"), card("B"), card("C")]} />);
        const b = moveButton("B");
        b.focus();
        fireEvent.click(b);
        expect(document.activeElement).toBe(moveButton("C"));
    });

    it("falls back to the previous row when the last row is removed", () => {
        render(<Harness initial={[card("A"), card("B")]} />);
        const b = moveButton("B");
        b.focus();
        fireEvent.click(b);
        expect(document.activeElement).toBe(moveButton("A"));
    });

    it("falls back to the dialog title when the list empties, never the Popup", async () => {
        render(<Harness initial={[card("A")]} />);
        const a = moveButton("A");
        a.focus();
        fireEvent.click(a);
        // base-ui restores focus asynchronously: it must still land on the
        // title once settled, never on the Popup.
        await new Promise((r) => setTimeout(r, 50));
        const active = document.activeElement as HTMLElement;
        expect(active.dataset.slot).toBe("dialog-title");
    });

    it("does not steal focus for a sibling list's removal (stale slot)", () => {
        function Two() {
            const [main, setMain] = useState([card("X"), card("X")]);
            const [side, setSide] = useState([card("Y")]);
            return (
                <GameDialog open title="Sideboarding">
                    <SideboardSwapList
                        title="Maindeck"
                        cards={[...main]}
                        moveLabel="→ Side"
                        onMove={() => setMain((c) => c.slice(1))}
                        emptyMessage="empty"
                    />
                    <SideboardSwapList
                        title="Sideboard"
                        cards={[...side]}
                        moveLabel="→ Main"
                        onMove={() => setSide([])}
                        emptyMessage="empty side"
                    />
                </GameDialog>
            );
        }
        render(<Two />);
        const x = screen
            .getAllByText(/X/)[0]
            .closest("li")!
            .querySelector("button")!;
        x.focus();
        fireEvent.click(x);
        const y = screen.getByText("Y").closest("li")!.querySelector("button")!;
        y.focus();
        fireEvent.click(y);
        // Y's row is gone: focus must not jump back into the Maindeck list.
        expect(document.activeElement).not.toBe(
            screen.getAllByText(/X/)[0].closest("li")!.querySelector("button")
        );
    });
});
