// Assertions read the DOM directly — see the note in `Term.test.tsx`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    act,
    fireEvent,
    render,
    screen,
    waitFor,
} from "@testing-library/react";
import { ConfirmDialog } from "../ConfirmDialog";
import { requestAction, resetPendingAction } from "../../../lib/confirm";
import { resetOverlays } from "../../../lib/overlays";
import { actionToken } from "../../../lib/actions";

/**
 * The action-confirmation dialog (#2636, ported in PRD #3148 S2).
 *
 * Three properties the port must not lose, all of them about REFUSING to send
 * something: the token has to ride on every request (an empty one is what the
 * server refuses, and it must stay empty rather than be faked), a double click
 * must not send twice, and a refusal must leave the dialog open with its
 * reason rather than closing as though it had worked.
 *
 * ── WHAT THIS FILE INHERITED (PRD #3148 S4) ───────────────────────────────
 *
 * `scripts/__tests__/dashboard-actions.test.ts` drove `actions.js`'s
 * hand-built dialog through `initActions()` and `querySelector`. Eighteen of
 * its nineteen cases are about the DIALOG and are here, against a rendered
 * component: what it says before anything is sent, that every way of closing
 * it sends nothing, where focus goes and where it comes back to, the in-flight
 * latch, and the refusal path. The nineteenth is a CONTRACT with the server
 * route and stayed in `scripts/__tests__/dashboard-actions.test.ts`, which
 * says why.
 *
 * The Tab/Shift+Tab wrap assertions did NOT come across as keystroke
 * simulations, and that is the point of the port rather than a gap: `dialog.js`
 * existed because the trap had been hand-written twice, and a hand-written trap
 * is a thing you test key by key. base-ui owns it now, so what is asserted is
 * the property the trap was FOR — the dialog declares itself modal and the page
 * behind it is inert — which is also what `ShortcutsSheet.test.tsx` asserts for
 * the other consumer.
 */

const TOKEN_META = 'meta[name="loop-action-token"]';

function setToken(value: string | null) {
    document.querySelector(TOKEN_META)?.remove();
    if (value === null) return;
    const meta = document.createElement("meta");
    meta.setAttribute("name", "loop-action-token");
    meta.setAttribute("content", value);
    document.head.appendChild(meta);
}

const raise = (issue = 3152) =>
    act(() => {
        requestAction({
            action: "claim.release",
            issue,
            opener: null,
        });
    });

const okResponse = () =>
    Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ ok: true }),
    } as Response);

beforeEach(() => {
    resetPendingAction();
    resetOverlays();
    setToken("boot-token-abc");
});

