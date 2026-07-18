// Infect + Wither (CR 702.90a/b, issue #1201).
//
// CR 702.90a — "Infect is a static ability. 'Infect' means 'This creature
// deals damage to creatures in the form of -1/-1 counters and to players in
// the form of poison counters.'"
// CR 702.90b — "Wither means 'This permanent's damage isn't marked on a
// creature but is dealt in the form of -1/-1 counters instead.'" (creature
// half only — wither does NOT change player damage).
//
// Modeled on the `markDeathtouchDamage` precedent (deathtouch.test.ts): the
// engine reads the source's EFFECTIVE static-ability set at every damage
// sink (`markInfectWitherDamage` for the shared creature branch,
// `markInfectPoisonDamage` for the infect-only player branch), covers BOTH
// combat (`applyOneCombatDamage`, phases.ts) and non-combat
// (`SpellContext.dealDamage`, state.ts). CR 702.90c — the diverted damage is
// still "damage" for every OTHER purpose (deathtouch, lifelink, damage-dealt
// tallies): only life-loss / damage-marking is replaced.
import { describe, it, expect } from "vitest";
import type { CardInstanceState, GameState, StackItem } from "../state";
import type { CardType } from "../../cards/types";
import { buildSpellContext, markInfectWitherDamage } from "../state";
import { markInfectPoisonDamage } from "../state";
import { applyAllCombatDamage } from "../phases";
import { checkStateBasedActions } from "../sba";
import { getEffectiveToughness } from "../layers";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import { projectPublicState } from "../../gameProjections";
import { grizzlyBears } from "../../cards/sets/lea/green";

function creature(
    id: string,
    power: number,
    toughness: number,
    overrides: Partial<CardInstanceState> = {}
): CardInstanceState {
    return {
        id,
        card: { id: `def-${id}` },
        types: ["Creature"] as CardType[],
        subtypes: [],
        power,
        toughness,
        staticAbilities: [],
        controllerId: "p1",
        ownerId: "p1",
        zone: "battlefield",
        isTapped: false,
        ...overrides,
    };
}

/** p1 (active) attacks with `p1Field`; `p2Field` blocks (or is left empty for
 *  an unblocked-attacker-to-player scenario). */
function combatState(
    p1Field: CardInstanceState[],
    p2Field: CardInstanceState[],
    combat: Partial<GameState["combat"]> & { attackerIds: string[] }
): GameState {
    return makeState({
        phase: "COMBAT_DAMAGE",
        activePlayerId: "p1",
        players: [
            makePlayer("p1", { battlefield: p1Field }),
            makePlayer("p2", { battlefield: p2Field }),
        ],
        combat: {
            confirmed: true,
            blockerAssignments: {},
            blockersConfirmed: true,
            damageConfirmed: false,
            ...combat,
        } as GameState["combat"],
    });
}

describe("markInfectWitherDamage helper edge cases", () => {
    it("does not divert on zero damage", () => {
        const bear = creature("bear", 5, 5);
        const state = makeState();
        expect(markInfectWitherDamage(state, bear, ["infect"], 0)).toBe(false);
        expect(bear.counters).toBeUndefined();
    });

    it("does not divert when the source lacks both keywords", () => {
        const bear = creature("bear", 5, 5);
        const state = makeState();
        expect(markInfectWitherDamage(state, bear, ["flying"], 3)).toBe(false);
        expect(bear.counters).toBeUndefined();
    });

    it("infect diverts damage to -1/-1 counters", () => {
        const bear = creature("bear", 5, 5, {
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bear] }),
                makePlayer("p2"),
            ],
        });
        expect(markInfectWitherDamage(state, bear, ["infect"], 3)).toBe(true);
        expect(bear.counters).toEqual({ "-1/-1": 3 });
        expect(bear.damageMarked ?? 0).toBe(0);
    });

    it("wither diverts damage to -1/-1 counters (creature half, CR 702.90b)", () => {
        const bear = creature("bear", 5, 5, {
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bear] }),
                makePlayer("p2"),
            ],
        });
        expect(markInfectWitherDamage(state, bear, ["wither"], 2)).toBe(true);
        expect(bear.counters).toEqual({ "-1/-1": 2 });
        expect(bear.damageMarked ?? 0).toBe(0);
    });
});

