// Per-card behavior tests for colorless cards in `convex/cards/sets/arn/colorless.ts`
// (ARN, split by colour per ADR 0043). Each non-trivial card gets a describe
// block citing the CR section it exercises; assertions check external behavior
// only (effective P/T, damage, zone, combat outcome).

import { describe, it, expect } from "vitest";
import {
    aladdinsLamp,
    aladdinsRing,
    bazaarOfBaghdad,
    bottleOfSuleiman,
    brassMan,
    cityOfBrass,
    desert,
    ebonyHorse,
    elephantGraveyard,
    fishliverOil,
    flyingCarpet,
    islandOfWakWak,
    jandorsRing,
    jandorsSaddlebags,
    libraryOfAlexandria,
    oasis,
    pyramids,
    warElephant,
} from "..";
import {
    forest,
    grizzlyBears,
    mountain,
    plains,
    prodigalSorcerer,
    stoneRain,
} from "../../lea";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import { projectPublicState } from "../../../../gameProjections";
import { getEffectivePower } from "../../../../gre/layers";
import {
    applyPendingChoiceSubmit,
    applyRandomRevealAck,
} from "../../../../gre/pendingChoiceSubmit";
import { advancePhase, applyAllCombatDamage } from "../../../../gre/phases";
import { getLegalTargets, NO_TARGETING_SOURCE } from "../../../../gre/rules";
import {
    canPayDiscardLastDrawn,
    type CardInstanceState,
    drawCard,
    type GameState,
    getPlayer,
    payDiscardLastDrawn,
    resolveTopOfStack,
    type StackItem,
} from "../../../../gre/state";
import {
    resolveActivated,
    resolveTrigger,
    answerChoice,
    upkeepEvent,
    WIN_SEED,
    LOSE_SEED,
} from "./helpers";

describe("ARN keyword creatures (CR 702 — staticAbilities)", () => {
    it("War Elephant has trample and banding", () => {
        expect(warElephant.staticAbilities).toEqual(
            expect.arrayContaining(["trample", "banding"])
        );
    });
});

describe("Jandor's Saddlebags ({3},{T}: untap target creature)", () => {
    it("untaps a tapped creature", () => {
        const bags = makeInstance(jandorsSaddlebags.id, { id: "bags" });
        const tapped = makeInstance(grizzlyBears.id, {
            id: "bear",
            isTapped: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bags, tapped] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, bags, "jandors-saddlebags-untap", [
            { type: "permanent", id: "bear" },
        ]);
        expect(
            state.players[0].battlefield.find((c) => c.id === "bear")!.isTapped
        ).toBe(false);
    });
});

