// JUD (Judgment) — red behavior tests (ADR 0043 colour split).
//
// Anger is the first card whose static ability functions from the GRAVEYARD
// (CR 113.6b, `SourceZoneScope`). Covered here through the real recompute
// (`checkStateBasedActions` → `recomputeContinuousEffects`) and the wire
// projection: the grant's owner scoping (CR 109.5), its Mountain gate
// (CR 611.2c), its end when Anger leaves the graveyard, its silence while
// Anger is on the battlefield, and the graveyard object's own CR 613.7d
// timestamp against an ability-loss effect.
import { describe, it, expect } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../../__tests__/setup.helper";
import {
    beginApplyingStaticEffects,
    moveCard,
    removePermanentTo,
    type CardInstanceState,
    type GameState,
} from "../../../../gre/state";
import { checkStateBasedActions } from "../../../../gre/sba";
import { projectPublicState } from "../../../../gameProjections";
import { anger } from "../red.cards";
import { grizzlyBears } from "../../lea/green.cards";
import { mountain, taiga } from "../../lea/colorless.cards";
import { humility } from "../../tmp/white.cards";

function permanent(
    cardId: string,
    id: string,
    controllerId: "p1" | "p2"
): CardInstanceState {
    return makeInstance(cardId, { id, controllerId, ownerId: controllerId });
}

/** Anger in `ownerId`'s graveyard; a Mountain and a Grizzly Bears on each
 *  side unless the caller says otherwise. */
function angerInGraveyard(opts?: {
    ownerId?: "p1" | "p2";
    mountainFor?: readonly ("p1" | "p2")[];
}): GameState {
    const ownerId = opts?.ownerId ?? "p1";
    const mountainFor = opts?.mountainFor ?? ["p1", "p2"];
    const battlefield = (pid: "p1" | "p2") => [
        permanent(grizzlyBears().id, `${pid}-bears`, pid),
        ...(mountainFor.includes(pid)
            ? [permanent(mountain().id, `${pid}-mountain`, pid)]
            : []),
    ];
    const angerCard = makeInstance(anger().id, {
        id: "anger",
        controllerId: ownerId,
        ownerId,
        zone: "graveyard",
    });
    const state = makeState({
        players: [
            makePlayer("p1", {
                battlefield: battlefield("p1"),
                graveyard: ownerId === "p1" ? [angerCard] : [],
            }),
            makePlayer("p2", {
                battlefield: battlefield("p2"),
                graveyard: ownerId === "p2" ? [angerCard] : [],
            }),
        ],
    });
    checkStateBasedActions(state);
    return state;
}

function find(state: GameState, id: string): CardInstanceState {
    for (const p of state.players) {
        for (const c of [...p.battlefield, ...p.graveyard, ...p.hand]) {
            if (c.id === id) return c;
        }
    }
    throw new Error(`no ${id}`);
}

const hasHaste = (state: GameState, id: string) =>
    find(state, id).staticAbilities.includes("haste");