describe("markInfectPoisonDamage helper edge cases", () => {
    it("does not divert on zero damage", () => {
        const state = makeState();
        expect(markInfectPoisonDamage(state, "p2", ["infect"], 0)).toBe(false);
    });

    it("does not divert when the source lacks infect", () => {
        const state = makeState();
        expect(markInfectPoisonDamage(state, "p2", ["flying"], 5)).toBe(false);
    });

    it("wither alone does NOT divert player damage (CR 702.90b is creature-only)", () => {
        const state = makeState();
        expect(markInfectPoisonDamage(state, "p2", ["wither"], 5)).toBe(false);
    });

    it("infect diverts player damage to poison counters", () => {
        const state = makeState();
        expect(markInfectPoisonDamage(state, "p2", ["infect"], 4)).toBe(true);
        expect(state.players[1].poisonCounters).toBe(4);
    });
});

describe("infect combat damage to a player (CR 702.90a)", () => {
    it("an unblocked infect attacker gives poison instead of life loss", () => {
        const toxic = creature("toxic", 3, 3, {
            staticAbilities: ["infect"],
        });
        const state = combatState([toxic], [], {
            attackerIds: ["toxic"],
        });

        applyAllCombatDamage(state, { toxic: { p2: 3 } });

        const p2 = state.players[1];
        expect(p2.life).toBe(20); // unchanged — no life lost
        expect(p2.poisonCounters).toBe(3);
    });
});

describe("wither combat damage to a player is normal life loss (CR 702.90b)", () => {
    it("an unblocked wither attacker deals normal life loss, no poison", () => {
        const withering = creature("withering", 3, 3, {
            staticAbilities: ["wither"],
        });
        const state = combatState([withering], [], {
            attackerIds: ["withering"],
        });

        applyAllCombatDamage(state, { withering: { p2: 3 } });

        const p2 = state.players[1];
        expect(p2.life).toBe(17); // 20 - 3, normal life loss
        expect(p2.poisonCounters ?? 0).toBe(0);
    });
});

describe("infect/wither combat damage to a creature (CR 702.90a/b)", () => {
    it("infect blocker puts -1/-1 counters on the attacker instead of marking damage", () => {
        const ogre = creature("ogre", 5, 5);
        const toxic = creature("toxic", 2, 2, {
            controllerId: "p2",
            ownerId: "p2",
            staticAbilities: ["infect"],
        });
        const state = combatState([ogre], [toxic], {
            attackerIds: ["ogre"],
            blockerAssignments: { toxic: ["ogre"] },
            blockedAttackerIds: ["ogre"],
        });

        applyAllCombatDamage(state, { ogre: { toxic: 5 } });

        const p1 = state.players[0];
        const ogreCard = p1.battlefield.find((c) => c.id === "ogre");
        // The 2/2 infect blocker died to normal 5 damage (>= 2 toughness);
        // the 5/5 attacker took only 2 damage, diverted to -1/-1 counters —
        // NOT marked damage — and survives (5/5 with -2/-2 = 3/3, > 0).
        expect(ogreCard).toBeDefined();
        expect(ogreCard!.counters).toEqual({ "-1/-1": 2 });
        expect(ogreCard!.damageMarked ?? 0).toBe(0);
        expect(getEffectiveToughness(state, ogreCard!)).toBe(3);
    });

    it("wither blocker also puts -1/-1 counters on the attacker (creature half)", () => {
        const ogre = creature("ogre", 5, 5);
        const witherer = creature("witherer", 2, 2, {
            controllerId: "p2",
            ownerId: "p2",
            staticAbilities: ["wither"],
        });
        const state = combatState([ogre], [witherer], {
            attackerIds: ["ogre"],
            blockerAssignments: { witherer: ["ogre"] },
            blockedAttackerIds: ["ogre"],
        });

        applyAllCombatDamage(state, { ogre: { witherer: 5 } });

        const p1 = state.players[0];
        const ogreCard = p1.battlefield.find((c) => c.id === "ogre");
        expect(ogreCard).toBeDefined();
        expect(ogreCard!.counters).toEqual({ "-1/-1": 2 });
        expect(ogreCard!.damageMarked ?? 0).toBe(0);
    });

    it("enough infect damage still destroys the creature via the toughness<=0 SBA", () => {
        const bear = creature("bear", 2, 2);
        const toxic = creature("toxic", 5, 5, {
            controllerId: "p2",
            ownerId: "p2",
            staticAbilities: ["infect"],
        });
        const state = combatState([toxic], [bear], {
            attackerIds: ["toxic"],
            blockerAssignments: { bear: ["toxic"] },
            blockedAttackerIds: ["toxic"],
        });

        applyAllCombatDamage(state, { toxic: { bear: 5 } });
        checkStateBasedActions(state);

        // 5 -1/-1 counters on a 2/2 → -3 effective toughness → dead via the
        // existing getEffectiveToughness<=0 SBA (CR 704.5f), same mechanism
        // any other -1/-1-counter source already relies on.
        const stillThere = state.players[0].battlefield.some(
            (c) => c.id === "bear"
        );
        expect(stillThere).toBe(false);
        const inGraveyard = state.players[0].graveyard.some(
            (c) => c.id === "bear"
        );
        expect(inGraveyard).toBe(true);
    });
});