describe("Flying Carpet ({2},{T}: target creature gains flying EOT)", () => {
    it("grants flying to the target", () => {
        const carpet = makeInstance(flyingCarpet.id, { id: "carpet" });
        const bear = makeInstance(grizzlyBears.id, { id: "bear" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [carpet, bear] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, carpet, "flying-carpet-grant", [
            { type: "permanent", id: "bear" },
        ]);
        expect(
            state.players[0].battlefield
                .find((c) => c.id === "bear")!
                .staticAbilities.includes("flying")
        ).toBe(true);
    });
});

describe("Aladdin's Ring ({8},{T}: 4 damage to any target)", () => {
    it("deals 4 damage to a player", () => {
        const ring = makeInstance(aladdinsRing.id, { id: "ring" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [ring] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, ring, "aladdins-ring-bolt", [
            { type: "player", id: "p2" },
        ]);
        expect(state.players[1].life).toBe(16);
    });
});

describe("Jandor's Ring ({2},{T}, discard last drawn: Draw a card)", () => {
    // drawCard records the last-drawn card per player (CR — Jandor's Ring).
    it("drawCard tracks the last card drawn this turn", () => {
        const p1 = makePlayer("p1", {
            library: [
                makeInstance(grizzlyBears.id, { id: "a", zone: "library" }),
                makeInstance(plains.id, { id: "b", zone: "library" }),
            ],
        });
        const state = makeState({ players: [p1, makePlayer("p2")] });
        const player = state.players[0];
        expect(player.lastDrawnCardId).toBeUndefined();
        const first = drawCard(player);
        expect(first?.id).toBe("a");
        expect(player.lastDrawnCardId).toBe("a");
        drawCard(player);
        expect(player.lastDrawnCardId).toBe("b");
    });

    it("can pay the discard cost only while the drawn card is still in hand", () => {
        const p1 = makePlayer("p1", {
            library: [
                makeInstance(grizzlyBears.id, { id: "a", zone: "library" }),
            ],
        });
        const state = makeState({ players: [p1, makePlayer("p2")] });
        const player = state.players[0];
        // No draw yet — cost unpayable.
        expect(canPayDiscardLastDrawn(player)).toBe(false);
        drawCard(player);
        expect(canPayDiscardLastDrawn(player)).toBe(true);
        // Card leaves hand (played/discarded elsewhere) — cost unpayable again.
        player.hand = [];
        expect(canPayDiscardLastDrawn(player)).toBe(false);
    });

    it("paying discards the last-drawn card and clears the tracker", () => {
        const p1 = makePlayer("p1", {
            library: [
                makeInstance(grizzlyBears.id, { id: "a", zone: "library" }),
            ],
        });
        const state = makeState({ players: [p1, makePlayer("p2")] });
        const player = state.players[0];
        drawCard(player);
        expect(player.hand.map((c) => c.id)).toEqual(["a"]);
        payDiscardLastDrawn(state, player);
        expect(player.hand).toHaveLength(0);
        expect(player.graveyard.map((c) => c.id)).toEqual(["a"]);
        expect(player.lastDrawnCardId).toBeUndefined();
        // Cost can no longer be paid — same draw can't fund a second use.
        expect(canPayDiscardLastDrawn(player)).toBe(false);
    });

    it("resolving the ability draws a card", () => {
        const ring = makeInstance(jandorsRing.id, { id: "ring" });
        const p1 = makePlayer("p1", {
            battlefield: [ring],
            library: [makeInstance(plains.id, { id: "top", zone: "library" })],
        });
        const state = makeState({ players: [p1, makePlayer("p2")] });
        resolveActivated(state, ring, "jandors-ring-draw");
        expect(state.players[0].hand.map((c) => c.id)).toEqual(["top"]);
    });

    it("wire format: lastDrawnCardId and the drawn hand card survive projection", () => {
        const p1 = makePlayer("p1", {
            library: [
                makeInstance(grizzlyBears.id, { id: "a", zone: "library" }),
            ],
        });
        const state = makeState({ players: [p1, makePlayer("p2")] });
        drawCard(state.players[0]);
        const projected = projectPublicState(state, 1, "p1");
        const me = projected.players.find((p) => p.id === "p1")!;
        expect(me.lastDrawnCardId).toBe("a");
        // The viewer's own hand keeps the card id (slimmed but identifiable),
        // so the UI can gate the discard cost on it.
        expect(me.hand.some((c) => c !== null && c.id === "a")).toBe(true);
    });
});

describe("City of Brass (becomes tapped → 1 damage; {T}: any color)", () => {
    it("deals 1 damage to its controller when it becomes tapped", () => {
        const city = makeInstance(cityOfBrass.id, { id: "city" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [city] }),
                makePlayer("p2"),
            ],
        });
        resolveTrigger(state, city, "city-of-brass-tap-damage", {
            type: "PERMANENT_TAPPED",
            permanentId: "city",
            controllerId: "p1",
        } as StackItem["triggerEvent"]);
        expect(state.players[0].life).toBe(19);
    });
});

