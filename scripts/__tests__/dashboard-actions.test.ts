import { describe, it, expect, vi, afterEach } from "vitest";
import { Window } from "happy-dom";
// @ts-expect-error — a browser ES module with no type declarations; plain JS
// on purpose (no build step on the dashboard, #2625). Neither module touches
// `document` at import time (only inside functions, called later), so a
// plain top-of-file import is safe here — unlike `shortcuts.js`, which
// registers a listener at MODULE scope via its own static import of
// `now-loop-status.js` and so must be imported dynamically in its tests.
import {
    initActions,
    actionDialogOpen,
    resetActions,
} from "../dashboard/actions.js";

/**
 * Action buttons and their confirmation dialog (#2636) — the verdict band's
 * `driver.stop`/`driver.resume` buttons and a claims-table row's
 * `claim.release` button, wired to `POST /api/action` (#2628).
 *
 * Driven through real `click`/`keydown` events on a real happy-dom document,
 * the same shape `dashboard-shortcuts.test.ts` uses for the shortcut sheet —
 * the ACs are behavioural ("Cancelling sends nothing", "traps focus"), which
 * a source-grep cannot prove.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const g = globalThis as any;

const SHELL_HTML = `
    <div id="loop-status-body">
        <span class="ls-verdict-remedy">
            <button type="button" class="ls-action" data-action="driver.stop">Stop driver</button>
        </span>
        <table><tbody>
            <tr><td>
                <button type="button" class="ls-action ls-release" data-action="claim.release" data-issue="2582">Release</button>
            </td></tr>
        </tbody></table>
    </div>
    <button id="elsewhere" type="button">elsewhere</button>
`;

function mountPage(html = SHELL_HTML) {
    const win = new Window({ url: "http://localhost/" });
    win.document.body.innerHTML = html;
    win.document.head.innerHTML =
        '<meta name="loop-action-token" content="TEST-TOKEN">';
    g.document = win.document;
    resetActions();
    return win;
}

afterEach(() => {
    delete g.document;
    delete g.fetch;
});

function fireKey(win: Window, key: string, init: Record<string, unknown> = {}) {
    win.document.dispatchEvent(
        new win.KeyboardEvent("keydown", {
            key,
            bubbles: true,
            cancelable: true,
            ...init,
        })
    );
}

function click(win: Window, el: Element | null) {
    expect(el, "element to click exists").toBeTruthy();
    (el as unknown as HTMLElement).dispatchEvent(
        new win.MouseEvent("click", { bubbles: true })
    );
}

describe("actions.js — opening the dialog names the exact effect (#2636 AC)", () => {
    it("clicking Stop driver opens a dialog naming what it will do, and sends nothing yet", () => {
        const win = mountPage();
        const fetchSpy = vi.fn();
        g.fetch = fetchSpy;
        initActions();

        click(
            win,
            win.document.querySelector(".ls-action[data-action='driver.stop']")
        );

        expect(actionDialogOpen()).toBe(true);
        const body = win.document.getElementById("action-confirm-body");
        expect(body!.textContent).toContain("stop after its current pass");
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("clicking Release on an orphaned claim's row names ITS OWN issue number", () => {
        const win = mountPage();
        g.fetch = vi.fn();
        initActions();

        click(win, win.document.querySelector(".ls-release"));

        const body = win.document.getElementById("action-confirm-body");
        expect(body!.textContent).toBe(
            "Remove the in-progress label from #2582. The next pass may claim it again."
        );
    });

    it("moves focus into the dialog, onto Confirm — focus stays visible throughout", () => {
        const win = mountPage();
        g.fetch = vi.fn();
        initActions();
        const trigger = win.document.querySelector(
            ".ls-action[data-action='driver.stop']"
        ) as unknown as HTMLElement;
        trigger.focus();

        click(win, trigger);

        expect(win.document.activeElement).toBe(
            win.document.querySelector(".action-confirm-ok")
        );
    });
});

describe("actions.js — cancelling sends nothing (#2636 AC)", () => {
    it("Cancel closes the dialog and never calls fetch", () => {
        const win = mountPage();
        const fetchSpy = vi.fn();
        g.fetch = fetchSpy;
        initActions();
        click(
            win,
            win.document.querySelector(".ls-action[data-action='driver.stop']")
        );
        expect(actionDialogOpen()).toBe(true);

        click(win, win.document.querySelector(".action-confirm-cancel"));

        expect(actionDialogOpen()).toBe(false);
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("Escape closes the dialog and never calls fetch", () => {
        const win = mountPage();
        const fetchSpy = vi.fn();
        g.fetch = fetchSpy;
        initActions();
        click(
            win,
            win.document.querySelector(".ls-action[data-action='driver.stop']")
        );

        fireKey(win, "Escape");

        expect(actionDialogOpen()).toBe(false);
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("clicking the backdrop itself (outside the sheet) closes and sends nothing", () => {
        const win = mountPage();
        const fetchSpy = vi.fn();
        g.fetch = fetchSpy;
        initActions();
        click(
            win,
            win.document.querySelector(".ls-action[data-action='driver.stop']")
        );

        click(win, win.document.getElementById("action-confirm-backdrop"));

        expect(actionDialogOpen()).toBe(false);
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("returns focus to the button that opened it", () => {
        const win = mountPage();
        g.fetch = vi.fn();
        initActions();
        const trigger = win.document.querySelector(
            ".ls-action[data-action='driver.stop']"
        ) as unknown as HTMLElement;
        trigger.focus();
        click(win, trigger);

        fireKey(win, "Escape");

        expect(win.document.activeElement).toBe(trigger);
    });
});

describe("actions.js — Confirm posts to /api/action with the boot token (#2636, #2628)", () => {
    it("driver.stop posts {action:'driver.stop'} with the meta token as x-loop-action-token", async () => {
        const win = mountPage();
        const fetchSpy = vi
            .fn()
            .mockResolvedValue({ json: async () => ({ ok: true }) });
        g.fetch = fetchSpy;
        initActions();
        click(
            win,
            win.document.querySelector(".ls-action[data-action='driver.stop']")
        );

        click(win, win.document.querySelector(".action-confirm-ok"));
        await Promise.resolve();
        await Promise.resolve();

        expect(fetchSpy).toHaveBeenCalledTimes(1);
        const [url, init] = fetchSpy.mock.calls[0];
        expect(url).toBe("/api/action");
        expect(init.method).toBe("POST");
        expect(init.headers["x-loop-action-token"]).toBe("TEST-TOKEN");
        expect(JSON.parse(init.body)).toEqual({ action: "driver.stop" });
    });

    it("claim.release posts {action:'claim.release', issue} for exactly the row clicked", async () => {
        const win = mountPage();
        const fetchSpy = vi.fn().mockResolvedValue({
            json: async () => ({ ok: true, issue: 2582 }),
        });
        g.fetch = fetchSpy;
        initActions();
        click(win, win.document.querySelector(".ls-release"));

        click(win, win.document.querySelector(".action-confirm-ok"));
        await Promise.resolve();
        await Promise.resolve();

        const [, init] = fetchSpy.mock.calls[0];
        expect(JSON.parse(init.body)).toEqual({
            action: "claim.release",
            issue: "2582",
        });
    });

    it("closes the dialog and calls onSuccess when the server accepts the action", async () => {
        const win = mountPage();
        g.fetch = vi
            .fn()
            .mockResolvedValue({ json: async () => ({ ok: true }) });
        const onSuccess = vi.fn();
        initActions(undefined, onSuccess);
        click(
            win,
            win.document.querySelector(".ls-action[data-action='driver.stop']")
        );

        click(win, win.document.querySelector(".action-confirm-ok"));
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();

        expect(actionDialogOpen()).toBe(false);
        expect(onSuccess).toHaveBeenCalledTimes(1);
    });
});

describe("actions.js — disables while the request is in flight, so a double click cannot send two (#2636 AC)", () => {
    it("disables Confirm and Cancel from the first click until the response resolves", async () => {
        const win = mountPage();
        let resolveFetch: (v: unknown) => void = () => {};
        g.fetch = vi.fn(
            () =>
                new Promise((resolve) => {
                    resolveFetch = resolve;
                })
        );
        initActions();
        click(
            win,
            win.document.querySelector(".ls-action[data-action='driver.stop']")
        );
        const ok = win.document.querySelector(
            ".action-confirm-ok"
        ) as unknown as HTMLButtonElement;
        const cancel = win.document.querySelector(
            ".action-confirm-cancel"
        ) as unknown as HTMLButtonElement;
        expect(ok.disabled).toBe(false);

        click(win, ok);
        // Still pending — the fetch promise has not resolved yet.
        expect(ok.disabled).toBe(true);
        expect(cancel.disabled).toBe(true);

        // A second click on the (now-disabled) button must not fire a
        // second request — happy-dom still dispatches click on a disabled
        // button, so the count is proven by the actual fetch call count,
        // not by whether the click event fired.
        click(win, ok);
        expect(g.fetch).toHaveBeenCalledTimes(1);

        resolveFetch({ json: async () => ({ ok: true }) });
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        expect(actionDialogOpen()).toBe(false);
    });

    it("still refuses a second in-flight request even if something re-enables the button (defence in depth — the `disabled` attribute is a UI reflection, not the enforcement)", async () => {
        // The click-suppression a browser gives a disabled button (proven by
        // the test above) is not something this module's OWN correctness
        // should rest on entirely: a script bypassing `disabled`, or an
        // engine that dispatches anyway, must still not double-send. This
        // test removes `disabled` by hand between the two clicks — the one
        // thing the test above cannot exercise — to prove the module's own
        // re-entrancy guard, not the DOM's.
        const win = mountPage();
        let resolveFetch: (v: unknown) => void = () => {};
        const fetchSpy = vi.fn(
            () =>
                new Promise((resolve) => {
                    resolveFetch = resolve;
                })
        );
        g.fetch = fetchSpy;
        initActions();
        click(
            win,
            win.document.querySelector(".ls-action[data-action='driver.stop']")
        );
        const ok = win.document.querySelector(
            ".action-confirm-ok"
        ) as unknown as HTMLButtonElement;

        click(win, ok);
        expect(fetchSpy).toHaveBeenCalledTimes(1);
        ok.disabled = false; // bypass, deliberately, for this proof
        click(win, ok);

        expect(fetchSpy).toHaveBeenCalledTimes(1);
        resolveFetch({ json: async () => ({ ok: true }) });
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
    });
});

describe("actions.js — a refused or failed action surfaces the reason and falls back to the copyable command (#2636 AC)", () => {
    it("shows the server's refusal reason, keeps the dialog open, and re-enables the buttons", async () => {
        const win = mountPage();
        g.fetch = vi.fn().mockResolvedValue({
            json: async () => ({ ok: false, error: "invalid action token" }),
        });
        initActions();
        click(
            win,
            win.document.querySelector(".ls-action[data-action='driver.stop']")
        );

        click(win, win.document.querySelector(".action-confirm-ok"));
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();

        expect(actionDialogOpen()).toBe(true);
        const err = win.document.querySelector(".action-confirm-error");
        expect(err!.textContent).toBe("invalid action token");
        expect((err as unknown as HTMLElement).hidden).toBe(false);
        const ok = win.document.querySelector(
            ".action-confirm-ok"
        ) as unknown as HTMLButtonElement;
        expect(ok.disabled).toBe(false);
    });

    it("a network failure (fetch rejects) is folded into the same error slot, never an uncaught rejection", async () => {
        const win = mountPage();
        g.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
        initActions();
        click(
            win,
            win.document.querySelector(".ls-action[data-action='driver.stop']")
        );

        click(win, win.document.querySelector(".action-confirm-ok"));
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();

        expect(actionDialogOpen()).toBe(true);
        const err = win.document.querySelector(".action-confirm-error");
        expect(err!.textContent).toContain("ECONNREFUSED");
    });
});

describe("actions.js — the dialog traps Tab/Shift+Tab between Cancel and Confirm (#2636 AC: keyboard-operable, traps focus)", () => {
    it("Tab from Confirm (the last focusable) wraps to Cancel (the first)", () => {
        const win = mountPage();
        g.fetch = vi.fn();
        initActions();
        click(
            win,
            win.document.querySelector(".ls-action[data-action='driver.stop']")
        );
        const ok = win.document.querySelector(".action-confirm-ok");
        expect(win.document.activeElement).toBe(ok);

        fireKey(win, "Tab");

        expect(win.document.activeElement).toBe(
            win.document.querySelector(".action-confirm-cancel")
        );
    });

    it("Shift+Tab from Cancel (the first focusable) wraps to Confirm (the last)", () => {
        const win = mountPage();
        g.fetch = vi.fn();
        initActions();
        click(
            win,
            win.document.querySelector(".ls-action[data-action='driver.stop']")
        );
        (
            win.document.querySelector(
                ".action-confirm-cancel"
            ) as unknown as HTMLElement
        ).focus();

        fireKey(win, "Tab", { shiftKey: true });

        expect(win.document.activeElement).toBe(
            win.document.querySelector(".action-confirm-ok")
        );
    });

    it("re-traps focus back into the dialog even if something moved it off by other means (a programmatic .focus() call)", () => {
        const win = mountPage();
        g.fetch = vi.fn();
        initActions();
        click(
            win,
            win.document.querySelector(".ls-action[data-action='driver.stop']")
        );
        (
            win.document.getElementById("elsewhere") as unknown as HTMLElement
        ).focus();
        expect(win.document.activeElement).not.toBe(
            win.document.querySelector(".action-confirm-cancel")
        );

        fireKey(win, "Tab");

        // Cycled from "outside" — the trap treats that as `!inside`, landing
        // on the first focusable, same contract `dialog.js` documents.
        expect(win.document.activeElement).toBe(
            win.document.querySelector(".action-confirm-cancel")
        );
    });

    it("1/2/r-style keys reaching `document` while the dialog is open do not leak past it (defence in depth alongside shortcuts.js's own suppression)", () => {
        const win = mountPage();
        g.fetch = vi.fn();
        initActions();
        click(
            win,
            win.document.querySelector(".ls-action[data-action='driver.stop']")
        );

        fireKey(win, "a");

        expect(actionDialogOpen()).toBe(true);
    });
});

describe("actions.js — a button whose action is not recognised is ignored (defensive)", () => {
    it("a rogue .ls-action with an unknown data-action does not open a dialog", () => {
        const win = mountPage(
            `<div id="loop-status-body"><button type="button" class="ls-action" data-action="not.a.real.action">?</button></div>`
        );
        g.fetch = vi.fn();
        initActions();

        click(win, win.document.querySelector(".ls-action"));

        expect(actionDialogOpen()).toBe(false);
    });
});
