// Frontend wiring analysis for Urza's Saga (issue #1884) — the reducer half.
//
// The card's ENTIRE affordance surface is GRANTED: chapters I and II give the
// Saga a mana ability and a token-maker it does not print (CR 611.2c). That is
// exactly the seam `.claude/rules/gre-development.md` § Frontend wiring
// analysis exists for, and the one #1880's review found three separate
// client-side gaps in — a card fully correct in the GRE with no affordance on
// the board at all.
//
// Every assertion below is driven THROUGH the real reducers — the server state
// is projected with `projectPublicState`, the view is built with
// `buildTriggerStateView`, and the menu comes from `getStackAbilities`. A
// hand-built view would mask a dropped field, so it would not count.

import { describe, it, expect } from "vitest";
import {
    buildTriggerStateView,
    getStackAbilities,
    hasManaAbility,
} from "../card-utils";
import { urzasSaga } from "@convex/cards/sets/mh2/colorless";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "@convex/cards/__tests__/setup";
import {
    processPendingActionTriggers,
    resolveTopOfStack,
} from "@convex/gre/state";
import type { GameState } from "@convex/gre/state";
import { advanceSagasAtPrecombatMain, LORE_COUNTER } from "@convex/gre/sagas";
import { projectPublicState } from "@convex/gameProjections";
import { bloodMoon } from "@convex/cards/sets/drk/red";
import { applySourceStaticEffects } from "@convex/gre/state";
import { buildPreviewBody } from "../preview-body";
import type { CardInstance } from "~/types/game";

/** A real server-side board with the Saga at `lore` counters, advanced one
 *  chapter through the production turn-based action, then PROJECTED. Returns
 *  what the client actually receives. */
function projectedAfterChapter(lore: number) {
    const saga = makeInstance(urzasSaga.id, {
        id: "saga-1",
        controllerId: "p1",
        ownerId: "p1",
        zone: "battlefield",
        counters: { [LORE_COUNTER]: lore },
    });
    const state: GameState = makeState({
        players: [makePlayer("p1", { battlefield: [saga] }), makePlayer("p2")],
    });
    advanceSagasAtPrecombatMain(state);
    processPendingActionTriggers(state);
    resolveTopOfStack(state);

    const projected = projectPublicState(state, 1, "p1");
    const slim = projected.players[0].battlefield.find(
        (c) => c.id === "saga-1"
    )! as unknown as CardInstance;
    const view = buildTriggerStateView(
        projected.players.map((p) => ({
            id: p.id,
            life: p.life,
            hand: p.hand ?? [],
            battlefield: p.battlefield as unknown as CardInstance[],
            graveyard: p.graveyard as unknown as CardInstance[],
        })),
        projected.activePlayerId
    );
    return { projected, slim, view };
}

describe("Urza's Saga — granted affordances survive the client reducers (issue #1884)", () => {
    it("before any chapter, the client sees no mana ability on the Saga", () => {
        const saga = makeInstance(urzasSaga.id, {
            id: "saga-1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const state: GameState = makeState({
            players: [
                makePlayer("p1", { battlefield: [saga] }),
                makePlayer("p2"),
            ],
        });
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "saga-1"
        )! as unknown as CardInstance;
        expect(hasManaAbility(slim)).toBe(false);
    });

    it('after chapter I, the client mirror sees the granted "{T}: Add {C}"', () => {
        // The load-bearing assertion: `hasManaAbility` (src/lib/card-utils.ts)
        // reads the POST-LAYER effective ability set since #1880. Reading
        // `cardDef.activatedAbilities` instead would return false here and the
        // Saga would render as a land you cannot tap.
        const { slim, view } = projectedAfterChapter(0);
        expect(slim.counters?.[LORE_COUNTER]).toBe(1);
        expect(hasManaAbility(slim, view)).toBe(true);
    });

    it("after chapter II, the tap/context menu offers the Construct maker", () => {
        const { slim, view, projected } = projectedAfterChapter(1);
        expect(slim.counters?.[LORE_COUNTER]).toBe(2);
        const offered = getStackAbilities(slim, projected.phase, true, view);
        expect(offered.map((a) => a.id)).toContain("urzas-saga-construct");
    });

    it("the Construct maker is NOT offered before chapter II resolves", () => {
        const { slim, view, projected } = projectedAfterChapter(0);
        const offered = getStackAbilities(slim, projected.phase, true, view);
        expect(offered.map((a) => a.id)).not.toContain("urzas-saga-construct");
    });
});

describe("Urza's Saga under Blood Moon — the preview shows the LIVE text (CR 613.1f)", () => {
    /** Chapter I resolves (granting "{T}: Add {C}"), THEN Blood Moon lands and
     *  strips the land, and the whole board is PROJECTED — so every assertion
     *  reads exactly what the client receives. */
    function projectedUnderBloodMoon() {
        const saga = makeInstance(urzasSaga.id, {
            id: "saga-1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const state: GameState = makeState({
            players: [
                makePlayer("p1", { battlefield: [saga] }),
                makePlayer("p2"),
            ],
        });
        advanceSagasAtPrecombatMain(state);
        processPendingActionTriggers(state);
        resolveTopOfStack(state); // chapter I — grants "{T}: Add {C}"

        const moon = makeInstance(bloodMoon.id, {
            id: "moon-1",
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
        });
        state.players[1].battlefield.push(moon);
        applySourceStaticEffects(state, moon);

        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "saga-1"
        )! as unknown as CardInstance;
        return { projected, slim };
    }

    it("stops printing the card's oracle text while its abilities are stripped", () => {
        const { slim } = projectedUnderBloodMoon();
        const body = buildPreviewBody(urzasSaga.id, slim);
        // The printed paragraphs describe three chapters the card no longer
        // has; the structured block below carries the live picture instead.
        expect(body.oracleParagraphs).toBeNull();
        expect(body.hasBody).toBe(true);
    });

    it("marks the chapter abilities AND the mana ability its own chapter I granted as lost", () => {
        const { slim } = projectedUnderBloodMoon();
        const body = buildPreviewBody(urzasSaga.id, slim);
        const granted = body.bodyAbilities.activated.find(
            (a) => a.id === "urzas-saga-mana"
        );
        // Granted BEFORE the Moon applied, so the Moon removes it (CR 613.7) —
        // the exact case the engine used to keep and the preview to advertise.
        expect(granted?.state).toBe("lost");
        expect(body.bodyAbilities.triggered.length).toBeGreaterThan(0);
        expect(
            body.bodyAbilities.triggered.every((t) => t.state === "lost")
        ).toBe(true);
    });

    it("still prints the oracle text of the SAME card with no Moon on the board", () => {
        // Guards against the suppression branch swallowing the normal case.
        const { slim } = projectedAfterChapter(0);
        const body = buildPreviewBody(urzasSaga.id, slim);
        expect(body.oracleParagraphs).not.toBeNull();
        expect(
            body.bodyAbilities.activated.find((a) => a.id === "urzas-saga-mana")
                ?.state
        ).toBe("granted");
    });
});
