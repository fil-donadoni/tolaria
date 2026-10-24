// `EffectCardFilter.hasFlashback`, the quality of Quiet Speculation's "up to
// three cards with flashback" (CR 702.34a). The search it narrows leaves the
// find optional:
//
//  1. SEARCH — a filtered `search-library` choice offers exactly the library
//     cards carrying a flashback cost, through the real `getLibraryCards`
//     reader and `resolveTopOfStack`; a pick outside that set is refused.
//  2. VALIDATOR — honest only at hidden-zone sites: a battlefield selector
//     would fail OPEN (`toPermanentFilter` has no mapping), so it is rejected.

import { describe, it, expect } from "vitest";
import type { EffectOp } from "../../../cards/types";
import { registerTokenDefinition } from "../../../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../cards/__tests__/setup.helper";
import { resolveTopOfStack } from "../../state";
import { applyPendingChoiceSubmit } from "../../pendingChoiceSubmit";
import { validateEffectScript, type EffectScriptHost } from "../validate";

const FLASHBACK_ID = "test-hasflashback-card";
registerTokenDefinition({
    id: FLASHBACK_ID,
    name: FLASHBACK_ID,
    rarity: "common",
    manaCost: { U: 1 },
    types: ["Sorcery"],
    flashback: { R: 1 },
    effects: [],
});
const PLAIN_ID = "test-hasflashback-plain";
registerTokenDefinition({
    id: PLAIN_ID,
    name: PLAIN_ID,
    rarity: "common",
    manaCost: { U: 1 },
    types: ["Sorcery"],
    effects: [],
});

const searchOps: EffectOp[] = [
    {
        op: "choice",
        kind: "search-library",
        player: "controller",
        zone: "library",
        filter: { hasFlashback: true },
        count: { min: 0, max: 3 },
        prompt: "Search your library for up to three cards with flashback.",
        bind: "$found",
    },
];

describe("EffectCardFilter.hasFlashback — library search (CR 701.23a)", () => {
    const setup = () => {
        const script = "test-hasflashback-search";
        registerTokenDefinition({
            id: script,
            name: script,
            rarity: "common",
            manaCost: { R: 1 },
            types: ["Sorcery"],
            effects: searchOps,
        });
        const library = [
            ["fb1", FLASHBACK_ID],
            ["plain1", PLAIN_ID],
            ["fb2", FLASHBACK_ID],
        ].map(([id, cardId]) =>
            makeInstance(cardId!, {
                id: id!,
                controllerId: "p1",
                ownerId: "p1",
                zone: "library",
            })
        );
        const state = makeState({
            players: [makePlayer("p1", { library }), makePlayer("p2")],
        });
        pushSpell(state, script, "p1");
        expect(resolveTopOfStack(state)).toBeNull();
        return { state, head: state.pendingChoices![0]! };
    };

    it("offers exactly the cards with a flashback cost", () => {
        const { head } = setup();
        expect([...(head.candidateIds ?? [])].sort()).toEqual(["fb1", "fb2"]);
    });

    it("refuses a pick outside the flashback set", () => {
        const { state, head } = setup();
        const before = structuredClone(state.players[0]!.library);
        let threw = false;
        try {
            applyPendingChoiceSubmit(state, {
                playerId: "p1",
                stackItemId: head.stackItemId,
                step: head.step,
                choiceId: head.choiceId,
                cardInstanceIds: ["plain1"],
            });
        } catch {
            threw = true;
        }
        const refused =
            threw ||
            JSON.stringify(state.players[0]!.library) ===
                JSON.stringify(before);
        expect(refused).toBe(true);
        expect(state.pendingChoices?.length ?? 0).toBeGreaterThan(0);
    });
});

describe("EffectCardFilter.hasFlashback — validator honesty", () => {
    const host = (effects: EffectOp[]): EffectScriptHost => ({
        id: "test-host",
        name: "Test Host",
        effects,
    });
    const choiceOn = (zone: string, filter: Record<string, unknown>) =>
        ({
            op: "choice",
            kind: "search-library",
            player: "controller",
            zone,
            filter,
            count: 1,
            prompt: "Pick.",
            bind: "$picked",
        }) as never;

    it("accepts hasFlashback: true on a library choice", () => {
        expect(
            validateEffectScript(
                host([choiceOn("library", { hasFlashback: true })])
            )
        ).toEqual([]);
    });

    it("rejects a non-true value", () => {
        expect(
            validateEffectScript(
                host([choiceOn("library", { hasFlashback: false })])
            ).length
        ).toBeGreaterThan(0);
    });

    it("rejects hasFlashback on a battlefield choice (would fail open)", () => {
        const errors = validateEffectScript(
            host([
                {
                    op: "choice",
                    kind: "choose-permanents",
                    player: "controller",
                    zone: "battlefield",
                    filter: { hasFlashback: true },
                    count: 1,
                    prompt: "Pick.",
                    bind: "$picked",
                } as never,
            ])
        );
        expect(errors.some((e) => /hasFlashback/.test(e))).toBe(true);
    });
});
