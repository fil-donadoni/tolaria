import { describe, expect, it, vi } from "vitest";
import {
    getChooseableCardNames,
    lookupCardNameInIndex,
    registerCompiledShard,
    tryGetCardByName,
} from "@convex/cards/catalogue";
import { withTemporaryDefinition } from "@convex/cards/registry";
import type { CardDefinition } from "@convex/cards/types";
import type { CompiledShard } from "@convex/cards/compiledShard";
import { isLegalNamedCard } from "@convex/gre/pendingChoiceSubmit";
import type { PendingChoice } from "@convex/gre/state";

// A CLIENT graph, as `compiledArrivalOrder.test.ts`: the index comes from a
// shard, so the choice domain is exactly what its `chooseableNames` carry.
vi.mock("@convex/cards/compiledPool", () => import("../compiled-pool.browser"));
vi.mock("@convex/cards/setModules", () => import("../set-modules.browser"));

const FRONT_ID = "00000000-0000-4000-8000-0000000000aa";
const FRONT = "Meld Front Half";
const COMBINED = "Meld Combined Colossus";

/** Issue #7640, CR 712.19 — the combined back face name is choosable on both
 *  doors (candidate list, submit gate) yet resolves to no card (CR 712.4b). */
describe("a meld pair's combined name in the name-choice domain (CR 712.19)", () => {
    registerCompiledShard(
        {
            key: "meld-test",
            ids: [FRONT_ID],
            names: [FRONT],
            lookups: {
                twinNames: {},
                chooseableNames: { [FRONT_ID]: [FRONT, COMBINED] },
                backFaceTriggers: {},
            },
            blockRows: 8,
            rowCount: 1,
            blocks: "",
            blockOffsets: [0],
            firstIds: [],
        } as CompiledShard,
        () => new Uint8Array()
    );
    const head = { kind: "name-card" } as PendingChoice;
    const state = { stagedEntries: [] };

    it("the candidate list offers it", () => {
        expect(getChooseableCardNames()).toContain(COMBINED);
    });

    it("the submit gate accepts it, case-insensitively", () => {
        expect(lookupCardNameInIndex(COMBINED.toLowerCase())).toEqual({
            kind: "meld-back",
            id: FRONT_ID,
            name: COMBINED,
        });
        // The restriction reads the combined face's types, so the front's
        // definition must resolve (the shard's blocks are empty here).
        const front = {
            id: FRONT_ID,
            name: FRONT,
            types: ["Land"],
            backFace: { kind: "meld", name: COMBINED, types: ["Planeswalker"] },
        } as CardDefinition;
        withTemporaryDefinition(front, () => {
            expect(isLegalNamedCard(state, head, COMBINED)).toBe(true);
            expect(
                isLegalNamedCard(
                    state,
                    { ...head, nameRestriction: "no-land" } as PendingChoice,
                    COMBINED
                )
            ).toBe(true);
        });
        // ...and rejects on the combined face's types, not the front's.
        const landBack = {
            ...front,
            types: ["Creature"],
            backFace: { kind: "meld", name: COMBINED, types: ["Land"] },
        } as CardDefinition;
        withTemporaryDefinition(landBack, () => {
            expect(
                isLegalNamedCard(
                    state,
                    { ...head, nameRestriction: "no-land" } as PendingChoice,
                    COMBINED
                )
            ).toBe(false);
        });
    });

    it("is a lookup key of no card", () => {
        expect(tryGetCardByName(COMBINED)).toBeNull();
    });
});
