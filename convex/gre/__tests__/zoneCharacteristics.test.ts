// CR 113.6c — "An ability that states which zones it doesn't function in
// functions everywhere except for the specified zones." Grist, the Hunger Tide
// ("As long as Grist isn't on the battlefield, it's a 1/1 Insect creature")
// declares it, and `gre/zoneCharacteristics.ts` materialises it onto the
// instance so every reader of `types` / `power` sees it without knowing the
// module exists.
//
// WHAT THIS FILE GUARDS, and why it isn't in the Grist card test: the OFF
// direction (a card landing in a hidden zone gains the characteristics) is
// covered card-side, but the ON direction — a permanent ENTERING the
// battlefield having them stripped — has to hold at EVERY battlefield-entry
// path, and the two paths the Grist test can reach (a resolving permanent
// spell, a put-onto-battlefield effect) are not the only ones. The general
// zone-mover `moveCard` and the cross-player `moveCardAcrossPlayers` also take
// cards to the battlefield, via the four land-play paths, and no shipped card
// is BOTH a land and zone-conditional — so the only way to prove those two
// paths clear is a synthetic land that declares the ability. The header of
// `clearZoneCharacteristics` enumerates the entry sites as a closed list;
// these tests are what stops that list from being a claim nobody checked.
//
// The synthetic definitions also exercise a second property: they are
// registered through `preloadDefinitions` AFTER module load, so a green run
// proves the registry-side `declaresOffBattlefieldCharacteristics` index
// (`cards/registry.ts`) — the precheck that keeps the state-based-action sweep
// cheap — is maintained by the registry's write funnel rather than snapshotted
// once at import time.

import { describe, it, expect } from "vitest";
import { preloadDefinitions } from "../../cards";
import type { CardDefinition } from "../../cards/types";
import {
    makeState,
    makePlayer,
    makeInstance,
} from "../../cards/__tests__/setup";
import { applyPlayLand, applyPlayLandFromExile } from "../playLand";
import { checkStateBasedActions } from "../sba";
import { compactState, expandState } from "../serialize";
import { planDrawStep } from "../state";
import { buildSpellContext, flushPendingEvents } from "../state";
import { pushSpell } from "../../cards/__tests__/setup";

// A land that is a 1/1 Insect creature everywhere except the battlefield —
// Grist's shape transplanted onto a card type that reaches the battlefield
// through `moveCard` instead of through spell resolution.
const ZONE_LAND_ID = "00000000-0000-4000-8000-00002391f001";
// Grist's shape again, on a non-land permanent, so the REANIMATION entry path
// can reach it — the one path where the entry type line (issue #2993) and
// `clearZoneCharacteristics` both write `types` in the same breath.
const ZONE_REANIMATABLE_ID = "00000000-0000-4000-8000-00002391f002";

// Grist's shape on a card whose printed type line is NOT a permanent type, so
// `isPermanentCard` genuinely FLIPS between the printed line and the zone one
// (issue #3278): a bug that read the definition would answer "no" in a
// graveyard where the right answer is "yes".
const ZONE_SORCERY_ID = "00000000-0000-4000-8000-00002391f003";

preloadDefinitions([
    {
        id: ZONE_LAND_ID,
        name: "Synthetic Zone-Conditional Land",
        rarity: "rare",
        manaCost: {},
        types: ["Land"],
        offBattlefieldCharacteristics: {
            addTypes: ["Creature"],
            addSubtypes: ["Insect"],
            power: 1,
            toughness: 1,
        },
    } as CardDefinition,
    {
        id: ZONE_REANIMATABLE_ID,
        name: "Synthetic Zone-Conditional Permanent",
        rarity: "rare",
        manaCost: { generic: 2 },
        types: ["Artifact"],
        subtypes: ["Clue"],
        offBattlefieldCharacteristics: {
            addTypes: ["Creature"],
            addSubtypes: ["Insect"],
            power: 1,
            toughness: 1,
        },
    } as CardDefinition,
    {
        id: ZONE_SORCERY_ID,
        name: "Synthetic Zone-Conditional Sorcery",
        rarity: "rare",
        manaCost: { generic: 1 },
        types: ["Sorcery"],
        offBattlefieldCharacteristics: {
            addTypes: ["Creature"],
            addSubtypes: ["Insect"],
            power: 1,
            toughness: 1,
        },
    } as CardDefinition,
]);