describe("infect/wither combat damage simultaneity (CR 510.4, issue #1201 regression)", () => {
    // Review found a bug in the original combat-damage branch: it called
    // `markInfectWitherDamage` (which mutates -1/-1 counters onto the
    // recipient IMMEDIATELY) from inside the attacker loop, which runs to
    // completion before the blocker loop starts. An infect/wither attacker's
    // counters therefore shrank the blocker's power BEFORE the blocker loop
    // read `getCardPower` to compute its own outgoing damage — undercounting
    // (or, as below, zeroing out) the blocker's return damage. CR 510.4: all
    // combat damage this step is dealt SIMULTANEOUSLY, each creature's
    // amount based on power AT THE START of the step. The fix defers the
    // -1/-1 counter application to a post-loop flush, mirroring the existing
    // `damageReceived` deferral for normal marked damage.
    it("a 3/3 infect attacker blocked by a 3/3 vanilla blocker: both deal full start-of-step power simultaneously and both die", () => {
        const toxic = creature("toxic", 3, 3, { staticAbilities: ["infect"] });
        const vanilla = creature("vanilla", 3, 3, {
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = combatState([toxic], [vanilla], {
            attackerIds: ["toxic"],
            blockerAssignments: { vanilla: ["toxic"] },
            blockedAttackerIds: ["toxic"],
        });

        applyAllCombatDamage(state, { toxic: { vanilla: 3 } });

        // The attacker's own lethal-marked-damage check runs INSIDE
        // `applyAllCombatDamage` (normal `damageReceived` creatures that hit
        // toughness are destroyed before the function returns), so by the
        // time we inspect state the attacker — if it took its full 3 marked
        // damage — is already in the graveyard. BUGGY behavior would have
        // `blockerPower` read as 0 (shrunk by the attacker's -1/-1 counters
        // before the blocker loop ran), so the attacker would take NO
        // damage and still be alive on the battlefield.
        expect(state.players[0].battlefield.some((c) => c.id === "toxic")).toBe(
            false
        );
        const toxicCard = state.players[0].graveyard.find(
            (c) => c.id === "toxic"
        )!;
        expect(toxicCard).toBeDefined();
        expect(toxicCard.damageMarked).toBe(3);

        // The attacker's infect damage still landed as -1/-1 counters on the
        // blocker — just deferred to after both loops. The blocker is not
        // part of `applyAllCombatDamage`'s own marked-damage lethal scan (its
        // damage is -1/-1 counters, not marked damage), so it's still on the
        // battlefield here, pending the effective-toughness SBA below.
        const vanillaCard = state.players[1].battlefield.find(
            (c) => c.id === "vanilla"
        )!;
        expect(vanillaCard).toBeDefined();
        expect(vanillaCard.counters).toEqual({ "-1/-1": 3 });
        expect(vanillaCard.damageMarked ?? 0).toBe(0);

        checkStateBasedActions(state);

        // The blocker now dies too: 3 -1/-1 counters on a 3/3 -> effective
        // toughness 0 (CR 704.5f).
        expect(
            state.players[1].battlefield.some((c) => c.id === "vanilla")
        ).toBe(false);
        expect(state.players[1].graveyard.some((c) => c.id === "vanilla")).toBe(
            true
        );
    });

    it("wither variant: a 3/3 wither attacker blocked by a 3/3 vanilla blocker — same simultaneity", () => {
        const witherer = creature("witherer", 3, 3, {
            staticAbilities: ["wither"],
        });
        const vanilla = creature("vanilla2", 3, 3, {
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = combatState([witherer], [vanilla], {
            attackerIds: ["witherer"],
            blockerAssignments: { vanilla2: ["witherer"] },
            blockedAttackerIds: ["witherer"],
        });

        applyAllCombatDamage(state, { witherer: { vanilla2: 3 } });

        expect(
            state.players[0].battlefield.some((c) => c.id === "witherer")
        ).toBe(false);
        const withererCard = state.players[0].graveyard.find(
            (c) => c.id === "witherer"
        )!;
        expect(withererCard).toBeDefined();
        expect(withererCard.damageMarked).toBe(3);

        const vanillaCard = state.players[1].battlefield.find(
            (c) => c.id === "vanilla2"
        )!;
        expect(vanillaCard).toBeDefined();
        expect(vanillaCard.counters).toEqual({ "-1/-1": 3 });
        expect(vanillaCard.damageMarked ?? 0).toBe(0);

        checkStateBasedActions(state);

        expect(
            state.players[1].battlefield.some((c) => c.id === "vanilla2")
        ).toBe(false);
        expect(
            state.players[1].graveyard.some((c) => c.id === "vanilla2")
        ).toBe(true);
    });
});

describe("infect/wither still 'damage' for other purposes (CR 702.90c)", () => {
    it("infect + lifelink: the source's controller still gains life even though the opponent takes poison, not life loss", () => {
        const toxic = creature("toxic", 3, 3, {
            staticAbilities: ["infect", "lifelink"],
        });
        const state = combatState([toxic], [], {
            attackerIds: ["toxic"],
        });

        applyAllCombatDamage(state, { toxic: { p2: 3 } });

        const p1 = state.players[0];
        const p2 = state.players[1];
        expect(p2.poisonCounters).toBe(3);
        expect(p2.life).toBe(20); // no life lost
        expect(p1.life).toBe(23); // 20 + 3 lifelink — still "damage dealt"
    });
});

describe("SpellContext.dealDamage — infect/wither non-combat damage", () => {
    function withSource(staticAbilities: string[]): {
        state: GameState;
        item: StackItem;
        source: CardInstanceState;
    } {
        const source = creature("toucher", 0, 0, { staticAbilities });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [source] }),
                makePlayer("p2"),
            ],
        });
        const item: StackItem = {
            ...source,
            castById: "p1",
            targets: [],
        };
        return { state, item, source };
    }

    it("infect source deals non-combat damage to a player as poison", () => {
        const { state, item } = withSource(["infect"]);
        const ctx = buildSpellContext(state, item);
        ctx.dealDamage({ type: "player", id: "p2" }, 4);

        const p2 = state.players[1];
        expect(p2.life).toBe(20);
        expect(p2.poisonCounters).toBe(4);
    });

    it("infect source deals non-combat damage to a creature as -1/-1 counters", () => {
        const { state, item } = withSource(["infect"]);
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
        });
        state.players[1].battlefield.push(bear);

        const ctx = buildSpellContext(state, item);
        ctx.dealDamage({ type: "permanent", id: "bear" }, 2);

        expect(bear.counters).toEqual({ "-1/-1": 2 });
        expect(bear.damageMarked ?? 0).toBe(0);
    });

    it("wither source deals non-combat damage to a creature as -1/-1 counters", () => {
        const { state, item } = withSource(["wither"]);
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
        });
        state.players[1].battlefield.push(bear);

        const ctx = buildSpellContext(state, item);
        ctx.dealDamage({ type: "permanent", id: "bear" }, 1);

        expect(bear.counters).toEqual({ "-1/-1": 1 });
        expect(bear.damageMarked ?? 0).toBe(0);
    });

    it("wither source deals non-combat damage to a player as normal life loss (creature-only half)", () => {
        const { state, item } = withSource(["wither"]);
        const ctx = buildSpellContext(state, item);
        ctx.dealDamage({ type: "player", id: "p2" }, 5);

        const p2 = state.players[1];
        expect(p2.life).toBe(15);
        expect(p2.poisonCounters ?? 0).toBe(0);
    });
});

