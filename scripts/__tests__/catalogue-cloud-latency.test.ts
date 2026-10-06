/**
 * The refusals and statistics behind `bun run perf:catalogue-cloud` (issue
 * #4167, ADR 0113 Amendment III § Decision 5). The script itself needs the
 * network and a cloud deployment, so it runs in no suite; what decides whether
 * it may push, and whether its number is a verdict, is pure and pinned here.
 */
import { describe, expect, it } from "vitest";
import type { CardDefinition } from "../../convex/cards/types";
import { blockFor } from "../../convex/cards/packedCorpus";
import {
    catalogueVerdict,
    deckIds,
    deploymentRefusal,
    quantile,
    summarizeCase,
    synthesizeRows,
    verdictRefusal,
} from "../lib/catalogue-cloud-latency";
import { packCorpus } from "../lib/packed-corpus";

const row = (id: string, name: string) =>
    ({ id, name, setCode: "tst" }) as unknown as CardDefinition;

const ROWS = [
    row("1a2b3c4d-0000-4000-8000-000000000001", "Alpha"),
    row("5e6f7a8b-0000-4000-8000-000000000002", "Beta"),
    row("9c0d1e2f-0000-4000-8000-000000000003", "Gamma"),
];

describe("deploymentRefusal — only a named throwaway cloud dev deployment", () => {
    it("accepts dev:<name>", () => {
        expect(deploymentRefusal("dev:happy-otter-123", [])).toBeNull();
    });

    it.each([
        "prod:happy-otter-123",
        "preview:happy-otter-123",
        "local:local-filippo",
        "happy-otter-123",
        "dev:happy-otter-123|eyJ2MiI6IjEyMyJ9",
        "",
    ])("refuses %j", (deployment) => {
        expect(deploymentRefusal(deployment, [])).toMatch(/refusing/);
    });

    it("refuses a deployment the repository's env files target", () => {
        expect(deploymentRefusal("dev:app-dev-1", ["dev:app-dev-1"])).toMatch(
            /env files target it/
        );
    });
});

describe("verdictRefusal — a verdict only from Convex cloud", () => {
    it("accepts the deployment's own *.convex.cloud URL", () => {
        expect(
            verdictRefusal("https://happy-otter-123.convex.cloud")
        ).toBeNull();
        expect(
            verdictRefusal("https://happy-otter-123.eu-west-1.convex.cloud")
        ).toBeNull();
    });

    it.each([
        "http://127.0.0.1:3210",
        "http://localhost:3210",
        "https://convex.example.org",
        "http://happy-otter-123.convex.cloud",
        "https://convex.cloud.example.org",
    ])("refuses %s", (url) => {
        expect(verdictRefusal(url)).toMatch(/no verdict/);
    });

    it("refuses a deployment that reports no URL", () => {
        expect(verdictRefusal(undefined)).toMatch(/no verdict/);
    });
});

describe("synthesizeRows — a uniquified catalogue the packer accepts", () => {
    const rows = synthesizeRows(ROWS, 8);

    it("reaches the target with unique ids and names, sorted by id", () => {
        expect(rows).toHaveLength(8);
        expect(new Set(rows.map((r) => r.id)).size).toBe(8);
        expect(new Set(rows.map((r) => r.name)).size).toBe(8);
        const ids = rows.map((r) => r.id);
        expect(ids).toEqual([...ids].sort());
    });

    it("keeps every id a UUID the packed lookup resolves", () => {
        const packed = packCorpus(rows, "h", 2);
        for (const r of rows) {
            expect(blockFor(packed, r.id)).toBeGreaterThanOrEqual(0);
            expect(r.id).toMatch(
                /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
            );
        }
    });

    it("spreads deck ids across distinct blocks", () => {
        const packed = packCorpus(rows, "h", 2);
        const ids = deckIds(rows, 4);
        expect(new Set(ids.map((id) => blockFor(packed, id))).size).toBe(4);
    });
});

describe("statistics and verdict", () => {
    it("quantile is nearest-rank", () => {
        const values = [5, 1, 4, 2, 3, 10, 9, 8, 7, 6];
        expect(quantile(values, 0.5)).toBe(5);
        expect(quantile(values, 0.9)).toBe(9);
    });

    it("summarizes the paired difference from the empty mutation", () => {
        const s = summarizeCase("deck", [130, 140, 150], [100, 100, 130]);
        expect(s).toEqual({ label: "deck", medianMs: 30, p90Ms: 40 });
    });

    it("judges every case's median against the budget", () => {
        const ok = { label: "a", medianMs: 100, p90Ms: 400 };
        const over = { label: "b", medianMs: 100.5, p90Ms: 101 };
        expect(catalogueVerdict([ok])).toBe("PASS");
        expect(catalogueVerdict([ok, over])).toBe("FAIL");
    });
});
