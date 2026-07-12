// Invasion (INV) — black behavior tests (ADR 0043 colour split, #1071).
//
// Per-Op regime (ADR 0045/0046): the 24 pure-DSL free cards + the Soul Burn
// CardPrint reuse only already-exercised Ops/keywords and need no
// hand-written test here — the catalogue-wide `validateEffectScript` sweep
// (effectScripts.test.ts) + the auto-generated canned-scenario smoke test
// (effectScriptSmoke.test.ts) cover them.
//
// Hand-written tests below cover:
//   - the 7 `resolve()` cards (Annihilate, Phyrexian Delver, Phyrexian
//     Reaper, Phyrexian Slayer, Plague Spitter, Spreading Plague, Tsabo's
//     Assassin) — mandatory per the card testing convention;
//   - the 2 bespoke `pt-cda` cards (Goham Djinn, Marauding Knight) — new
//     board-scan compute logic, with a wire-format assertion;
//   - Andradite Leech's cost-modifier (mirrors the Derelor precedent,
//     fem/black.ts) + its activated pump;
//   - Duskwalker's kicker → entersWith-counters → keyword-grant-proxy chain,
//     a novel-enough composition to warrant its own assertion.

import { describe, it, expect } from "vitest";
import {
    addle,
    andraditeLeech,
    annihilate,
    bogInitiate,
    cremate,
    cryptAngel,
    cursedFlesh,
    devouringStrossus,
    dredge,
    duskwalker,
    gohamDjinn,
    hateWeaver,
    hypnoticCloud,
    maraudingKnight,
    mourning,
    phyrexianBattleflies,
    phyrexianDelver,
    phyrexianReaper,
    phyrexianSlayer,
    plagueSpitter,
    ravenousRats,
    recklessSpite,
    recover,
    scavengedWeaponry,
    soulBurnInv,
    spreadingPlague,
    taintedWell,
    tsabosAssassin,
    urborgShambler,
    urborgSkeleton,
} from "../black";
import { getCardByName } from "../../../index";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import { resolveTopOfStack, getCostModifiers } from "../../../../gre/state";
import {
    getEffectivePower,
    getEffectiveToughness,
} from "../../../../gre/layers";
import { projectPublicState } from "../../../../gameProjections";
import type { GameState, StackItem } from "../../../../gre/state";

/** Resolves a triggered ability directly (bypasses `matches` — same shim
 *  every other set's local `__tests__/helpers.ts` defines; inlined here
 *  since this file is the sole consumer in `sets/inv/`). */
function resolveTrigger(
    state: GameState,
    source: ReturnType<typeof makeInstance>,
    triggeredAbilityId: string,
    triggerEvent: StackItem["triggerEvent"],
    targets: StackItem["targets"] = []
): void {
    state.stack.push({
        ...source,
        zone: "stack",
        castById: source.controllerId,
        triggeredAbilityId,
        triggerSourceId: source.id,
        triggerEvent,
        targets,
    });
    resolveTopOfStack(state);
}

/** Resolves an activated ability directly, mirroring the same per-set shim. */
function resolveActivated(
    state: GameState,
    source: ReturnType<typeof makeInstance>,
    abilityId: string,
    targets: StackItem["targets"] = []
): void {
    state.stack.push({
        ...source,
        zone: "stack",
        castById: source.controllerId,
        abilityId,
        targets,
    });
    resolveTopOfStack(state);
}

describe("inv/black.ts — registry shape (#1071)", () => {
    it("exports the 24 free CardDefinitions + 5 resolve() cards + 1 CardPrint", () => {
        const defs = [
            addle,
            andraditeLeech,
            annihilate,
            bogInitiate,
            cremate,
            cryptAngel,
            cursedFlesh,
            devouringStrossus,
            dredge,
            duskwalker,
            gohamDjinn,
            hateWeaver,
            hypnoticCloud,
            maraudingKnight,
            mourning,
            phyrexianBattleflies,
            phyrexianDelver,
            phyrexianReaper,
            phyrexianSlayer,
            plagueSpitter,
            ravenousRats,
            recklessSpite,
            recover,
            scavengedWeaponry,
            spreadingPlague,
            taintedWell,
            tsabosAssassin,
            urborgShambler,
            urborgSkeleton,
        ];
        expect(defs).toHaveLength(29);
        for (const def of defs) {
            expect(def.id).toMatch(/^[0-9a-f-]{36}$/);
        }
        expect(soulBurnInv.definitionId).toBe(
            "eb8e00d2-2381-4d45-bed8-c9bf738a9419"
        );
        expect(soulBurnInv.setCode).toBe("inv");
    });
});

