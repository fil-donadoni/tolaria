// Per-card behavior tests for red cards in `convex/cards/sets/drk/red.cards.ts`
// (The Dark, split by colour per ADR 0043). Each non-trivial card gets a
// describe block citing the CR section it exercises; set-wide registry-parity
// checks live in colorless.test.ts. Shared stack/resolve shims live in
// ./helpers; fixtures stay in convex/cards/__tests__/setup.helper.ts.

import { describe, it, expect } from "vitest";
import { answerChoice, resolveTrigger } from "./set.helper";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
    resolveActivated,
} from "../../../__tests__/setup.helper";
import { projectPublicState } from "../../../../gameProjections";
import {
    abilitiesSuppressed,
    getActivatedManaAbility,
    getBasicLandMana,
    getBasicLandManaColors,
    hasManaAbility,
} from "../../../../gre/constants";
import { effectiveTriggeredAbilities } from "../../../../gre/copy";
import {
    getEffectivePower,
    getEffectiveToughness,
} from "../../../../gre/layers";
import { getProducibleManaOptions } from "../../../../gre/rules";
import {
    type CardInstanceState,
    type GameState,
    type StackItem,
    applyExistingGrantsTo,
    beginApplyingStaticEffects,
    resolveTopOfStack,
    stopApplyingStaticEffects,
} from "../../../../gre/state";
import { getDefinition } from "../../../index";
import { applyRandomRevealAck } from "../../../../gre/pendingChoiceSubmit";
import { compactState, expandState } from "../../../../gre/serialize";

const ballLightning = getDefinition("c1ba83ab-83f5-421d-bba1-0f925870b5c8");
const bloodMoon = getDefinition("78373616-e2d6-4ccf-998f-09f02bea45b4");
const cavePeople = getDefinition("72746a5d-faa1-44b7-97b5-0ef9302a3c13");
const eternalFlame = getDefinition("d646feea-3c20-4737-8d20-ffad42258ced");
const goblinCaves = getDefinition("c6a415b0-00a2-4a65-8994-4a395c50ae2d");
const goblinHero = getDefinition("7135a569-e5d3-4a1f-924b-bdb86926b4e1");
const goblinRockSled = getDefinition("91e0b59d-8f9b-4a76-9845-bcb0dc32523d");
const goblinShrine = getDefinition("cd69a6dc-27f3-42aa-9e63-4417796e4ef5");
const goblinWizard = getDefinition("9b73dfb4-d930-4a89-b621-129dd9f6328c");
const goblinsOfTheFlarg = getDefinition("fd333b18-b896-4ab8-9c46-eed4efdd94f2");
const manaClash = getDefinition("72955141-d990-459f-adbe-7d3d0f5f6c95");
const orcGeneral = getDefinition("65a10fd5-506e-46bf-87e6-fde134c0dc04");
const stripMine = getDefinition("e7880157-7f27-4f1b-9cdc-ab36a6252376");
const urzasMine = getDefinition("ddf85792-470b-4b42-99ac-9cb43a575523");
const startingTown = getDefinition("fc7d1912-7e27-49ef-bd98-375d975a42b0");
const mountain = getDefinition("eace2c85-976c-425e-9800-5a6ccbd91b56");
const tropicalIsland = getDefinition("a9c6c759-aabf-44e7-ba8c-33c5df232b56");

// ───────────────────────────────────────────────────────────────────────────
// Blood Moon — {2}{R} Enchantment, "Nonbasic lands are Mountains." (#419)
// CR 305.7 type-changing + CR 611/613 layer system (layer 4 subtype-set +
// layer 6 ability-loss).
// ───────────────────────────────────────────────────────────────────────────

/** Puts Blood Moon on p1's battlefield plus the given nonbasic land, then
 *  applies the enchantment's continuous static effects to the board. */