describe("off-battlefield characteristics on battlefield entry (CR 113.6c)", () => {
    it("strips them when a land is played from hand (moveCard)", () => {
        const land = makeInstance(ZONE_LAND_ID, { zone: "hand" });
        const p1 = makePlayer("p1", { hand: [land] });
        const state = makeState({ players: [p1, makePlayer("p2")] });

        // In hand the ability functions: the SBA sweep materialises the
        // off-battlefield characteristics and the card IS a 1/1 Insect
        // creature. (Also the precheck's own proof — a definition registered
        // after module load still gets swept.)
        checkStateBasedActions(state);
        expect(land.types).toContain("Creature");
        expect(land.subtypes).toContain("Insect");
        expect(land.power).toBe(1);

        const entered = applyPlayLand(state, state.players[0], land.id);

        expect(entered).not.toBeNull();
        expect(entered!.zone).toBe("battlefield");
        // On the battlefield the ability switches off — printed land, no P/T.
        expect(entered!.types).toEqual(["Land"]);
        expect(entered!.subtypes ?? []).not.toContain("Insect");
        expect(entered!.power).toBeUndefined();
        expect(entered!.toughness).toBeUndefined();
    });

    it("an entry type line SURVIVES the strip — applied after clearZoneCharacteristics, not before (issue #2993, PR #3023 review B2)", () => {
        // Both writers rewrite `types`/`subtypes` on the way in:
        // `clearZoneCharacteristics` restores the PRINTED line for a card
        // declaring `offBattlefieldCharacteristics` (CR 113.6c), and
        // `applyEntryTypeLine` installs the line the effect says the permanent
        // enters with (CR 205.1a / 613.1d — "return it to the battlefield.
        // It's an enchantment."). Ordered the other way round, the entry line
        // is silently clobbered while its layer-4 provenance records are left
        // behind, and the ETB event announces the printed line — the exact bug
        // issue #2993 fixed, resurfacing on this one card shape.
        const victim = makeInstance(ZONE_REANIMATABLE_ID, {
            id: "zone-victim",
            ownerId: "p1",
            controllerId: "p1",
            zone: "graveyard",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { graveyard: [victim] }),
                makePlayer("p2"),
            ],
        });

        // In the graveyard the ability functions: it IS a 1/1 Insect creature.
        checkStateBasedActions(state);
        expect(victim.types).toContain("Creature");

        const item = pushSpell(state, ZONE_LAND_ID, "p1");
        const ctx = buildSpellContext(state, item);
        const entered = ctx.returnToBattlefield(
            "p1",
            "zone-victim",
            "graveyard",
            undefined,
            { entersAs: { types: ["Enchantment"], subtypes: [] } }
        );

        expect(entered).toBe(true);
        const back = state.players[0].battlefield.find(
            (c) => c.id === "zone-victim"
        )!;
        // The entry line won: not the off-battlefield Creature/Insect, and not
        // the printed Artifact — Clue either.
        expect(back.types).toEqual(["Enchantment"]);
        expect(back.subtypes).toEqual([]);
        expect(back.power).toBeUndefined();
        // And the entry EVENT announced it (CR 603.6a) — the whole point.
        const events = flushPendingEvents(state);
        const entry = events.find(
            (e) =>
                e.type === "PERMANENT_ENTERED" && e.instanceId === "zone-victim"
        );
        expect(entry).toBeDefined();
        expect(entry!.type === "PERMANENT_ENTERED" && entry!.types).toEqual([
            "Enchantment",
        ]);
    });

    it("strips them when a land is played from an OPPONENT's exile (moveCardAcrossPlayers)", () => {
        // issue #1156 — a cross-player play grant (Dauthi Voidwalker) takes a
        // card out of the OPPONENT's exile straight onto the caster's
        // battlefield, the one entry path `moveCard` cannot serve.
        const land = makeInstance(ZONE_LAND_ID, {
            zone: "exile",
            ownerId: "p2",
            controllerId: "p2",
            castableFromExileBy: "p1",
            castableFromExileIncludesLand: true,
        });
        const p1 = makePlayer("p1");
        const p2 = makePlayer("p2", { exile: [land] });
        const state = makeState({ players: [p1, p2] });

        checkStateBasedActions(state);
        expect(land.types).toContain("Creature");

        const entered = applyPlayLandFromExile(
            state,
            state.players[0],
            land.id
        );

        expect(entered).not.toBeNull();
        expect(entered!.zone).toBe("battlefield");
        expect(state.players[0].battlefield).toContain(entered);
        expect(entered!.types).toEqual(["Land"]);
        expect(entered!.power).toBeUndefined();
        expect(entered!.toughness).toBeUndefined();
    });
});

