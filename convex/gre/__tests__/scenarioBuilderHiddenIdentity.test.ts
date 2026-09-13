// specFromState — a face-down object whose real identity the state does not
// carry (issue #3554, CR 406.3 / 708.2).
//
// A raw engine state always keeps the identity underneath a face-down mask
// (`faceDownOf` on a permanent, the real `card.id` on a card exiled face
// down). A PROJECTED state does not: the seat that may not look sees only the
// face-down sentinel, which is registered by definition id and not by name.
// The lowering used to place that object under the sentinel's display name,
// and the rebuild threw "Card not found by name: Face-down creature".

import { describe, expect, it } from "vitest";
import { buildStateFromScenario, specFromState } from "../scenarioBuilder";
import { makeInstance, makeState } from "../../cards/__tests__/setup";
import {
    FACE_DOWN_CARD_ID,
    getCardByName,
    tryGetCardByName,
} from "../../cards";
import { findTokenSpec } from "../../cards/tokenCatalogue";
import { projectPublicState } from "../../gameProjections";
import type { CardInstanceState, GameState } from "../state";
import type { ScenarioSpec } from "../../debugScenarioSpec";

const BEARS = getCardByName("Grizzly Bears").id;

/** The opponent's hideaway-style card, exiled face down and known only to its
 *  owner, plus the opponent's morph — the two objects a projection hides. */
const HIDDEN_BOARD: ScenarioSpec = {
    cards: [
        { name: "Forest", owner: "me" },
        {
            name: "Grizzly Bears",
            owner: "opp",
            zone: "exile",
            faceDownExile: true,
        },
        { name: "Shivan Dragon", owner: "opp", faceDown: true },
    ],
};

function rawBoard(spec: ScenarioSpec = HIDDEN_BOARD): GameState {
    return buildStateFromScenario(makeState(), spec);
}

/** The shape the LOWERING meets when the position came through the wire to
 *  `p1`: what `projectExileCard` and the battlefield projection do to exactly
 *  these objects. Built by hand so a raw `GameState` reaches `specFromState`,
 *  and pinned to the real projection by {@link expectMatchesProjection}. */
function asSeenByMe(raw: GameState): GameState {
    const seen = structuredClone(raw);
    const opp = seen.players[1];
    for (const card of opp.exile) {
        if (!card.knownTo?.length) continue;
        card.card = { id: FACE_DOWN_CARD_ID } as CardInstanceState["card"];
        delete card.knownTo;
        card.faceDown = true;
    }
    for (const card of opp.battlefield) {
        if (card.faceDown) delete card.faceDownOf;
    }
    return seen;
}

function expectMatchesProjection(raw: GameState): void {
    const wire = projectPublicState(raw, 1, "p1");
    const exiled = wire.players[1].exile[0] as { card: { id: string } };
    expect(exiled.card.id).toBe(FACE_DOWN_CARD_ID);
    const morph = wire.players[1].battlefield.find(
        (c) => (c as { faceDown?: boolean }).faceDown
    ) as { card: { id: string }; faceDownOf?: string };
    expect(morph.card.id).toBe(FACE_DOWN_CARD_ID);
    expect(morph.faceDownOf).toBeUndefined();
}

const NAME_KEYS = new Set([
    "name",
    "copyOf",
    "attachedTo",
    "attacker",
    "blocker",
]);

/** Every card-naming string a spec carries, wherever it sits. */
function specNames(value: unknown, out: string[] = []): string[] {
    if (Array.isArray(value)) {
        for (const item of value) specNames(item, out);
    } else if (value && typeof value === "object") {
        for (const [key, child] of Object.entries(value)) {
            if (NAME_KEYS.has(key) && typeof child === "string")
                out.push(child);
            else specNames(child, out);
        }
    }
    return out;
}

function expectEveryNameResolves(spec: ScenarioSpec): void {
    for (const name of specNames(spec)) {
        expect(
            tryGetCardByName(name) ?? findTokenSpec(name),
            `"${name}" must resolve through the catalogue`
        ).toBeTruthy();
    }
}

