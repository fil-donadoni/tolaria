// Which traces Sentry keeps (issue #10321): a Brain consult and the game route
// in full, every other route at the lower rate, nothing from a development
// build or from a browser driven by automation.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
    BOT_CONSULT_SPAN,
    GAME_ROUTE,
    ROUTE_SAMPLE_RATE,
    isAutomatedBrowser,
    isGameRouteName,
    scrubBotConsultTransaction,
    sendableTransaction,
    tracesSamplerFor,
    withoutBreadcrumbs,
} from "../tracing";

const human = () => false;
const automated = () => true;

describe("tracesSamplerFor", () => {
    it("keeps the game route in full and another route at the lower rate", () => {
        const sample = tracesSamplerFor(true, human);
        expect(sample({ name: GAME_ROUTE })).toBe(1);
        expect(sample({ name: "/decks/$slug" })).toBe(ROUTE_SAMPLE_RATE);
        expect(sample({ name: "/" })).toBe(ROUTE_SAMPLE_RATE);
        expect(ROUTE_SAMPLE_RATE).toBeGreaterThan(0);
        expect(ROUTE_SAMPLE_RATE).toBeLessThan(1);
    });

    it("keeps every Brain consult's span, by its name or by its op", () => {
        const sample = tracesSamplerFor(true, human);
        expect(sample({ name: BOT_CONSULT_SPAN })).toBe(1);
        expect(
            sample({
                name: "renamed",
                attributes: { "sentry.op": BOT_CONSULT_SPAN },
            })
        ).toBe(1);
    });

    it("keeps nothing on a development build", () => {
        const sample = tracesSamplerFor(false, human);
        expect(sample({ name: GAME_ROUTE })).toBe(0);
        expect(sample({ name: BOT_CONSULT_SPAN })).toBe(0);
        expect(sample({ name: "/" })).toBe(0);
    });

    it("keeps nothing from a browser driven by automation", () => {
        const sample = tracesSamplerFor(true, automated);
        expect(sample({ name: GAME_ROUTE })).toBe(0);
        expect(sample({ name: BOT_CONSULT_SPAN })).toBe(0);
        expect(sample({ name: "/" })).toBe(0);
    });

    it("names the route the router plays a game on", () => {
        // The sampler matches the route by name: a renamed game route would
        // silently fall to the lower rate.
        const router = readFileSync(
            resolve(__dirname, "../../../router.tsx"),
            "utf8"
        );
        expect(router).toContain(`path: "${GAME_ROUTE}",`);
    });
});

describe("the game route, as the router integration names it", () => {
    it("is kept in full under each shape the SDK gives the name", () => {
        const sample = tracesSamplerFor(true, human);
        // A matched route: the route id, `sentry.source: route`.
        expect(
            sample({
                name: "/game",
                attributes: {
                    "sentry.op": "pageload",
                    "sentry.source": "route",
                },
            })
        ).toBe(1);
        // No route matched yet: the location's pathname, `sentry.source: url`.
        expect(
            sample({
                name: "/game/",
                attributes: {
                    "sentry.op": "navigation",
                    "sentry.source": "url",
                },
            })
        ).toBe(1);
    });

    it("is told from a route that only starts like it", () => {
        expect(isGameRouteName("/game")).toBe(true);
        expect(isGameRouteName("/game/")).toBe(true);
        expect(isGameRouteName("/game?gameId=abc")).toBe(true);
        expect(isGameRouteName("/games")).toBe(false);
        expect(isGameRouteName("/game/extra")).toBe(false);
        expect(isGameRouteName("/")).toBe(false);
    });
});

/** A consult's transaction as the SDK builds it with its default
 *  integrations (captured from a real client, 2026-11-22). */
const consultTransaction = () => ({
    type: "transaction",
    transaction: BOT_CONSULT_SPAN,
    request: {
        url: "https://tolaria.example/game?gameId=abc123",
        headers: { "User-Agent": "Mozilla/5.0 (Macintosh) Firefox/147.0" },
    },
    breadcrumbs: [
        { category: "navigation", data: { from: "/", to: "/game" } },
        { category: "console", message: "a console line" },
    ],
    user: { ip_address: "{{auto}}" },
    tags: { anything: "else" },
    extra: { anything: "else" },
    contexts: {
        trace: {
            op: BOT_CONSULT_SPAN,
            trace_id: "d9f58ee1a74d42649151c9f443465e2c",
            data: { gameId: "abc123", consult: 1 },
        },
        culture: { locale: "it-IT", timezone: "Europe/Rome" },
        react: { version: "19.2.6" },
    },
    sdk: { name: "sentry.javascript.react" },
    environment: "production",
});