function withBloodMoon(landCardId: string = tropicalIsland.id): {
    state: GameState;
    moon: CardInstanceState;
    land: CardInstanceState;
} {
    const state = makeState();
    const moon = makeInstance(bloodMoon.id, {
        id: "moon-1",
        controllerId: "p1",
        zone: "battlefield",
    });
    const land = makeInstance(landCardId, {
        id: "land-1",
        controllerId: "p2",
        zone: "battlefield",
    });
    state.players[0].battlefield.push(moon);
    state.players[1].battlefield.push(land);
    beginApplyingStaticEffects(state, moon);
    return { state, moon, land };
}

describe("Blood Moon ({2}{R} Enchantment — CR 305.7 subtype-set + CR 613.1f ability-loss)", () => {
    it("turns a nonbasic dual land into a Mountain (subtype replaced) — CR 305.7", () => {
        const { land } = withBloodMoon();
        expect(land.subtypes).toEqual(["Mountain"]);
        // Tropical Island's printed Forest/Island types are gone.
        expect(land.subtypes).not.toContain("Forest");
        expect(land.subtypes).not.toContain("Island");
    });

    it("strips the dual land's printed activated mana ability — CR 613.1f", () => {
        const { land } = withBloodMoon();
        expect(abilitiesSuppressed(land)).toBe(true);
        expect(land.abilitiesSuppressedBy).toEqual([
            { sourceId: "moon-1", seq: expect.any(Number) },
        ]);
        // Its {G}/{U} abilities were the intrinsic Forest / Island ones (CR
        // 305.6, issue #5623), gone with the subtypes; no printed one remains.
        expect(getActivatedManaAbility(land)).toBeNull();
        // It still HAS a mana ability — the intrinsic Mountain one.
        expect(hasManaAbility(land)).toBe(true);
    });

    it("affected land taps for {R} via intrinsic basic-land mana — CR 305.6", () => {
        const { land } = withBloodMoon();
        expect(getBasicLandMana(land)).toBe("R");
    });

    it("producible-mana planner offers ONLY {R} (no original G/U) — planner/handler sync", () => {
        const { land } = withBloodMoon();
        const options = getProducibleManaOptions(land);
        expect([...options.keys()]).toEqual(["R"]);
        expect(options.has("G")).toBe(false);
        expect(options.has("U")).toBe(false);
    });

    it("leaves BASIC lands untouched (basic Mountain keeps its type, no suppression)", () => {
        const { land } = withBloodMoon(mountain.id);
        expect(land.subtypes).toEqual(["Mountain"]);
        expect(abilitiesSuppressed(land)).toBe(false);
        expect(land.abilitiesSuppressedBy).toBeUndefined();
        expect(getBasicLandMana(land)).toBe("R");
    });

    it("does NOT touch a basic land of another color (Island stays an Island)", () => {
        const island = makeInstance(
            getDefinition("90a57c0e-fa61-45ef-955d-d296403967d5").id,
            {
                id: "isl-1",
                controllerId: "p2",
                zone: "battlefield",
            }
        );
        const state = makeState();
        const moon = makeInstance(bloodMoon.id, {
            id: "moon-1",
            controllerId: "p1",
            zone: "battlefield",
        });
        state.players[0].battlefield.push(moon);
        state.players[1].battlefield.push(island);
        beginApplyingStaticEffects(state, moon);
        expect(island.subtypes).toEqual(["Island"]);
        expect(getBasicLandMana(island)).toBe("U");
    });

    it("affects a nonbasic land that ENTERS after Blood Moon resolves (applyExistingGrantsTo)", () => {
        const { state } = withBloodMoon();
        const newLand = makeInstance(tropicalIsland.id, {
            id: "land-2",
            controllerId: "p1",
            zone: "battlefield",
        });
        state.players[0].battlefield.push(newLand);
        applyExistingGrantsTo(state, newLand);
        expect(newLand.subtypes).toEqual(["Mountain"]);
        expect(newLand.abilitiesSuppressedBy).toEqual([
            { sourceId: "moon-1", seq: expect.any(Number) },
        ]);
        expect(getBasicLandMana(newLand)).toBe("R");
    });

    it("reverts the land cleanly when Blood Moon leaves play (stopApplyingStaticEffects)", () => {
        const { state, moon, land } = withBloodMoon();
        stopApplyingStaticEffects(state, moon);
        // Printed subtypes restored; their intrinsic mana abilities (CR 305.6)
        // function again.
        expect(land.subtypes).toEqual(["Forest", "Island"]);
        expect(abilitiesSuppressed(land)).toBe(false);
        expect(land.abilitiesSuppressedBy).toBeUndefined();
        expect(getBasicLandManaColors(land)).toEqual(["G", "U"]);
        const options = getProducibleManaOptions(land);
        expect(options.has("G")).toBe(true);
        expect(options.has("U")).toBe(true);
        expect(options.has("R")).toBe(false);
    });

    it("strips a UTILITY land's non-mana ability and rewrites its mana to {R} (Strip Mine)", () => {
        // Strip Mine: "{T}: Add {C}" + "{T}, Sacrifice: Destroy target land".
        // Under Blood Moon it loses BOTH printed abilities (suppressed) and taps
        // for {R} from the Mountain subtype instead of {C}.
        const { land } = withBloodMoon(stripMine.id);
        expect(land.subtypes).toEqual(["Mountain"]);
        expect(abilitiesSuppressed(land)).toBe(true);
        // The {T}: Add {C} ability no longer functions; only intrinsic {R}.
        expect(getActivatedManaAbility(land)).toBeNull();
        expect(getBasicLandMana(land)).toBe("R");
        expect(effectiveTriggeredAbilities(land)).toHaveLength(0);
        const options = getProducibleManaOptions(land);
        expect([...options.keys()]).toEqual(["R"]);
        expect(options.has("C")).toBe(false);
    });

    // CR 305.7 narrowing (issue #1883): "If an effect sets a land's subtype
    // to one or more of the basic land types, the land no longer has its old
    // land type[s]" — ONLY the land types are removed. A subtype belonging to
    // a different card type (Saga, CR 205.3h) survives. Urza's Saga itself
    // isn't shipped yet (#1884); this synthetic `Enchantment Land — Urza's
    // Saga`-shaped fixture proves the narrowing independent of that card.
    it("keeps a non-land subtype (Saga) and replaces only the land type — CR 305.7 (issue #1883)", () => {
        const state = makeState();
        const moon = makeInstance(bloodMoon.id, {
            id: "moon-1",
            controllerId: "p1",
            zone: "battlefield",
        });
        const sagaLand = makeInstance(tropicalIsland.id, {
            id: "saga-land-1",
            controllerId: "p2",
            zone: "battlefield",
            types: ["Land", "Enchantment"],
            subtypes: ["Urza's", "Saga"],
        });
        state.players[0].battlefield.push(moon);
        state.players[1].battlefield.push(sagaLand);
        beginApplyingStaticEffects(state, moon);
        // Urza's (a land type, CR 205.3i) is gone, replaced by Mountain.
        expect(sagaLand.subtypes).toContain("Mountain");
        expect(sagaLand.subtypes).not.toContain("Urza's");
        // Saga (an enchantment type, CR 205.3h) is untouched.
        expect(sagaLand.subtypes).toContain("Saga");
        expect(sagaLand.subtypes).toHaveLength(2);
        expect(getBasicLandMana(sagaLand)).toBe("R");

        // Wire format (MANDATORY): the surviving Saga subtype must cross the
        // projection to the client along with the new Mountain type.
        const projected = projectPublicState(state, 1, "p2");
        const slim = projected.players[1].battlefield.find(
            (c) => c.id === "saga-land-1"
        )!;
        expect(slim.subtypes).toContain("Mountain");
        expect(slim.subtypes).toContain("Saga");
        expect(slim.subtypes).not.toContain("Urza's");
    });

    // Regression (issue #1883 review finding): a REAL shipped Urza land
    // (`atq/colorless.ts`) stores its subtype as the two CR 205.3i tokens
    // `["Urza's", "Mine"/"Power-Plant"/"Tower"]` — not the compound
    // `"Urza's Mine"` string this PR's predecessor shipped, which never
    // matched `LAND_TYPES` and let the Urza subtype (and its now-invalid
    // mana ability) survive underneath the new Mountain type. Exercises the
    // production path end to end: `beginApplyingStaticEffects` + Blood Moon on
    // an actual `CardDefinition`, not a synthetic fixture.
    it("strips a REAL Urza land's subtype down to just Mountain (issue #1883 regression)", () => {
        const { land } = withBloodMoon(urzasMine.id);
        expect(land.subtypes).toEqual(["Mountain"]);
        expect(land.subtypes).not.toContain("Urza's");
        expect(land.subtypes).not.toContain("Mine");
        expect(abilitiesSuppressed(land)).toBe(true);
        expect(getActivatedManaAbility(land)).toBeNull();
        expect(getBasicLandMana(land)).toBe("R");
    });

    // Regression (issue #1883 review finding): Starting Town (FIN) carries
    // "Town" — a CR 205.3i land type omitted from `LAND_TYPES` by this PR's
    // predecessor. Same production path as the Urza-land case above.
    it("strips Starting Town's subtype down to just Mountain (issue #1883 regression)", () => {
        const { land } = withBloodMoon(startingTown.id);
        expect(land.subtypes).toEqual(["Mountain"]);
        expect(land.subtypes).not.toContain("Town");
        expect(abilitiesSuppressed(land)).toBe(true);
        expect(getBasicLandMana(land)).toBe("R");
    });

    // Wire format (MANDATORY for staticEffects): the Mountain subtype and the
    // producible {R} must survive projection to the client (CR rule re-checked
    // on the slimmed PublicGameState).
    it("wire format: Mountain subtype + producible {R} survive projectPublicState", () => {
        const { state } = withBloodMoon();
        const projected = projectPublicState(state, 1, "p2");
        const slim = projected.players[1].battlefield.find(
            (c) => c.id === "land-1"
        )!;
        expect(slim.subtypes).toEqual(["Mountain"]);
        expect(getBasicLandMana(slim as unknown as CardInstanceState)).toBe(
            "R"
        );
        expect(abilitiesSuppressed(slim as unknown as CardInstanceState)).toBe(
            true
        );
        const options = getProducibleManaOptions(
            slim as unknown as CardInstanceState
        );
        expect([...options.keys()]).toEqual(["R"]);
    });
});