describe("Elephant Graveyard ({T}: regenerate target Elephant)", () => {
    it("stacks a regeneration shield on an Elephant", () => {
        const grave = makeInstance(elephantGraveyard.id, { id: "grave" });
        const elephant = makeInstance(warElephant.id, { id: "ele" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [grave, elephant] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, grave, "elephant-graveyard-regen", [
            { type: "permanent", id: "ele" },
        ]);
        expect(
            state.players[0].battlefield.find((c) => c.id === "ele")!
                .regenerationShields
        ).toBe(1);
    });
});

describe("Library of Alexandria ({T}: draw if exactly 7 cards in hand)", () => {
    function setup(handSize: number) {
        const lib = makeInstance(libraryOfAlexandria.id, { id: "lib" });
        const hand = Array.from({ length: handSize }, (_, i) =>
            makeInstance(plains.id, { id: `h${i}`, zone: "hand" })
        );
        const library = [
            makeInstance(mountain.id, { id: "top", zone: "library" }),
        ];
        return makeState({
            players: [
                makePlayer("p1", { battlefield: [lib], hand, library }),
                makePlayer("p2"),
            ],
        });
    }
    it("can activate the draw with exactly seven cards", () => {
        const state = setup(7);
        const ability = libraryOfAlexandria.activatedAbilities?.find(
            (a) => a.id === "library-of-alexandria-draw"
        );
        const lib = state.players[0].battlefield[0];
        expect(
            ability?.canActivate?.(
                { ...lib, controllerId: "p1" } as never,
                state as never
            )
        ).toBe(true);
    });
    it("cannot activate the draw with six cards", () => {
        const state = setup(6);
        const ability = libraryOfAlexandria.activatedAbilities?.find(
            (a) => a.id === "library-of-alexandria-draw"
        );
        const lib = state.players[0].battlefield[0];
        expect(
            ability?.canActivate?.(
                { ...lib, controllerId: "p1" } as never,
                state as never
            )
        ).toBe(false);
    });

    // Regression guard (#436): the server's activation gate rejects an attempt
    // when `canActivate` is false. The production handler in game.ts validates
    // `if (ability.canActivate && !ability.canActivate(card, state)) throw`.
    // We mirror that exact gate against the real GRE state so the seven-card
    // rule stays authoritative even though the UI hint now surfaces it.
    function serverGate(handSize: number): { activatable: boolean } {
        const state = setup(handSize);
        const ability = (libraryOfAlexandria.activatedAbilities ?? []).find(
            (a) => a.id === "library-of-alexandria-draw"
        )!;
        const card = { ...state.players[0].battlefield[0], controllerId: "p1" };
        const activatable =
            ability.canActivate === undefined ||
            ability.canActivate(card as never, state as never);
        return { activatable };
    }
    it("server gate rejects the draw at 6/8 cards, allows it at exactly 7", () => {
        expect(serverGate(6).activatable).toBe(false);
        expect(serverGate(7).activatable).toBe(true);
        expect(serverGate(8).activatable).toBe(false);
    });
});

describe("Brass Man (does-not-untap + pay {1} to untap on upkeep)", () => {
    it("paying {1} untaps it on upkeep", () => {
        const brass = makeInstance(brassMan.id, {
            id: "brass",
            isTapped: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [brass] }),
                makePlayer("p2"),
            ],
        });
        state.players[0].manaPool = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 1 };
        resolveTrigger(
            state,
            brass,
            "brass-man-untap-option",
            upkeepEvent("p1")
        );
        answerChoice(state, ["yes"]);
        expect(
            state.players[0].battlefield.find((c) => c.id === "brass")!.isTapped
        ).toBe(false);
    });
});