describe("infect/wither survive the wire projection (visible outcome)", () => {
    it("poison counters project through to the public state", () => {
        const toxic = creature("toxic", 3, 3, {
            staticAbilities: ["infect"],
        });
        const state = combatState([toxic], [], {
            attackerIds: ["toxic"],
        });
        applyAllCombatDamage(state, { toxic: { p2: 3 } });

        const projected = projectPublicState(state, 1, "p1");
        const p2 = projected.players.find((p) => p.id === "p2")!;
        expect(p2.poisonCounters).toBe(3);
    });

    it("-1/-1 counters (and the resulting effective toughness) project through to the public state", () => {
        const ogre = creature("ogre", 5, 5);
        const toxic = creature("toxic", 2, 2, {
            controllerId: "p2",
            ownerId: "p2",
            staticAbilities: ["infect"],
        });
        const state = combatState([ogre], [toxic], {
            attackerIds: ["ogre"],
            blockerAssignments: { toxic: ["ogre"] },
            blockedAttackerIds: ["ogre"],
        });
        applyAllCombatDamage(state, { ogre: { toxic: 5 } });

        // GRE: fat state
        const ogreCard = state.players[0].battlefield.find(
            (c) => c.id === "ogre"
        )!;
        expect(getEffectiveToughness(state, ogreCard)).toBe(3);

        // Wire: projected state
        const projected = projectPublicState(state, 1, "p1");
        const slimOgre = projected.players[0].battlefield.find(
            (c) => c.id === "ogre"
        )!;
        expect(slimOgre.counters).toEqual({ "-1/-1": 2 });
        expect(getEffectiveToughness(projected, slimOgre)).toBe(3);
    });
});