afterEach(() => {
    resetPendingAction();
    resetOverlays();
    setToken(null);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe("ConfirmDialog — nothing is sent before the effect is stated", () => {
    it("names the action and its exact effect, including the issue it acts on", async () => {
        render(<ConfirmDialog onSuccess={() => {}} />);
        raise();
        expect(await screen.findByText("Release claim")).not.toBeNull();
        expect(
            screen.getByText(
                "Remove the in-progress label from #3152. The next pass may claim it again."
            )
        ).not.toBeNull();
    });

    it("carries the boot token on the request, in the header the server reads", async () => {
        const fetchMock = vi.fn(okResponse);
        vi.stubGlobal("fetch", fetchMock);
        const onSuccess = vi.fn();
        render(<ConfirmDialog onSuccess={onSuccess} />);
        raise();
        fireEvent.click(await screen.findByRole("button", { name: "Confirm" }));

        await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
        const [url, init] = fetchMock.mock.calls[0] as unknown as [
            string,
            RequestInit,
        ];
        expect(url).toBe("/api/action");
        expect(init.method).toBe("POST");
        expect(
            (init.headers as Record<string, string>)["x-loop-action-token"]
        ).toBe("boot-token-abc");
        // The issue is COERCED to a number: the server's allow-list refuses a
        // numeric string by design, so the coercion has to happen client-side
        // (#2636 review round 1, finding 1).
        expect(JSON.parse(String(init.body))).toEqual({
            action: "claim.release",
            issue: 3152,
        });
    });

    it("sends an EMPTY token when the page carries no meta tag — an empty token authenticates nothing, and faking one here would only move the 401", async () => {
        setToken(null);
        expect(actionToken()).toBe("");
        const fetchMock = vi.fn(okResponse);
        vi.stubGlobal("fetch", fetchMock);
        render(<ConfirmDialog onSuccess={() => {}} />);
        raise();
        fireEvent.click(await screen.findByRole("button", { name: "Confirm" }));
        await waitFor(() => expect(fetchMock).toHaveBeenCalled());
        const [, init] = fetchMock.mock.calls[0] as unknown as [
            string,
            RequestInit,
        ];
        expect(
            (init.headers as Record<string, string>)["x-loop-action-token"]
        ).toBe("");
    });

    it("a double click cannot send two — the guard is a latch, not the disabled attribute", async () => {
        let release: (() => void) | null = null;
        const fetchMock = vi.fn(
            () =>
                new Promise<Response>((resolve) => {
                    release = () =>
                        resolve({
                            ok: true,
                            json: () => Promise.resolve({ ok: true }),
                        } as Response);
                })
        );
        vi.stubGlobal("fetch", fetchMock);
        render(<ConfirmDialog onSuccess={() => {}} />);
        raise();
        const confirm = await screen.findByRole("button", { name: "Confirm" });

        fireEvent.click(confirm);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        // The control says it is busy without going `disabled`, so the second
        // click genuinely REACHES the handler — which is what makes this a
        // test of the latch rather than a test of a browser behaviour. With
        // `disabled` the browser would refuse the click before any of the
        // component's code ran, and removing the latch would leave the test
        // green (measured).
        expect(confirm.getAttribute("aria-disabled")).toBe("true");
        expect((confirm as HTMLButtonElement).disabled).toBe(false);

        fireEvent.click(confirm);
        expect(fetchMock).toHaveBeenCalledTimes(1);

        await act(async () => {
            release?.();
        });
    });

    it("a refusal stays on screen with its reason — the operator can retry or cancel", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(() =>
                Promise.resolve({
                    ok: false,
                    json: () =>
                        Promise.resolve({ ok: false, error: "not allowed" }),
                } as Response)
            )
        );
        const onSuccess = vi.fn();
        render(<ConfirmDialog onSuccess={onSuccess} />);
        raise();
        fireEvent.click(await screen.findByRole("button", { name: "Confirm" }));

        expect(await screen.findByRole("alert")).not.toBeNull();
        expect(screen.getByText("not allowed")).not.toBeNull();
        expect(onSuccess).not.toHaveBeenCalled();
        expect(screen.getByRole("button", { name: "Confirm" })).not.toBeNull();
    });

    it("a network failure is the same shape as a refusal — one branch, never a thrown exception", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(() => Promise.reject(new Error("connection reset")))
        );
        render(<ConfirmDialog onSuccess={() => {}} />);
        raise();
        fireEvent.click(await screen.findByRole("button", { name: "Confirm" }));
        expect(await screen.findByText("connection reset")).not.toBeNull();
    });

    it("closing while a request is still out does not wedge the NEXT confirmation (#2636 review round 1, finding 4)", async () => {
        let release: (() => void) | null = null;
        const fetchMock = vi.fn(
            () =>
                new Promise<Response>((resolve) => {
                    release = () =>
                        resolve({
                            ok: true,
                            json: () => Promise.resolve({ ok: true }),
                        } as Response);
                })
        );
        vi.stubGlobal("fetch", fetchMock);
        render(<ConfirmDialog onSuccess={() => {}} />);

        raise();
        fireEvent.click(await screen.findByRole("button", { name: "Confirm" }));
        const cancel = screen.getByRole("button", { name: "Cancel" });
        expect((cancel as HTMLButtonElement).disabled).toBe(false);
        fireEvent.click(cancel);
        await act(async () => {
            release?.();
        });

        // A latch left set here would swallow the next Confirm silently — no
        // fetch, no error, nothing visibly wrong.
        raise();
        fireEvent.click(await screen.findByRole("button", { name: "Confirm" }));
        expect(fetchMock).toHaveBeenCalledTimes(2);
        await act(async () => {
            release?.();
        });
    });
});

