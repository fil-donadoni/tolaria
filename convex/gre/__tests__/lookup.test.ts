// The lookup leaf (issue #4452): the engine's player / permanent / any-zone
// finders and instance-id allocation, importable WITHOUT the core (`./state`)
// and therefore without joining its import cycle.
//
// Three things are pinned here: what the helpers return (CR 400.1 zones), that
// the leaf and the two modules moved onto it stay off the core at runtime (the
// import graph, read from the source files), and the findings-1969 scenario —
// a card whose Effect Script reads an engine constant at module-evaluation
// time must see the constant whichever module the bundle happens to start
// from (`docs/findings/1969-figure-of-fable-import-cycle.md`).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import type { CardInstanceState } from "../state/declarations";
import * as core from "../state";
import {
    ZONE_TO_FIELD,
    allPermanents,
    allocInstanceId,
    findCardInAnyZone,
    findCardInGraveyardOrExile,
    findOnBattlefield,
    findPermanent,
    getOpponentId,
    getPlayer,
} from "../lookup";
import { makePlayer, makeState } from "../../cards/__tests__/setup";

const GRE_DIR = resolve(__dirname, "..");

function card(id: string): CardInstanceState {
    return { id } as CardInstanceState;
}

function boardState() {
    return makeState({
        players: [
            makePlayer("p1", {
                battlefield: [card("bf1"), card("bf2")],
                hand: [card("h1")],
                library: [card("l1")],
            }),
            makePlayer("p2", {
                battlefield: [card("bf3")],
                graveyard: [card("g1")],
                exile: [card("e1")],
            }),
        ],
    });
}

describe("lookup leaf — finders (CR 400.1)", () => {
    it("getPlayer finds by id and throws on an unknown one", () => {
        const state = boardState();
        expect(getPlayer(state, "p2")).toBe(state.players[1]);
        expect(() => getPlayer(state, "nobody")).toThrow(
            "Player not found: nobody"
        );
    });

    it("getOpponentId returns the other player", () => {
        const state = boardState();
        expect(getOpponentId(state, "p1")).toBe("p2");
        expect(getOpponentId(state, "p2")).toBe("p1");
    });

    it("allocInstanceId increments the counter it is given", () => {
        const counter: { nextInstanceId?: number } = {};
        expect(allocInstanceId(counter)).toBe("1");
        expect(allocInstanceId(counter)).toBe("2");
        expect(counter.nextInstanceId).toBe(2);
    });

    it("allPermanents walks every battlefield in player order", () => {
        expect([...allPermanents(boardState())].map((c) => c.id)).toEqual([
            "bf1",
            "bf2",
            "bf3",
        ]);
    });

    it("findPermanent / findOnBattlefield search only the battlefield", () => {
        const state = boardState();
        expect(findPermanent(state, "bf3")).toBe(
            state.players[1].battlefield[0]
        );
        expect(findPermanent(state, "g1")).toBeUndefined();
        const hit = findOnBattlefield(state, "bf2");
        expect(hit?.player).toBe(state.players[0]);
        expect(hit?.idx).toBe(1);
        expect(findOnBattlefield(state, "h1")).toBeNull();
    });

    it("findCardInGraveyardOrExile reads only the public non-battlefield zones", () => {
        const state = boardState();
        expect(findCardInGraveyardOrExile(state, "g1")?.id).toBe("g1");
        expect(findCardInGraveyardOrExile(state, "e1")?.id).toBe("e1");
        expect(findCardInGraveyardOrExile(state, "bf1")).toBeUndefined();
        expect(findCardInGraveyardOrExile(state, "h1")).toBeUndefined();
    });

    it("findCardInAnyZone reaches every per-player zone, hidden ones included", () => {
        const state = boardState();
        for (const id of ["bf1", "bf3", "g1", "e1", "h1", "l1"]) {
            expect(findCardInAnyZone(state, id)?.id).toBe(id);
        }
        expect(findCardInAnyZone(state, "missing")).toBeUndefined();
    });

    it("ZONE_TO_FIELD maps each per-player zone to its PlayerState array", () => {
        const state = boardState();
        for (const [zone, field] of Object.entries(ZONE_TO_FIELD)) {
            expect(zone).toBe(field);
            expect(Array.isArray(state.players[0][field])).toBe(true);
        }
    });

    it("the core re-exports the leaf's helpers, not copies of them", () => {
        expect(core.getPlayer).toBe(getPlayer);
        expect(core.getOpponentId).toBe(getOpponentId);
        expect(core.allocInstanceId).toBe(allocInstanceId);
        expect(core.findPermanent).toBe(findPermanent);
        expect(core.findOnBattlefield).toBe(findOnBattlefield);
        expect(core.findCardInAnyZone).toBe(findCardInAnyZone);
    });
});

