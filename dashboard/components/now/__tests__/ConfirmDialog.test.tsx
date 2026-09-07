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

const raise = () =>
    act(() => {
        requestAction({
            action: "claim.release",
            issue: 3152,
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

        // Both clicks are dispatched before the first request resolves, and
        // the second is dispatched programmatically — which is exactly the
        // case `disabled` is not guaranteed to suppress.
        fireEvent.click(confirm);
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
        fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
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