describe("specFromState — a face-down object with no recoverable identity (issue #3554, CR 406.3 / 708.2)", () => {
    it("refuses the hidden objects, naming each with its zone, and hands back a spec that rebuilds", () => {
        const raw = rawBoard();
        expectMatchesProjection(raw);

        const { spec, dropped } = specFromState(asSeenByMe(raw), {
            mySeatId: "p1",
        });

        expect(specNames(spec)).not.toContain("Face-down creature");
        expectEveryNameResolves(spec);
        expect(() => buildStateFromScenario(makeState(), spec)).not.toThrow();
        const hidden = dropped.filter((note) =>
            note.startsWith("hidden identity:")
        );
        expect(hidden).toHaveLength(2);
        expect(
            hidden.some((n) => n.includes("a face-down card (opp, exile)"))
        ).toBe(true);
        expect(
            hidden.some((n) => n.includes("a face-down permanent (opp)"))
        ).toBe(true);
    });

    it("captures a face-down exile under its REAL identity when the state carries it", () => {
        const { spec, dropped } = specFromState(rawBoard(), { mySeatId: "p1" });

        expect(dropped.filter((n) => n.startsWith("hidden identity:"))).toEqual(
            []
        );
        expect(spec.cards).toContainEqual(
            expect.objectContaining({
                name: "Grizzly Bears",
                owner: "opp",
                zone: "exile",
                faceDownExile: true,
            })
        );
        const rebuilt = buildStateFromScenario(makeState(), spec);
        const exiled = rebuilt.players[1].exile[0];
        expect((exiled.card as { id: string }).id).toBe(BEARS);
        expect(exiled.knownTo).toEqual([rebuilt.players[1].id]);
    });

    it("holds for every zone a card is lowered from: no name it writes fails the lookup", () => {
        const state = rawBoard({ cards: [{ name: "Forest", owner: "me" }] });
        const zones = ["battlefield", "graveyard", "exile", "hand"] as const;
        for (const zone of zones) {
            state.players[1][zone].push(
                makeInstance(FACE_DOWN_CARD_ID, {
                    id: `sentinel-${zone}`,
                    controllerId: "p2",
                    ownerId: "p2",
                    zone,
                })
            );
        }

        const { spec, dropped } = specFromState(state, { mySeatId: "p1" });

        expectEveryNameResolves(spec);
        expect(() => buildStateFromScenario(makeState(), spec)).not.toThrow();
        expect(
            dropped.filter((n) => n.startsWith("hidden identity:"))
        ).toHaveLength(zones.length);
    });

    it("drops an attachment to a face-down host instead of naming the sentinel", () => {
        const raw = rawBoard({
            cards: [
                { name: "Shivan Dragon", owner: "opp", faceDown: true },
                { name: "Fear", owner: "me" },
            ],
        });
        // Attached on the raw board: the builder itself resolves a host by
        // its PRESENTED identity, so no spec can stage this attachment.
        const morph = raw.players[1].battlefield.find((c) => c.faceDown)!;
        const fear = raw.players[0].battlefield.find(
            (c) => (c.card as { id: string }).id === getCardByName("Fear").id
        )!;
        fear.attachedTo = morph.id;

        const { spec, dropped } = specFromState(asSeenByMe(raw), {
            mySeatId: "p1",
        });

        expectEveryNameResolves(spec);
        expect(
            dropped.some((n) => n.includes("attached to a FACE-DOWN permanent"))
        ).toBe(true);
    });

    it("throws at the name funnel itself for a definition the catalogue cannot name", () => {
        const state = rawBoard({ cards: [{ name: "Forest", owner: "me" }] });
        state.players[0].companion = {
            instance: makeInstance(FACE_DOWN_CARD_ID, {
                id: "companion",
                controllerId: "p1",
                ownerId: "p1",
                zone: "sideboard" as never,
            }),
            used: false,
        } as never;

        expect(() => specFromState(state, { mySeatId: "p1" })).toThrow(
            /is not a name the catalogue resolves/
        );
    });
});