describe("ConfirmDialog — a stale response belongs to the dialog that asked for it", () => {
    it("does not dismiss, or fire onSuccess for, a DIFFERENT confirmation raised while the first request was still out", async () => {
        let release: ((body: unknown) => void) | null = null;
        const fetchMock = vi.fn(
            () =>
                new Promise<Response>((resolve) => {
                    release = (body) =>
                        resolve({
                            ok: true,
                            json: () => Promise.resolve(body),
                        } as Response);
                })
        );
        vi.stubGlobal("fetch", fetchMock);
        const onSuccess = vi.fn();
        render(<ConfirmDialog onSuccess={onSuccess} />);

        // Confirm the release of #3152, then cancel out of it while the POST
        // is still in flight, then raise a DIFFERENT one.
        raise(3152);
        fireEvent.click(await screen.findByRole("button", { name: "Confirm" }));
        fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
        raise(9999);
        const second =
            "Remove the in-progress label from #9999. The next pass may claim it again.";
        expect(await screen.findByText(second)).not.toBeNull();

        // …and only now does the FIRST request come back, successfully.
        await act(async () => {
            release?.({ ok: true });
        });

        // Truthiness alone would have missed this: a pending action exists, it
        // is simply not the one that was sent. The second dialog must still be
        // open and unanswered.
        expect(onSuccess).not.toHaveBeenCalled();
        expect(screen.getByText(second)).not.toBeNull();
    });
});

