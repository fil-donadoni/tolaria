// Issue #9927 — one broken catalogue entry is ONE card. A Definition Index
// entry naming a card its Set module no longer exported threw inside the
// catalogue-wide walk, and the Bot's target-creature search failed for 1,035
// targeted spells. A runtime reader skips the entry; the census walk stays
// strict.

import { afterEach, describe, expect, it, vi } from "vitest";
import type { CardDefinition } from "../types";
import {
    brokenCatalogueEntries,
    catalogueDefinitions,
    registeredDefinitions,
    resolveIsolated,
    withLazyDefinitionSource,
} from "../registry";
import "../catalogue";

const card = (n: number): CardDefinition =>
    ({
        id: `test-broken-entry-${n}`,
        name: `Broken Entry Neighbour ${n}`,
        manaCost: { generic: 1 },
        types: ["Sorcery"],
        effects: [],
    }) as unknown as CardDefinition;

const BROKEN = "test-broken-entry-2";
const STALE =
    "The Definition Index is stale: Retired Card (test-broken-entry-2) is not leg.retiredCard. Run: bun run catalogue:pack";
const rows = [card(1), card(2), card(3)];

/** A catalogue of three whose middle entry throws, as a stale index does. */
const withBrokenSource = <T>(run: () => T): T =>
    withLazyDefinitionSource(
        (id) => {
            if (id === BROKEN) throw new Error(STALE);
            return rows.find((r) => r.id === id) ?? null;
        },
        () => rows.map((r) => r.id),
        run
    );

afterEach(() => vi.restoreAllMocks());

describe("a broken catalogue entry (issue #9927)", () => {
    it("is skipped by a runtime catalogue-wide walk: its neighbours are still yielded, the entry reported once", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const walk = () =>
            withBrokenSource(() =>
                [...registeredDefinitions()]
                    .map((d) => d.id)
                    .filter((id) => id.startsWith("test-broken-entry-"))
            );
        expect(walk()).toEqual(["test-broken-entry-1", "test-broken-entry-3"]);
        expect(walk()).toEqual(["test-broken-entry-1", "test-broken-entry-3"]);
        expect(brokenCatalogueEntries().get(BROKEN)).toBe(STALE);
        expect(
            warn.mock.calls.filter((c) => String(c[0]).includes(BROKEN))
        ).toHaveLength(1);
    });

    it("still throws in the census walk: a census over what is left would pass", () => {
        expect(() =>
            withBrokenSource(() => [...catalogueDefinitions()])
        ).toThrow(STALE);
    });

    it("resolveIsolated hands back the value, or null for a throw", () => {
        vi.spyOn(console, "warn").mockImplementation(() => {});
        expect(resolveIsolated("test-broken-entry-ok", () => 7)).toBe(7);
        expect(
            resolveIsolated("test-broken-entry-throws", () => {
                throw new Error("unreadable row");
            })
        ).toBeNull();
        expect(brokenCatalogueEntries().get("test-broken-entry-throws")).toBe(
            "unreadable row"
        );
    });
});