// The FAMILY A snapshot readers (`gre/zoneCharacteristics.ts` census): the two
// `SpellContext` accessors that answer "what IS this object" for a
// per-target-shape reference. Every `bind` snapshot goes through them
// (`effects/interpreter.ts` `bindSnapshot` → SNAP_TYPES / SNAP_SUBTYPES /
// SNAP_NAME / SNAP_IS_PERMANENT_CARD), so a hidden-zone card read off its
// printed definition makes every "if it WAS a creature card" gate answer on
// the wrong type line (issue #3278: Agatha's Soul Cauldron exiling Grist).
//
// These read the accessors DIRECTLY rather than through a card, deliberately:
// the defect is a reader family, and the card-level proof (Agatha's Soul
// Cauldron, `sets/woe/__tests__/colorless.test.ts`) exercises exactly one of
// the four target shapes.
describe("off-battlefield characteristics through the snapshot readers (CR 113.6c)", () => {
    function contextFor(state: ReturnType<typeof makeState>) {
        return buildSpellContext(state, pushSpell(state, ZONE_LAND_ID, "p1"));
    }

    it("getCharacteristics reports the ZONE types of a graveyard card", () => {
        const card = makeInstance(ZONE_REANIMATABLE_ID, {
            id: "gy-card",
            zone: "graveyard",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { graveyard: [card] }),
                makePlayer("p2"),
            ],
        });

        // No SBA sweep in between — the accessor consults the registry itself
        // (FAMILY A), so it must be right before anything materialises the
        // characteristics onto the instance.
        const chars = contextFor(state).getCharacteristics({
            type: "graveyard-card",
            id: "gy-card",
            playerId: "p1",
        });

        expect(chars).toBeDefined();
        expect(chars!.types).toContain("Creature");
        expect(chars!.types).toContain("Artifact");
        expect(chars!.subtypes).toContain("Insect");
        expect(chars!.name).toBe("Synthetic Zone-Conditional Permanent");
    });

    it("getCharacteristics reports the PRINTED types of the same card on the battlefield", () => {
        // CR 113.6c switches the ability off on the battlefield — the negative
        // half of the pair, and what stops the fix from being "always add the
        // off-battlefield types".
        const card = makeInstance(ZONE_REANIMATABLE_ID, {
            id: "bf-card",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [card] }),
                makePlayer("p2"),
            ],
        });

        const chars = contextFor(state).getCharacteristics({
            type: "permanent",
            id: "bf-card",
        });

        expect(chars).toBeDefined();
        expect(chars!.types).not.toContain("Creature");
        expect(chars!.subtypes).not.toContain("Insect");
    });

    it("getCharacteristics reports the ZONE types of a hand card", () => {
        const card = makeInstance(ZONE_REANIMATABLE_ID, {
            id: "hand-card",
            zone: "hand",
        });
        const state = makeState({
            players: [makePlayer("p1", { hand: [card] }), makePlayer("p2")],
        });

        const chars = contextFor(state).getCharacteristics({
            type: "hand-card",
            id: "hand-card",
            playerId: "p1",
        });

        expect(chars!.types).toContain("Creature");
        expect(chars!.subtypes).toContain("Insect");
    });

    it("isPermanentCard is TRUE for a non-permanent card that is a creature card in a graveyard", () => {
        // The discriminating shape: printed `Sorcery` (not a permanent type),
        // `Creature` in every zone but the battlefield (CR 110.1).
        const card = makeInstance(ZONE_SORCERY_ID, {
            id: "gy-sorcery",
            zone: "graveyard",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { graveyard: [card] }),
                makePlayer("p2"),
            ],
        });

        expect(
            contextFor(state).isPermanentCard({
                type: "graveyard-card",
                id: "gy-sorcery",
                playerId: "p1",
            })
        ).toBe(true);
    });

    it("isPermanentCard is TRUE for the same card in hand, FALSE on the battlefield", () => {
        const inHand = makeInstance(ZONE_SORCERY_ID, {
            id: "hand-sorcery",
            zone: "hand",
        });
        // A Sorcery never legitimately reaches the battlefield; the instance is
        // placed there directly to assert the reader's battlefield BRANCH keeps
        // reading the printed line.
        const onBattlefield = makeInstance(ZONE_SORCERY_ID, {
            id: "bf-sorcery",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    hand: [inHand],
                    battlefield: [onBattlefield],
                }),
                makePlayer("p2"),
            ],
        });
        const ctx = contextFor(state);

        expect(
            ctx.isPermanentCard({
                type: "hand-card",
                id: "hand-sorcery",
                playerId: "p1",
            })
        ).toBe(true);
        expect(
            ctx.isPermanentCard({ type: "permanent", id: "bf-sorcery" })
        ).toBe(false);
    });

    it("a card on the STACK is read in its stack zone, not as a battlefield object", () => {
        // CR 113.6c names the battlefield as the only zone the ability is off
        // in — a spell on the stack still has the off-battlefield line, and a
        // `spell`-shaped reference is the fourth target shape both readers
        // dispatch on.
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        const item = pushSpell(state, ZONE_SORCERY_ID, "p1");
        const ctx = buildSpellContext(state, item);

        expect(
            ctx.getCharacteristics({ type: "spell", id: item.id })!.types
        ).toContain("Creature");
        expect(ctx.isPermanentCard({ type: "spell", id: item.id })).toBe(true);
    });
});

