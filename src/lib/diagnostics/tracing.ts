// Which traces Sentry keeps (issue #10321, after issue #10214).
//
// Until now every transaction was sampled at one flat rate. Read on 2026-11-20
// over two days, the project held 8 transactions: 5 from `HeadlessChrome`
// (automated walks against production) and 3 from the owner's Chrome; neither
// of that day's two vs-Bot games was sampled. Two rules fix both halves:
//
//   1. BY WHAT IT IS. A Brain consult's span (`~/lib/ai/bot-consult-span`) and
//      the game route are kept in full; every other route at `ROUTE_SAMPLE_RATE`.
//      The game route is `/game` for every game: the route does not say whether
//      a Bot sits in it, so a two-player game's navigation is kept too (one
//      transaction per visit).
//   2. NO AUTOMATED TRAFFIC. A browser driven by automation
//      (`navigator.webdriver`) is sampled at zero, and a transaction that
//      reaches the send step from one is dropped.
//
// Production builds only: the local dev server must not spend the free-tier
// span quota (ADR 0139 § 4).

/** The name and `op` of a Brain consult's span (`~/lib/ai/bot-consult-span`):
 *  what this sampler and a Sentry query match. */
export const BOT_CONSULT_SPAN = "bot.consult";

/** The TanStack route every game is played on (`src/router.tsx`). */
export const GAME_ROUTE = "/game";

/** The share of every other route's transactions kept (issue #10214). */
export const ROUTE_SAMPLE_RATE = 0.2;

/** What the SDK hands a trace sampler, as far as this one reads it. */
type SamplingInput = {
    name: string;
    attributes?: Record<string, unknown>;
};

/** Whether this browser is driven by automation: `check:ui`, a Playwright
 *  walk, a crawler that says so. */
export function isAutomatedBrowser(
    nav: { webdriver?: boolean } | undefined = typeof navigator === "undefined"
        ? undefined
        : navigator
): boolean {
    return nav?.webdriver === true;
}

/** The trace sampler of a build: the rate a transaction starting now is kept
 *  at. `production` is the build's own flag; `automated` is asked per call. */
export function tracesSamplerFor(
    production: boolean,
    automated: () => boolean = isAutomatedBrowser
): (input: SamplingInput) => number {
    return ({ name, attributes }) => {
        if (!production || automated()) return 0;
        if (
            name === BOT_CONSULT_SPAN ||
            attributes?.["sentry.op"] === BOT_CONSULT_SPAN
        ) {
            return 1;
        }
        if (name === GAME_ROUTE) return 1;
        return ROUTE_SAMPLE_RATE;
    };
}

/** `beforeSendTransaction`: a transaction from an automated browser is not
 *  sent. The sampler already keeps none; this is the send step saying the
 *  same, for a transaction sampled before the browser said what drives it. */
export function dropAutomatedTransaction<T>(
    event: T,
    automated: () => boolean = isAutomatedBrowser
): T | null {
    return automated() ? null : event;
}