describe("scrubBotConsultTransaction", () => {
    it("strips a consult's transaction to its trace context", () => {
        const scrubbed = scrubBotConsultTransaction(consultTransaction());
        expect(scrubbed).toEqual({
            type: "transaction",
            transaction: BOT_CONSULT_SPAN,
            contexts: {
                trace: {
                    op: BOT_CONSULT_SPAN,
                    trace_id: "d9f58ee1a74d42649151c9f443465e2c",
                    data: { gameId: "abc123", consult: 1 },
                },
            },
            sdk: { name: "sentry.javascript.react" },
            environment: "production",
        });
        expect(JSON.stringify(scrubbed)).not.toMatch(
            /Mozilla|tolaria\.example|console line|Europe\/Rome|ip_address/
        );
    });

    it("knows a consult by its op when the name was changed", () => {
        const renamed = { ...consultTransaction(), transaction: "renamed" };
        expect(scrubBotConsultTransaction(renamed)).not.toHaveProperty(
            "request"
        );
    });

    it("leaves any other transaction as it came", () => {
        const pageLoad = {
            ...consultTransaction(),
            transaction: GAME_ROUTE,
            contexts: { trace: { op: "pageload" }, culture: { locale: "it" } },
        };
        const before = JSON.stringify(pageLoad);
        expect(scrubBotConsultTransaction(pageLoad)).toBe(pageLoad);
        expect(JSON.stringify(pageLoad)).toBe(before);
    });
});

/** A page-load transaction as the SDK builds it (captured from a real
 *  client, 2026-11-22), with the breadcrumbs a session leaves. */
const pageLoadTransaction = () => ({
    type: "transaction",
    transaction: GAME_ROUTE,
    request: {
        url: "https://tolaria.example/game?gameId=abc123",
        headers: { "User-Agent": "Mozilla/5.0 (Macintosh) Firefox/147.0" },
    },
    breadcrumbs: [
        { category: "navigation", data: { from: "/", to: "/game" } },
        {
            category: "ui.click",
            message: 'div.board > img.card[alt="Lightning Bolt"]',
        },
        { category: "console", message: "a console line" },
    ],
    contexts: {
        trace: { op: "pageload", trace_id: "50a130bc" },
        culture: { locale: "it-IT", timezone: "Europe/Rome" },
    },
    spans: [{ op: "resource.script", description: "/assets/index.js" }],
});

describe("withoutBreadcrumbs", () => {
    it("takes the session's breadcrumbs off a transaction and nothing else", () => {
        const { breadcrumbs: _dropped, ...rest } = pageLoadTransaction();
        void _dropped;
        const sent = withoutBreadcrumbs(pageLoadTransaction());
        expect(sent).toEqual(rest);
        // A clicked card's name rode in a click breadcrumb.
        expect(JSON.stringify(sent)).not.toMatch(/Lightning Bolt/);
    });
});

describe("sendableTransaction", () => {
    it("drops a transaction from an automated browser and passes any other through", () => {
        const event = { type: "transaction", transaction: GAME_ROUTE };
        expect(sendableTransaction(event, automated)).toBeNull();
        expect(sendableTransaction(event, human)).toBe(event);
    });

    it("sends no transaction with breadcrumbs: a page load keeps the rest, a consult only its trace", () => {
        const pageLoad = sendableTransaction(pageLoadTransaction(), human);
        expect(pageLoad).not.toHaveProperty("breadcrumbs");
        expect(pageLoad).toHaveProperty("request");
        expect(pageLoad).toHaveProperty("spans");

        const consult = sendableTransaction(consultTransaction(), human);
        expect(consult).not.toHaveProperty("breadcrumbs");
        expect(consult).not.toHaveProperty("request");
    });
});

describe("isAutomatedBrowser", () => {
    it("reads the browser's own automation flag", () => {
        expect(isAutomatedBrowser({ webdriver: true })).toBe(true);
        expect(isAutomatedBrowser({ webdriver: false })).toBe(false);
        expect(isAutomatedBrowser({})).toBe(false);
        expect(isAutomatedBrowser(undefined)).toBe(false);
    });
});
