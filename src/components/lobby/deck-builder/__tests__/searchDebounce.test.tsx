// Issue #503 / PRD #501: the deck-builder search box wires together three real
// pieces — the controlled <SearchBar>, the `useDebouncedValue` hook, and the
// effect that pushes the *settled* query into the URL-backed filter set. The
// hook's own unit test covers the timer mechanics; this test covers the WIRING
// the deck-builder relies on: typing keeps the input responsive (the box shows
// every keystroke immediately) while the filter/URL sink (`setFilters`) only
// receives the trailing value, and clearing reaches the sink promptly.
//
// It reproduces the deck-builder's exact wiring around the real SearchBar so a
// regression in either the binding or the propagation effect fails here, without
// dragging in Convex / dnd-kit.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { useEffect, useState } from "react";
import {
    act,
    cleanup,
    fireEvent,
    render,
    screen,
} from "@testing-library/react";
import SearchBar from "../search-bar";
import { useDebouncedValue } from "~/hooks/useDebouncedValue";

const DELAY = 180;

// Mirror of the deck-builder's search wiring (see deck-builder.tsx). `onText`
// stands in for the URL-backed `setFilters({ text })` sink.
function Harness({ onText }: { onText: (text: string) => void }) {
    const [rawText, setRawText] = useState("");
    const debouncedText = useDebouncedValue(rawText, DELAY);
    useEffect(() => {
        onText(debouncedText);
    }, [debouncedText, onText]);
    return <SearchBar value={rawText} onChange={setRawText} />;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
    vi.useRealTimers();
    cleanup();
});

function input(): HTMLInputElement {
    return screen.getByRole("textbox") as HTMLInputElement;
}

describe("deck-builder search debounce wiring (#503)", () => {
    it("reflects every keystroke in the input immediately", () => {
        render(<Harness onText={() => {}} />);
        fireEvent.change(input(), { target: { value: "a" } });
        expect(input().value).toBe("a");
        fireEvent.change(input(), { target: { value: "an" } });
        expect(input().value).toBe("an");
        fireEvent.change(input(), { target: { value: "ang" } });
        expect(input().value).toBe("ang");
    });

    it("feeds the filter/URL sink only the trailing value after the delay", () => {
        const onText = vi.fn();
        render(<Harness onText={onText} />);
        onText.mockClear(); // ignore the initial "" emission

        fireEvent.change(input(), { target: { value: "a" } });
        act(() => vi.advanceTimersByTime(50));
        fireEvent.change(input(), { target: { value: "an" } });
        act(() => vi.advanceTimersByTime(50));
        fireEvent.change(input(), { target: { value: "ang" } });

        // Nothing has settled yet: the sink hasn't seen any of the keystrokes.
        expect(onText).not.toHaveBeenCalled();

        act(() => vi.advanceTimersByTime(DELAY));
        // Exactly one trailing emission reaches the sink, not three.
        expect(onText).toHaveBeenCalledTimes(1);
        expect(onText).toHaveBeenLastCalledWith("ang");
    });

    it("propagates a clear to the sink promptly", () => {
        const onText = vi.fn();
        render(<Harness onText={onText} />);

        fireEvent.change(input(), { target: { value: "ang" } });
        act(() => vi.advanceTimersByTime(DELAY));
        expect(onText).toHaveBeenLastCalledWith("ang");
        onText.mockClear();

        // Use the clear button (×) the SearchBar renders for a non-empty value.
        fireEvent.click(screen.getByLabelText("Clear search"));
        expect(input().value).toBe("");
        // Sink sees "" without advancing timers.
        expect(onText).toHaveBeenLastCalledWith("");
    });
});