describe("Goblin Hero (vanilla creature, CR 302)", () => {
    it("resolves from the stack onto the battlefield (CR 608.3)", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        const item = pushSpell(state, goblinHero.id, "p1");
        resolveTopOfStack(state);
        const inPlay = state.players[0].battlefield.find(
            (c) => c.id === item.id
        );
        expect(inPlay).toBeDefined();
        expect(inPlay?.zone).toBe("battlefield");
        expect(state.stack).toHaveLength(0);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// RED free tranche (#414)
// ═══════════════════════════════════════════════════════════════════════════

describe("Ball Lightning — trample, haste, end-step sacrifice (CR 702.19 / 702.10 / 603.6a)", () => {
    it("sacrifices itself when its end-step trigger resolves (CR 603.6a)", () => {
        const ball = makeInstance(ballLightning.id, { controllerId: "p1" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [ball] }),
                makePlayer("p2"),
            ],
        });
        resolveTrigger(state, ball, "ball-lightning-end-step-sac", {
            type: "PHASE_BEGIN",
            phase: "END_STEP",
            activePlayerId: "p1",
        } as StackItem["triggerEvent"]);
        expect(
            state.players[0].battlefield.find((c) => c.id === ball.id)
        ).toBeUndefined();
        expect(state.players[0].graveyard.some((c) => c.id === ball.id)).toBe(
            true
        );
    });
});

