/**
 * Card Field Lifecycle (issue #4453, PRD #4447): the wire format of a card
 * instance, proven against a fixture STORED BEFORE the lifecycle table
 * replaced the hand-written `compactCard` / `expandCard` branches.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { grizzlyBears } from "../../cards/sets/lea/green";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import { compactState } from "../serialize";
import type { GameState, StackItem } from "../state";
import { everyRoundTrippableCardField } from "./fixtures/everyOptionalCardField";

const FIXTURE_PATH = fileURLToPath(
    new URL("./fixtures/cardFieldLifecycle.compact.json", import.meta.url)
);

/** A state whose three card seams — a battlefield permanent, a bestowed Aura
 *  and a stack item — each carry every optional field the seam can emit. */
function cardFieldLifecycleFixtureState(): GameState {
    const every = makeInstance(grizzlyBears.id, {
        id: "cf-every",
        controllerId: "p1",
        ownerId: "p1",
        zone: "battlefield",
        ...everyRoundTrippableCardField(),
    });
    // CR 702.103b / 208.3 — a bestowed object is an Aura with no P/T; the
    // marker is the one field the "every field" instance cannot carry.
    const bestowed = makeInstance(grizzlyBears.id, {
        id: "cf-bestowed",
        controllerId: "p2",
        ownerId: "p2",
        zone: "battlefield",
        types: ["Enchantment"],
        subtypes: ["Aura"],
        power: undefined,
        toughness: undefined,
        bestowed: true,
        attachedTo: "cf-every",
    });
    const spell: StackItem = {
        ...makeInstance(grizzlyBears.id, {
            id: "cf-stack",
            controllerId: "p2",
            ownerId: "p1",
            zone: "stack",
            ...everyRoundTrippableCardField(),
        }),
        castById: "p2",
        targets: [],
    };
    const p1 = makePlayer("p1", { battlefield: [every] });
    const p2 = makePlayer("p2", { battlefield: [bestowed] });
    return makeState({ players: [p1, p2], stack: [spell] });
}

describe("Card Field Lifecycle — wire format (issue #4453)", () => {
    // Byte-identical, not deep-equal: key ORDER is part of the stored
    // document, and a table-driven `compactCard` that emitted the same keys in
    // a different order would still be a wire change. Regenerate ONLY for a
    // deliberate wire migration: `TOLARIA_WRITE_CARD_FIELD_FIXTURE=1`.
    it("compactState output is byte-identical to the fixture stored before the lifecycle table", () => {
        const got =
            JSON.stringify(
                compactState(cardFieldLifecycleFixtureState()),
                null,
                2
            ) + "\n";
        if (process.env.TOLARIA_WRITE_CARD_FIELD_FIXTURE === "1") {
            writeFileSync(FIXTURE_PATH, got);
        }
        expect(got).toBe(readFileSync(FIXTURE_PATH, "utf8"));
    });
});