// The two FAMILY A readers a review of PR #3297 found still unrouted — the same
// defect class as the snapshot accessors above, on the LIBRARY rather than the
// graveyard/hand. Both are reached through a real entry point here, not called
// directly: `topCardHasType` is module-private and the serialization boundary
// is only observable through a full round trip.
describe("off-battlefield characteristics on the LIBRARY (CR 113.6c)", () => {
    /** Enduring Renewal — "If you would draw a card, reveal the top card of
     *  your library instead. If it's a creature card, put it into your
     *  graveyard." The one shipped card whose behaviour turns on the top
     *  library card's TYPE. */
    const ENDURING_RENEWAL = "be77edac-9a8b-4b7f-a859-27df76b10aa6";

    it("survives the persistence round trip, which REBUILDS a library card from its definition", () => {
        // A library card is compacted to `[instanceId, cardId]` — its type line
        // is not stored, it is rebuilt on expand. Rebuilt from the printed
        // definition, every DB round trip silently undoes the materialisation
        // and FAMILY B's guarantee leaks away between saves.
        const card = makeInstance(ZONE_SORCERY_ID, {
            id: "lib-card",
            zone: "library",
        });
        const state = makeState({
            players: [makePlayer("p1", { library: [card] }), makePlayer("p2")],
        });
        checkStateBasedActions(state);
        expect(card.types).toContain("Creature");

        const back = expandState(compactState(state));

        const restored = back.players[0].library.find(
            (c) => c.id === "lib-card"
        )!;
        expect(restored.types).toContain("Creature");
        expect(restored.types).toContain("Sorcery");
        expect(restored.subtypes).toContain("Insect");
        expect(restored.power).toBe(1);
        expect(restored.toughness).toBe(1);
    });

    it("makes Enduring Renewal bin a top card that is a creature card only off the battlefield", () => {
        // `topCardHasType` reads the top of the LIBRARY, so it must read it in
        // that zone — the same shape `millCards` uses for the graveyard.
        const renewal = makeInstance(ENDURING_RENEWAL, {
            id: "renewal",
            controllerId: "p1",
        });
        const top = makeInstance(ZONE_SORCERY_ID, {
            id: "lib-top",
            zone: "library",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [renewal],
                    library: [top],
                }),
                makePlayer("p2"),
            ],
        });

        expect(planDrawStep(state, "p1", 1, true)).toEqual({ kind: "bin" });
    });

    it("still draws normally when the top card is a creature card in NO zone", () => {
        // The negative half — otherwise "always bin" passes the test above.
        const renewal = makeInstance(ENDURING_RENEWAL, {
            id: "renewal",
            controllerId: "p1",
        });
        // Animate Dead — an Enchantment in every zone, so the gate has to
        // discriminate rather than bin whatever is on top.
        const top = makeInstance("8fd7861d-925f-4b4c-a4ab-60be6f43d50b", {
            id: "lib-top",
            zone: "library",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [renewal],
                    library: [top],
                }),
                makePlayer("p2"),
            ],
        });

        expect(planDrawStep(state, "p1", 1, true)).toEqual({
            kind: "normal",
            count: 1,
        });
    });
});