describe("Cave People — attack pump +1/-2 + grant mountainwalk (CR 508 / 702.19)", () => {
    it("gives itself +1/-2 until end of turn when it attacks", () => {
        const cave = makeInstance(cavePeople.id, { controllerId: "p1" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [cave] }),
                makePlayer("p2"),
            ],
        });
        resolveTrigger(state, cave, "cave-people-attack-pump", {
            type: "ATTACKERS_DECLARED",
            attackingPlayerId: "p1",
            attackerIds: [cave.id],
        } as StackItem["triggerEvent"]);
        const ref = { type: "permanent" as const, id: cave.id };
        expect(getEffectivePower(state, cave)).toBe(2); // 1 + 1
        expect(getEffectiveToughness(state, cave)).toBe(2); // 4 - 2
        void ref;
    });

    it("grants mountainwalk to a target creature until end of turn", () => {
        const cave = makeInstance(cavePeople.id, { controllerId: "p1" });
        const ally = makeInstance(goblinHero.id, {
            id: "ally",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [cave, ally] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, cave, "cave-people-grant-mountainwalk", [
            { type: "permanent", id: ally.id },
        ]);
        const inPlay = state.players[0].battlefield.find(
            (c) => c.id === ally.id
        )!;
        expect(inPlay.staticAbilities).toContain("mountainwalk");
    });
});