describe("Oasis ({T}: prevent next 1 damage to target creature, CR 615.1)", () => {
    it("prevents the next 1 damage dealt to the target creature", () => {
        const oasisLand = makeInstance(oasis.id, { id: "oasis" });
        const bear = makeInstance(grizzlyBears.id, { id: "bear" });
        const tim = makeInstance(prodigalSorcerer.id, { id: "tim" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [oasisLand, bear, tim] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, oasisLand, "oasis-prevent", [
            { type: "permanent", id: "bear" },
        ]);
        // Tim zaps the shielded bear for 1 — fully prevented.
        resolveActivated(state, tim, "prodigal-sorcerer-zap", [
            { type: "permanent", id: "bear" },
        ]);
        const survivor = state.players[0].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(survivor.damageMarked ?? 0).toBe(0);
    });
});

describe("Ebony Horse ({2},{T}: untap attacker + prevent its combat damage both ways, CR 615)", () => {
    it("untaps the target and records the immunity shield", () => {
        const horse = makeInstance(ebonyHorse.id, { id: "horse" });
        const attacker = makeInstance(grizzlyBears.id, {
            id: "atk",
            isAttacking: true,
            isTapped: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [horse, attacker] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, horse, "ebony-horse-untap", [
            { type: "permanent", id: "atk" },
        ]);
        const a = state.players[0].battlefield.find((c) => c.id === "atk")!;
        expect(a.isTapped).toBe(false);
        expect(
            state.combatDamageImmunity?.some((s) => s.instanceId === "atk")
        ).toBe(true);
    });

    it("prevents all combat damage to and by the shielded creature", () => {
        const attacker = makeInstance(grizzlyBears.id, {
            id: "atk",
            controllerId: "p1",
            ownerId: "p1",
            isAttacking: true,
        });
        const blocker = makeInstance(grizzlyBears.id, {
            id: "blk",
            controllerId: "p2",
            ownerId: "p2",
            isBlocking: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [attacker] }),
                makePlayer("p2", { battlefield: [blocker] }),
            ],
            combat: {
                attackerIds: ["atk"],
                confirmed: true,
                blockerAssignments: { blk: ["atk"] },
                blockersConfirmed: true,
            },
            combatDamageImmunity: [
                { instanceId: "atk", duration: { phase: "end-of-turn" } },
            ],
        });
        applyAllCombatDamage(state, { atk: { blk: 2 } });
        const a = state.players[0].battlefield.find((c) => c.id === "atk");
        const b = state.players[1].battlefield.find((c) => c.id === "blk");
        // Neither dealt damage to the other — both survive unmarked.
        expect(a?.damageMarked ?? 0).toBe(0);
        expect(b?.damageMarked ?? 0).toBe(0);
        expect(state.players[0].battlefield).toHaveLength(1);
        expect(state.players[1].battlefield).toHaveLength(1);
    });
});

describe("Pyramids (modal destroy-aura / save land, CR 614 + ADR 0020)", () => {
    it("mode 1 destroys a target Aura", () => {
        const pyr = makeInstance(pyramids.id, { id: "pyr" });
        const land = makeInstance(forest.id, { id: "land" });
        const aura = makeInstance(fishliverOil.id, {
            id: "aura",
            attachedTo: "land",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [pyr, land, aura] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, pyr, "pyramids-destroy-aura", [
            { type: "permanent", id: "aura" },
        ]);
        expect(
            state.players[0].battlefield.find((c) => c.id === "aura")
        ).toBeUndefined();
        expect(state.players[0].graveyard.some((c) => c.id === "aura")).toBe(
            true
        );
    });

    it("mode 2 saves the target land from the next destruction this turn", () => {
        const pyr = makeInstance(pyramids.id, { id: "pyr" });
        const land = makeInstance(mountain.id, {
            id: "land",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [pyr] }),
                makePlayer("p2", { battlefield: [land] }),
            ],
        });
        resolveActivated(state, pyr, "pyramids-save-land", [
            { type: "permanent", id: "land" },
        ]);
        // Stone Rain would destroy the land — the shield replaces it.
        pushSpell(state, stoneRain.id, "p1", [
            { type: "permanent", id: "land" },
        ]);
        resolveTopOfStack(state);
        expect(
            state.players[1].battlefield.find((c) => c.id === "land")
        ).toBeDefined();
        // Survives through the public projection (wire format).
        const projected = projectPublicState(state, 1, "p1");
        expect(
            projected.players[1].battlefield.find((c) => c.id === "land")
        ).toBeDefined();
        // Shield consumed — a second Stone Rain destroys it.
        pushSpell(state, stoneRain.id, "p1", [
            { type: "permanent", id: "land" },
        ]);
        resolveTopOfStack(state);
        expect(
            state.players[1].battlefield.find((c) => c.id === "land")
        ).toBeUndefined();
    });
});

describe("Island of Wak-Wak ({T}: target flyer base power 0)", () => {
    it("sets a flyer's base power to 0", () => {
        const isl = makeInstance(islandOfWakWak.id, { id: "wakwak" });
        const flyer = makeInstance(grizzlyBears.id, {
            id: "flyer",
            controllerId: "p2",
            ownerId: "p2",
            staticAbilities: ["flying"],
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [isl] }),
                makePlayer("p2", { battlefield: [flyer] }),
            ],
        });
        resolveActivated(state, isl, "island-of-wak-wak-set-power", [
            { type: "permanent", id: "flyer" },
        ]);
        const f = state.players[1].battlefield.find((c) => c.id === "flyer")!;
        expect(getEffectivePower(state, f)).toBe(0);
    });
    it("only flyers are legal targets (requireAbility)", () => {
        const flyer = makeInstance(grizzlyBears.id, {
            id: "flyer",
            staticAbilities: ["flying"],
        });
        const ground = makeInstance(grizzlyBears.id, { id: "ground" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [flyer, ground] }),
                makePlayer("p2"),
            ],
        });
        const req = islandOfWakWak.activatedAbilities![0].targetRequirement!;
        const legal = getLegalTargets(
            state,
            req,
            NO_TARGETING_SOURCE,
            "p1"
        ).map((t) => t.id);
        expect(legal).toContain("flyer");
        expect(legal).not.toContain("ground");
    });
});

