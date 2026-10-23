// SPM (Marvel's Spider-Man) — colorless behavior tests (ADR 0043 colour
// split). Multiversal Passage (issue #1306, parent PRD #620; issue #2672):
// the as-enters basic-land-type choice (CR 614.12a, ADR 0100 `subtypes`), THEN
// the land-entry pay-choice (CR 614.12, ADR 0051), then CR 305.7 layer-4
// subtype replacement — see the card's own doc comment in
// `../colorless.cards.ts`.

import { describe, it, expect } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
    submitChoice,
} from "../../../__tests__/setup.helper";
import {
    beginApplyingStaticEffects,
    getPlayer,
    resolveTopOfStack,
    type GameState,
    type PlayerState,
} from "../../../../gre/state";
import { getBasicLandMana } from "../../../../gre/constants";
import {
    applyPlayLand,
    applyPlayLandFromExile,
    applyPlayLandFromGraveyard,
    applyPlayLandFromLibraryTop,
} from "../../../../gre/playLand";
import { applyLandEntrySubmit } from "../../../../gre/pendingChoiceSubmit";
import { compactState, expandState } from "../../../../gre/serialize";
import { projectPublicState } from "../../../../gameProjections";
import { getDefinition, withTemporaryDefinition } from "../../../index";
import type { CardDefinition } from "../../../types";

const multiversalPassage = getDefinition(
    "f5fb426a-5618-4dd4-9c51-0cc847be8c1d"
);
const forest = getDefinition("6f1c8cb0-38eb-408b-94e8-16db83999b3b");
// Courser of Kruphix: "You may play lands from the top of your library" (the
// library-top origin) AND a landfall watcher — the observer for the CR 603.6a
// PERMANENT_ENTERED the two entry choices must both precede.
const courserOfKruphix = getDefinition("da5a807f-58e8-4d92-a61c-47bb9b28977f");

describe("Multiversal Passage (CR 614.12a as-enters type, THEN CR 614.12 pay-choice, CR 305.7 subtype-set)", () => {
    it("the subtype-set static applies ONLY to itself (a pre-set chosenSubtypes)", () => {
        const passage = makeInstance(multiversalPassage.id, {
            id: "passage-1",
            controllerId: "p1",
            zone: "battlefield",
        });
        passage.chosenSubtypes = ["Island"];
        const otherLand = makeInstance(forest.id, {
            id: "other-1",
            controllerId: "p1",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [passage, otherLand] }),
                makePlayer("p2"),
            ],
        });
        beginApplyingStaticEffects(state, passage);
        expect(passage.subtypes).toEqual(["Island"]);
        expect(getBasicLandMana(passage)).toBe("U");
        // The other land on the board is untouched — this is a SELF-only
        // static, not a swap over every matching land (Illusionary Terrain).
        expect(otherLand.subtypes).toEqual(["Forest"]);
    });

    it("has no subtype (and no intrinsic mana) without a chosen type", () => {
        const passage = makeInstance(multiversalPassage.id, {
            id: "passage-1",
            controllerId: "p1",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [passage] }),
                makePlayer("p2"),
            ],
        });
        beginApplyingStaticEffects(state, passage);
        expect(passage.subtypes).toEqual([]);
        expect(getBasicLandMana(passage)).toBeNull();
    });
});

/** Every zone a played Multiversal Passage can come from, and the play-land
 *  transition for it. `zone` is the `PlayerState` array that holds the card. */
const PLAY_ORIGINS = [
    { origin: "hand", zone: "hand" as const, play: applyPlayLand },
    {
        origin: "graveyard",
        zone: "graveyard" as const,
        play: applyPlayLandFromGraveyard,
    },
    { origin: "exile", zone: "exile" as const, play: applyPlayLandFromExile },
    {
        origin: "library-top",
        zone: "library" as const,
        play: applyPlayLandFromLibraryTop,
    },
];

function passageIn(zone: "hand" | "graveyard" | "exile" | "library") {
    const passage = makeInstance(multiversalPassage.id, {
        id: "passage",
        controllerId: "p1",
        ownerId: "p1",
        zone,
    });
    const filler = makeInstance(forest.id, {
        id: "filler",
        controllerId: "p1",
        ownerId: "p1",
        zone,
    });
    const courser = makeInstance(courserOfKruphix.id, {
        id: "courser",
        controllerId: "p1",
        ownerId: "p1",
        zone: "battlefield",
    });
    const state = makeState({
        players: [
            makePlayer("p1", {
                life: 20,
                battlefield: [courser],
                // The library origin plays only the TOP card: the land is on
                // TOP, with a card under it to prove it goes back on top.
                [zone]: zone === "library" ? [passage, filler] : [passage],
            }),
            makePlayer("p2"),
        ],
    });
    state.activePlayerId = "p1";
    state.priorityPlayerId = "p1";
    return { state, player: getPlayer(state, "p1") };
}