describe("Eternal Flame — X = Mountains; X to target, ceil(X/2) to you (CR 120.3)", () => {
    it("deals X damage to the target and half rounded up to the controller", () => {
        const mtnId = getDefinition("eace2c85-976c-425e-9800-5a6ccbd91b56").id;
        const mtns = [0, 1, 2].map((i) =>
            makeInstance(mtnId, { id: `mtn-${i}`, controllerId: "p1" })
        );
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: mtns }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, eternalFlame.id, "p1", [{ type: "player", id: "p2" }]);
        resolveTopOfStack(state);
        expect(state.players[1].life).toBe(17); // 20 - 3 Mountains
        expect(state.players[0].life).toBe(18); // 20 - ceil(3/2) = 2
    });
});

describe("Goblin Caves — conditional Goblin anthem +0/+2 (CR 611.2c)", () => {
    it("buffs Goblins +0/+2 only while the enchanted land is a basic Mountain", () => {
        const mtnId = getDefinition("eace2c85-976c-425e-9800-5a6ccbd91b56").id;
        const mtn = makeInstance(mtnId, { id: "mtn", controllerId: "p1" });
        const goblin = makeInstance(goblinHero.id, {
            id: "gob",
            controllerId: "p1",
        });
        const caves = makeInstance(goblinCaves.id, {
            id: "caves",
            controllerId: "p1",
            attachedTo: mtn.id,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [mtn, goblin, caves] }),
                makePlayer("p2"),
            ],
        });
        expect(getEffectiveToughness(state, goblin)).toBe(4); // 2 + 2
        expect(getEffectivePower(state, goblin)).toBe(2);

        // Wire-format guard: the anthem survives projection.
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === goblin.id
        )!;
        expect(getEffectiveToughness(projected, slim)).toBe(4);
    });

    it("does nothing while enchanting a nonbasic / non-Mountain land", () => {
        const tropId = tropicalIsland.id; // dual land, not a basic Mountain
        const trop = makeInstance(tropId, { id: "trop", controllerId: "p1" });
        const goblin = makeInstance(goblinHero.id, {
            id: "gob",
            controllerId: "p1",
        });
        const caves = makeInstance(goblinCaves.id, {
            id: "caves",
            controllerId: "p1",
            attachedTo: trop.id,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [trop, goblin, caves] }),
                makePlayer("p2"),
            ],
        });
        expect(getEffectiveToughness(state, goblin)).toBe(2); // no buff
    });
});

