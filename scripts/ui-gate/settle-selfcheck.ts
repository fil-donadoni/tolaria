#!/usr/bin/env bun
/**
 * The Settled Screen predicate, checked in the browser lane itself (issue
 * #3644). `settleState` is pure and unit-tested (`ui-gate-settle.test.ts`),
 * but what it is FED — the page-side sampler and the network instrument — only
 * means something in a real Chromium: `document.getAnimations()`, a CSS
 * animation's computed timing, a `fetch` still pending. So `check:ui` runs
 * these cases against fixture pages in its own browser before walking
 * anything, and a predicate that returns early is a fatal error rather than a
 * run of readings taken on a moving screen.
 *
 * Each case holds back exactly ONE condition and records, in the page, the
 * moment it clears; the wait must return only after that moment. The last case
 * never raises the ready marker and must time out as `unsettled`.
 *
 *   bun scripts/ui-gate/settle-selfcheck.ts     # run it alone
 */
import type { Browser, Route } from "playwright";
import { UNSETTLED_MESSAGE_PREFIX } from "./infra-verdict.ts";
import {
    NETWORK_INSTRUMENT_SOURCE,
    SURFACE_READY_ATTRIBUTE,
    waitForSettledScreen,
    type SettlePolicy,
} from "./settle.ts";

const ORIGIN = "http://settle-selfcheck.invalid";
/** When the held-back condition clears, in page milliseconds. */
const HOLD_MS = 500;
const POLICY: SettlePolicy = { quietMs: 300, timeoutMs: 5_000, pollMs: 50 };
const NEVER_READY_POLICY: SettlePolicy = { ...POLICY, timeoutMs: 1_200 };

const MARK_READY = `(() => {
    const s = document.createElement("span");
    s.setAttribute("${SURFACE_READY_ATTRIBUTE}", "");
    s.hidden = true;
    document.body.appendChild(s);
})`;

interface SelfCheckCase {
    name: string;
    /** Body markup plus a script that sets `window.__cleared` when the held
     *  condition clears (never, for the unsettled case). */
    body: string;
    targets?: string[];
    expect: "settled" | "unsettled";
}

const CASES: readonly SelfCheckCase[] = [
    {
        name: "delayed ready marker",
        body: `<main><p>list</p></main><script>
            setTimeout(() => { ${MARK_READY}(); window.__cleared = performance.now(); }, ${HOLD_MS});
        </script>`,
        expect: "settled",
    },
    {
        name: "running finite animation",
        body: `<style>
            @keyframes slide { from { transform: translateX(0) } to { transform: translateX(80px) } }
            .slide { width: 40px; height: 40px; animation: slide ${HOLD_MS}ms linear 1 forwards; }
        </style><main><div class="slide"></div></main><script>
            ${MARK_READY}();
            document.querySelector(".slide").addEventListener("animationend", () => { window.__cleared = performance.now(); });
        </script>`,
        expect: "settled",
    },
    {
        name: "request in flight",
        body: `<main><p>list</p></main><script>
            ${MARK_READY}();
            fetch("/slow").then((r) => r.text()).then(() => { window.__cleared = performance.now(); });
        </script>`,
        expect: "settled",
    },
    {
        name: "target box moving without an animation",
        body: `<main><div class="mover" style="position:relative;left:0;width:20px;height:20px"></div></main><script>
            ${MARK_READY}();
            const el = document.querySelector(".mover");
            const t0 = performance.now();
            const id = setInterval(() => {
                if (performance.now() - t0 >= ${HOLD_MS}) { clearInterval(id); window.__cleared = performance.now(); return; }
                el.style.left = (parseFloat(el.style.left) + 3) + "px";
            }, 30);
        </script>`,
        targets: [".mover"],
        expect: "settled",
    },
    {
        name: "infinite animation is not a blocker",
        body: `<style>
            @keyframes spin { to { transform: rotate(360deg) } }
            .spin { width: 10px; height: 10px; animation: spin 600ms linear infinite; }
        </style><main><div class="spin"></div></main><script>
            ${MARK_READY}();
            window.__cleared = performance.now();
        </script>`,
        expect: "settled",
    },
    {
        name: "ready marker never raised",
        body: `<main><p>loading</p></main>`,
        expect: "unsettled",
    },
];

async function runCase(browser: Browser, c: SelfCheckCase): Promise<void> {
    const context = await browser.newContext();
    try {
        await context.addInitScript(NETWORK_INSTRUMENT_SOURCE);
        await context.route(`${ORIGIN}/**`, async (route: Route) => {
            const url = new URL(route.request().url());
            if (url.pathname === "/slow") {
                await new Promise((resolve) => setTimeout(resolve, HOLD_MS));
                await route.fulfill({ status: 200, body: "ok" });
                return;
            }
            await route.fulfill({
                status: 200,
                contentType: "text/html",
                body: `<!doctype html><html><body>${c.body}</body></html>`,
            });
        });
        const page = await context.newPage();
        await page.goto(`${ORIGIN}/case`, { waitUntil: "domcontentloaded" });

        if (c.expect === "unsettled") {
            const outcome = await waitForSettledScreen(page, {
                policy: NEVER_READY_POLICY,
            }).then(
                () => "settled",
                (err: Error) => err.message
            );
            if (!outcome.startsWith(UNSETTLED_MESSAGE_PREFIX)) {
                throw new Error(
                    `"${c.name}": expected an \`${UNSETTLED_MESSAGE_PREFIX}\` error, got ${JSON.stringify(outcome)}`
                );
            }
            return;
        }

        await waitForSettledScreen(page, {
            targets: c.targets,
            policy: POLICY,
        });
        // How long ago, in page time, the held condition cleared — or null if
        // it has not cleared yet, which means the wait returned early.
        const sinceCleared = (await page.evaluate(
            "window.__cleared === undefined ? null : performance.now() - window.__cleared"
        )) as number | null;
        if (sinceCleared === null) {
            throw new Error(
                `"${c.name}": the wait returned while the held condition was still up`
            );
        }
    } finally {
        await context.close();
    }
}

/** Every case, in parallel pages. Resolves to a one-line summary; throws the
 *  first case that failed. */
export async function runSettleSelfCheck(browser: Browser): Promise<string> {
    const startedAt = Date.now();
    await Promise.all(CASES.map((c) => runCase(browser, c)));
    return `settle self-check: ${CASES.length} cases passed in ${Date.now() - startedAt}ms`;
}

if (import.meta.main) {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless: true });
    try {
        console.log(await runSettleSelfCheck(browser));
    } catch (err) {
        console.error(`✗ ${(err as Error).message}`);
        process.exitCode = 1;
    } finally {
        await browser.close();
    }
}
