// Manual battlefield card verbs (PRD #2162, issue #2169; popover input,
// issue #2170).
//
// `manualBattlefieldVerbs` builds the synthetic ability list; this suite's
// focus is `dispatchManualCardVerb`'s two PARAMETERISED verbs — custom
// counter and note — which used to call `window.prompt` directly and now
// collect their input through the shared anchored popover
// (`requestVerbInput`). Every other verb dispatches immediately and is
// covered end-to-end through the shared board in
// `manual-battlefield-interaction.test.tsx`.
import { describe, expect, it, vi } from "vitest";
import {
    dispatchManualCardVerb,
    manualBattlefieldVerbs,
} from "~/lib/manual-card-verbs";
import type { ManualVerbRequest, RequestVerbInput } from "~/lib/manual-runtime";
import { manualCard, spyDispatch } from "./manual-test-fixtures";

function build() {
    const dispatch = spyDispatch();
    const requestVerbInput = vi.fn() as unknown as RequestVerbInput & {
        mock: { calls: unknown[][] };
    };
    return { dispatch, requestVerbInput };
}

function lastRequest(
    requestVerbInput: RequestVerbInput & { mock: { calls: unknown[][] } }
): ManualVerbRequest {
    const calls = requestVerbInput.mock.calls;
    return calls[calls.length - 1][1] as ManualVerbRequest;
}

describe("manual battlefield card verbs (#2169)", () => {
    it("offers a custom-counter and a note verb, in menu order", () => {
        const verbs = manualBattlefieldVerbs(manualCard("perm1"));
        const ids = verbs.map((v) => v.id);
        expect(ids).toContain("counter:custom");
        expect(ids).toContain("note");
    });

    it("Custom counter… opens a TEXT popover request anchored to the card, never window.prompt (#2170)", () => {
        // Mount the card's own DOM anchor so `findManualAnchor` resolves it —
        // the same `data-arrow-anchor-permanent` attribute
        // `battlefield-card.tsx` / `board-battlefield-card.tsx` stamp.
        const el = document.createElement("div");
        el.setAttribute("data-arrow-anchor-permanent", "perm1");
        document.body.appendChild(el);
        try {
            const { dispatch, requestVerbInput } = build();
            const card = manualCard("perm1");
            dispatchManualCardVerb(
                card,
                "counter:custom",
                dispatch,
                requestVerbInput
            );
            expect(requestVerbInput).toHaveBeenCalledTimes(1);
            expect(requestVerbInput.mock.calls[0][0]).toBe(el);
            const request = lastRequest(requestVerbInput);
            expect(request.kind).toBe("text");
            expect(dispatch.adjustCounter).not.toHaveBeenCalled();
            if (request.kind !== "text") throw new Error("unreachable");
            request.onConfirm("poison");
            expect(dispatch.adjustCounter).toHaveBeenCalledWith({
                instanceId: "perm1",
                type: "poison",
                delta: 1,
            });
        } finally {
            el.remove();
        }
    });

    it("Custom counter… confirming BLANK text is a no-op (mirrors the old prompt's cancel behaviour)", () => {
        const { dispatch, requestVerbInput } = build();
        const card = manualCard("perm1");
        dispatchManualCardVerb(
            card,
            "counter:custom",
            dispatch,
            requestVerbInput
        );
        const request = lastRequest(requestVerbInput);
        if (request.kind !== "text") throw new Error("unreachable");
        request.onConfirm("   ");
        expect(dispatch.adjustCounter).not.toHaveBeenCalled();
    });

    it("Set note… opens a TEXT popover request defaulting to the card's existing note", () => {
        const { dispatch, requestVerbInput } = build();
        const card = manualCard("perm1", { note: "already annotated" });
        dispatchManualCardVerb(card, "note", dispatch, requestVerbInput);
        const request = lastRequest(requestVerbInput);
        expect(request.kind).toBe("text");
        if (request.kind !== "text") throw new Error("unreachable");
        expect(request.defaultValue).toBe("already annotated");
        request.onConfirm("new note");
        expect(dispatch.setNote).toHaveBeenCalledWith({
            instanceId: "perm1",
            text: "new note",
        });
    });

    it("every other verb dispatches immediately, without touching the popover", () => {
        const { dispatch, requestVerbInput } = build();
        const card = manualCard("perm1", { isTapped: false });
        dispatchManualCardVerb(card, "tap", dispatch, requestVerbInput);
        expect(dispatch.setTapped).toHaveBeenCalledWith({
            instanceId: "perm1",
            tapped: true,
        });
        expect(requestVerbInput).not.toHaveBeenCalled();
    });
});
