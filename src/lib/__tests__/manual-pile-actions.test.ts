// Manual pile verbs (PRD #2162, issue #2169).
//
// The library tile's GRE menu dispatches `api.game.drawCard` / `mill` /
// `exileFromLibrary`, none of which has a `gameStates` row to land in behind a
// manual game — so every one of those verbs had to be replaced, not merely
// added to. This suite pins the replacement set and the argument each verb
// sends.
import { describe, expect, it, vi, afterEach } from "vitest";
import { makeManualPileActions } from "~/lib/manual-pile-actions";
import {
    manualCard,
    manualRuntime,
    manualSeat,
    manualState,
    spyDispatch,
} from "./manual-test-fixtures";

function build(seats = [manualSeat("me"), manualSeat("opp")]) {
    const dispatch = spyDispatch();
    const state = manualState(seats);
    return {
        dispatch,
        source: makeManualPileActions(manualRuntime(state, dispatch)),
    };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asPlayer = (id: string) => ({ id }) as any;

afterEach(() => vi.restoreAllMocks());

describe("manual pile actions (#2169)", () => {
    it("the library tile offers the manual library verbs", () => {
        const { source } = build();
        expect(source(asPlayer("me"), "library").map((a) => a.label)).toEqual([
            "Draw 1",
            "Draw N…",
            "Mill 1",
            "Mill N…",
            "Exile top 1",
            "Exile top N…",
            "Peek top N…",
            "Shuffle",
        ]);
    });

    it("Draw 1 dispatches the manual draw verb for that pile's OWNER", () => {
        const { source, dispatch } = build();
        const actions = source(asPlayer("opp"), "library");
        actions.find((a) => a.key === "draw-1")!.onSelect();
        expect(dispatch.draw).toHaveBeenCalledWith({ playerId: "opp", n: 1 });
    });

    it("Shuffle asks for confirmation before dispatching", () => {
        const { source, dispatch } = build();
        const confirm = vi
            .spyOn(window, "confirm")
            .mockImplementation(() => false);
        const shuffle = source(asPlayer("me"), "library").find(
            (a) => a.key === "shuffle"
        )!;
        shuffle.onSelect();
        expect(dispatch.shuffle).not.toHaveBeenCalled();
        confirm.mockImplementation(() => true);
        shuffle.onSelect();
        expect(dispatch.shuffle).toHaveBeenCalledWith({ playerId: "me" });
    });

    it("Draw N… reads a count from the prompt and refuses a non-positive one", () => {
        const { source, dispatch } = build();
        const prompt = vi.spyOn(window, "prompt").mockImplementation(() => "0");
        const drawN = source(asPlayer("me"), "library").find(
            (a) => a.key === "draw-n"
        )!;
        drawN.onSelect();
        expect(dispatch.draw).not.toHaveBeenCalled();
        prompt.mockImplementation(() => "3");
        drawN.onSelect();
        expect(dispatch.draw).toHaveBeenCalledWith({ playerId: "me", n: 3 });
    });

    it("the graveyard tile moves its TOP card out", () => {
        const { source, dispatch } = build([
            manualSeat("me", {
                graveyard: [
                    manualCard("bottom", { zone: "graveyard" }),
                    manualCard("top", { zone: "graveyard" }),
                ],
            }),
            manualSeat("opp"),
        ]);
        const actions = source(asPlayer("me"), "graveyard");
        expect(actions.map((a) => a.label)).toEqual([
            "Move top card to hand",
            "Move top card to battlefield",
            "Move top card to library",
        ]);
        actions[0].onSelect();
        expect(dispatch.moveCard).toHaveBeenCalledWith({
            instanceId: "top",
            toZone: "hand",
        });
    });

    it("an EMPTY graveyard or exile offers nothing to move", () => {
        const { source } = build();
        expect(source(asPlayer("me"), "graveyard")).toEqual([]);
        expect(source(asPlayer("me"), "exile")).toEqual([]);
    });

    it("a pile whose seat isn't in the manual state offers nothing", () => {
        const { source } = build();
        expect(source(asPlayer("ghost"), "library")).toEqual([]);
    });
});