describe("Desert (mana + end-of-combat ping)", () => {
    it("taps for {C} and pings an attacking creature for 1", () => {
        expect(desert.subtypes).toContain("Desert");
        const manaAbility = desert.activatedAbilities!.find(
            (a) => a.id === "desert-mana"
        )!;
        expect(manaAbility.manaProduced).toEqual({ C: 1 });

        const des = makeInstance(desert.id, { id: "des" });
        const attacker = makeInstance(grizzlyBears.id, {
            id: "atk",
            controllerId: "p2",
            ownerId: "p2",
            isAttacking: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [des] }),
                makePlayer("p2", { battlefield: [attacker] }),
            ],
        });
        resolveActivated(state, des, "desert-ping", [
            { type: "permanent", id: "atk" },
        ]);
        expect(
            state.players[1].battlefield.find((c) => c.id === "atk")
                ?.damageMarked
        ).toBe(1);
    });

    // CR 511.2 — attackers remain attacking until the END_OF_COMBAT step
    // *ends*. Regression for #310: Desert can only be activated during
    // END_OF_COMBAT and targets an attacking creature; clearing the attacking
    // status on step entry made `getLegalTargets` return nothing and threw
    // "No legal targets available".
    it("an attacker is still a legal Desert target throughout END_OF_COMBAT", () => {
        const pingAbility = desert.activatedAbilities!.find(
            (a) => a.id === "desert-ping"
        )!;
        const des = makeInstance(desert.id, { id: "des" });
        const attacker = makeInstance(grizzlyBears.id, {
            id: "atk",
            controllerId: "p2",
            ownerId: "p2",
            isAttacking: true,
        });
        // Active player p2 has the attacker; defending p1 controls the Desert.
        const state = makeState({
            phase: "COMBAT_DAMAGE",
            activePlayerId: "p2",
            priorityPlayerId: "p2",
            combat: {
                attackerIds: ["atk"],
                confirmed: true,
                blockerAssignments: {},
                blockersConfirmed: true,
            },
            players: [
                makePlayer("p1", { battlefield: [des] }),
                makePlayer("p2", { battlefield: [attacker] }),
            ],
        });

        // COMBAT_DAMAGE → END_OF_COMBAT: the attacker must STILL be attacking.
        advancePhase(state);
        expect(state.phase).toBe("END_OF_COMBAT");
        const atkInCombat = state.players[1].battlefield.find(
            (c) => c.id === "atk"
        )!;
        expect(atkInCombat.isAttacking).toBe(true);

        // ...and therefore a legal target for Desert's "target attacking
        // creature" ability (caster = the Desert's controller, p1).
        const legal = getLegalTargets(
            state,
            pingAbility.targetRequirement!,
            NO_TARGETING_SOURCE,
            "p1"
        );
        expect(
            legal.some((t) => t.type === "permanent" && t.id === "atk")
        ).toBe(true);

        // Leaving END_OF_COMBAT ends combat: the status clears (CR 511.2).
        advancePhase(state);
        expect(state.phase).toBe("POSTCOMBAT_MAIN");
        expect(
            state.players[1].battlefield.find((c) => c.id === "atk")
                ?.isAttacking
        ).toBeUndefined();
        expect(state.combat).toBeUndefined();
    });
});