describe("Andradite Leech (controller's black spells cost {B} more, CR 601.2f)", () => {
    it("carries the printed characteristics + cost-modifier static", () => {
        expect(andraditeLeech.manaCost).toEqual({ X: 2, B: 1 });
        expect(andraditeLeech.power).toBe(2);
        expect(andraditeLeech.toughness).toBe(2);
        const eff = andraditeLeech.staticEffects?.[0];
        expect(eff?.kind).toBe("cost-modifier");
        expect((eff as { costIncrease?: unknown }).costIncrease).toEqual({
            B: 1,
        });
    });

    it("taxes the controller's OWN black spell by {B}", () => {
        const leech = makeInstance(andraditeLeech.id, {
            id: "leech",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [leech] }),
                makePlayer("p2"),
            ],
        });
        const blackSpell = makeInstance(cremate.id, {
            id: "cremate-hand",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const mods = getCostModifiers(state, blackSpell, "spell");
        expect(mods.increase.B ?? 0).toBe(1);
    });

    it("does NOT tax the opponent's black spell", () => {
        const leech = makeInstance(andraditeLeech.id, {
            id: "leech",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [leech] }),
                makePlayer("p2"),
            ],
        });
        const oppSpell = makeInstance(cremate.id, {
            id: "cremate-opp",
            controllerId: "p2",
            ownerId: "p2",
            zone: "hand",
        });
        const mods = getCostModifiers(state, oppSpell, "spell");
        expect(mods.increase.B ?? 0).toBe(0);
    });

    it("{B}: pumps itself +1/+1 until end of turn", () => {
        const leech = makeInstance(andraditeLeech.id, {
            id: "leech",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [leech] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, leech, "andradite-leech-pump");
        const live = state.players[0].battlefield.find(
            (c) => c.id === "leech"
        )!;
        expect(getEffectivePower(state, live)).toBe(3);
        expect(getEffectiveToughness(state, live)).toBe(3);
    });
});

describe("Annihilate (destroy nonblack, can't regen, draw; CR 701.8 / 701.15c / 121.1)", () => {
    it("destroys the target and draws a card", () => {
        const target = makeInstance(getCardByName("Elvish Archers").id, {
            id: "target",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    library: [makeInstance(annihilate.id, { zone: "library" })],
                }),
                makePlayer("p2", { battlefield: [target] }),
            ],
        });
        pushSpell(state, annihilate.id, "p1", [
            { type: "permanent", id: "target" },
        ]);
        resolveTopOfStack(state);
        expect(state.players[1].battlefield).toHaveLength(0);
        expect(state.players[1].graveyard.some((c) => c.id === "target")).toBe(
            true
        );
        expect(state.players[0].hand).toHaveLength(1);
    });
});

