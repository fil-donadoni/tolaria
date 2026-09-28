// CR 712.8a / 712.8f / 712.12 (issue #4767) — a scenario spec can place a
// MODAL double-faced card with its BACK face up.
//
// The live engine plays a modal back face by stamping the parent instance
// (`stampModalBackFaceForPlay`, `gre/transform.ts`): the presented definition
// becomes the `${parentId}#back` twin, with `transformed` / `transformedFrom`
// recording the front face it reverts to on leaving the battlefield. A spec
// names that permanent by the name it PRESENTS — the back face's own name,
// which is what `specFromState` already writes and what `attachedTo` / combat
// references match on — and the builder rebuilds the SAME stamp.

import { describe, expect, it } from "vitest";
import { buildStateFromScenario, specFromState } from "../scenarioBuilder";
import { buildPositionFromSpec } from "../ai/blade/build";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import {
    getAllCatalogueCards,
    tryGetCardByName,
    tryGetPlaceableCardByName,
} from "../../cards/catalogue";
import { tryGetDefinition } from "../../cards";
import {
    isModalDoubleFaced,
    modalBackFaceDefinitionId,
} from "../../cards/modalDfc";
import { applyPlayLand, finalizeLandEntry } from "../playLand";
import { getManaTapOptionsDetailed, hasManaAbility } from "../constants";
import { collectUnresolvedCardNames } from "../../debugScenarioSpec";
import type { CardInstanceState, GameState, PendingChoice } from "../state";
import { isLegalNamedCard } from "../pendingChoiceSubmit";
import type { ScenarioSpec } from "../../debugScenarioSpec";

const SINK_INTO_STUPOR = "5358b87a-1a29-426d-b165-40c97da2c14d";
const BACK_ID = modalBackFaceDefinitionId(SINK_INTO_STUPOR);

/** The permanent the LIVE engine produces when p1 plays Sink into Stupor as
 *  Soporific Springs (CR 712.12), paying 3 life so it enters untapped. */
function livePlayedBackFace(): GameState {
    const card = makeInstance(SINK_INTO_STUPOR, {
        controllerId: "p1",
        zone: "hand",
    });
    const state = makeState({
        players: [makePlayer("p1", { hand: [card] }), makePlayer("p2")],
    });
    applyPlayLand(state, state.players[0], card.id, "back");
    const choice = state.pendingChoices?.[0];
    finalizeLandEntry(
        state,
        "p1",
        card.id,
        { life: 3 },
        true,
        choice?.landSourceZone,
        choice?.landEntryFace
    );
    state.pendingChoices = [];
    return state;
}

function battlefieldOf(state: GameState, seat = 0): CardInstanceState[] {
    return state.players[seat].battlefield;
}

/** The fields that make a back-face-up modal permanent what it is. */
function faceShape(card: CardInstanceState | undefined) {
    return {
        cardId: (card?.card as { id?: string } | undefined)?.id,
        types: card?.types,
        subtypes: card?.subtypes,
        staticAbilities: card?.staticAbilities,
        transformed: card?.transformed,
        transformedFrom: card?.transformedFrom,
    };
}

function place(name: string, zone?: "hand" | "battlefield"): GameState {
    const spec: ScenarioSpec = {
        cards: [{ name, owner: "me", ...(zone ? { zone } : {}) }],
    };
    return buildStateFromScenario(makeState(), spec);
}

