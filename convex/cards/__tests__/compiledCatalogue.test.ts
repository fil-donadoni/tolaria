import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getDefinition, tryGetDefinition, tryGetCardByName } from "../index";
import { resolveTopOfStack, type GameState } from "../../gre/state";
import { projectPublicState } from "../../gameProjections";
import {
    assertNoHandWrittenCollision,
    compiledReadyDefinitions,
} from "../compiledCatalogue";
import { getAllCards } from "../catalogue";
import type { CardDefinition } from "../types";
import { makeInstance, makePlayer, makeState } from "./setup";

/**
 * Compiled-card hydration through the single registry seam (issue #2702,
 * PRD #2693, ADR 0108).
 *
 * Coeurl (Final Fantasy, `fin`) is a REAL compiled `ready` row — a plain
 * vanilla-shaped creature with one activated ability compiled to a single
 * `tapUntap` Op — deliberately not something hand-written (this exact
 * assertion is `it("has never been hand-written", ...)` below), so every
 * test here proves the compiled-only path, not a card the hand-written
 * registry would resolve anyway.
 *
 * Proof-of-failure (gre-development.md § Proof-of-failure): commented out
 * `preloadDefinitions(compiledToRegister);` in `convex/cards/catalogue.ts` —
 * the four tests reading `getDefinition`/`makeInstance` for `COEURL_ID` went
 * red with `Error: Card not found: 7604b534-...` (the "resolves by name"
 * test stayed green, since `nameRegistry` construction wasn't touched by
 * that line — a useful confirmation the two seams are independently wired).
 * Reverted after confirming the failure.
 */
const COEURL_ORACLE_ID = "00d1596a-c3e2-4109-86da-388934a0c652";
const COEURL_ID = "7604b534-5480-42fa-bc36-bbae730f8582"; // Scryfall first-print id (fin), per data/card-index.json

describe("compiled `ready` card hydration (issue #2702)", () => {
    it("has never been hand-written (this test proves the compiled-only path, not a hand-written fallback)", () => {
        const src = readFileSync(
            resolve(__dirname, "../../../data/card-index.json"),
            "utf8"
        );
        const entry = (
            JSON.parse(src) as Array<{ oracleId: string; source?: string }>
        ).find((e) => e.oracleId === COEURL_ORACLE_ID);
        expect(entry?.source).toBe("compiled");
    });

    it("resolves through getDefinition/tryGetDefinition exactly like a hand-written card", () => {
        const def = getDefinition(COEURL_ID);
        expect(def.name).toBe("Coeurl");
        expect(def.types).toContain("Creature");
        expect(def.id).toBe(COEURL_ID);
        expect(tryGetDefinition(COEURL_ID)?.name).toBe("Coeurl");
    });

    it("resolves by name — the seam debug scenarios use (convex/debugScenarios.ts's tryGetCardByName)", () => {
        expect(tryGetCardByName("Coeurl")?.id).toBe(COEURL_ID);
        expect(tryGetCardByName("coeurl")?.id).toBe(COEURL_ID); // case-insensitive, same as hand-written lookup
    });

    it("resolves its activated ability through the real stack (GRE entry point, not a hand-built view)", () => {
        const coeurl = makeInstance(COEURL_ID, { id: "coeurl" });
        const target = makeInstance(COEURL_ID, {
            id: "target",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state: GameState = makeState({
            players: [
                makePlayer("p1", { battlefield: [coeurl] }),
                makePlayer("p2", { battlefield: [target] }),
            ],
        });
        const ability = getDefinition(COEURL_ID).activatedAbilities?.[0];
        expect(ability).toBeDefined();
        state.stack.push({
            ...coeurl,
            zone: "stack",
            castById: "p1",
            abilityId: ability!.id,
            targets: [{ type: "permanent", id: "target" }],
        });
        resolveTopOfStack(state);
        expect(
            state.players[1].battlefield.find((c) => c.id === "target")
                ?.isTapped
        ).toBe(true);
    });

    it("projects through the wire format like a hand-written card", () => {
        const coeurl = makeInstance(COEURL_ID, { id: "coeurl" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [coeurl] }),
                makePlayer("p2"),
            ],
        });
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "coeurl"
        )!;
        // The projection strips the fat definition to `{ id }` (gre-development
        // rule "why wire tests are mandatory") — assert the SLIM shape, then
        // resolve it back through the same seam a client reads it with.
        expect(slim.card.id).toBe(COEURL_ID);
        expect(getDefinition(slim.card.id).name).toBe("Coeurl");
    });
});

describe("compiled card id scheme (ADR 0108, issue #2702)", () => {
    it("a compiled row's id is the ADR 0041 first-print id — the SAME id a hand-written CardDefinition for this oracle card would be required to use, so graduation keeps the id", () => {
        const cardIndex = JSON.parse(
            readFileSync(
                resolve(__dirname, "../../../data/card-index.json"),
                "utf8"
            )
        ) as Array<{
            oracleId: string;
            scryfallId: string;
            firstPrintId: string;
            source?: string;
        }>;
        const entry = cardIndex.find((e) => e.oracleId === COEURL_ORACLE_ID)!;
        expect(entry.source).toBe("compiled");
        // ADR 0041's own invariant (`check-card-index.ts` enforces
        // `scryfallId === firstPrintId` for a HAND-WRITTEN row) — a
        // graduating card's `CardDefinition.id` would have to equal this
        // SAME value, so nothing about the id changes on graduation.
        expect(entry.scryfallId).toBe(entry.firstPrintId);
        expect(getDefinition(COEURL_ID).id).toBe(entry.firstPrintId);
    });
});

describe("assertNoHandWrittenCollision (the collision is resolved at BUILD, ADR 0114 §2)", () => {
    const stub = (id: string, name: string): CardDefinition =>
        ({ id, name, rarity: "common", types: ["Creature"] }) as CardDefinition;

    it("passes the pool through untouched when no id collides", () => {
        const compiled = [stub("a", "A"), stub("b", "B")];
        expect(
            assertNoHandWrittenCollision(compiled, new Set(["unrelated"]))
        ).toEqual(compiled);
    });

    it("throws and NAMES the card when a compiled row claims a hand-written id", () => {
        // The old `excludeHandWritten` dropped this row silently. It cannot
        // stay silent: `preloadDefinitions` is last-write-wins and compiled
        // rows are registered AFTER `allCards`, so a filter that stopped
        // filtering would let the compiled row overwrite the definition the
        // engine runs — the one failure this seam exists to prevent.
        expect(() =>
            assertNoHandWrittenCollision(
                [
                    stub("shared-id", "Compiled Twin"),
                    stub("only-compiled", "Only Compiled"),
                ],
                new Set(["shared-id"])
            )
        ).toThrow(/Compiled Twin \(shared-id\)/);
    });

    it("never fires on the REAL pool — the assertion the build makes true", () => {
        // The vacuity guard for the two unit cases above, and the live
        // statement of ADR 0114 §2's claim: on a regenerated tree the two
        // populations are disjoint, which is what makes throwing affordable.
        expect(() =>
            assertNoHandWrittenCollision(
                compiledReadyDefinitions,
                new Set(getAllCards().map((c) => c.id))
            )
        ).not.toThrow();
    });
});
