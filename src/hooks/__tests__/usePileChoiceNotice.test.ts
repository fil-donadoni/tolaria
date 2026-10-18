// ADR 0053 / issue #5661 — the pile-pick confirmation is derived from the
// snapshot's one-slot `lastPileChoice`: the first loaded snapshot is a
// baseline (a reload never replays an old pick), each NEW key confirms once.
import { describe, it, expect } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { usePileChoiceNotice } from "../usePileChoiceNotice";
import { formatPileChoiceNotice } from "~/lib/pile-choice-notice";
import type { PileChoiceNotice } from "~/types/game";

const pick = (key: string): PileChoiceNotice => ({
    key,
    chooserId: "p2",
    pile: "B",
    seq: 1,
    cardNames: ["Grizzly Bears"],
});

function setup(initial: {
    loaded: boolean;
    notice: PileChoiceNotice | undefined;
}) {
    return renderHook(
        ({ loaded, notice }) => usePileChoiceNotice(loaded, notice),
        { initialProps: initial }
    );
}

describe("usePileChoiceNotice (issue #5661)", () => {
    it("treats the first loaded snapshot as a baseline, never a confirmation", () => {
        const { result, rerender } = setup({
            loaded: false,
            notice: undefined,
        });
        rerender({ loaded: true, notice: pick("old") });
        expect(result.current.confirm).toBeNull();
    });

    it("confirms a new pick once, and a dismissed pick stays dismissed", () => {
        const { result, rerender } = setup({ loaded: true, notice: undefined });
        rerender({ loaded: true, notice: pick("s1:0:$x:pick") });
        expect(result.current.confirm?.key).toBe("s1:0:$x:pick");
        act(() => result.current.dismiss());
        rerender({ loaded: true, notice: pick("s1:0:$x:pick") });
        expect(result.current.confirm).toBeNull();
        rerender({ loaded: true, notice: pick("s2:0:$x:pick") });
        expect(result.current.confirm?.key).toBe("s2:0:$x:pick");
    });
});

describe("formatPileChoiceNotice (issue #5661)", () => {
    const players = [
        { id: "p1", name: "Alice" },
        { id: "p2", name: "Bob" },
    ];

    it("names the chooser, the pile and its cards", () => {
        expect(
            formatPileChoiceNotice(
                { ...pick("k"), cardNames: ["Grizzly Bears", "Shock"] },
                players
            )
        ).toBe("Bob took Pile B: Grizzly Bears, Shock");
    });

    it("says so when the taken pile is empty", () => {
        expect(
            formatPileChoiceNotice({ ...pick("k"), cardNames: [] }, players)
        ).toBe("Bob took Pile B: no cards");
    });
});
