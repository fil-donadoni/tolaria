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

/** Whether a transaction's name is the game route. The router integration
 *  names a transaction by its matched route id (`/game`) and, when no route
 *  matched yet, by the location's pathname: the same text, possibly with a
 *  trailing slash, never with the query string. */
export function isGameRouteName(name: string): boolean {
    const path = name.split(/[?#]/)[0]!.replace(/\/+$/, "");
    return path === GAME_ROUTE;
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
        if (isGameRouteName(name)) return 1;
        return ROUTE_SAMPLE_RATE;
    };
}

/** A transaction event, as far as this module reads and rewrites it. */
type TransactionLike = {
    transaction?: string;
    contexts?: { trace?: { op?: string } } & Record<string, unknown>;
    request?: unknown;
    breadcrumbs?: unknown;
    user?: unknown;
    extra?: unknown;
    tags?: unknown;
};

/** A Brain consult's transaction, stripped to what the consult itself says.
 *
 *  The SDK dresses every transaction like a page load: the page's URL with
 *  its query string, the full user-agent header, the session's breadcrumbs
 *  (console lines, navigations, clicks, requests), the locale and time zone.
 *  A consult's span leaves the device outside the bug-report consent gate
 *  and promises counters, durations and a coarse device class
 *  (`~/lib/ai/bot-consult-span`), so none of that may ride on it: only the
 *  trace context, which holds the span's own allowlisted attributes, stays.
 *  Any other transaction is returned untouched. */
export function scrubBotConsultTransaction<T>(event: T): T {
    const loose = event as TransactionLike;
    if (
        loose.transaction !== BOT_CONSULT_SPAN &&
        loose.contexts?.trace?.op !== BOT_CONSULT_SPAN
    ) {
        return event;
    }
    delete loose.request;
    delete loose.breadcrumbs;
    delete loose.user;
    delete loose.extra;
    delete loose.tags;
    loose.contexts = loose.contexts?.trace
        ? { trace: loose.contexts.trace }
        : {};
    return event;
}

/** `beforeSendTransaction`: a transaction from an automated browser is not
 *  sent (the sampler already keeps none; this is the send step saying the
 *  same, for a transaction sampled before the browser said what drives it),
 *  and a Brain consult's is stripped first. */
export function sendableTransaction<T>(
    event: T,
    automated: () => boolean = isAutomatedBrowser
): T | null {
    return automated() ? null : scrubBotConsultTransaction(event);
}
