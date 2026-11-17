// Structural-sharing clone (ADR 0000, issue #108 — vs-AI feasibility slice).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { cloneGameState, SHARED_KEYS } from "../clone";
import { advancePhase } from "../phases";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { getCardByName } from "../../cards";
import type { GameState } from "../state";

const BEARS = getCardByName("Grizzly Bears").id;

function representativeState(): GameState {
    const p1 = makePlayer("p1", {
        battlefield: [
            makeInstance(BEARS, { id: "bear-1", controllerId: "p1" }),
        ],
        hand: [makeInstance(BEARS, { id: "bear-h", zone: "hand" })],
        library: Array.from({ length: 10 }, (_, i) =>
            makeInstance(BEARS, { id: `lib-${i}`, zone: "library" })
        ),
    });
    const p2 = makePlayer("p2");
    return makeState({ players: [p1, p2] });
}

describe("cloneGameState (structural sharing, issue #108)", () => {
    it("produces an independent copy of mutable paths", () => {
        const state = representativeState();
        const clone = cloneGameState(state);

        expect(clone).not.toBe(state);
        expect(clone.players).not.toBe(state.players);
        expect(clone.players[0].battlefield).not.toBe(
            state.players[0].battlefield
        );
        expect(clone.players[0].battlefield[0]).not.toBe(
            state.players[0].battlefield[0]
        );
        // value-equal despite different identity
        expect(clone).toEqual(state);
    });

    it("shares the immutable card-definition reference by identity", () => {
        const state = representativeState();
        const clone = cloneGameState(state);
        expect(clone.players[0].battlefield[0].card).toBe(
            state.players[0].battlefield[0].card
        );
    });

    it("shares the characteristic lists the engine only ever replaces (issue #10026)", () => {
        const state = representativeState();
        const clone = cloneGameState(state);
        const orig = state.players[0].library[0];
        const copy = clone.players[0].library[0];
        expect(copy).not.toBe(orig);
        expect(copy.types).toBe(orig.types);
        expect(copy.subtypes).toBe(orig.subtypes);
        expect(copy.staticAbilities).toBe(orig.staticAbilities);
    });

    it("copies a whole instance held under `card` (StagedEntry), sharing only its definition ref (issue #10026)", () => {
        const state = representativeState();
        const staged = makeInstance(BEARS, { id: "staged", zone: "stack" });
        const withStaged = {
            ...state,
            stagedEntries: [{ card: staged, controllerId: "p1" }],
        } as unknown as GameState;
        const clone = cloneGameState(withStaged);
        const copy = (clone as unknown as typeof withStaged).stagedEntries![0]
            .card;

        expect(copy).not.toBe(staged);
        expect(copy.card).toBe(staged.card);
        copy.zone = "battlefield";
        expect(staged.zone).toBe("stack");
    });

    it("shares exactly the lists named in SHARED_KEYS, and copies a list under any other key", () => {
        const lists = [...SHARED_KEYS].filter((k) => k !== "card");
        const holder = Object.fromEntries(
            [...lists, "colors", "counters"].map((k) => [k, ["x"]])
        );
        const clone = cloneGameState(
            holder as unknown as GameState
        ) as unknown as Record<string, unknown>;
        for (const key of lists) expect(clone[key], key).toBe(holder[key]);
        expect(clone.colors).not.toBe(holder.colors);
        expect(clone.counters).not.toBe(holder.counters);
    });

    it("mutating the clone in place never reaches the original", () => {
        const state = representativeState();
        const clone = cloneGameState(state);

        const copy = clone.players[0].battlefield[0];
        copy.isTapped = true;
        copy.power = 99;
        copy.types = [...copy.types, "Artifact"];
        copy.counters = { "+1/+1": 3 };
        clone.players[0].life = 1;
        clone.players[0].battlefield.push(makeInstance(BEARS, { id: "added" }));

        const origCard = state.players[0].battlefield[0];
        expect(origCard.isTapped).toBe(false);
        expect(origCard.power).toBe(2);
        expect(origCard.types).not.toContain("Artifact");
        expect(origCard.counters).toBeUndefined();
        expect(state.players[0].life).toBe(20);
        expect(state.players[0].battlefield).toHaveLength(1);
    });

    it("survives a real in-place engine move (advancePhase) without aliasing", () => {
        const state = representativeState();
        const clone = cloneGameState(state);
        const phaseBefore = state.phase;

        advancePhase(clone);

        // engine mutated the clone, not the original
        expect(state.phase).toBe(phaseBefore);
        expect(clone.phase).not.toBe(phaseBefore);
    });
});

/** The repository root, from this file's own location. */
const root = fileURLToPath(new URL("../../../", import.meta.url));
const ENGINE_ROOTS = ["convex/gre", "convex/cards"];

/** Receivers that hold a FRESH list built inside the function, never a state
 *  object's own: the layer-2-to-5 derivation (`layers2to5.ts`) copies its
 *  type lines out of the instance before it edits them. */
const FRESH_RECEIVERS = new Set(["result"]);

function engineSources(dir: string): string[] {
    const out: string[] = [];
    for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) {
            if (name === "__tests__") continue;
            out.push(...engineSources(path));
        } else if (name.endsWith(".ts") && !name.endsWith(".test.ts")) {
            out.push(path);
        }
    }
    return out;
}

describe("search aliasing: shared lists are replaced, never mutated (issue #10026)", () => {
    it("no engine source writes into a shared list in place", () => {
        const keys = [...SHARED_KEYS].filter((k) => k !== "card").join("|");
        // `<receiver>.<key>` followed by a mutating call, a length write or
        // an element write.
        const write = new RegExp(
            String.raw`(\w+)\??\.(${keys})\s*(?:\.\s*(?:push|pop|shift|unshift|splice|sort|reverse|fill|copyWithin)\s*\(|\.length\s*=(?!=)|\[[^\]]*\]\s*=(?!=))`,
            "g"
        );
        const offenders: string[] = [];
        for (const dir of ENGINE_ROOTS) {
            for (const file of engineSources(join(root, dir))) {
                const lines = readFileSync(file, "utf8").split("\n");
                lines.forEach((line, i) => {
                    const code = line.trim();
                    if (code.startsWith("//") || code.startsWith("*")) return;
                    for (const m of line.matchAll(write)) {
                        if (FRESH_RECEIVERS.has(m[1])) continue;
                        offenders.push(
                            `${relative(root, file)}:${i + 1}: ${line.trim()}`
                        );
                    }
                });
            }
        }
        expect(offenders).toEqual([]);
    });
});
