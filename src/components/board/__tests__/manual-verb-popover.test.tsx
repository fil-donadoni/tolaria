// Anchored popover for parameterised manual verbs (issue #2170).
//
// Proves the popover itself renders each `ManualVerbRequest` kind (number /
// text / confirm), confirms/cancels correctly, and that
// `useManualVerbPopoverState` is the seam every verb factory's
// `requestVerbInput` closes over — no `window.prompt`/`window.confirm`
// anywhere in this path (the catalogue-wide guard for that lives in
// `scripts/__tests__/manual-no-native-dialog.test.ts`).
//
// `render()`'s bound queries default to `baseElement: document.body`, which
// is exactly where base-ui portals the popup — so `rendered.getByText` etc.
// reach it with no extra `within()` wiring, mirroring
// `basic-land-art-picker.test.tsx`.
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, renderHook, act } from "@testing-library/react";
import ManualVerbPopover from "../manual-verb-popover";
import { useManualVerbPopoverState } from "~/hooks/useManualVerbPopover";
import type { ManualVerbRequest } from "~/lib/manual-runtime";

function anchorEl(): Element {
    const el = document.createElement("div");
    document.body.appendChild(el);
    return el;
}

describe("ManualVerbPopover (#2170)", () => {
    it("renders nothing while no verb is pending", () => {
        const { container } = render(
            <ManualVerbPopover pending={null} onClose={() => {}} />
        );
        expect(container.firstChild).toBeNull();
    });

    it("a NUMBER request shows a stepper defaulting to the request's value; Confirm sends the parsed count", () => {
        const onConfirm = vi.fn();
        const onClose = vi.fn();
        const request: ManualVerbRequest = {
            kind: "number",
            title: "Draw how many?",
            defaultValue: 3,
            onConfirm,
        };
        const rendered = render(
            <ManualVerbPopover
                pending={{ anchor: anchorEl(), request, nonce: 1 }}
                onClose={onClose}
            />
        );
        expect(rendered.getByText("Draw how many?")).toBeTruthy();
        const input = rendered.getByLabelText(
            "Draw how many?"
        ) as HTMLInputElement;
        expect(input.value).toBe("3");
        fireEvent.click(rendered.getByText("Confirm"));
        expect(onConfirm).toHaveBeenCalledWith(3);
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("a NUMBER request below the minimum disables Confirm and never calls onConfirm", () => {
        const onConfirm = vi.fn();
        const request: ManualVerbRequest = {
            kind: "number",
            title: "Draw how many?",
            defaultValue: 1,
            onConfirm,
        };
        const rendered = render(
            <ManualVerbPopover
                pending={{ anchor: anchorEl(), request, nonce: 1 }}
                onClose={() => {}}
            />
        );
        const input = rendered.getByLabelText(
            "Draw how many?"
        ) as HTMLInputElement;
        fireEvent.change(input, { target: { value: "0" } });
        const confirmBtn = rendered.getByText("Confirm") as HTMLButtonElement;
        expect(confirmBtn.disabled).toBe(true);
        fireEvent.click(confirmBtn);
        expect(onConfirm).not.toHaveBeenCalled();
    });

    it("a TEXT request shows an input defaulting to the request's value; Confirm sends the edited text", () => {
        const onConfirm = vi.fn();
        const onClose = vi.fn();
        const request: ManualVerbRequest = {
            kind: "text",
            title: "Note",
            defaultValue: "old note",
            onConfirm,
        };
        const rendered = render(
            <ManualVerbPopover
                pending={{ anchor: anchorEl(), request, nonce: 1 }}
                onClose={onClose}
            />
        );
        const input = rendered.getByLabelText("Note") as HTMLInputElement;
        expect(input.value).toBe("old note");
        fireEvent.change(input, { target: { value: "new note" } });
        fireEvent.click(rendered.getByText("Confirm"));
        expect(onConfirm).toHaveBeenCalledWith("new note");
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("a CONFIRM request (shuffle) shows the title + description; Confirm fires onConfirm, Cancel does not", () => {
        const onConfirm = vi.fn();
        const onClose = vi.fn();
        const request: ManualVerbRequest = {
            kind: "confirm",
            title: "Shuffle library?",
            description: "This cannot be undone.",
            onConfirm,
        };
        const rendered = render(
            <ManualVerbPopover
                pending={{ anchor: anchorEl(), request, nonce: 1 }}
                onClose={onClose}
            />
        );
        expect(rendered.getByText("Shuffle library?")).toBeTruthy();
        expect(rendered.getByText("This cannot be undone.")).toBeTruthy();
        fireEvent.click(rendered.getByText("Cancel"));
        expect(onConfirm).not.toHaveBeenCalled();
        expect(onClose).toHaveBeenCalledTimes(1);

        onClose.mockClear();
        rendered.rerender(
            <ManualVerbPopover
                pending={{ anchor: anchorEl(), request, nonce: 2 }}
                onClose={onClose}
            />
        );
        fireEvent.click(rendered.getByText("Confirm"));
        expect(onConfirm).toHaveBeenCalledTimes(1);
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("a fresh request (new nonce) resets the local form even with a matching title", () => {
        const onConfirm = vi.fn();
        const request1: ManualVerbRequest = {
            kind: "number",
            title: "Mill how many?",
            defaultValue: 1,
            onConfirm,
        };
        const rendered = render(
            <ManualVerbPopover
                pending={{ anchor: anchorEl(), request: request1, nonce: 1 }}
                onClose={() => {}}
            />
        );
        fireEvent.change(rendered.getByLabelText("Mill how many?"), {
            target: { value: "9" },
        });
        const onConfirm2 = vi.fn();
        const request2: ManualVerbRequest = {
            kind: "number",
            title: "Mill how many?",
            defaultValue: 1,
            onConfirm: onConfirm2,
        };
        rendered.rerender(
            <ManualVerbPopover
                pending={{ anchor: anchorEl(), request: request2, nonce: 2 }}
                onClose={() => {}}
            />
        );
        const input = rendered.getByLabelText(
            "Mill how many?"
        ) as HTMLInputElement;
        expect(input.value).toBe("1");
    });
});

// The QA report this covers: "the concede button in manual is still inert".
// Concede has no card or pile to point at, so it used to anchor its confirm to
// the board ROOT — and base-ui positions a `side="top"` popover ABOVE its
// anchor, which for a full-viewport anchor is off-screen (measured in Chrome:
// `y: -94` on a 620px board) while `#root` still gets `data-base-ui-inert`.
// An invisible prompt over a frozen board is indistinguishable from a dead
// button. An anchorless request must therefore never take the popover shell.
describe("ManualVerbPopover — no anchor", () => {
    const request: ManualVerbRequest = {
        kind: "confirm",
        title: "Concede this game?",
        onConfirm: () => {},
    };

    it("renders a centred dialog instead of an anchored popover", () => {
        const rendered = render(
            <ManualVerbPopover
                pending={{ anchor: null, request, nonce: 1 }}
                onClose={() => {}}
            />
        );

        expect(
            document.querySelector('[data-slot="popover-content"]')
        ).toBeNull();
        expect(document.querySelector('[role="dialog"]')).toBeTruthy();
        expect(
            rendered.getAllByText("Concede this game?").length
        ).toBeGreaterThan(0);
    });

    it("confirms and cancels through the dialog shell", () => {
        const onConfirm = vi.fn();
        const onClose = vi.fn();
        const rendered = render(
            <ManualVerbPopover
                pending={{
                    anchor: null,
                    request: { ...request, onConfirm },
                    nonce: 1,
                }}
                onClose={onClose}
            />
        );

        fireEvent.click(rendered.getByText("Cancel"));
        expect(onConfirm).not.toHaveBeenCalled();
        expect(onClose).toHaveBeenCalledTimes(1);

        fireEvent.click(rendered.getByText("Confirm"));
        expect(onConfirm).toHaveBeenCalledTimes(1);
    });
});

describe("useManualVerbPopoverState (#2170)", () => {
    it("starts with nothing pending", () => {
        const { result } = renderHook(() => useManualVerbPopoverState());
        expect(result.current.pending).toBeNull();
    });

    it("requestVerbInput opens a popover carrying the anchor and request, incrementing nonce each call", () => {
        const { result } = renderHook(() => useManualVerbPopoverState());
        const anchor = anchorEl();
        const request: ManualVerbRequest = {
            kind: "confirm",
            title: "Shuffle library?",
            onConfirm: () => {},
        };
        act(() => result.current.requestVerbInput(anchor, request));
        expect(result.current.pending?.anchor).toBe(anchor);
        expect(result.current.pending?.request).toBe(request);
        const firstNonce = result.current.pending?.nonce;

        act(() => result.current.requestVerbInput(anchor, request));
        expect(result.current.pending?.nonce).not.toBe(firstNonce);
    });

    it("closeVerbPopover clears the pending request", () => {
        const { result } = renderHook(() => useManualVerbPopoverState());
        act(() =>
            result.current.requestVerbInput(anchorEl(), {
                kind: "confirm",
                title: "Shuffle library?",
                onConfirm: () => {},
            })
        );
        expect(result.current.pending).not.toBeNull();
        act(() => result.current.closeVerbPopover());
        expect(result.current.pending).toBeNull();
    });
});