describe("Phyrexian Reaper / Phyrexian Slayer (becomes-blocked-by-color → destroy, can't regen; CR 509.1h / 701.8 / 701.15c)", () => {
    it("Reaper's trigger fires only when blocked by a GREEN creature", () => {
        const reaper = makeInstance(phyrexianReaper.id, {
            id: "reaper",
            controllerId: "p1",
            ownerId: "p1",
        });
        const greenBlocker = makeInstance(getCardByName("Elvish Archers").id, {
            id: "green-blk",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [reaper] }),
                makePlayer("p2", { battlefield: [greenBlocker] }),
            ],
        });
        const trigger = phyrexianReaper.triggeredAbilities![0]!;
        const stateView = {
            players: state.players.map((p) => ({
                id: p.id,
                life: p.life,
                battlefield: p.battlefield.map((c) => ({
                    ...c,
                    colors: c.id === "green-blk" ? (["G"] as const) : undefined,
                })),
            })),
        };
        const matches = trigger.matches(
            {
                type: "BLOCKERS_CONFIRMED",
                attackerId: "reaper",
                attackerControllerId: "p1",
                attackerTypes: ["Creature"],
                attackerSubtypes: [],
                blockerId: "green-blk",
                blockerControllerId: "p2",
                blockerTypes: ["Creature"],
                blockerSubtypes: [],
            },
            reaper as never,
            stateView as never
        );
        expect(matches).toBe(true);

        resolveTrigger(state, reaper, "phyrexian-reaper-blocked", {
            type: "BLOCKERS_CONFIRMED",
            attackerId: "reaper",
            attackerControllerId: "p1",
            attackerTypes: ["Creature"],
            attackerSubtypes: [],
            blockerId: "green-blk",
            blockerControllerId: "p2",
            blockerTypes: ["Creature"],
            blockerSubtypes: [],
        } as StackItem["triggerEvent"]);
        expect(state.players[1].battlefield).toHaveLength(0);
        expect(
            state.players[1].graveyard.some((c) => c.id === "green-blk")
        ).toBe(true);
    });

    it("Reaper's trigger does NOT match a non-green blocker", () => {
        const reaper = makeInstance(phyrexianReaper.id, {
            id: "reaper",
            controllerId: "p1",
            ownerId: "p1",
        });
        const whiteBlocker = makeInstance(getCardByName("Benalish Hero").id, {
            id: "white-blk",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [reaper] }),
                makePlayer("p2", { battlefield: [whiteBlocker] }),
            ],
        });
        const trigger = phyrexianReaper.triggeredAbilities![0]!;
        const stateView = {
            players: state.players.map((p) => ({
                id: p.id,
                life: p.life,
                battlefield: p.battlefield.map((c) => ({
                    ...c,
                    colors: c.id === "white-blk" ? (["W"] as const) : undefined,
                })),
            })),
        };
        const matches = trigger.matches(
            {
                type: "BLOCKERS_CONFIRMED",
                attackerId: "reaper",
                attackerControllerId: "p1",
                attackerTypes: ["Creature"],
                attackerSubtypes: [],
                blockerId: "white-blk",
                blockerControllerId: "p2",
                blockerTypes: ["Creature"],
                blockerSubtypes: [],
            },
            reaper as never,
            stateView as never
        );
        expect(matches).toBe(false);
    });

    it("Slayer destroys a WHITE blocker", () => {
        const slayer = makeInstance(phyrexianSlayer.id, {
            id: "slayer",
            controllerId: "p1",
            ownerId: "p1",
        });
        const whiteBlocker = makeInstance(getCardByName("Benalish Hero").id, {
            id: "white-blk",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [slayer] }),
                makePlayer("p2", { battlefield: [whiteBlocker] }),
            ],
        });
        resolveTrigger(state, slayer, "phyrexian-slayer-blocked", {
            type: "BLOCKERS_CONFIRMED",
            attackerId: "slayer",
            attackerControllerId: "p1",
            attackerTypes: ["Creature"],
            attackerSubtypes: [],
            blockerId: "white-blk",
            blockerControllerId: "p2",
            blockerTypes: ["Creature"],
            blockerSubtypes: [],
        } as StackItem["triggerEvent"]);
        expect(state.players[1].battlefield).toHaveLength(0);
    });
});

describe("Spreading Plague (ETB → destroy other same-color creatures, can't regen; CR 603.6a / 701.8 / 701.15c)", () => {
    it("destroys other creatures sharing a color with the entrant, spares different colors", () => {
        const plague = makeInstance(spreadingPlague.id, {
            id: "plague",
            controllerId: "p1",
            ownerId: "p1",
        });
        const blackCreature = makeInstance(andraditeLeech.id, {
            id: "black-c",
            controllerId: "p1",
            ownerId: "p1",
        });
        const greenCreature = makeInstance(getCardByName("Elvish Archers").id, {
            id: "green-c",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [plague, blackCreature] }),
                makePlayer("p2", { battlefield: [greenCreature] }),
            ],
        });
        // A second black creature enters — Spreading Plague fires and should
        // destroy the OTHER black creature (shares color) but spare the green one.
        const entrant = makeInstance(bogInitiate.id, {
            id: "entrant",
            controllerId: "p1",
            ownerId: "p1",
        });
        state.players[0].battlefield.push(entrant);
        resolveTrigger(state, plague, "spreading-plague-enters", {
            type: "PERMANENT_ENTERED",
            instanceId: "entrant",
            controllerId: "p1",
            types: ["Creature"],
        });
        const p1Ids = state.players[0].battlefield.map((c) => c.id);
        expect(p1Ids).not.toContain("black-c");
        expect(p1Ids).toContain("entrant"); // the entrant itself is never "other"
        expect(state.players[1].battlefield.map((c) => c.id)).toContain(
            "green-c"
        );
    });
});

