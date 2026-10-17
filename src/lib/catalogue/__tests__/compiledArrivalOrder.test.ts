import { describe, it, expect, vi } from "vitest";
import {
    catalogueIdByName,
    getAllCardNames,
    registerCompiledShard,
} from "@convex/cards/catalogue";
import type { CompiledShard } from "@convex/cards/compiledShard";
import { twinDefinitionId } from "@convex/cards/twinId";

// A CLIENT graph (no bundled corpus), where nothing has installed the
// compiled index: every compiled name comes from the shards, in the order
// they arrive.
vi.mock("@convex/cards/compiledPool", () => import("../compiled-pool.browser"));
vi.mock("@convex/cards/setModules", () => import("../set-modules.browser"));

/**
 * Issue #5616 — a client installs the compiled index a shard at a time, in
 * whatever order a game asks for them, and must end where the server's one
 * id-ordered corpus is: a printed name beats a twin's, and between two twins
 * of different cards the lower row wins. Shards hand-made here so both
 * collisions are certain and both arrival orders are played; only the index
 * is read, so the blocks are empty.
 */

const id = (n: number) =>
    `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function shard(
    key: string,
    rows: readonly { id: string; name: string; twins?: [string, string][] }[]
): CompiledShard {
    return {
        key,
        ids: rows.map((r) => r.id),
        names: rows.map((r) => r.name),
        lookups: {
            twinNames: Object.fromEntries(
                rows.filter((r) => r.twins).map((r) => [r.id, r.twins!])
            ),
            chooseableNames: {},
            backFaceTriggers: {},
        },
        blockRows: 8,
        rowCount: rows.length,
        blocks: "",
        blockOffsets: [0],
        firstIds: [],
    };
}

const noDictionary = () => new Uint8Array();

describe("compiled name precedence is arrival-order free (issue #5616)", () => {
    it("between two twins the lower row wins — the higher one's shard arriving FIRST", () => {
        const low = twinDefinitionId(id(1), "split-left");
        const high = twinDefinitionId(id(2), "split-left");
        registerCompiledShard(
            shard("bbb", [
                {
                    id: id(2),
                    name: "Zq High // Card",
                    twins: [["zq fire", high]],
                },
            ]),
            noDictionary
        );
        expect(catalogueIdByName("zq fire")).toBe(high);
        registerCompiledShard(
            shard("aaa", [
                {
                    id: id(1),
                    name: "Zq Low // Card",
                    twins: [["zq fire", low]],
                },
            ]),
            noDictionary
        );
        expect(catalogueIdByName("zq fire")).toBe(low);
    });

    it("a printed name beats a twin's, whichever arrives first", () => {
        const twin = twinDefinitionId(id(3), "adventure");
        registerCompiledShard(
            shard("ccc", [
                { id: id(3), name: "Zq Giant", twins: [["zq stomp", twin]] },
            ]),
            noDictionary
        );
        registerCompiledShard(
            shard("ddd", [{ id: id(9), name: "Zq Stomp" }]),
            noDictionary
        );
        expect(catalogueIdByName("zq stomp")).toBe(id(9));

        // And the other way round: the printed name is never displaced.
        registerCompiledShard(
            shard("eee", [{ id: id(5), name: "Zq Bolt" }]),
            noDictionary
        );
        registerCompiledShard(
            shard("fff", [
                {
                    id: id(4),
                    name: "Zq Lightning",
                    twins: [["zq bolt", twinDefinitionId(id(4), "adventure")]],
                },
            ]),
            noDictionary
        );
        expect(catalogueIdByName("zq bolt")).toBe(id(5));
    });

    it("the enumerated names are in id order, not arrival order", () => {
        expect(getAllCardNames().slice(-6)).toEqual([
            "Zq Low // Card",
            "Zq High // Card",
            "Zq Giant",
            "Zq Lightning",
            "Zq Bolt",
            "Zq Stomp",
        ]);
    });
});