describe("Bottle of Suleiman (random-reveal coin flip, CR 705 / ADR 0023)", () => {
    /** Build a fresh state with Bottle in play, seeded for a known first flip. */
    function setup(seed: number) {
        const bottle = makeInstance(bottleOfSuleiman.id, {
            id: "bottle",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            rngSeed: seed,
            players: [
                makePlayer("p1", { life: 20, battlefield: [bottle] }),
                makePlayer("p2"),
            ],
        });
        return { state, bottle };
    }

    /** Acknowledge the head random-reveal choice to resume resolution. */
    function ack(state: GameState) {
        const head = state.pendingChoices![0];
        applyRandomRevealAck(state, {
            playerId: head.playerId,
            stackItemId: head.stackItemId,
            choiceId: head.choiceId,
        });
    }

    it("suspends on a random-reveal choice BEFORE applying the consequence", () => {
        const { state, bottle } = setup(WIN_SEED);
        resolveActivated(state, bottle, "bottle-of-suleiman-flip");

        // Resolution is suspended on a random-reveal pending choice.
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("random-reveal");
        expect(head.playerId).toBe("p1");
        expect(head.randomKind).toBe("coin");
        expect(head.sides).toBe(2);
        // WIN seed → result 1 (heads), realized WIN face + Djinn consequence.
        expect(head.result).toBe(1);
        expect(head.realized).toEqual({
            face: "WIN",
            consequence: "Create a 5/5 flying Djinn",
        });
        // The consequence has NOT been applied yet (reveal precedes apply).
        expect(state.players[0].battlefield.filter((c) => c.isToken)).toEqual(
            []
        );
        expect(state.players[0].life).toBe(20);
    });

    it("flipCoin runs exactly once: rngCounter advances by 1 across suspend/resume (WIN)", () => {
        const { state, bottle } = setup(WIN_SEED);
        const before = state.rngCounter;
        resolveActivated(state, bottle, "bottle-of-suleiman-flip");
        // The bit was drawn once on suspend.
        expect(state.rngCounter).toBe(before + 1);
        ack(state);
        // Resume reads the persisted outcome — no re-roll.
        expect(state.rngCounter).toBe(before + 1);

        // WIN consequence applied only after the ack.
        const tokens = state.players[0].battlefield.filter((c) => c.isToken);
        expect(tokens).toHaveLength(1);
        const djinn = tokens[0];
        expect(djinn.types).toEqual(["Artifact", "Creature"]);
        expect(djinn.subtypes).toContain("Djinn");
        expect(djinn.power).toBe(5);
        expect(djinn.toughness).toBe(5);
        expect(djinn.staticAbilities).toContain("flying");
        expect(state.players[0].life).toBe(20);
        // Choice cleared, stack empty.
        expect(state.pendingChoices).toBeUndefined();
        expect(state.stack.length).toBe(0);
    });

    it("flipCoin runs exactly once: rngCounter advances by 1 across suspend/resume (LOSE)", () => {
        const { state, bottle } = setup(LOSE_SEED);
        const before = state.rngCounter;
        resolveActivated(state, bottle, "bottle-of-suleiman-flip");
        const head = state.pendingChoices![0];
        expect(head.result).toBe(0);
        expect(head.realized).toEqual({
            face: "LOSE",
            consequence: "Bottle of Suleiman deals 5 damage to you",
        });
        expect(state.rngCounter).toBe(before + 1);
        // Damage NOT yet applied.
        expect(state.players[0].life).toBe(20);

        ack(state);
        expect(state.rngCounter).toBe(before + 1);
        // LOSE consequence applied: 5 damage, no token.
        expect(state.players[0].life).toBe(15);
        expect(state.players[0].battlefield.filter((c) => c.isToken)).toEqual(
            []
        );
        expect(state.pendingChoices).toBeUndefined();
    });

    it("wire format: random-reveal fields survive projection for BOTH viewers", () => {
        const { state, bottle } = setup(WIN_SEED);
        resolveActivated(state, bottle, "bottle-of-suleiman-flip");

        for (const viewerId of ["p1", "p2"]) {
            const projected = projectPublicState(state, 1, viewerId);
            const head = projected.pendingChoices![0];
            expect(head.kind).toBe("random-reveal");
            expect(head.randomKind).toBe("coin");
            expect(head.result).toBe(1);
            // The result is public (CR 705) — both the flipper and the
            // opponent see the realized face + consequence.
            expect(head.realized).toEqual({
                face: "WIN",
                consequence: "Create a 5/5 flying Djinn",
            });
        }
    });

    it("ack mutation rejects a mismatched head (stack item / choice id)", () => {
        const { state, bottle } = setup(WIN_SEED);
        resolveActivated(state, bottle, "bottle-of-suleiman-flip");
        const head = state.pendingChoices![0];
        expect(() =>
            applyRandomRevealAck(state, {
                playerId: head.playerId,
                stackItemId: "wrong",
                choiceId: head.choiceId,
            })
        ).toThrow();
        // Unchanged: still suspended.
        expect(state.pendingChoices![0].kind).toBe("random-reveal");
        // Sanity: ack resumes only on the correct identity (silences getPlayer).
        ack(state);
        expect(getPlayer(state, "p1").battlefield.some((c) => c.isToken)).toBe(
            true
        );
    });
});