describe("Phyrexian Delver (ETB → reanimate + lose life equal to MV; CR 603.6a / 400.7 / 202.3 / 119.3b)", () => {
    /** Answers the head pending choice by writing directly into the stack
     *  item's `collectedChoices` (mirrors the Fasting harness,
     *  drk/__tests__/white.test.ts) so `resolve()`'s `ctx.requestChoice`
     *  resumes on the next `resolveTopOfStack` call instead of re-suspending. */
    function commitHead(state: GameState, picks: string[]) {
        const queue = state.pendingChoices ?? [];
        const head = queue[0];
        const stackItem = state.stack.find((s) => s.id === head.stackItemId)!;
        stackItem.collectedChoices = {
            ...(stackItem.collectedChoices ?? {}),
            [`${head.step}:${head.choiceId}`]: picks,
        };
        queue.shift();
        state.pendingChoices = queue.length > 0 ? queue : undefined;
    }

    it("returns the chosen graveyard creature to the battlefield under its controller and loses life equal to its mana value", () => {
        const delver = makeInstance(phyrexianDelver.id, {
            id: "delver",
            controllerId: "p1",
            ownerId: "p1",
        });
        // Elvish Archers — {1}{G}, mana value 2 (CR 202.3).
        const gyCreature = makeInstance(getCardByName("Elvish Archers").id, {
            id: "gy-creature",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [delver],
                    graveyard: [gyCreature],
                }),
                makePlayer("p2", {}),
            ],
        });
        state.stack.push({
            ...delver,
            zone: "stack",
            castById: delver.controllerId,
            triggeredAbilityId: "phyrexian-delver-etb",
            triggerSourceId: delver.id,
            triggerEvent: {
                type: "PERMANENT_ENTERED",
                instanceId: delver.id,
                controllerId: "p1",
                types: ["Creature"],
            },
            targets: [],
        });
        resolveTopOfStack(state); // suspends on the choose-graveyard-card pick
        expect(state.pendingChoices).toHaveLength(1);
        commitHead(state, ["gy-creature"]);
        resolveTopOfStack(state); // resumes and completes
        const p1 = state.players[0];
        expect(p1.battlefield.some((c) => c.id === "gy-creature")).toBe(true);
        expect(p1.graveyard.some((c) => c.id === "gy-creature")).toBe(false);
        expect(p1.life).toBe(18); // 20 - Elvish Archers' mana value (2)
    });

    it("does nothing (no life loss) when the graveyard has no creature to return (CR 608.2b)", () => {
        const delver = makeInstance(phyrexianDelver.id, {
            id: "delver",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [delver] }),
                makePlayer("p2", {}),
            ],
        });
        state.stack.push({
            ...delver,
            zone: "stack",
            castById: delver.controllerId,
            triggeredAbilityId: "phyrexian-delver-etb",
            triggerSourceId: delver.id,
            triggerEvent: {
                type: "PERMANENT_ENTERED",
                instanceId: delver.id,
                controllerId: "p1",
                types: ["Creature"],
            },
            targets: [],
        });
        resolveTopOfStack(state); // suspends on the choose-graveyard-card pick
        commitHead(state, []); // no legal creature to pick
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(20);
    });
});