describe("scenario spec — a modal double-faced card back face up (issue #4767, CR 712.8f)", () => {
    it("a Blade position naming the back face builds the SAME permanent the live land play produces, and it taps for mana", () => {
        const state = buildPositionFromSpec({
            cards: [{ name: "Soporific Springs", owner: "me" }],
        });
        const placed = battlefieldOf(state).find(
            (c) => (c.card as { id?: string }).id === BACK_ID
        );
        const live = battlefieldOf(livePlayedBackFace())[0];

        expect(faceShape(placed)).toEqual(faceShape(live));
        expect(placed?.types).toEqual(["Land"]);
        expect(placed?.transformed).toBe(true);
        expect(placed?.transformedFrom).toBe(SINK_INTO_STUPOR);
        // CR 605.1a — the back face's own mana ability ({T}: Add {U}); the
        // instant on the front has none.
        expect(hasManaAbility(placed!)).toBe(true);
        expect(
            getManaTapOptionsDetailed(placed!, "p1").map((o) => o.mana)
        ).toEqual(getManaTapOptionsDetailed(live, "p1").map((o) => o.mana));
        expect(getManaTapOptionsDetailed(placed!, "p1").length).toBeGreaterThan(
            0
        );
    });

    it("round-trips a live back-face-up permanent through specFromState with nothing dropped for it", () => {
        const live = livePlayedBackFace();
        const { spec, dropped } = specFromState(live, { mySeatId: "p1" });

        expect(dropped.filter((d) => d.includes("Soporific Springs"))).toEqual(
            []
        );
        expect(spec.cards).toContainEqual(
            expect.objectContaining({ name: "Soporific Springs", owner: "me" })
        );

        const rebuilt = buildStateFromScenario(makeState(), spec);
        expect(faceShape(battlefieldOf(rebuilt)[0])).toEqual(
            faceShape(battlefieldOf(live)[0])
        );
    });

    it("resolves the full `front // back` catalogue name to the front face", () => {
        const full = "Sink into Stupor // Soporific Springs";
        expect(tryGetCardByName(full)?.id).toBe(SINK_INTO_STUPOR);
        expect(tryGetPlaceableCardByName(full)?.id).toBe(SINK_INTO_STUPOR);

        const hand = place(full, "hand").players[0].hand;
        expect((hand[0]?.card as { id: string }).id).toBe(SINK_INTO_STUPOR);
        expect(hand[0]?.types).toEqual(["Instant"]);
    });

    it("places the FRONT face when the back face is named outside the battlefield (CR 712.8a)", () => {
        const card = place("Soporific Springs", "hand").players[0].hand[0];
        expect((card?.card as { id: string }).id).toBe(SINK_INTO_STUPOR);
        expect(card?.types).toEqual(["Instant"]);
        expect(card?.transformed).toBeUndefined();
    });

    it("seeds basic lands for the face actually placed (CR 712.8a / 202.2)", () => {
        const state = buildStateFromScenario(makeState(), {
            cards: [{ name: "Soporific Springs", owner: "me", zone: "hand" }],
            landCount: 1,
        });
        // The instant in hand is blue ({1}{U}{U}); the colourless land face
        // would have fallen back to Plains.
        const basic = battlefieldOf(state)[0];
        expect(tryGetDefinition((basic?.card as { id: string }).id)?.name).toBe(
            "Island"
        );
    });

    it("still refuses an Adventure's inset spell with the CR 715.4 message", () => {
        expect(() => place("Stomp")).toThrow(/Adventure.*CR 715\.4/);
        expect(() => place("Soporific Springs")).not.toThrow();
    });

    it("names a split card's half for what it is, never an Adventure (CR 709.4)", () => {
        expect(() => place("Stand")).toThrow(/split card.*CR 709\.4/);
        expect(() => place("Stand")).not.toThrow(/Adventure/);
    });

    it("still reports a back-face stamp whose transformedFrom is not its own front face", () => {
        const live = livePlayedBackFace();
        battlefieldOf(live)[0].transformedFrom = "some-other-card";
        const { dropped } = specFromState(live, { mySeatId: "p1" });
        expect(
            dropped.some(
                (d) =>
                    d.startsWith("Soporific Springs (me)") &&
                    d.includes("transformedFrom")
            )
        ).toBe(true);
    });

    it("refuses a back face as a stack spell — no live cast path produces one (CR 712.8f)", () => {
        expect(() =>
            buildStateFromScenario(makeState(), {
                cards: [],
                stack: [
                    {
                        kind: "spell",
                        name: "Soporific Springs",
                        controller: "me",
                    },
                ],
            })
        ).toThrow(/modal back face/);
    });

    it("a name choice accepts either face but not the combined name (CR 712.19)", () => {
        const head = {
            kind: "name-card",
            playerId: "p1",
            stackItemId: "s1",
            step: 0,
            choiceId: "c1",
        } as unknown as PendingChoice;
        const empty = {} as Pick<GameState, "stagedEntries">;
        expect(isLegalNamedCard(empty, head, "Sink into Stupor")).toBe(true);
        expect(isLegalNamedCard(empty, head, "Soporific Springs")).toBe(true);
        expect(
            isLegalNamedCard(
                empty,
                head,
                "Sink into Stupor // Soporific Springs"
            )
        ).toBe(false);
    });

    it("the save-path validators accept the back-face and the full name", () => {
        const spec: ScenarioSpec = {
            cards: [
                { name: "Soporific Springs", owner: "me" },
                { name: "Sink into Stupor // Soporific Springs", owner: "opp" },
            ],
        };
        expect(
            collectUnresolvedCardNames(
                spec,
                (name) => tryGetPlaceableCardByName(name) !== null
            )
        ).toEqual([]);
        // An inset spell stays unplaceable.
        expect(tryGetPlaceableCardByName("Stomp")).toBeNull();
    });

    it("SWEEP: every modal double-faced card in the catalogue places back face up, by either name", () => {
        const modal = getAllCatalogueCards().filter((c) =>
            isModalDoubleFaced(c)
        );
        expect(modal.length).toBeGreaterThan(0);
        const failures: string[] = [];
        for (const front of modal) {
            const back = tryGetDefinition(modalBackFaceDefinitionId(front.id));
            if (!back) {
                failures.push(`${front.name}: no back twin`);
                continue;
            }
            // A back name another card's printed name shadows (first write
            // wins, `catalogue.ts`) could not be placed back face up at all
            // under this representation — fail loudly, never skip.
            if (tryGetCardByName(back.name)?.id !== back.id) {
                failures.push(`${back.name}: shadowed by another card's name`);
                continue;
            }
            try {
                const placed = battlefieldOf(place(back.name))[0];
                if (
                    (placed?.card as { id?: string }).id !== back.id ||
                    placed?.transformedFrom !== front.id ||
                    placed?.transformed !== true
                ) {
                    failures.push(`${back.name}: wrong shape`);
                }
                const full = `${front.name} // ${back.name}`;
                if (tryGetPlaceableCardByName(full)?.id !== front.id) {
                    failures.push(`${full}: does not resolve`);
                }
            } catch (e) {
                failures.push(`${back.name}: ${(e as Error).message}`);
            }
        }
        expect(failures).toEqual([]);
    });
});