describe("Anger (graveyard-functioning static ability, CR 113.6b)", () => {
    it("grants haste to its owner's creatures while in the graveyard with a Mountain", () => {
        const state = angerInGraveyard();
        expect(hasHaste(state, "p1-bears")).toBe(true);
    });

    it("grants nothing to the other player's creatures (CR 109.5 — 'you' is the owner)", () => {
        const state = angerInGraveyard();
        expect(hasHaste(state, "p2-bears")).toBe(false);
    });

    it("in an opponent's graveyard grants haste to that opponent's creatures only", () => {
        const state = angerInGraveyard({ ownerId: "p2" });
        expect(hasHaste(state, "p2-bears")).toBe(true);
        expect(hasHaste(state, "p1-bears")).toBe(false);
    });

    it("grants nothing without a Mountain (CR 611.2c gate)", () => {
        const state = angerInGraveyard({ mountainFor: ["p2"] });
        expect(hasHaste(state, "p1-bears")).toBe(false);
    });

    it("stops the moment its owner's last Mountain leaves", () => {
        const state = angerInGraveyard();
        expect(hasHaste(state, "p1-bears")).toBe(true);
        removePermanentTo(state, "p1-mountain", "graveyard", "destroy");
        checkStateBasedActions(state);
        expect(hasHaste(state, "p1-bears")).toBe(false);
    });

    it("counts a nonbasic land with the Mountain subtype", () => {
        const state = angerInGraveyard({ mountainFor: [] });
        state.players[0].battlefield.push(
            permanent(taiga().id, "p1-taiga", "p1")
        );
        checkStateBasedActions(state);
        expect(hasHaste(state, "p1-bears")).toBe(true);
    });

    it("ends when Anger leaves the graveyard", () => {
        const state = angerInGraveyard();
        expect(hasHaste(state, "p1-bears")).toBe(true);
        moveCard(state.players[0], "anger", "graveyard", "exile");
        checkStateBasedActions(state);
        expect(hasHaste(state, "p1-bears")).toBe(false);
    });

    it("on the battlefield has haste itself and grants it to nothing else", () => {
        const angerPermanent = permanent(anger().id, "anger", "p1");
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        angerPermanent,
                        permanent(grizzlyBears().id, "p1-bears", "p1"),
                        permanent(mountain().id, "p1-mountain", "p1"),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        beginApplyingStaticEffects(state, angerPermanent);
        checkStateBasedActions(state);
        expect(hasHaste(state, "anger")).toBe(true);
        expect(hasHaste(state, "p1-bears")).toBe(false);
    });

    it("starts granting once it dies, through the real leave-the-battlefield path", () => {
        const angerPermanent = permanent(anger().id, "anger", "p1");
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        angerPermanent,
                        permanent(grizzlyBears().id, "p1-bears", "p1"),
                        permanent(mountain().id, "p1-mountain", "p1"),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        beginApplyingStaticEffects(state, angerPermanent);
        checkStateBasedActions(state);
        expect(hasHaste(state, "p1-bears")).toBe(false);
        removePermanentTo(state, "anger", "graveyard", "destroy");
        checkStateBasedActions(state);
        expect(hasHaste(state, "p1-bears")).toBe(true);
    });

    it("the granted haste survives the public-state projection", () => {
        const state = angerInGraveyard();
        for (const viewer of ["p1", "p2"]) {
            const projected = projectPublicState(state, 1, viewer);
            const bears = projected.players[0].battlefield.find(
                (c) => c.id === "p1-bears"
            )!;
            expect(bears.staticAbilities).toContain("haste");
            const oppBears = projected.players[1].battlefield.find(
                (c) => c.id === "p2-bears"
            )!;
            expect(oppBears.staticAbilities).not.toContain("haste");
        }
    });
});

describe("Anger — the graveyard object's own timestamp (CR 613.7d)", () => {
    function humilityThenAngerDies(): GameState {
        // Anger is on the battlefield BEFORE Humility, so its battlefield
        // stamp is earlier than Humility's; it then dies AFTER Humility, so
        // the graveyard object's stamp is later. CR 613.7d makes the
        // graveyard one the timestamp of its effect.
        const angerPermanent = permanent(anger().id, "anger", "p1");
        const humilityPermanent = permanent(humility().id, "humility", "p2");
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        angerPermanent,
                        permanent(grizzlyBears().id, "p1-bears", "p1"),
                        permanent(mountain().id, "p1-mountain", "p1"),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        beginApplyingStaticEffects(state, angerPermanent);
        state.players[1].battlefield.push(humilityPermanent);
        beginApplyingStaticEffects(state, humilityPermanent);
        removePermanentTo(state, "anger", "graveyard", "destroy");
        checkStateBasedActions(state);
        return state;
    }

    it("a grant arriving after Humility survives it (CR 613.1f — later timestamp)", () => {
        const state = humilityThenAngerDies();
        expect(hasHaste(state, "p1-bears")).toBe(true);
    });

    it("a grant predating Humility is stripped by it", () => {
        const state = angerInGraveyard();
        expect(hasHaste(state, "p1-bears")).toBe(true);
        const humilityPermanent = permanent(humility().id, "humility", "p2");
        state.players[1].battlefield.push(humilityPermanent);
        beginApplyingStaticEffects(state, humilityPermanent);
        checkStateBasedActions(state);
        expect(hasHaste(state, "p1-bears")).toBe(false);
    });

    it("a card that leaves and returns is a new object with a new timestamp", () => {
        // Anger is stamped, Humility arrives later and strips its grant; Anger
        // then goes to hand and back. The returning card is a new object
        // (CR 400.7) whose stamp postdates Humility, so the grant survives it.
        const state = angerInGraveyard();
        const humilityPermanent = permanent(humility().id, "humility", "p2");
        state.players[1].battlefield.push(humilityPermanent);
        beginApplyingStaticEffects(state, humilityPermanent);
        checkStateBasedActions(state);
        expect(hasHaste(state, "p1-bears")).toBe(false);

        moveCard(state.players[0], "anger", "graveyard", "hand");
        expect(find(state, "anger").zoneStaticSeq).toBeUndefined();
        moveCard(state.players[0], "anger", "hand", "graveyard");
        checkStateBasedActions(state);
        expect(find(state, "anger").zoneStaticSeq).toBeGreaterThan(
            humilityPermanent.staticSeq!
        );
        expect(hasHaste(state, "p1-bears")).toBe(true);
    });
});