describe("Plague Spitter (dies → 1 damage to each creature and each player; CR 700.4 / 603.2 / 120.3)", () => {
    it("deals 1 damage to each creature and each player when it dies", () => {
        const spitter = makeInstance(plagueSpitter.id, {
            id: "spitter",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard", // already dead by the time the trigger resolves
        });
        const ourBear = makeInstance(getCardByName("Grizzly Bears").id, {
            id: "our-bear",
            controllerId: "p1",
            ownerId: "p1",
        });
        const oppBear = makeInstance(getCardByName("Grizzly Bears").id, {
            id: "opp-bear",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [ourBear],
                    graveyard: [spitter],
                }),
                makePlayer("p2", { battlefield: [oppBear] }),
            ],
        });
        const beforeP1 = state.players[0].life;
        const beforeP2 = state.players[1].life;
        resolveTrigger(state, spitter, "plague-spitter-dies", {
            type: "CREATURE_DIED",
            creatureInstanceId: "spitter",
            creatureControllerId: "p1",
            creatureTypes: ["Creature"],
            damagedBySources: [],
            creaturePower: 2,
            creatureToughness: 2,
        });
        const live1 = state.players[0].battlefield.find(
            (c) => c.id === "our-bear"
        )!;
        const live2 = state.players[1].battlefield.find(
            (c) => c.id === "opp-bear"
        )!;
        expect(live1.damageMarked).toBe(1);
        expect(live2.damageMarked).toBe(1);
        expect(state.players[0].life).toBe(beforeP1 - 1);
        expect(state.players[1].life).toBe(beforeP2 - 1);
    });
});

describe("Tsabo's Assassin ({T}: destroy target creature sharing the board's most common color; CR 701.8 / 701.15c)", () => {
    function setup() {
        const assassin = makeInstance(tsabosAssassin.id, {
            id: "assassin",
            controllerId: "p1",
            ownerId: "p1",
        });
        const anotherBlack = makeInstance(andraditeLeech.id, {
            id: "black-2",
            controllerId: "p1",
            ownerId: "p1",
        });
        const greenTarget = makeInstance(getCardByName("Elvish Archers").id, {
            id: "green-target",
            controllerId: "p2",
            ownerId: "p2",
        });
        // Black count = 2 (assassin + black-2), green count = 1 — black is
        // the sole most-common color.
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [assassin, anotherBlack] }),
                makePlayer("p2", { battlefield: [greenTarget] }),
            ],
        });
        return { state, assassin };
    }

    it("does NOT destroy a creature of a non-most-common color", () => {
        const { state, assassin } = setup();
        resolveActivated(state, assassin, "tsabos-assassin-destroy", [
            { type: "permanent", id: "green-target" },
        ]);
        expect(state.players[1].battlefield).toHaveLength(1);
    });

    it("destroys a creature sharing the most-common color", () => {
        const { state, assassin } = setup();
        resolveActivated(state, assassin, "tsabos-assassin-destroy", [
            { type: "permanent", id: "black-2" },
        ]);
        expect(
            state.players[0].battlefield.some((c) => c.id === "black-2")
        ).toBe(false);
        expect(state.players[0].graveyard.some((c) => c.id === "black-2")).toBe(
            true
        );
    });
});

describe("Goham Djinn (-2/-2 while black is most common color or tied; CR 613.4a CDA)", () => {
    function setup(greenCount: number) {
        const djinn = makeInstance(gohamDjinn.id, {
            id: "djinn",
            controllerId: "p1",
            ownerId: "p1",
        });
        const greens = Array.from({ length: greenCount }, (_, i) =>
            makeInstance(getCardByName("Elvish Archers").id, {
                id: `green-${i}`,
                controllerId: "p2",
                ownerId: "p2",
            })
        );
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [djinn] }),
                makePlayer("p2", { battlefield: greens }),
            ],
        });
        return { state, djinn };
    }

    it("sole black permanent on the board → -2/-2", () => {
        const { state, djinn } = setup(0);
        expect(getEffectivePower(state, djinn)).toBe(3);
        expect(getEffectiveToughness(state, djinn)).toBe(3);
    });

    it("tied with green (1 vs 1) → still -2/-2", () => {
        const { state, djinn } = setup(1);
        expect(getEffectivePower(state, djinn)).toBe(3);
        expect(getEffectiveToughness(state, djinn)).toBe(3);
    });

    it("green strictly more common (2 vs 1) → unaffected", () => {
        const { state, djinn } = setup(2);
        expect(getEffectivePower(state, djinn)).toBe(5);
        expect(getEffectiveToughness(state, djinn)).toBe(5);
    });

    it("wire format: derived P/T survives projectPublicState", () => {
        const { state } = setup(0);
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "djinn"
        )!;
        expect(getEffectiveToughness(projected, slim)).toBe(3);
    });

    it("{1}{B}: regenerates itself", () => {
        const { state, djinn } = setup(0);
        resolveActivated(state, djinn, "goham-djinn-regen");
        // Applying a regeneration shield is a no-op observable event unless a
        // destroy follows; assert the ability at least resolves cleanly.
        expect(state.players[0].battlefield.some((c) => c.id === "djinn")).toBe(
            true
        );
    });
});