describe("Goblin Digging Team — {T}, Sac this: destroy target Wall (CR 701.8)", () => {
    it("destroys a Wall creature", () => {
        const wallId = getDefinition("140e567c-6e4a-42b0-8084-d6c9695ae802").id;
        const wall = makeInstance(wallId, {
            id: "wall",
            controllerId: "p2",
            ownerId: "p2",
        });
        const team = makeInstance("8a538b9d-351e-40bb-be11-9ba08c16352b", {
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [team] }),
                makePlayer("p2", { battlefield: [wall] }),
            ],
        });
        resolveActivated(state, team, "goblin-digging-team-ability", [
            { type: "permanent", id: wall.id },
        ]);
        expect(
            state.players[1].battlefield.find((c) => c.id === wall.id)
        ).toBeUndefined();
    });
});

describe("Goblin Rock Sled — attack restriction + arm-skip-untap (CR 508.1c / 502.1)", () => {
    it("can't attack unless the defender controls a Mountain", () => {
        const sled = makeInstance(goblinRockSled.id, { controllerId: "p1" });
        const restriction = goblinRockSled.staticEffects?.find(
            (e) => e.kind === "attack-restriction"
        );
        expect(restriction).toBeDefined();
        // Predicate: false with no Mountain on the defender, true with one.
        const pred = (
            restriction as {
                predicate: (self: unknown, defenders: unknown[]) => boolean;
            }
        ).predicate;
        expect(pred(sled, [])).toBe(false);
        expect(pred(sled, [{ subtypes: ["Mountain"] }])).toBe(true);
    });

    it("arms skipNextUntap when it attacks", () => {
        const sled = makeInstance(goblinRockSled.id, { controllerId: "p1" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [sled] }),
                makePlayer("p2"),
            ],
        });
        resolveTrigger(state, sled, "goblin-rock-sled-arm-skip-untap", {
            type: "ATTACKERS_DECLARED",
            attackingPlayerId: "p1",
            attackerIds: [sled.id],
        } as StackItem["triggerEvent"]);
        const inPlay = state.players[0].battlefield.find(
            (c) => c.id === sled.id
        )!;
        expect(inPlay.skipNextUntap).toBe(true);
    });
});

describe("Goblin Shrine — conditional Goblin anthem +1/+0 + LTB damage (CR 611 / 603.6)", () => {
    it("buffs Goblins +1/+0 while enchanting a basic Mountain (survives projection)", () => {
        const mtnId = getDefinition("eace2c85-976c-425e-9800-5a6ccbd91b56").id;
        const mtn = makeInstance(mtnId, { id: "mtn", controllerId: "p1" });
        const goblin = makeInstance(goblinHero.id, {
            id: "gob",
            controllerId: "p1",
        });
        const shrine = makeInstance(goblinShrine.id, {
            id: "shrine",
            controllerId: "p1",
            attachedTo: mtn.id,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [mtn, goblin, shrine] }),
                makePlayer("p2"),
            ],
        });
        expect(getEffectivePower(state, goblin)).toBe(3); // 2 + 1
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === goblin.id
        )!;
        expect(getEffectivePower(projected, slim)).toBe(3);
    });

    it("deals 1 damage to each Goblin creature when it leaves (CR 603.6)", () => {
        const goblin = makeInstance(goblinHero.id, {
            id: "gob",
            controllerId: "p1",
        }); // 2/2
        const shrine = makeInstance(goblinShrine.id, {
            id: "shrine",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [goblin, shrine] }),
                makePlayer("p2"),
            ],
        });
        resolveTrigger(state, shrine, "goblin-shrine-leaves", {
            type: "PERMANENT_LEFT",
            instanceId: shrine.id,
        } as StackItem["triggerEvent"]);
        const inPlay = state.players[0].battlefield.find(
            (c) => c.id === goblin.id
        )!;
        expect(inPlay.damageMarked).toBe(1);
    });
});

