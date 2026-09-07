import { describe, it, expect, vi, afterEach } from "vitest";
import { postAction } from "../../dashboard/lib/actions";

/**
 * The `/api/action` WIRE, end to end (#2636 review round 1, findings 1 & 2).
 *
 * ── WHY ONE CASE OF THIS FILE SURVIVED IN THE `node` PROJECT (PRD #3148 S4) ─
 *
 * `scripts/__tests__/dashboard-actions.test.ts` had nineteen cases against
 * `scripts/dashboard/actions.js` — the hand-built dialog, its focus trap, its
 * in-flight latch, its error slot. Eighteen of them are about the DIALOG and
 * moved with it, to
 * `dashboard/components/now/__tests__/ConfirmDialog.test.tsx`, where they are
 * asserted against a rendered component instead of an `initActions()` call and
 * a `querySelector`.
 *
 * This one is not about the dialog. It feeds the CLIENT'S OWN request — its
 * literal headers and body string, not a hand-rebuilt equivalent — into the
 * REAL `telemetry-serve` route handler, and that seam cannot be reached from
 * the `dom` project: `telemetry-serve.ts` is a Node-typed module that
 * `tsconfig.dashboard.json` (a browser program, no `@types/node`) cannot
 * check. So it stays here, one directory away from the server it is
 * contracting with, and imports the client half — `dashboard/lib/actions.ts`,
 * typed, no `@ts-expect-error` — the way `dashboard-now-port.test.ts` already
 * imports the ported Now modules.
 *
 * THIS IS THE SEAM THAT SHIPPED BROKEN: the client and the server each had a
 * passing test of its own half while the wire between them 400'd on every real
 * click. Two pieces passing individually and failing together is the bug class
 * this repo's own rules name.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const g = globalThis as any;

const ORIGIN = "http://127.0.0.1:5174";
const TOKEN = "TEST-TOKEN";

/** `actionToken()` reads the boot token out of the shell's `<meta>`; the
 *  `node` project has no document, so this is the smallest stand-in that
 *  answers the one query it makes. */
function installTokenMeta(token: string): void {
    g.document = {
        querySelector: (sel: string) =>
            sel === 'meta[name="loop-action-token"]'
                ? { content: token }
                : null,
    };
}

afterEach(() => {
    delete g.document;
    delete g.fetch;
    vi.restoreAllMocks();
});

describe("/api/action — the client's own request is accepted by the real server route", () => {
    it("the exact body postAction sends for claim.release is ACCEPTED by handleRequest, and dispatches releaseClaim with the issue as a NUMBER", async () => {
        installTokenMeta(TOKEN);
        const fetchSpy = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ ok: true }),
        });
        g.fetch = fetchSpy;

        await postAction("claim.release", { issue: 2582 });

        expect(fetchSpy).toHaveBeenCalledTimes(1);
        const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];

        const { handleRequest } = await import("../telemetry-serve");
        const calls: string[] = [];
        const res = await handleRequest(
            new Request(`${ORIGIN}/api/action`, {
                method: "POST",
                headers: {
                    ...(init.headers as Record<string, string>),
                    origin: ORIGIN,
                },
                body: init.body as string,
            }),
            {
                actionToken: TOKEN,
                allowedOrigins: new Set([ORIGIN]),
                driverActions: {
                    stopDriver: async () => {
                        calls.push("stopDriver");
                    },
                    resumeDriver: async () => {
                        calls.push("resumeDriver");
                    },
                    releaseClaim: async (issue: number) => {
                        calls.push(`releaseClaim:${issue}`);
                    },
                },
            }
        );

        expect(res.status).toBe(200);
        // A STRING `"2582"` here would mean the client serialised the issue as
        // text and the server coerced it — the two halves agreeing by luck.
        expect(calls).toEqual(["releaseClaim:2582"]);
        expect(await res.json()).toEqual({
            ok: true,
            action: "claim.release",
            issue: 2582,
        });
    });

    it("the same request with a WRONG token is refused, and no driver operation runs — the token the client sends is the one the server checks", async () => {
        installTokenMeta("not-the-boot-token");
        const fetchSpy = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ ok: true }),
        });
        g.fetch = fetchSpy;

        await postAction("driver.stop");
        const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];

        const { handleRequest } = await import("../telemetry-serve");
        const calls: string[] = [];
        const res = await handleRequest(
            new Request(`${ORIGIN}/api/action`, {
                method: "POST",
                headers: {
                    ...(init.headers as Record<string, string>),
                    origin: ORIGIN,
                },
                body: init.body as string,
            }),
            {
                actionToken: TOKEN,
                allowedOrigins: new Set([ORIGIN]),
                driverActions: {
                    stopDriver: async () => {
                        calls.push("stopDriver");
                    },
                    resumeDriver: async () => {
                        calls.push("resumeDriver");
                    },
                    releaseClaim: async () => {
                        calls.push("releaseClaim");
                    },
                },
            }
        );

        expect(res.status).toBe(401);
        expect(calls).toEqual([]);
    });
});