function onBattlefield(player: PlayerState) {
    return player.battlefield.find((c) => c.id === "passage");
}

/** Mirrors the DB save point every pending choice is: the state is compacted
 *  and rehydrated between two submissions, so the staged land must survive
 *  the round trip with its answer on it. */
function persisted(state: GameState): GameState {
    return expandState(
        JSON.parse(JSON.stringify(compactState(state))) as Record<
            string,
            unknown
        >
    );
}

describe.each(PLAY_ORIGINS)(
    "Multiversal Passage played from $origin — the type is chosen FIRST, the 2 life SECOND (issue #2672)",
    ({ zone, play }) => {
        it("raises the basic-land-type pick first; nothing has entered", () => {
            const { state, player } = passageIn(zone);
            expect(play(state, player, "passage")).toBeNull();

            const head = state.pendingChoices?.[0];
            expect(head?.asEntersKind).toBe("subtypes");
            expect(head?.kind).toBe("option-pick");
            expect(head?.playerId).toBe("p1");
            expect(head?.options?.map((o) => o.id)).toEqual([
                "Plains",
                "Island",
                "Swamp",
                "Mountain",
                "Forest",
            ]);
            // Only ONE choice is queued: the pay-choice is not raised yet.
            expect(state.pendingChoices).toHaveLength(1);
            expect(onBattlefield(player)).toBeUndefined();
            expect(state.stack).toHaveLength(0);
            expect(state.priorityPlayerId).toBe("p1");
        });

        it("then raises the pay-2-life choice; still not on the battlefield, no land drop, no entry event", () => {
            const { state, player } = passageIn(zone);
            play(state, player, "passage");
            submitChoice(state, ["Mountain"]);

            const head = state.pendingChoices?.[0];
            expect(head?.kind).toBe("land-entry-tapped");
            expect(head?.landInstanceId).toBe("passage");
            expect(head?.cost).toEqual({ life: 2 });
            expect(state.pendingChoices).toHaveLength(1);
            expect(onBattlefield(player)).toBeUndefined();
            // CR 305.2 — the drop is recorded only as the land settles.
            expect(player.landsPlayedThisTurn ?? 0).toBe(0);
            // No PERMANENT_ENTERED has been emitted: landfall is silent.
            expect(state.stack).toHaveLength(0);
            expect(state.priorityPlayerId).toBe("p1");
        });

        it("decline → enters TAPPED and typed; taps for the chosen colour at once", () => {
            const { state, player } = passageIn(zone);
            play(state, player, "passage");
            submitChoice(state, ["Mountain"]);
            applyLandEntrySubmit(state, { playerId: "p1", accept: false });

            const land = onBattlefield(player)!;
            expect(land).toBeDefined();
            expect(land.isTapped).toBe(true);
            expect(player.life).toBe(20);
            // No extra materialisation pass: the type is live on entry.
            expect(land.chosenSubtypes).toEqual(["Mountain"]);
            expect(land.subtypes).toEqual(["Mountain"]);
            expect(getBasicLandMana(land)).toBe("R");
            expect(player.landsPlayedThisTurn).toBe(1);
            expect(state.pendingChoices ?? []).toHaveLength(0);
            expect(state.stagedEntries ?? []).toHaveLength(0);
            // CR 603.6a — the land entered exactly once, after both choices:
            // Courser's landfall is the one item on the stack.
            expect(state.stack.map((i) => i.triggeredAbilityId)).toEqual([
                "courser-of-kruphix-landfall",
            ]);
        });

        it("pay → enters UNTAPPED and typed, across a save point between the two choices", () => {
            const first = passageIn(zone);
            play(first.state, first.player, "passage");
            const mid = persisted(first.state);
            submitChoice(mid, ["Island"]);
            const state = persisted(mid);
            applyLandEntrySubmit(state, { playerId: "p1", accept: true });

            const player = getPlayer(state, "p1");
            const land = onBattlefield(player)!;
            expect(land.isTapped).toBe(false);
            expect(player.life).toBe(18);
            expect(land.subtypes).toEqual(["Island"]);
            expect(getBasicLandMana(land)).toBe("U");
            // The source zone is left exactly as it was, minus the land.
            const rest = player[zone].map((c) => c.id);
            expect(rest).not.toContain("passage");
            if (zone === "library") expect(rest).toEqual(["filler"]);
        });
    }
);