describe("Goblin Wizard — put Goblin from hand + grant protection from white (CR 400.7 / 702.16)", () => {
    it("puts a chosen Goblin permanent card from hand onto the battlefield", () => {
        const handGoblin = makeInstance(goblinHero.id, {
            id: "hand-gob",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const wizard = makeInstance(goblinWizard.id, { controllerId: "p1" });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [wizard],
                    hand: [handGoblin],
                }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, wizard, "goblin-wizard-put-goblin");
        answerChoice(state, [handGoblin.id]);
        const inPlay = state.players[0].battlefield.find(
            (c) => c.id === handGoblin.id
        );
        expect(inPlay).toBeDefined();
        expect(state.players[0].hand.some((c) => c.id === handGoblin.id)).toBe(
            false
        );
    });

    it("grants protection from white to a target Goblin until end of turn", () => {
        const goblin = makeInstance(goblinHero.id, {
            id: "gob",
            controllerId: "p1",
        });
        const wizard = makeInstance(goblinWizard.id, { controllerId: "p1" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [wizard, goblin] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, wizard, "goblin-wizard-protection", [
            { type: "permanent", id: goblin.id },
        ]);
        const inPlay = state.players[0].battlefield.find(
            (c) => c.id === goblin.id
        )!;
        expect(inPlay.staticAbilities).toContain("protection from white");
    });
});

describe("Goblins of the Flarg — mountainwalk + sac when you control a Dwarf (CR 702.14 / 603.8)", () => {
    it("sacrifices itself when its controller controls a Dwarf", () => {
        const flarg = makeInstance(goblinsOfTheFlarg.id, {
            controllerId: "p1",
        });
        const dwarf = makeInstance(goblinHero.id, {
            id: "dwarf",
            controllerId: "p1",
            subtypes: ["Dwarf"],
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [flarg, dwarf] }),
                makePlayer("p2"),
            ],
        });
        resolveTrigger(state, flarg, "goblins-flarg-dwarf-sac", {
            type: "STATE_CHECK",
        } as StackItem["triggerEvent"]);
        expect(
            state.players[0].battlefield.find((c) => c.id === flarg.id)
        ).toBeUndefined();
    });
});

