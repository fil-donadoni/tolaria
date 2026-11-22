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
    dropAutomatedTransaction,
    isAutomatedBrowser,
    tracesSamplerFor,
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

describe("dropAutomatedTransaction", () => {
    it("drops a transaction from an automated browser and passes any other through", () => {
        const event = { type: "transaction", transaction: GAME_ROUTE };
        expect(dropAutomatedTransaction(event, automated)).toBeNull();
        expect(dropAutomatedTransaction(event, human)).toBe(event);
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