describe("Aladdin's Lamp (#189) — replace the next draw with look-X-keep-one", () => {
    /** Activate the Lamp's {X},{T} ability with the given X, arming the
     *  replacement on its controller. Resolves through the real stack. */
    function activateLamp(
        state: GameState,
        lamp: CardInstanceState,
        x: number
    ) {
        state.stack.push({
            ...lamp,
            zone: "stack",
            castById: lamp.controllerId,
            abilityId: "aladdins-lamp-look",
            chosenX: x,
            targets: [],
        });
        resolveTopOfStack(state);
    }

    it("arms a turn-scoped draw replacement on activation", () => {
        const lamp = makeInstance(aladdinsLamp.id, { id: "lamp" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [lamp] }),
                makePlayer("p2"),
            ],
        });
        activateLamp(state, lamp, 3);
        expect(state.drawLookReplacements).toEqual([{ playerId: "p1", x: 3 }]);
    });

    it("X = 0 is a no-op (CR 107.3 — X can't be 0)", () => {
        const lamp = makeInstance(aladdinsLamp.id, { id: "lamp" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [lamp] }),
                makePlayer("p2"),
            ],
        });
        activateLamp(state, lamp, 0);
        expect(state.drawLookReplacements).toBeUndefined();
    });

    it("the draw step looks at the top X, keeps one, bottoms the rest, and draws the kept card", () => {
        const lamp = makeInstance(aladdinsLamp.id, { id: "lamp" });
        // Library top→bottom: c0, c1, c2, c3 (deeper).
        const lib = ["c0", "c1", "c2", "c3"].map((id) =>
            makeInstance(grizzlyBears.id, {
                id,
                controllerId: "p1",
                zone: "library",
            })
        );
        const state = makeState({
            turn: 2,
            phase: "UPKEEP",
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            players: [
                makePlayer("p1", { battlefield: [lamp], library: lib }),
                makePlayer("p2"),
            ],
        });
        activateLamp(state, lamp, 3);
        // Advance UPKEEP → DRAW: the replacement fires and suspends on a choice.
        advancePhase(state);
        const head = state.pendingChoices?.[0];
        expect(head?.kind).toBe("draw-look-keep");
        expect(head?.candidateIds).toEqual(["c0", "c1", "c2"]); // top 3
        expect(state.players[0].hand).toHaveLength(0); // not drawn yet

        // Keep c2 (the third card looked at).
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: "",
            step: 0,
            choiceId: "draw-look-p1",
            cardInstanceIds: ["c2"],
        });

        // c2 is drawn; the replacement is consumed.
        expect(state.players[0].hand.map((c) => c.id)).toEqual(["c2"]);
        expect(state.drawLookReplacements).toBeUndefined();
        // c3 (below the looked-at window) is now on top; c0 and c1 are bottomed.
        const libIds = state.players[0].library.map((c) => c.id);
        expect(libIds[0]).toBe("c3");
        expect(libIds.slice(1).sort()).toEqual(["c0", "c1"]);
    });

    it("expires at the start of the next turn if never consumed", () => {
        const lamp = makeInstance(aladdinsLamp.id, { id: "lamp" });
        const state = makeState({
            turn: 2,
            phase: "POSTCOMBAT_MAIN",
            activePlayerId: "p1",
            players: [
                makePlayer("p1", {
                    battlefield: [lamp],
                    library: [
                        makeInstance(grizzlyBears.id, {
                            id: "lone",
                            controllerId: "p1",
                            zone: "library",
                        }),
                    ],
                }),
                makePlayer("p2", {
                    library: [
                        makeInstance(grizzlyBears.id, {
                            id: "p2lib",
                            controllerId: "p2",
                            zone: "library",
                        }),
                    ],
                }),
            ],
        });
        activateLamp(state, lamp, 3);
        expect(state.drawLookReplacements).toHaveLength(1);
        // Run to end of turn → p2's turn begins → the replacement is cleared.
        for (let i = 0; i < 12 && state.activePlayerId === "p1"; i++) {
            advancePhase(state);
        }
        expect(state.activePlayerId).toBe("p2");
        expect(state.drawLookReplacements).toBeUndefined();
    });
});