// Mana Clash — draw-then-reveal (PRD issue #4433, issue #5520).
//
//   705.2  Some effects that instruct a player to flip a coin care only about
//          whether the coin comes up heads or tails. No player wins or loses a
//          coin flip for this kind of effect. …
//   704.3  Whenever a player would get priority …, the game checks for any of
//          the listed conditions for state-based actions …
//
// Every round is drawn up front, so the reveal can show it; SBAs are never
// checked mid-resolution (CR 704.3), so pre-drawing changes no outcome. Seed 19
// draws (you / opponent): T T · T H · H T · H H — four rounds, two tails each.
describe("Mana Clash — every round revealed, then 1 damage per tails (CR 705.2, CR 704.3)", () => {
    function castManaClash(state: GameState): void {
        pushSpell(state, manaClash.id, "p1", [{ type: "player", id: "p2" }]);
        resolveTopOfStack(state);
    }

    function ackReveal(state: GameState): void {
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("random-reveal");
        applyRandomRevealAck(state, {
            playerId: head.playerId,
            stackItemId: head.stackItemId,
            choiceId: head.choiceId,
        });
    }

    function seeded(rngSeed: number): GameState {
        return makeState({
            rngSeed,
            players: [makePlayer("p1"), makePlayer("p2")],
        });
    }

    it("suspends ONCE on the whole clash; the damage lands only after the ack, without a re-roll", () => {
        const state = seeded(19);
        const before = state.rngCounter ?? 0;
        castManaClash(state);

        // One reveal, every round on it: two coins per round, you then the
        // opponent, ending on the first round both came up heads.
        expect(state.pendingChoices).toHaveLength(1);
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("random-reveal");
        expect(head.playerId).toBe("p1");
        const flips = head.flips!;
        expect(flips.map((f) => f.round)).toEqual([0, 0, 1, 1, 2, 2, 3, 3]);
        expect(flips.map((f) => f.flipperId)).toEqual([
            "p1",
            "p2",
            "p1",
            "p2",
            "p1",
            "p2",
            "p1",
            "p2",
        ]);
        expect(flips.map((f) => f.face)).toEqual([
            "tails",
            "tails",
            "tails",
            "heads",
            "heads",
            "tails",
            "heads",
            "heads",
        ]);
        // CR 705.2 — a face-only flip: nobody wins or loses it.
        expect(flips.every((f) => f.outcome === "none")).toBe(true);
        expect(head.faceDamage).toEqual({ heads: 0, tails: 1 });
        // rngCounter advanced twice per round, at the draw.
        const afterDraw = state.rngCounter ?? 0;
        expect(afterDraw - before).toBe(8);
        // Nothing dealt yet: the damage waits for the ack.
        expect(state.players[0].life).toBe(20);
        expect(state.players[1].life).toBe(20);
        expect(state.stack).toHaveLength(1);

        // SURFACE: both seats receive the rounds and the per-face stake.
        for (const seat of ["p1", "p2"]) {
            const seen = projectPublicState(state, 1, seat).pendingChoices![0];
            expect(seen.flips).toHaveLength(8);
            expect(seen.faceDamage).toEqual({ heads: 0, tails: 1 });
            expect(seen.source?.cardId).toBe(manaClash.id);
        }

        // Across a serialize round-trip the ack resumes without re-rolling.
        const reloaded = expandState(compactState(state));
        ackReveal(reloaded);
        expect(reloaded.rngCounter ?? 0).toBe(afterDraw);
        expect(reloaded.players[0].life).toBe(18);
        expect(reloaded.players[1].life).toBe(18);
        expect(reloaded.pendingChoices ?? []).toHaveLength(0);
        expect(reloaded.stack).toHaveLength(0);
    });

    it("deals each tails as its own 1-damage event: a one-shot shield prevents one round, not the clash", () => {
        const state = seeded(19);
        // CR 615.1 — the next damage that would be dealt to the opponent is
        // prevented. Dealt as one event of 2, the shield would eat both.
        state.playerDamagePrevention = [
            {
                playerId: "p2",
                match: {},
                mode: "all",
                remaining: 1,
                duration: { phase: "end-of-turn" },
            },
        ];
        castManaClash(state);
        ackReveal(state);
        expect(state.players[0].life).toBe(18);
        expect(state.players[1].life).toBe(19);
    });

    it("a first round of two heads ends the clash at once, dealing nothing", () => {
        const state = seeded(5); // H H
        castManaClash(state);
        expect(state.pendingChoices![0].flips).toHaveLength(2);
        ackReveal(state);
        expect(state.players[0].life).toBe(20);
        expect(state.players[1].life).toBe(20);
        expect(state.stack).toHaveLength(0);
    });
});

describe("Orc General — {T}, Sac another Orc/Goblin: other Orcs +1/+1 EOT (CR 611.1)", () => {
    it("buffs other Orc creatures the controller controls", () => {
        const general = makeInstance(orcGeneral.id, { controllerId: "p1" });
        const otherOrc = makeInstance(goblinHero.id, {
            id: "orc",
            controllerId: "p1",
            subtypes: ["Orc"],
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [general, otherOrc] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, general, "orc-general-pump");
        expect(getEffectivePower(state, otherOrc)).toBe(3); // 2 + 1
        expect(getEffectiveToughness(state, otherOrc)).toBe(3);
        // The General does NOT buff itself ("Other Orc creatures").
        expect(getEffectivePower(state, general)).toBe(2);
    });
});