/** The module specifiers `file` imports or re-exports at RUNTIME — every
 *  import / export-from declaration except the ones erased at compile time
 *  (`import type`, or an import whose every named binding is `type`). */
function runtimeImports(file: string): string[] {
    const source = ts.createSourceFile(
        file,
        readFileSync(resolve(GRE_DIR, file), "utf-8"),
        ts.ScriptTarget.Latest
    );
    const out: string[] = [];
    for (const stmt of source.statements) {
        if (ts.isImportDeclaration(stmt)) {
            const clause = stmt.importClause;
            if (clause?.isTypeOnly) continue;
            const named = clause?.namedBindings;
            const allTypeNamed =
                clause !== undefined &&
                clause.name === undefined &&
                named !== undefined &&
                ts.isNamedImports(named) &&
                named.elements.length > 0 &&
                named.elements.every((e) => e.isTypeOnly);
            if (allTypeNamed) continue;
            out.push((stmt.moduleSpecifier as ts.StringLiteral).text);
        } else if (
            ts.isExportDeclaration(stmt) &&
            stmt.moduleSpecifier &&
            !stmt.isTypeOnly
        ) {
            out.push((stmt.moduleSpecifier as ts.StringLiteral).text);
        }
    }
    return out;
}

describe("lookup leaf — import graph", () => {
    it.each(["lookup.ts", "protectionQualities.ts"])(
        "the leaf %s imports nothing at runtime, so it can never join a cycle",
        (file) => {
            expect(runtimeImports(file)).toEqual([]);
        }
    );

    it("gre/protection takes its quality strings from the leaf BEFORE it enters the registry cycle", () => {
        const specs = runtimeImports("protection.ts");
        expect(specs.indexOf("./protectionQualities")).toBe(0);
    });

    it.each(["rebound.ts", "triggers.ts"])(
        "%s value-imports the lookup leaf, never the core",
        (file) => {
            const specs = runtimeImports(file);
            expect(specs).toContain("./lookup");
            expect(specs).not.toContain("./state");
        }
    );
});

describe("findings-1969 — an Op field read at module evaluation (issue #1969)", () => {
    // Figure of Fable's final stage grants `PROTECTION_FROM_EACH_OPPONENT`, a
    // constant its set module reads out of `gre/protection` while building
    // the card literal. `gre/protection` sits in a cycle with the card
    // registry, so the value the card sees depended on which module was
    // evaluated first; the wrong order shipped a `grantAbility` with no
    // `ability`. Each entry below starts a FRESH module graph from a
    // different engine module and reads the card back.
    it.each([
        "../protection",
        "../lookup",
        "../rebound",
        "../triggers",
        "../state",
    ])(
        "entered from %s, Figure of Fable's grantAbility carries its ability",
        async (entry) => {
            vi.resetModules();
            await import(/* @vite-ignore */ entry);
            const { figureOfFable } =
                await import("../../cards/sets/ecl/multicolor");
            const grants: unknown[] = [];
            JSON.stringify(figureOfFable, (_k, v) => {
                if (v && typeof v === "object" && v.op === "grantAbility") {
                    grants.push(v);
                }
                return v;
            });
            expect(grants).toEqual([
                {
                    op: "grantAbility",
                    target: { ref: "$source" },
                    ability: "protection from each of your opponents",
                },
            ]);
        },
        60_000
    );
});
