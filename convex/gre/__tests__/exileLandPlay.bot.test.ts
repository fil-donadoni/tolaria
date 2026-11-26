// CR 116.2a / 514.2 — a land in exile under a land-inclusive PLAY grant ("you
// may play that card this turn": Laelia, the Blade Reforged's attack trigger)
// is a land the Bot can play, values as material only while it still can, and
// is worth holding the hand land drop for.

import { describe, expect, it } from "vitest";
import { getCardByName } from "../../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { applyMoveForSearch } from "../applyMove";
import { buildBladeState } from "../ai/blade/build";
import { findBladeScenario } from "../ai/blade/registry";
import { runBladeScenario } from "../ai/blade/runner";
import type { BladeScenario } from "../ai/blade/types";
import { evaluate } from "../evaluate";
import { enumerateMoves, onlyPassIsLegal, type Move } from "../moves";
import type { CardInstanceState, GameState } from "../state";

const MOUNTAIN = getCardByName("Mountain").id;

const POSTCOMBAT =
    "expiring exile land: play the exiled land before the hand land (CR 305.2)";
const PRECOMBAT =
    "expiring exile land: hold the hand land drop for Laelia's attack (CR 305.2)";

function entry(label: string): BladeScenario {
    const scenario = findBladeScenario(label);
    if (!scenario) throw new Error(`missing blade entry: ${label}`);
    return scenario;
}

/** p1 in its precombat main with nothing but one exiled Mountain, in the
 *  exile of `zoneOwner`, under the grant `grant` names. */
function exiledLandBoard(
    grant: "play" | "cast-only" | "none",
    zoneOwner: "p1" | "p2" = "p1"
): GameState {
    const land: CardInstanceState = makeInstance(MOUNTAIN, {
        controllerId: zoneOwner,
        ownerId: zoneOwner,
        id: "exiled-land",
        zone: "exile",
        ...(grant === "none"
            ? {}
            : {
                  castableFromExileBy: "p1",
                  castableFromExileUntilTurn: 3,
                  ...(grant === "play"
                      ? { castableFromExileIncludesLand: true }
                      : {}),
              }),
    });
    return makeState({
        turn: 3,
        players: [
            makePlayer("p1", zoneOwner === "p1" ? { exile: [land] } : {}),
            makePlayer("p2", zoneOwner === "p2" ? { exile: [land] } : {}),
        ],
    });
}

const PLAY_EXILED: Move = { kind: "play-land", cardInstanceId: "exiled-land" };

describe("a land in exile under a play grant is enumerated (CR 116.2a)", () => {
    it("a land-inclusive grant offers its play-land move", () => {
        expect(enumerateMoves(exiledLandBoard("play"), "p1")).toContainEqual(
            PLAY_EXILED
        );
    });

    it("a cross-player grant offers it to the grant holder", () => {
        expect(
            enumerateMoves(exiledLandBoard("play", "p2"), "p1")
        ).toContainEqual(PLAY_EXILED);
    });

    it("a cast-only grant, or none, offers no play", () => {
        for (const grant of ["cast-only", "none"] as const) {
            expect(
                enumerateMoves(exiledLandBoard(grant), "p1")
            ).not.toContainEqual(PLAY_EXILED);
        }
    });

    it("the land drop spent, it is no longer offered (CR 305.2)", () => {
        const state = exiledLandBoard("play");
        state.players[0].landsPlayedThisTurn = 1;
        expect(enumerateMoves(state, "p1")).not.toContainEqual(PLAY_EXILED);
    });
});

describe("onlyPassIsLegal sees the exiled land play", () => {
    it("is false when the exiled land play is the only action", () => {
        const state = exiledLandBoard("play");
        expect(enumerateMoves(state, "p1")).toEqual([
            { kind: "pass" },
            PLAY_EXILED,
        ]);
        expect(onlyPassIsLegal(state, "p1")).toBe(false);
    });

    it("is true for the same board under a cast-only grant", () => {
        const state = exiledLandBoard("cast-only");
        expect(enumerateMoves(state, "p1")).toEqual([{ kind: "pass" }]);
        expect(onlyPassIsLegal(state, "p1")).toBe(true);
    });
});

describe("an exiled land under a lapsing grant is material only while playable (CR 514.2)", () => {
    it("playing the exiled land scores above playing the hand land", () => {
        const state = buildBladeState(entry(POSTCOMBAT));
        const me = state.players[0];
        const byName = (name: string, zone: CardInstanceState[]) =>
            zone.find((c) => c.card.id === getCardByName(name).id)!.id;
        const exiled = byName("Mountain", me.exile);
        const inHand = byName("Snow-Covered Mountain", me.hand);
        const after = (id: string) =>
            evaluate(
                applyMoveForSearch(state, me.id, {
                    kind: "play-land",
                    cardInstanceId: id,
                }),
                me.id
            );
        expect(after(exiled)).toBeGreaterThan(after(inHand));
    });
});

describe("the Bot spends the expiring land drop first (blade)", () => {
    it("postcombat: plays the exiled land, not the hand land", () => {
        expect(runBladeScenario(entry(POSTCOMBAT)).failureMessage).toBe("");
    });

    it("precombat, Laelia able to attack: holds the hand land drop", () => {
        expect(runBladeScenario(entry(PRECOMBAT)).failureMessage).toBe("");
    });

    it("precombat at a budget where `pass` wins outright: the drop is not swapped back in", () => {
        // At this budget `pass` out-rewards the drop, and the land-drop arm
        // that turns a robust `pass` into an outcome-equal land play must not
        // undo the hold.
        const base = entry(PRECOMBAT);
        const scenario: BladeScenario = {
            ...base,
            budget: { iterations: 3000 },
            seeds: [1],
        };
        expect(runBladeScenario(scenario).failureMessage).toBe("");
    }, 300_000);

    it("precombat, the attack can exile no land: the drop is not held for it", () => {
        // The same board with a library of uncastable nonland cards: no line
        // plays a land out of exile, so the deferred drop has nothing to wait
        // for and the hand land goes down as before.
        const base = entry(PRECOMBAT);
        const scenario: BladeScenario = {
            ...base,
            label: `${base.label} — nonland library`,
            spec: {
                ...base.spec,
                libraryCount: 0,
                cards: [
                    ...base.spec.cards,
                    ...Array.from({ length: 20 }, () => ({
                        name: "Craw Wurm",
                        owner: "me" as const,
                        zone: "library" as const,
                    })),
                ],
            },
            expect: { moves: [{ kind: "play-land" }] },
        };
        expect(runBladeScenario(scenario).failureMessage).toBe("");
    });
});