describe("ConfirmDialog — every way of closing it sends nothing (#2636 AC)", () => {
    it("states a DRIVER action's exact effect too, and has sent nothing at the point it asks", async () => {
        const fetchMock = vi.fn(okResponse);
        vi.stubGlobal("fetch", fetchMock);
        render(<ConfirmDialog onSuccess={() => {}} />);
        act(() => {
            requestAction({ action: "driver.stop", opener: null });
        });
        expect(await screen.findByText("Stop driver")).not.toBeNull();
        expect(
            screen.getByText(
                "Ask the running driver to stop after its current pass."
            )
        ).not.toBeNull();
        // The AC's first half: opening states the effect and sends nothing.
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("Cancel closes the dialog and never calls fetch", async () => {
        const fetchMock = vi.fn(okResponse);
        vi.stubGlobal("fetch", fetchMock);
        render(<ConfirmDialog onSuccess={() => {}} />);
        raise();
        fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
        await waitFor(() =>
            expect(screen.queryByText("Release claim")).toBeNull()
        );
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("Escape closes the dialog and never calls fetch", async () => {
        const fetchMock = vi.fn(okResponse);
        vi.stubGlobal("fetch", fetchMock);
        render(<ConfirmDialog onSuccess={() => {}} />);
        raise();
        await screen.findByText("Release claim");
        fireEvent.keyDown(document, { key: "Escape" });
        await waitFor(() =>
            expect(screen.queryByText("Release claim")).toBeNull()
        );
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("a press outside the dialog closes it and sends nothing", async () => {
        const fetchMock = vi.fn(okResponse);
        vi.stubGlobal("fetch", fetchMock);
        render(<ConfirmDialog onSuccess={() => {}} />);
        raise();
        await screen.findByText("Release claim");
        fireEvent.pointerDown(document.body);
        fireEvent.mouseDown(document.body);
        fireEvent.click(document.body);
        await waitFor(() =>
            expect(screen.queryByText("Release claim")).toBeNull()
        );
        expect(fetchMock).not.toHaveBeenCalled();
    });
});

describe("ConfirmDialog — focus goes in, and comes back out to where it started", () => {
    it("moves focus INTO the dialog when it opens", async () => {
        render(<ConfirmDialog onSuccess={() => {}} />);
        raise();
        const dialog = await screen.findByRole("dialog");
        await waitFor(() =>
            expect(dialog.contains(document.activeElement)).toBe(true)
        );
    });

    it("declares itself modal, so nothing behind it is reachable while it is open — the property the hand-written Tab trap existed to provide", async () => {
        render(
            <>
                <button type="button">behind</button>
                <ConfirmDialog onSuccess={() => {}} />
            </>
        );
        raise();
        await screen.findByRole("dialog");
        // The control behind is out of the accessibility tree while the dialog
        // is up — which is the property the hand-written Tab trap was FOR, and
        // it holds for every way of reaching the page behind, not only for the
        // two keystrokes a hand-written trap remembered to intercept.
        expect(screen.queryByRole("button", { name: "behind" })).toBeNull();
        // Sanity: the same query DOES find it once the dialog closes, so the
        // assertion above cannot pass by asking for the wrong thing.
        fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
        await waitFor(() =>
            expect(
                screen.queryByRole("button", { name: "behind" })
            ).not.toBeNull()
        );
    });

    it("returns focus to the control that opened it", async () => {
        render(
            <>
                <button type="button">Release</button>
                <ConfirmDialog onSuccess={() => {}} />
            </>
        );
        const opener = screen.getByRole("button", { name: "Release" });
        opener.focus();
        act(() => {
            requestAction({
                action: "claim.release",
                issue: 3152,
                opener,
            });
        });
        fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
        // A poll may have replaced the button by now, which is why the dialog
        // holds the ELEMENT rather than a selector — and why this is asserted
        // rather than assumed.
        await waitFor(() => expect(document.activeElement).toBe(opener));
    });
});

describe("ConfirmDialog — the request it sends", () => {
    it("posts the action name for a driver operation, and nothing else", async () => {
        const fetchMock = vi.fn(okResponse);
        vi.stubGlobal("fetch", fetchMock);
        render(<ConfirmDialog onSuccess={() => {}} />);
        act(() => {
            requestAction({ action: "driver.stop", opener: null });
        });
        fireEvent.click(await screen.findByRole("button", { name: "Confirm" }));
        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toBe("/api/action");
        expect(JSON.parse(init.body as string)).toEqual({
            action: "driver.stop",
        });
    });

    it("posts the issue as a NUMBER for the row it was raised on — a string would be the two halves agreeing by luck", async () => {
        const fetchMock = vi.fn(okResponse);
        vi.stubGlobal("fetch", fetchMock);
        render(<ConfirmDialog onSuccess={() => {}} />);
        raise(2582);
        fireEvent.click(await screen.findByRole("button", { name: "Confirm" }));
        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
        const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(JSON.parse(init.body as string)).toEqual({
            action: "claim.release",
            issue: 2582,
        });
    });

    it("closes and calls onSuccess when the server accepts the action", async () => {
        vi.stubGlobal("fetch", vi.fn(okResponse));
        const onSuccess = vi.fn();
        render(<ConfirmDialog onSuccess={onSuccess} />);
        raise();
        fireEvent.click(await screen.findByRole("button", { name: "Confirm" }));
        await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
        expect(screen.queryByText("Release claim")).toBeNull();
    });

    it("marks Confirm busy from the first click until the response resolves, and Cancel deliberately stays live", async () => {
        // WHAT CHANGED, AND WHY (PRD #3148 S2). The vanilla dialog disabled
        // BOTH buttons in flight. The port keeps the half that matters — a
        // second Confirm cannot send a second request — and deliberately
        // leaves Cancel live, because closing while a request is still out is
        // a case this dialog now SUPPORTS rather than prevents (#2636 review
        // round 1, finding 4: the latch is cleared on close, so the next
        // dialog's Confirm is not swallowed).
        //
        // `aria-disabled` and a changed label, not the `disabled` attribute:
        // the re-entrancy guard is the latch, and a disabled control is a UI
        // reflection of it rather than the enforcement — the point the
        // component's own header makes and the sibling case proves.
        let release: (r: Response) => void = () => {};
        const fetchMock = vi.fn(
            () =>
                new Promise<Response>((resolve) => {
                    release = resolve;
                })
        );
        vi.stubGlobal("fetch", fetchMock);
        render(<ConfirmDialog onSuccess={() => {}} />);
        raise();
        fireEvent.click(await screen.findByRole("button", { name: "Confirm" }));

        const busy = await screen.findByRole("button", { name: "Working…" });
        expect(busy.getAttribute("aria-disabled")).toBe("true");
        expect(
            screen
                .getByRole("button", { name: "Cancel" })
                .hasAttribute("disabled")
        ).toBe(false);

        fireEvent.click(busy);
        expect(fetchMock).toHaveBeenCalledTimes(1);

        await act(async () => {
            release({
                ok: true,
                json: () => Promise.resolve({ ok: true }),
            } as Response);
        });
    });
});
