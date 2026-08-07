// Manual pile verbs (PRD #2162, issue #2169; popover input, issue #2170).
//
// The library tile's GRE menu dispatches `api.game.drawCard` / `mill` /
// `exileFromLibrary`, none of which has a `gameStates` row to land in behind a
// manual game — so every one of those verbs had to be replaced, not merely
// added to. This suite pins the replacement set, WHICH verbs open the shared
// anchored popover (issue #2170 — never a native `window.prompt`/
// `window.confirm`) and the argument each verb's `onConfirm` sends.
import { describe, expect, it, vi } from "vitest";
import { makeManualPileActions } from "~/lib/manual-pile-actions";
import type { ManualVerbRequest, RequestVerbInput } from "~/lib/manual-runtime";
import {
    manualCard,
    manualRuntime,
    manualSeat,
    manualState,
    spyDispatch,
} from "./manual-test-fixtures";

function build(seats = [manualSeat("me"), manualSeat("opp")]) {
    const dispatch = spyDispatch();
    const requestVerbInput = vi.fn() as unknown as RequestVerbInput & {
        mock: { calls: unknown[][] };
    };
    const state = manualState(seats);
    return {
        dispatch,
        requestVerbInput,
        source: makeManualPileActions(
            manualRuntime(state, dispatch, "me", requestVerbInput)
        ),
    };
}

/** Pulls the `ManualVerbRequest` from the LAST `requestVerbInput` call — the
 *  form a popover-driven verb's `onSelect` opens instead of dispatching
 *  directly. */
function lastRequest(
    requestVerbInput: RequestVerbInput & { mock: { calls: unknown[][] } }
): ManualVerbRequest {
    const calls = requestVerbInput.mock.calls;
    return calls[calls.length - 1][1] as ManualVerbRequest;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asPlayer = (id: string) => ({ id }) as any;

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

    it("Draw 1 dispatches the manual draw verb for that pile's OWNER directly (no popover)", () => {
        const { source, dispatch, requestVerbInput } = build();
        const actions = source(asPlayer("opp"), "library");
        actions.find((a) => a.key === "draw-1")!.onSelect();
        expect(dispatch.draw).toHaveBeenCalledWith({ playerId: "opp", n: 1 });
        expect(requestVerbInput).not.toHaveBeenCalled();
    });

    it("Shuffle opens an inline-confirm popover request; confirming dispatches", () => {
        const { source, dispatch, requestVerbInput } = build();
        const shuffle = source(asPlayer("me"), "library").find(
            (a) => a.key === "shuffle"
        )!;
        shuffle.onSelect();
        expect(requestVerbInput).toHaveBeenCalledTimes(1);
        // Never a native dialog (#2170 AC) — the verb hands the popover a
        // request object instead of calling `window.confirm` itself.
        const request = lastRequest(requestVerbInput);
        expect(request.kind).toBe("confirm");
        expect(dispatch.shuffle).not.toHaveBeenCalled();
        // The popover's own "Confirm" click is what fires `onConfirm` — this
        // simulates that, exactly what `ManualVerbPopover` calls.
        if (request.kind === "confirm") request.onConfirm();
        expect(dispatch.shuffle).toHaveBeenCalledWith({ playerId: "me" });
    });

    it("Draw N… opens a numeric popover request defaulting to 1; confirming with a count dispatches it", () => {
        const { source, dispatch, requestVerbInput } = build();
        const drawN = source(asPlayer("me"), "library").find(
            (a) => a.key === "draw-n"
        )!;
        drawN.onSelect();
        const request = lastRequest(requestVerbInput);
        expect(request.kind).toBe("number");
        if (request.kind !== "number") throw new Error("unreachable");
        expect(request.defaultValue).toBe(1);
        expect(dispatch.draw).not.toHaveBeenCalled();
        request.onConfirm(3);
        expect(dispatch.draw).toHaveBeenCalledWith({ playerId: "me", n: 3 });
    });

    it("Mill N… and Exile top N… also route through the popover, not window.prompt", () => {
        const { source, dispatch, requestVerbInput } = build();
        const actions = source(asPlayer("me"), "library");

        actions.find((a) => a.key === "mill-n")!.onSelect();
        const millRequest = lastRequest(requestVerbInput);
        if (millRequest.kind !== "number") throw new Error("unreachable");
        millRequest.onConfirm(5);
        expect(dispatch.mill).toHaveBeenCalledWith({ playerId: "me", n: 5 });

        actions.find((a) => a.key === "exile-top-n")!.onSelect();
        const exileRequest = lastRequest(requestVerbInput);
        if (exileRequest.kind !== "number") throw new Error("unreachable");
        exileRequest.onConfirm(2);
        expect(dispatch.exileTop).toHaveBeenCalledWith({
            playerId: "me",
            n: 2,
        });
    });

    it("Peek top N… defaults to 3", () => {
        const { source, dispatch, requestVerbInput } = build();
        const peek = source(asPlayer("me"), "library").find(
            (a) => a.key === "peek"
        )!;
        peek.onSelect();
        const request = lastRequest(requestVerbInput);
        if (request.kind !== "number") throw new Error("unreachable");
        expect(request.defaultValue).toBe(3);
        request.onConfirm(3);
        expect(dispatch.peek).toHaveBeenCalledWith({ playerId: "me", n: 3 });
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