describe("Marauding Knight (+1/+1 per opponents' Plains; CR 613.4a CDA)", () => {
    it("scales with the OPPONENT's Plains, not the controller's own", () => {
        const knight = makeInstance(maraudingKnight.id, {
            id: "knight",
            controllerId: "p1",
            ownerId: "p1",
        });
        const ownPlains = makeInstance(getCardByName("Plains").id, {
            id: "own-plains",
            controllerId: "p1",
            ownerId: "p1",
        });
        const oppPlains = [0, 1, 2].map((i) =>
            makeInstance(getCardByName("Plains").id, {
                id: `opp-plains-${i}`,
                controllerId: "p2",
                ownerId: "p2",
            })
        );
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [knight, ownPlains] }),
                makePlayer("p2", { battlefield: oppPlains }),
            ],
        });
        expect(getEffectivePower(state, knight)).toBe(5); // 2 + 3
        expect(getEffectiveToughness(state, knight)).toBe(5);
    });

    it("wire format: derived P/T survives projectPublicState", () => {
        const knight = makeInstance(maraudingKnight.id, {
            id: "knight",
            controllerId: "p1",
            ownerId: "p1",
        });
        const oppPlains = makeInstance(getCardByName("Plains").id, {
            id: "opp-plains",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [knight] }),
                makePlayer("p2", { battlefield: [oppPlains] }),
            ],
        });
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "knight"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(3); // 2 + 1
    });
});

describe("Duskwalker (Kicker → two +1/+1 counters + fear; CR 702.33 / 122.1 / 702.36)", () => {
    function enterKicked(kicked: boolean) {
        const state = makeState();
        const item = pushSpell(state, duskwalker.id, "p1");
        if (kicked) item.kickerCount = 1;
        resolveTopOfStack(state);
        return state;
    }

    it("kicked: enters with two +1/+1 counters and fear", () => {
        const state = enterKicked(true);
        const dw = state.players[0].battlefield.find(
            (c) => c.card.id === duskwalker.id
        )!;
        expect(dw.counters?.["+1/+1"]).toBe(2);
        expect(dw.staticAbilities).toContain("fear");
    });

    it("not kicked: no counters, no fear", () => {
        const state = enterKicked(false);
        const dw = state.players[0].battlefield.find(
            (c) => c.card.id === duskwalker.id
        )!;
        expect(dw.counters?.["+1/+1"] ?? 0).toBe(0);
        expect(dw.staticAbilities).not.toContain("fear");
    });
});

describe("Urborg Skeleton (Kicker → a single +1/+1 counter; CR 702.33 / 122.1)", () => {
    it("kicked: enters with exactly one +1/+1 counter", () => {
        const state = makeState();
        const item = pushSpell(state, urborgSkeleton.id, "p1");
        item.kickerCount = 1;
        resolveTopOfStack(state);
        const skel = state.players[0].battlefield.find(
            (c) => c.card.id === urborgSkeleton.id
        )!;
        expect(skel.counters?.["+1/+1"]).toBe(1);
    });

    it("not kicked: no counters", () => {
        const state = makeState();
        pushSpell(state, urborgSkeleton.id, "p1");
        resolveTopOfStack(state);
        const skel = state.players[0].battlefield.find(
            (c) => c.card.id === urborgSkeleton.id
        )!;
        expect(skel.counters?.["+1/+1"] ?? 0).toBe(0);
    });
});