/** "Return target land card from your graveyard to the battlefield." — a
 *  stand-in reanimation spell on the shipped Resurrection shape (an Effect
 *  Script `moveZone`, so its resolution is CHECKPOINTED and genuinely waits on
 *  the as-enters choice). */
const LAND_REANIMATION: CardDefinition = {
    id: "test-land-reanimation",
    name: "Test Land Reanimation",
    rarity: "common",
    oracleText:
        "Return target land card from your graveyard to the battlefield.",
    manaCost: { X: 2 },
    types: ["Sorcery"],
    targetRequirement: {
        type: "Land",
        count: 1,
        zone: "graveyard",
        controller: "you",
    },
    effects: [{ op: "moveZone", target: { target: 0 }, to: "battlefield" }],
};

describe("Multiversal Passage put onto the battlefield by an effect (issue #2672)", () => {
    function reanimate() {
        const passage = makeInstance(multiversalPassage.id, {
            id: "passage",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
            // A previous existence's stale choice must not survive (CR 400.7).
            chosenSubtypes: ["Plains"],
        });
        const courser = makeInstance(courserOfKruphix.id, {
            id: "courser",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    life: 20,
                    battlefield: [courser],
                    graveyard: [passage],
                }),
                makePlayer("p2"),
            ],
        });
        state.activePlayerId = "p1";
        pushSpell(state, LAND_REANIMATION.id, "p1", [
            { type: "graveyard-card", id: "passage", playerId: "p1" },
        ]);
        resolveTopOfStack(state);
        return { state, player: getPlayer(state, "p1") };
    }

    it("raises the type pick first, then the pay-choice; the spell finishes resolving between them", () => {
        withTemporaryDefinition(LAND_REANIMATION, () => {
            const { state, player } = reanimate();
            const first = state.pendingChoices?.[0];
            expect(first?.asEntersKind).toBe("subtypes");
            expect(state.pendingChoices).toHaveLength(1);
            expect(onBattlefield(player)).toBeUndefined();

            submitChoice(state, ["Swamp"]);
            const second = state.pendingChoices?.[0];
            expect(second?.kind).toBe("land-entry-tapped");
            expect(second?.landSourceZone).toBe("battlefield");
            // The parked resolution resumed and completed: the stackless
            // pay-choice never holds a resolution (ADR 0051).
            expect(state.stack).toHaveLength(0);
            // Provisional, as ADR 0051 enters it — but already TYPED.
            const land = onBattlefield(player)!;
            expect(land.isTapped).toBe(true);
            expect(land.chosenSubtypes).toEqual(["Swamp"]);
            expect(land.subtypes).toEqual(["Swamp"]);
        });
    });

    it("pay → untapped, typed, no land drop (CR 305.2)", () => {
        withTemporaryDefinition(LAND_REANIMATION, () => {
            const { state, player } = reanimate();
            submitChoice(state, ["Forest"]);
            applyLandEntrySubmit(state, { playerId: "p1", accept: true });

            const land = onBattlefield(player)!;
            expect(land.isTapped).toBe(false);
            expect(player.life).toBe(18);
            expect(land.subtypes).toEqual(["Forest"]);
            expect(getBasicLandMana(land)).toBe("G");
            expect(player.landsPlayedThisTurn ?? 0).toBe(0);
            expect(state.pendingChoices ?? []).toHaveLength(0);
            // CR 603.6a — the deferred entry is announced only now.
            expect(state.stack.map((i) => i.triggeredAbilityId)).toEqual([
                "courser-of-kruphix-landfall",
            ]);
        });
    });
});

describe("Multiversal Passage — wire format (issue #2672)", () => {
    // The client sees only the projection: both prompts, in order, and the
    // typed land, must survive `projectPublicState` for the chooser.
    it("projects the type pick, then the pay-choice, then the typed land", () => {
        const { state, player } = passageIn("hand");
        applyPlayLand(state, player, "passage");

        const first = projectPublicState(state, 1, "p1");
        expect(first.pendingChoices?.[0]?.asEntersKind).toBe("subtypes");
        expect(first.pendingChoices?.[0]?.options?.map((o) => o.id)).toContain(
            "Swamp"
        );
        expect(first.stagedEntries?.[0]?.card.id).toBe("passage");

        submitChoice(state, ["Swamp"]);
        const second = projectPublicState(state, 1, "p1");
        expect(second.pendingChoices?.[0]?.kind).toBe("land-entry-tapped");
        expect(second.pendingChoices).toHaveLength(1);

        applyLandEntrySubmit(state, { playerId: "p1", accept: false });
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players
            .find((p) => p.id === "p1")!
            .battlefield.find((c) => c.id === "passage")!;
        expect(slim.isTapped).toBe(true);
        expect(slim.subtypes).toEqual(["Swamp"]);
    });
});