describe("Bazaar of Baghdad ({T}: Draw two cards, then discard three cards)", () => {
    // Each filler card is a distinct grizzly-bear instance in the named zone.
    const libCard = (id: string) =>
        makeInstance(grizzlyBears.id, {
            id,
            controllerId: "p1",
            zone: "library",
        });
    const handCard = (id: string) =>
        makeInstance(grizzlyBears.id, { id, controllerId: "p1", zone: "hand" });

    function bazaarState(libIds: string[], handIds: string[]): GameState {
        const bazaar = makeInstance(bazaarOfBaghdad.id, {
            id: "bazaar",
            controllerId: "p1",
            zone: "battlefield",
        });
        return makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [bazaar],
                    library: libIds.map(libCard),
                    hand: handIds.map(handCard),
                }),
                makePlayer("p2"),
            ],
        });
    }

    const bazaarInstance = (state: GameState) =>
        state.players[0].battlefield.find((c) => c.id === "bazaar")!;

    it("draws two BEFORE suspending for the discard choice, drawing exactly once (CR 121.6, 701.8)", () => {
        const state = bazaarState(
            ["l1", "l2", "l3", "l4", "l5"],
            ["h1", "h2", "h3", "h4"]
        );

        // Step 0 (draw two) commits, then step 1 suspends on the discard choice.
        resolveActivated(
            state,
            bazaarInstance(state),
            "bazaar-of-baghdad-draw-discard"
        );

        const p1 = () => state.players[0];
        // Draw happened exactly once: library 5 → 3, hand 4 → 6. A re-running
        // single `resolve` would have drawn twice (library 1) — the bug this
        // card was deferred for.
        expect(p1().library).toHaveLength(3);
        expect(p1().hand).toHaveLength(6);
        expect(state.pendingChoices).toHaveLength(1);
        expect(state.pendingChoices![0].choiceId).toBe("bazaar-discard");
        // Still on the stack while suspended.
        expect(state.stack).toHaveLength(1);

        // Discard three of the six held cards.
        answerChoice(state, ["h1", "h2", "l1"]);

        // Library unchanged by the discard (no second draw): still 3.
        expect(p1().library).toHaveLength(3);
        expect(p1().hand).toHaveLength(3);
        expect(p1().graveyard).toHaveLength(3);
        expect(
            p1()
                .graveyard.map((c) => c.id)
                .sort()
        ).toEqual(["h1", "h2", "l1"]);
        expect(state.stack).toHaveLength(0);
        expect(state.pendingChoices ?? []).toHaveLength(0);

        // Wire format — the visible draw/discard survives projection.
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.players[0].hand).toHaveLength(3);
        expect(projected.players[0].graveyard).toHaveLength(3);
        expect(projected.players[0].library.count).toBe(3);
    });

    it("clamps the discard to hand size when fewer than three cards are held", () => {
        // Library 3, empty hand → draw two → hand 2 → discard min(3,2)=2.
        const state = bazaarState(["l1", "l2", "l3"], []);
        resolveActivated(
            state,
            bazaarInstance(state),
            "bazaar-of-baghdad-draw-discard"
        );

        expect(state.players[0].hand).toHaveLength(2);
        expect(state.pendingChoices).toHaveLength(1);

        answerChoice(state, ["l1", "l2"]);
        expect(state.players[0].hand).toHaveLength(0);
        expect(state.players[0].graveyard).toHaveLength(2);
        expect(state.players[0].library).toHaveLength(1);
        expect(state.stack).toHaveLength(0);
    });
});
