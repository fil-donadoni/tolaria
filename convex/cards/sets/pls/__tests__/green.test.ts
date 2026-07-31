// PLS (Planeshift) — green card behavior tests (ADR 0043 colour split).
// Each card's describe block cites the CR section it exercises.
import { describe, it, expect } from "vitest";
import {
    amphibiousKavu,
    magnigothTreefolk,
    mirrorwoodTreefolk,
    multanisHarmony,
    nemataGroveGuardian,
    pygmyKavu,
    quirionDryad,
    quirionExplorer,
    thornscapeBattlemage,
} from "../green";
import { crawWurm, grizzlyBears } from "../../lea/green";
import { lightningBolt } from "../../lea/red";
import { airElemental } from "../../lea/blue";
import { blackKnight } from "../../lea/black";
import { forest, island, mountain, plains, swamp } from "../../lea/colorless";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
    resolveTriggerOrder,
} from "../../../__tests__/setup";
import { projectPublicState } from "../../../../gameProjections";
import {
    applySourceStaticEffects,
    refreshCounterGatedStatics,
    resolveTopOfStack,
} from "../../../../gre/state";
import type {
    CardInstanceState,
    GameState,
    StackItem,
} from "../../../../gre/state";
import {
    getEffectiveManaChoices,
    getManaTapOptionsDetailed,
    hasManaAbility,
} from "../../../../gre/constants";
import { getEffectiveActivatedAbilities } from "../../../../gre/activatedAbilities";
import {
    getEffectivePower,
    getEffectiveToughness,
} from "../../../../gre/layers";
import {
    emitBlockersConfirmedEvents,
    advancePhase,
} from "../../../../gre/phases";
import { getLegalActions } from "../../../../gre/rules";
import { applyOneTargetSelection } from "../../../../game";
import { registerTokenDefinition } from "../../..";
import { kickerPaidCondition } from "../../../abilities/triggers/shared";
import type { TargetSelection, PermanentView } from "../../../types";

/** Pushes a triggered ability directly onto the stack (bypassing the real
 *  cast/announcement pipeline) and resolves it — mirrors `pls/blue.test.ts`'s
 *  `pushTrigger` (the established shape every per-colour test file uses for
 *  a card-def `TriggeredAbility`). */
function pushTrigger(
    state: GameState,
    source: CardInstanceState,
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

/** Pushes an activated ability (the card's own, or a `grantTemplates[]`
 *  ability granted to a host via `grantedSourceCardId`) directly onto the
 *  stack and resolves it — mirrors `pls/blue.test.ts`'s `pushActivated`. */
function pushActivated(
    state: GameState,
    source: CardInstanceState,
    abilityId: string,
    targets: StackItem["targets"] = [],
    grantedSourceCardId?: string
): void {
    state.stack.push({
        ...source,
        zone: "stack",
        castById: source.controllerId,
        abilityId,
        targets,
        ...(grantedSourceCardId ? { grantedSourceCardId } : {}),
    });
    resolveTopOfStack(state);
}

const REDIRECT_ABILITY_ID = "mirrorwood-treefolk-redirect";

/** Activates Mirrorwood Treefolk's redirect ability with `target` announced
 *  at activation (CR 602.2b) — the ability's `targetRequirement: { type:
 *  "any" }` is a controller-chosen target, exactly like Cuombajj Witches'
 *  own ping, so the test wires it the same way `pushSpell`'s `targets`
 *  parameter does for a spell: no mid-resolution suspension involved. */
function activateAndPickTarget(
    state: GameState,
    treefolkId: string,
    target: TargetSelection
) {
    const act = pushSpell(state, mirrorwoodTreefolk.id, "p1", [target]);
    act.abilityId = REDIRECT_ABILITY_ID;
    act.id = treefolkId; // the ability's own stack item IS the source (ctx.sourceInstanceId)
    resolveTopOfStack(state);
}

describe("Mirrorwood Treefolk ({3}{G} 2/4 — one-shot damage redirect, CR 614/115.4)", () => {
    it("is a {3}{G} 2/4 Treefolk with the modern oracle text", () => {
        expect(mirrorwoodTreefolk.manaCost).toEqual({ X: 3, G: 1 });
        expect(mirrorwoodTreefolk.types).toEqual(["Creature"]);
        expect(mirrorwoodTreefolk.subtypes).toEqual(["Treefolk"]);
        expect(mirrorwoodTreefolk.power).toBe(2);
        expect(mirrorwoodTreefolk.toughness).toBe(4);
        expect(mirrorwoodTreefolk.oracleText).toBe(
            "{2}{R}{W}: The next time damage would be dealt to this creature this turn, that damage is dealt to any target instead."
        );
        expect(mirrorwoodTreefolk.activatedAbilities?.[0]?.cost).toEqual({
            mana: { X: 2, R: 1, W: 1 },
        });
    });

    it("redirects the next damage to this creature to a chosen PERMANENT (CR 115.4)", () => {
        const mwt = makeInstance(mirrorwoodTreefolk.id, {
            id: "mwt",
            controllerId: "p1",
            ownerId: "p1",
        });
        const bear = makeInstance(crawWurm.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [mwt] }),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        activateAndPickTarget(state, "mwt", { type: "permanent", id: "bear" });

        pushSpell(state, lightningBolt.id, "p2", [
            { type: "permanent", id: "mwt" },
        ]);
        expect(resolveTopOfStack(state)).not.toBeNull();

        const mwtAfter = state.players[0].battlefield.find(
            (c) => c.id === "mwt"
        )!;
        const bearAfter = state.players[1].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(mwtAfter.damageMarked).toBeUndefined();
        expect(bearAfter.damageMarked).toBe(3);
    });

    it("redirects the next damage to this creature to a chosen PLAYER (CR 115.4)", () => {
        const mwt = makeInstance(mirrorwoodTreefolk.id, {
            id: "mwt",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [mwt] }),
                makePlayer("p2", { battlefield: [], life: 20 }),
            ],
        });
        activateAndPickTarget(state, "mwt", { type: "player", id: "p2" });

        pushSpell(state, lightningBolt.id, "p2", [
            { type: "permanent", id: "mwt" },
        ]);
        expect(resolveTopOfStack(state)).not.toBeNull();

        const mwtAfter = state.players[0].battlefield.find(
            (c) => c.id === "mwt"
        )!;
        expect(mwtAfter.damageMarked).toBeUndefined();
        expect(state.players[1].life).toBe(17);
    });

    it("is one-shot — a second instance of damage this turn is NOT redirected (CR 614)", () => {
        const mwt = makeInstance(mirrorwoodTreefolk.id, {
            id: "mwt",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [mwt] }),
                makePlayer("p2", { battlefield: [], life: 20 }),
            ],
        });
        activateAndPickTarget(state, "mwt", { type: "player", id: "p2" });

        pushSpell(state, lightningBolt.id, "p2", [
            { type: "permanent", id: "mwt" },
        ]);
        resolveTopOfStack(state);
        expect(state.players[1].life).toBe(17); // redirected, shield spent

        pushSpell(state, lightningBolt.id, "p2", [
            { type: "permanent", id: "mwt" },
        ]);
        resolveTopOfStack(state);
        const mwtAfter = state.players[0].battlefield.find(
            (c) => c.id === "mwt"
        )!;
        expect(mwtAfter.damageMarked).toBe(3); // second bolt lands on mwt itself
        expect(state.players[1].life).toBe(17); // unchanged — shield already spent
    });

    it("redirect destination removed from the battlefield before damage lands: damage goes on the Treefolk instead of vanishing (official ruling)", () => {
        // Scryfall/Gatherer ruling: "If the target creature is not on the
        // battlefield (or is not a creature) at the time the damage would be
        // redirected, then the damage goes on this card." Regression for
        // PR #1978 review Blocking 1: a naive redirect that rewrites
        // `current.target` to a dead instance id silently drops the damage
        // (dealDamage's `if (!found) return`) instead of landing it back on
        // the shielded creature.
        const mwt = makeInstance(mirrorwoodTreefolk.id, {
            id: "mwt",
            controllerId: "p1",
            ownerId: "p1",
        });
        const bear = makeInstance(crawWurm.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [mwt] }),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        activateAndPickTarget(state, "mwt", { type: "permanent", id: "bear" });

        // The chosen destination leaves the battlefield (destroyed,
        // exiled, etc. — the mechanism doesn't matter, only that it's gone)
        // before the shielded damage is dealt.
        state.players[1].battlefield = [];
        state.players[1].graveyard = [...state.players[1].graveyard, bear];

        pushSpell(state, lightningBolt.id, "p2", [
            { type: "permanent", id: "mwt" },
        ]);
        expect(resolveTopOfStack(state)).not.toBeNull();

        const mwtAfter = state.players[0].battlefield.find(
            (c) => c.id === "mwt"
        )!;
        // Damage lands on the Treefolk itself — not lost, not on the gone
        // destination.
        expect(mwtAfter.damageMarked).toBe(3);
    });

    it("holds through the real damage pipeline and survives the wire projection (CR 614)", () => {
        const mwt = makeInstance(mirrorwoodTreefolk.id, {
            id: "mwt",
            controllerId: "p1",
            ownerId: "p1",
        });
        const bear = makeInstance(crawWurm.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [mwt] }),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        activateAndPickTarget(state, "mwt", { type: "permanent", id: "bear" });

        pushSpell(state, lightningBolt.id, "p2", [
            { type: "permanent", id: "mwt" },
        ]);
        resolveTopOfStack(state);

        const projected = projectPublicState(state, 0, "p1");
        const slimMwt = projected.players[0].battlefield.find(
            (c) => c.id === "mwt"
        );
        const slimBear = projected.players[1].battlefield.find(
            (c) => c.id === "bear"
        );
        expect(slimMwt?.damageMarked).toBeUndefined();
        expect(slimBear?.damageMarked).toBe(3);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// C6 — Board-derived restricted-colour mana abilities (CR 605.1a, issue #1941).
// Quirion Explorer's `manaColorSource` descriptor is evaluated by
// `boardDerivedManaChoices` (`gre/constants.ts`); the assertions below drive
// the SAME authorities every consumer reads — `getEffectiveManaChoices` (the
// picker/index authority), `getManaTapOptionsDetailed` (the payment-option
// enumerator) and `getLegalActions` (the castability gate) — rather than the
// descriptor in isolation.
// ─────────────────────────────────────────────────────────────────────────────

/** The `battlefields` argument every board-derived mana consumer takes. */
function boards(state: GameState) {
    return state.players.map((p) => ({
        playerId: p.id,
        battlefield: p.battlefield,
    }));
}

function choicesFor(
    state: GameState,
    source: CardInstanceState,
    controllerId: string
) {
    return getEffectiveManaChoices(source, controllerId, boards(state));
}

describe("Quirion Explorer (CR 605.1a / 106.4 — colours an OPPONENT's land could produce)", () => {
    it("is a {1}{G} 1/1 Elf Druid Scout with the modern oracle text", () => {
        expect(quirionExplorer.manaCost).toEqual({ X: 1, G: 1 });
        expect(quirionExplorer.types).toEqual(["Creature"]);
        expect(quirionExplorer.subtypes).toEqual(["Elf", "Druid", "Scout"]);
        expect(quirionExplorer.power).toBe(1);
        expect(quirionExplorer.toughness).toBe(1);
        expect(quirionExplorer.oracleText).toBe(
            "{T}: Add one mana of any color that a land an opponent controls could produce."
        );
    });

    it("is a mana ability — resolves immediately, never uses the stack (CR 605.3a)", () => {
        const ability = quirionExplorer.activatedAbilities![0];
        expect(ability.useStack).toBe(false);
        expect(ability.cost).toEqual({ tap: true });
    });

    it("reads the OPPONENT's lands, not its controller's", () => {
        const elf = makeInstance(quirionExplorer.id, { controllerId: "p1" });
        const state = makeState({
            players: [
                // p1's own Mountain must NOT contribute {R}.
                makePlayer("p1", {
                    battlefield: [
                        elf,
                        makeInstance(mountain.id, { controllerId: "p1" }),
                    ],
                }),
                makePlayer("p2", {
                    battlefield: [
                        makeInstance(forest.id, { controllerId: "p2" }),
                        makeInstance(island.id, { controllerId: "p2" }),
                    ],
                }),
            ],
        });
        expect(choicesFor(state, elf, "p1")).toEqual([{ U: 1 }, { G: 1 }]);
    });

    it("offers nothing — and no tap option — when the opponent controls no colour-producing land", () => {
        const elf = makeInstance(quirionExplorer.id, { controllerId: "p1" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [elf] }),
                makePlayer("p2", { battlefield: [] }),
            ],
        });
        expect(choicesFor(state, elf, "p1")).toEqual([]);
        // The empty scope must not surface as a false affordance: the unified
        // tap-option list (what the picker renders and the planner taps) is
        // empty too, rather than falling back to the static five-colour list.
        expect(
            getManaTapOptionsDetailed(elf, "p1", boards(state))
        ).toHaveLength(0);
    });

    it("tracks the board — a land entering the opponent's side changes the offer", () => {
        const elf = makeInstance(quirionExplorer.id, { controllerId: "p1" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [elf] }),
                makePlayer("p2", { battlefield: [] }),
            ],
        });
        expect(choicesFor(state, elf, "p1")).toEqual([]);
        state.players[1].battlefield.push(
            makeInstance(swamp.id, { controllerId: "p2" })
        );
        expect(choicesFor(state, elf, "p1")).toEqual([{ B: 1 }]);
    });

    it("the restricted colour set is visible to the castability gate", () => {
        const bolt = makeInstance(lightningBolt.id, {
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const elf = makeInstance(quirionExplorer.id, { controllerId: "p1" });
        // p1 has NO mana source of its own — Bolt's {R} can only come from
        // Quirion Explorer reading p2's board.
        const state = makeState({
            players: [
                makePlayer("p1", { hand: [bolt], battlefield: [elf] }),
                makePlayer("p2", {
                    battlefield: [
                        makeInstance(mountain.id, { controllerId: "p2" }),
                    ],
                }),
            ],
        });
        expect(getLegalActions(state, state.players[0], bolt)).toContain(
            "cast"
        );

        // …and a scope that cannot produce {R} correctly reports NOT castable,
        // instead of leaning on the five-colour fallback.
        state.players[1].battlefield = [
            makeInstance(island.id, { controllerId: "p2" }),
        ];
        expect(getLegalActions(state, state.players[0], bolt)).not.toContain(
            "cast"
        );
    });

    it("survives the wire projection — the client's picker matches the server's list", () => {
        const elf = makeInstance(quirionExplorer.id, { controllerId: "p1" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [elf] }),
                makePlayer("p2", {
                    battlefield: [
                        makeInstance(forest.id, { controllerId: "p2" }),
                        makeInstance(swamp.id, { controllerId: "p2" }),
                    ],
                }),
            ],
        });
        const onFat = choicesFor(state, elf, "p1");
        expect(onFat).toEqual([{ B: 1 }, { G: 1 }]);

        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === elf.id
        )! as unknown as CardInstanceState;
        expect(
            getEffectiveManaChoices(
                slim,
                "p1",
                projected.players.map((p) => ({
                    playerId: p.id,
                    battlefield:
                        p.battlefield as unknown as CardInstanceState[],
                }))
            )
        ).toEqual(onFat);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// C8a — Amphibious Kavu (CR 509.1h "blocks or becomes blocked by" combat-
// pairing trigger with a colour filter, issue #1942). Exercised through the
// REAL combat path: `emitBlockersConfirmedEvents` (`gre/phases.ts`) is the
// production emitter, not a hand-built `TriggerStateView` — the only way to
// prove the new `attackerColors`/`blockerColors` event fields actually reach
// `matches` the way the real engine populates them.
// ─────────────────────────────────────────────────────────────────────────────
describe("Amphibious Kavu ({2}{G} 2/2 — blocks/becomes-blocked-by colour trigger, CR 509.1h / 603.3b)", () => {
    // p1 always controls the attacker, p2 always controls the blocker(s) —
    // `emitBlockersConfirmedEvents` resolves sides off `state.activePlayerId`
    // (defaults to "p1", `setup.ts`'s `makeState`).
    function setupCombat(opts: {
        kavuRole: "attacker" | "blocker";
        /** The lone attacker, when Kavu is the BLOCKER. Defaults to a plain
         *  green Craw Wurm (non-matching colour, irrelevant to the trigger's
         *  filter on this side). */
        attacker?: CardInstanceState;
        /** The blocker(s), when Kavu is the ATTACKER (becomes-blocked-by
         *  direction). Ignored when Kavu itself is the blocker. */
        otherBlockers?: CardInstanceState[];
    }) {
        const kavu = makeInstance(amphibiousKavu.id, {
            id: "kavu",
            controllerId: opts.kavuRole === "attacker" ? "p1" : "p2",
            ownerId: opts.kavuRole === "attacker" ? "p1" : "p2",
            isAttacking: opts.kavuRole === "attacker",
            isBlocking: opts.kavuRole === "blocker",
        });
        const attacker: CardInstanceState =
            opts.kavuRole === "attacker"
                ? kavu
                : (opts.attacker ??
                  makeInstance(crawWurm.id, {
                      id: "atk",
                      controllerId: "p1",
                      ownerId: "p1",
                      isAttacking: true,
                  }));
        const blockers: CardInstanceState[] =
            opts.kavuRole === "blocker" ? [kavu] : (opts.otherBlockers ?? []);

        const blockerAssignments: Record<string, string[]> = {};
        for (const b of blockers) blockerAssignments[b.id] = [attacker.id];

        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield:
                        opts.kavuRole === "attacker" ? [kavu] : [attacker],
                }),
                makePlayer("p2", { battlefield: blockers }),
            ],
            phase: "DECLARE_BLOCKERS",
            combat: {
                attackerIds: [attacker.id],
                confirmed: true,
                blockerAssignments,
                blockersConfirmed: true,
            },
        });
        return { state, kavu };
    }

    it("is a {2}{G} 2/2 Kavu with the modern oracle text", () => {
        expect(amphibiousKavu.manaCost).toEqual({ X: 2, G: 1 });
        expect(amphibiousKavu.types).toEqual(["Creature"]);
        expect(amphibiousKavu.subtypes).toEqual(["Kavu"]);
        expect(amphibiousKavu.power).toBe(2);
        expect(amphibiousKavu.toughness).toBe(2);
        expect(amphibiousKavu.oracleText).toBe(
            "Whenever this creature blocks or becomes blocked by one or more blue and/or black creatures, this creature gets +3/+3 until end of turn."
        );
    });

    it("fires when Kavu BLOCKS a blue creature (uses the Stack, does not auto-resolve)", () => {
        const air = makeInstance(airElemental.id, {
            id: "atk",
            controllerId: "p1",
            ownerId: "p1",
            isAttacking: true,
        });
        const { state, kavu } = setupCombat({
            kavuRole: "blocker",
            attacker: air,
        });

        emitBlockersConfirmedEvents(state);
        expect(state.stack).toHaveLength(1); // on the Stack, not auto-resolved
        expect(state.stack[0].triggeredAbilityId).toBe(
            "amphibious-kavu-combat-pump"
        );
        resolveTopOfStack(state);
        expect(getEffectivePower(state, kavu)).toBe(5);
        expect(getEffectiveToughness(state, kavu)).toBe(5);
    });

    it("fires when Kavu BECOMES BLOCKED BY a black creature", () => {
        const knight = makeInstance(blackKnight.id, {
            id: "knight",
            controllerId: "p2",
            ownerId: "p2",
            isBlocking: true,
        });
        const { state, kavu } = setupCombat({
            kavuRole: "attacker",
            otherBlockers: [knight],
        });

        emitBlockersConfirmedEvents(state);
        expect(state.stack).toHaveLength(1);
        resolveTopOfStack(state);
        expect(getEffectivePower(state, kavu)).toBe(5);
        expect(getEffectiveToughness(state, kavu)).toBe(5);
    });

    it("does NOT fire when blocked only by a non-blue/black creature", () => {
        const wurm = makeInstance(crawWurm.id, {
            id: "wurm",
            controllerId: "p2",
            ownerId: "p2",
            isBlocking: true,
        });
        const { state, kavu } = setupCombat({
            kavuRole: "attacker",
            otherBlockers: [wurm],
        });

        emitBlockersConfirmedEvents(state);
        expect(state.stack).toHaveLength(0);
        expect(getEffectivePower(state, kavu)).toBe(2);
    });

    it("fires exactly ONCE when blocked by TWO blue/black creatures (CR 603.3b batching, official ruling: once per combat)", () => {
        const air = makeInstance(airElemental.id, {
            id: "air",
            controllerId: "p2",
            ownerId: "p2",
            isBlocking: true,
        });
        const knight = makeInstance(blackKnight.id, {
            id: "knight",
            controllerId: "p2",
            ownerId: "p2",
            isBlocking: true,
        });
        const { state, kavu } = setupCombat({
            kavuRole: "attacker",
            otherBlockers: [air, knight],
        });

        emitBlockersConfirmedEvents(state);
        expect(state.stack).toHaveLength(1); // not two
        resolveTopOfStack(state);
        expect(getEffectivePower(state, kavu)).toBe(5); // +3/+3 once, not +6/+6
        expect(getEffectiveToughness(state, kavu)).toBe(5);
    });

    it("fires exactly ONCE when only ONE of several blockers matches (mixed pairing)", () => {
        const wurm = makeInstance(crawWurm.id, {
            id: "wurm",
            controllerId: "p2",
            ownerId: "p2",
            isBlocking: true,
        });
        const air = makeInstance(airElemental.id, {
            id: "air",
            controllerId: "p2",
            ownerId: "p2",
            isBlocking: true,
        });
        const { state, kavu } = setupCombat({
            kavuRole: "attacker",
            otherBlockers: [wurm, air],
        });

        emitBlockersConfirmedEvents(state);
        expect(state.stack).toHaveLength(1);
        resolveTopOfStack(state);
        expect(getEffectivePower(state, kavu)).toBe(5);
    });

    it("reads EFFECTIVE colour through the layer pipeline (colorOverride, CR 202.2/613.1d) — a green creature made blue still counts", () => {
        const paintedWurm = makeInstance(crawWurm.id, {
            id: "painted-wurm",
            controllerId: "p2",
            ownerId: "p2",
            isBlocking: true,
            colorOverride: ["U"],
        });
        const { state, kavu } = setupCombat({
            kavuRole: "attacker",
            otherBlockers: [paintedWurm],
        });

        emitBlockersConfirmedEvents(state);
        expect(state.stack).toHaveLength(1);
        resolveTopOfStack(state);
        expect(getEffectivePower(state, kavu)).toBe(5);
    });

    it("+3/+3 lasts until end of turn and is gone after cleanup (CR 514.2)", () => {
        const knight = makeInstance(blackKnight.id, {
            id: "knight",
            controllerId: "p2",
            ownerId: "p2",
            isBlocking: true,
        });
        const { state, kavu } = setupCombat({
            kavuRole: "attacker",
            otherBlockers: [knight],
        });
        emitBlockersConfirmedEvents(state);
        resolveTopOfStack(state);
        expect(getEffectiveToughness(state, kavu)).toBe(5);

        state.phase = "END_STEP";
        advancePhase(state); // traverses CLEANUP, purges EOT buffs
        const kavuAfter = state.players
            .flatMap((p) => p.battlefield)
            .find((c) => c.id === "kavu")!;
        expect(getEffectivePower(state, kavuAfter)).toBe(2);
        expect(getEffectiveToughness(state, kavuAfter)).toBe(2);
    });

    it("survives the wire projection (mandatory — visible P/T change)", () => {
        const knight = makeInstance(blackKnight.id, {
            id: "knight",
            controllerId: "p2",
            ownerId: "p2",
            isBlocking: true,
        });
        const { state } = setupCombat({
            kavuRole: "attacker",
            otherBlockers: [knight],
        });
        emitBlockersConfirmedEvents(state);
        resolveTopOfStack(state);

        const projected = projectPublicState(state, 1, "p1");
        const slimKavu = projected.players[0].battlefield.find(
            (c) => c.id === "kavu"
        )!;
        expect(getEffectivePower(projected, slimKavu)).toBe(5);
        expect(getEffectiveToughness(projected, slimKavu)).toBe(5);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Free tranche (issue #1952) — mandatory hand-written coverage for the slice's
// genuinely tricky cards (staticEffects[]/activatedAbilities[] per the Card
// testing convention, plus the two DSL cards the scenario generator can't
// faithfully assert: Quirion Dryad's spell-color trigger and Pygmy Kavu's
// color-filtered count, both explicit-skip cases per `scenarioGenerator.ts`).
// ─────────────────────────────────────────────────────────────────────────────

describe("Magnigoth Treefolk ({4}{G} 2/6 — Domain landwalk grant, CR 702 preamble / 702.14)", () => {
    it("is a {4}{G} 2/6 Treefolk with the modern oracle text and five keyword-grant statics", () => {
        expect(magnigothTreefolk.manaCost).toEqual({ X: 4, G: 1 });
        expect(magnigothTreefolk.types).toEqual(["Creature"]);
        expect(magnigothTreefolk.subtypes).toEqual(["Treefolk"]);
        expect(magnigothTreefolk.power).toBe(2);
        expect(magnigothTreefolk.toughness).toBe(6);
        expect(magnigothTreefolk.staticEffects).toHaveLength(5);
        const keywords = magnigothTreefolk.staticEffects!.map((e) =>
            e.kind === "keyword-grant" ? e.keyword : undefined
        );
        expect(keywords.sort()).toEqual(
            [
                "plainswalk",
                "islandwalk",
                "swampwalk",
                "mountainwalk",
                "forestwalk",
            ].sort()
        );
    });

    it("grants ONLY the landwalk(s) matching the basic land types actually controlled", () => {
        const treefolk = makeInstance(magnigothTreefolk.id, {
            id: "mag",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        treefolk,
                        makeInstance(forest.id, { controllerId: "p1" }),
                        makeInstance(island.id, { controllerId: "p1" }),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        applySourceStaticEffects(state, treefolk);
        const after = state.players[0].battlefield.find((c) => c.id === "mag")!;
        expect(after.staticAbilities).toEqual(
            expect.arrayContaining(["forestwalk", "islandwalk"])
        );
        expect(after.staticAbilities).not.toContain("swampwalk");
        expect(after.staticAbilities).not.toContain("mountainwalk");
        expect(after.staticAbilities).not.toContain("plainswalk");
    });

    it("tracks the board — gaining a third basic land type grants a third landwalk on refresh (CR 611.2c 'as long as')", () => {
        const treefolk = makeInstance(magnigothTreefolk.id, {
            id: "mag2",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        treefolk,
                        makeInstance(forest.id, { controllerId: "p1" }),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        applySourceStaticEffects(state, treefolk);
        let after = state.players[0].battlefield.find((c) => c.id === "mag2")!;
        expect(after.staticAbilities).toContain("forestwalk");
        expect(after.staticAbilities).not.toContain("plainswalk");

        state.players[0].battlefield.push(
            makeInstance(plains.id, { controllerId: "p1" })
        );
        refreshCounterGatedStatics(state);
        after = state.players[0].battlefield.find((c) => c.id === "mag2")!;
        expect(after.staticAbilities).toContain("forestwalk");
        expect(after.staticAbilities).toContain("plainswalk");
    });

    it("survives the wire projection — the granted landwalk keyword is on the slim permanent", () => {
        const treefolk = makeInstance(magnigothTreefolk.id, {
            id: "mag3",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        treefolk,
                        makeInstance(swamp.id, { controllerId: "p1" }),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        applySourceStaticEffects(state, treefolk);
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "mag3"
        )!;
        expect(slim.staticAbilities).toContain("swampwalk");
    });
});

describe("Multani's Harmony ({G} Aura — grants a mana ability, CR 303.4 / 611.2c / 605.3a)", () => {
    it("is a {G} Aura enchanting a creature, granting a useStack:false any-color mana ability", () => {
        expect(multanisHarmony.manaCost).toEqual({ G: 1 });
        expect(multanisHarmony.types).toEqual(["Enchantment"]);
        expect(multanisHarmony.subtypes).toEqual(["Aura"]);
        expect(multanisHarmony.targetRequirement).toEqual({
            type: "Creature",
            count: 1,
        });
        const grant = multanisHarmony.staticEffects!.find(
            (e) => e.kind === "activated-grant"
        );
        expect(grant).toBeDefined();
        const tmpl = multanisHarmony.grantTemplates!.find(
            (g) => g.id === "multanis-harmony-mana"
        )!;
        expect(tmpl.useStack).toBe(false);
        expect(tmpl.cost).toEqual({ tap: true });
        expect(tmpl.manaChoices).toEqual([
            { W: 1 },
            { U: 1 },
            { B: 1 },
            { R: 1 },
            { G: 1 },
        ]);
    });

    it("materializes onto the host once attached, visible to getEffectiveActivatedAbilities (CR 113.1)", () => {
        const host = makeInstance(grizzlyBears.id, {
            id: "host",
            controllerId: "p1",
            ownerId: "p1",
        });
        const aura = makeInstance(multanisHarmony.id, {
            id: "aura",
            controllerId: "p1",
            ownerId: "p1",
            attachedTo: "host",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [host, aura] }),
                makePlayer("p2"),
            ],
        });
        applySourceStaticEffects(state, aura);
        const hostAfter = state.players[0].battlefield.find(
            (c) => c.id === "host"
        )!;
        const grants = getEffectiveActivatedAbilities(hostAfter);
        const granted = grants.find(
            (g) => g.ability.id === "multanis-harmony-mana"
        );
        expect(granted).toBeDefined();
        expect(granted?.grantedSourceCardId).toBe(multanisHarmony.id);
    });

    it("the granted mana ability is a real tap option — the unified auto-tap solver sees it (issue #1880)", () => {
        const host = makeInstance(grizzlyBears.id, {
            id: "host2",
            controllerId: "p1",
            ownerId: "p1",
            isTapped: false,
        });
        const aura = makeInstance(multanisHarmony.id, {
            id: "aura2",
            controllerId: "p1",
            ownerId: "p1",
            attachedTo: "host2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [host, aura] }),
                makePlayer("p2"),
            ],
        });
        applySourceStaticEffects(state, aura);
        const hostAfter = state.players[0].battlefield.find(
            (c) => c.id === "host2"
        )!;
        expect(
            hasManaAbility(hostAfter, undefined, state.players[0].battlefield)
        ).toBe(true);
        const boards = state.players.map((p) => ({
            playerId: p.id,
            battlefield: p.battlefield,
        }));
        const detailed = getManaTapOptionsDetailed(hostAfter, "p1", boards);
        expect(
            detailed.some(
                (o) =>
                    o.source.kind === "activated" &&
                    o.source.abilityId === "multanis-harmony-mana"
            )
        ).toBe(true);
        expect(getEffectiveManaChoices(hostAfter, "p1", boards)).toEqual([
            { W: 1 },
            { U: 1 },
            { B: 1 },
            { R: 1 },
            { G: 1 },
        ]);
    });

    it("survives the wire projection — the granted mana ability is still discoverable on the slim host", () => {
        const host = makeInstance(grizzlyBears.id, {
            id: "host3",
            controllerId: "p1",
            ownerId: "p1",
        });
        const aura = makeInstance(multanisHarmony.id, {
            id: "aura3",
            controllerId: "p1",
            ownerId: "p1",
            attachedTo: "host3",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [host, aura] }),
                makePlayer("p2"),
            ],
        });
        applySourceStaticEffects(state, aura);
        const projected = projectPublicState(state, 1, "p1");
        const slimHost = projected.players[0].battlefield.find(
            (c) => c.id === "host3"
        )! as unknown as CardInstanceState;
        const boards = projected.players.map((p) => ({
            playerId: p.id,
            battlefield: p.battlefield as unknown as CardInstanceState[],
        }));
        expect(hasManaAbility(slimHost, undefined, boards[0].battlefield)).toBe(
            true
        );
        expect(getEffectiveManaChoices(slimHost, "p1", boards)).toEqual([
            { W: 1 },
            { U: 1 },
            { B: 1 },
            { R: 1 },
            { G: 1 },
        ]);
    });
});

describe("Nemata, Grove Guardian ({4}{G}{G} Legendary 4/5 — Saproling maker + sac-pump, CR 602.1)", () => {
    it("is a {4}{G}{G} Legendary Treefolk 4/5 with the modern oracle text", () => {
        expect(nemataGroveGuardian.manaCost).toEqual({ X: 4, G: 2 });
        expect(nemataGroveGuardian.types).toEqual(["Creature"]);
        expect(nemataGroveGuardian.supertypes).toEqual(["Legendary"]);
        expect(nemataGroveGuardian.subtypes).toEqual(["Treefolk"]);
        expect(nemataGroveGuardian.power).toBe(4);
        expect(nemataGroveGuardian.toughness).toBe(5);
        expect(nemataGroveGuardian.activatedAbilities).toHaveLength(2);
    });

    it("{2}{G}: creates a 1/1 green Saproling token with resolvable art", () => {
        const nemata = makeInstance(nemataGroveGuardian.id, {
            id: "nemata",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [nemata] }),
                makePlayer("p2"),
            ],
        });
        pushActivated(state, nemata, "nemata-make-saproling");
        const saprolings = state.players[0].battlefield.filter((c) =>
            c.subtypes?.includes("Saproling")
        );
        expect(saprolings).toHaveLength(1);
        expect(getEffectivePower(state, saprolings[0])).toBe(1);
        expect(getEffectiveToughness(state, saprolings[0])).toBe(1);
    });

    it("Sacrifice a Saproling: EVERY Saproling creature gets +1/+1 until end of turn — not scoped to the controller (CR 611, Oracle text names no controller)", () => {
        const nemata = makeInstance(nemataGroveGuardian.id, {
            id: "nemata2",
            controllerId: "p1",
            ownerId: "p1",
        });
        const sap1 = makeInstance(nemataGroveGuardian.id, {
            id: "sap1",
            controllerId: "p1",
            ownerId: "p1",
            types: ["Creature"],
            subtypes: ["Saproling"],
            power: 1,
            toughness: 1,
        });
        const sap2 = makeInstance(nemataGroveGuardian.id, {
            id: "sap2",
            controllerId: "p1",
            ownerId: "p1",
            types: ["Creature"],
            subtypes: ["Saproling"],
            power: 1,
            toughness: 1,
        });
        // An OPPONENT's Saproling — pinning the scope in a test rather than
        // just a comment: the `forEach` has no `controller`, so
        // `selectForEachMembers` sweeps every player's battlefield
        // (`interpreter.ts`), and the effect must pump this too.
        const oppSap = makeInstance(nemataGroveGuardian.id, {
            id: "opp-sap",
            controllerId: "p2",
            ownerId: "p2",
            types: ["Creature"],
            subtypes: ["Saproling"],
            power: 1,
            toughness: 1,
        });
        const state = makeState({
            players: [
                // sap1 already "sacrificed" (the cost's own payment) — only
                // sap2 remains on the battlefield when the effect resolves.
                makePlayer("p1", { battlefield: [nemata, sap2] }),
                makePlayer("p2", { battlefield: [oppSap] }),
            ],
        });
        pushActivated(state, nemata, "nemata-pump-saprolings");
        const sap2After = state.players[0].battlefield.find(
            (c) => c.id === "sap2"
        )!;
        const oppSapAfter = state.players[1].battlefield.find(
            (c) => c.id === "opp-sap"
        )!;
        expect(getEffectivePower(state, sap2After)).toBe(2);
        expect(getEffectiveToughness(state, sap2After)).toBe(2);
        expect(getEffectivePower(state, oppSapAfter)).toBe(2);
        expect(getEffectiveToughness(state, oppSapAfter)).toBe(2);
        void sap1;
    });

    it("survives the wire projection — the mass +1/+1 is visible on the slim Saprolings", () => {
        const nemata = makeInstance(nemataGroveGuardian.id, {
            id: "nemata3",
            controllerId: "p1",
            ownerId: "p1",
        });
        const sap = makeInstance(nemataGroveGuardian.id, {
            id: "sap3",
            controllerId: "p1",
            ownerId: "p1",
            types: ["Creature"],
            subtypes: ["Saproling"],
            power: 1,
            toughness: 1,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [nemata, sap] }),
                makePlayer("p2"),
            ],
        });
        pushActivated(state, nemata, "nemata-pump-saprolings");
        const projected = projectPublicState(state, 1, "p1");
        const slimSap = projected.players[0].battlefield.find(
            (c) => c.id === "sap3"
        )!;
        expect(getEffectivePower(projected, slimSap)).toBe(2);
        expect(getEffectiveToughness(projected, slimSap)).toBe(2);
    });
});

describe("Pygmy Kavu ({3}{G} 1/2 — draw per opponent black creature, CR 603.6a; color-filtered count, issue #1952)", () => {
    it("is a {3}{G} 1/2 Kavu with the modern oracle text", () => {
        expect(pygmyKavu.manaCost).toEqual({ X: 3, G: 1 });
        expect(pygmyKavu.types).toEqual(["Creature"]);
        expect(pygmyKavu.subtypes).toEqual(["Kavu"]);
        expect(pygmyKavu.power).toBe(1);
        expect(pygmyKavu.toughness).toBe(2);
    });

    it("draws one card per BLACK creature an opponent controls — nonblack creatures don't count", () => {
        const kavu = makeInstance(pygmyKavu.id, {
            id: "pk",
            controllerId: "p1",
            ownerId: "p1",
        });
        const lib = Array.from({ length: 5 }, (_, i) =>
            makeInstance(crawWurm.id, {
                id: `lib${i}`,
                controllerId: "p1",
                ownerId: "p1",
                zone: "library",
            })
        );
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [kavu], library: lib }),
                makePlayer("p2", {
                    battlefield: [
                        makeInstance(blackKnight.id, {
                            id: "bk1",
                            controllerId: "p2",
                            ownerId: "p2",
                        }),
                        makeInstance(blackKnight.id, {
                            id: "bk2",
                            controllerId: "p2",
                            ownerId: "p2",
                        }),
                        // A non-black creature must NOT count.
                        makeInstance(crawWurm.id, {
                            id: "wurm",
                            controllerId: "p2",
                            ownerId: "p2",
                        }),
                    ],
                }),
            ],
        });
        pushTrigger(state, kavu, "pygmy-kavu-etb-draw", {
            type: "PERMANENT_ENTERED",
            instanceId: kavu.id,
            controllerId: kavu.controllerId,
            types: kavu.types,
        } as StackItem["triggerEvent"]);
        expect(state.players[0].hand).toHaveLength(2);
    });

    it("draws zero cards when the opponent controls no black creature", () => {
        const kavu = makeInstance(pygmyKavu.id, {
            id: "pk2",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [kavu],
                    library: [
                        makeInstance(crawWurm.id, {
                            id: "lib0",
                            controllerId: "p1",
                            ownerId: "p1",
                            zone: "library",
                        }),
                    ],
                }),
                makePlayer("p2", {
                    battlefield: [
                        makeInstance(crawWurm.id, {
                            id: "wurm2",
                            controllerId: "p2",
                            ownerId: "p2",
                        }),
                    ],
                }),
            ],
        });
        pushTrigger(state, kavu, "pygmy-kavu-etb-draw", {
            type: "PERMANENT_ENTERED",
            instanceId: kavu.id,
            controllerId: kavu.controllerId,
            types: kavu.types,
        } as StackItem["triggerEvent"]);
        expect(state.players[0].hand).toHaveLength(0);
    });
});

describe("Quirion Dryad ({1}{G} 1/1 — spell-COLOR triggered +1/+1 counter, CR 601.2i / 603.2)", () => {
    const trig = quirionDryad.triggeredAbilities?.[0];

    it("is a {1}{G} 1/1 Dryad with the modern oracle text and a DSL-only trigger", () => {
        expect(quirionDryad.manaCost).toEqual({ X: 1, G: 1 });
        expect(quirionDryad.types).toEqual(["Creature"]);
        expect(quirionDryad.subtypes).toEqual(["Dryad"]);
        expect(quirionDryad.power).toBe(1);
        expect(quirionDryad.toughness).toBe(1);
        expect(trig).toBeDefined();
        expect(trig!.effects).toBeDefined();
        expect(trig!.resolve).toBeUndefined();
    });

    it("discriminates the CAST SPELL's color — not the permanent's own color", () => {
        const self = {
            id: "qd1",
            controllerId: "p1",
            ownerId: "p1",
            types: ["Creature"] as const,
            subtypes: ["Dryad"],
            isTapped: false,
            card: {},
        };
        const baseEvent = {
            type: "SPELL_CAST" as const,
            casterId: "p1",
            spellInstanceId: "x",
            spellCardId: "y",
            spellTypes: ["Instant"] as const,
            spellSubtypes: [],
        };
        for (const color of ["W", "U", "B", "R"] as const) {
            expect(
                trig!.matches(
                    { ...baseEvent, spellColors: [color] },
                    self as never
                )
            ).toBe(true);
        }
        // Its OWN color (green) does not match the "white, blue, black, or
        // red" filter.
        expect(
            trig!.matches({ ...baseEvent, spellColors: ["G"] }, self as never)
        ).toBe(false);
        // Colorless never matches.
        expect(
            trig!.matches({ ...baseEvent, spellColors: [] }, self as never)
        ).toBe(false);
        // Only the controller's OWN casts (scope "you").
        expect(
            trig!.matches(
                { ...baseEvent, casterId: "p2", spellColors: ["R"] },
                self as never
            )
        ).toBe(false);
    });

    it("puts a +1/+1 counter on itself when the matching trigger resolves", () => {
        const dryad = makeInstance(quirionDryad.id, {
            id: "qd2",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [dryad] }),
                makePlayer("p2"),
            ],
        });
        pushTrigger(state, dryad, trig!.id, {
            type: "SPELL_CAST",
            casterId: "p1",
            spellInstanceId: "s",
            spellCardId: "c",
            spellTypes: ["Instant"],
            spellSubtypes: [],
            spellColors: ["R"],
        } as StackItem["triggerEvent"]);
        const after = state.players[0].battlefield.find((c) => c.id === "qd2")!;
        expect(after.counters?.["+1/+1"]).toBe(1);
        expect(getEffectivePower(state, after)).toBe(2);
        expect(getEffectiveToughness(state, after)).toBe(2);
    });

    it("survives the wire projection — the +1/+1 counter is visible on the slim permanent", () => {
        const dryad = makeInstance(quirionDryad.id, {
            id: "qd3",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [dryad] }),
                makePlayer("p2"),
            ],
        });
        pushTrigger(state, dryad, trig!.id, {
            type: "SPELL_CAST",
            casterId: "p1",
            spellInstanceId: "s",
            spellCardId: "c",
            spellTypes: ["Sorcery"],
            spellSubtypes: [],
            spellColors: ["B"],
        } as StackItem["triggerEvent"]);
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "qd3"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(2);
        expect(getEffectiveToughness(projected, slim)).toBe(2);
    });
});

describe("Thornscape Battlemage ({2}{G} 2/2 — Kicker {R} and/or {W}, two independent ETB triggers, CR 702.33a, issue #1937)", () => {
    function triggerEventFor(bm: CardInstanceState): StackItem["triggerEvent"] {
        return {
            type: "PERMANENT_ENTERED",
            instanceId: bm.id,
            controllerId: bm.controllerId,
            types: bm.types,
        } as StackItem["triggerEvent"];
    }

    it("declares two independent Kickers with the canonical Kicker descriptions", () => {
        expect(thornscapeBattlemage.kickers).toEqual([
            { id: "kicker-r", description: "Kicker {R}", mana: { R: 1 } },
            { id: "kicker-w", description: "Kicker {W}", mana: { W: 1 } },
        ]);
        expect(thornscapeBattlemage.triggeredAbilities).toHaveLength(2);
    });

    it("unkicked: neither trigger does anything, even though both still announce a target", () => {
        const bm = makeInstance(thornscapeBattlemage.id, {
            id: "bm1",
            controllerId: "p1",
            ownerId: "p1",
        });
        const artifact = makeInstance(mirrorwoodTreefolk.id, {
            id: "art1",
            controllerId: "p2",
            ownerId: "p2",
            types: ["Artifact"],
            subtypes: [],
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bm], life: 20 }),
                makePlayer("p2", { battlefield: [artifact], life: 20 }),
            ],
        });
        pushTrigger(
            state,
            bm,
            "thornscape-battlemage-red-kicker",
            triggerEventFor(bm),
            [{ type: "player", id: "p2" }]
        );
        expect(state.players[1].life).toBe(20);

        pushTrigger(
            state,
            bm,
            "thornscape-battlemage-white-kicker",
            triggerEventFor(bm),
            [{ type: "permanent", id: "art1" }]
        );
        expect(state.players[1].battlefield.some((c) => c.id === "art1")).toBe(
            true
        );
    });

    it("kicked with only the {R} kicker: deals 2 damage to any target; the artifact-destroy trigger does nothing", () => {
        const bm = makeInstance(thornscapeBattlemage.id, {
            id: "bm2",
            controllerId: "p1",
            ownerId: "p1",
            kickerPayments: { "kicker-r": 1 },
        });
        const artifact = makeInstance(mirrorwoodTreefolk.id, {
            id: "art2",
            controllerId: "p2",
            ownerId: "p2",
            types: ["Artifact"],
            subtypes: [],
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bm], life: 20 }),
                makePlayer("p2", { battlefield: [artifact], life: 20 }),
            ],
        });
        pushTrigger(
            state,
            bm,
            "thornscape-battlemage-red-kicker",
            triggerEventFor(bm),
            [{ type: "player", id: "p2" }]
        );
        expect(state.players[1].life).toBe(18);

        pushTrigger(
            state,
            bm,
            "thornscape-battlemage-white-kicker",
            triggerEventFor(bm),
            [{ type: "permanent", id: "art2" }]
        );
        expect(state.players[1].battlefield.some((c) => c.id === "art2")).toBe(
            true
        );
    });

    it("kicked with only the {W} kicker: destroys the target artifact; no damage dealt", () => {
        const bm = makeInstance(thornscapeBattlemage.id, {
            id: "bm3",
            controllerId: "p1",
            ownerId: "p1",
            kickerPayments: { "kicker-w": 1 },
        });
        const artifact = makeInstance(mirrorwoodTreefolk.id, {
            id: "art3",
            controllerId: "p2",
            ownerId: "p2",
            types: ["Artifact"],
            subtypes: [],
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bm], life: 20 }),
                makePlayer("p2", { battlefield: [artifact], life: 20 }),
            ],
        });
        pushTrigger(
            state,
            bm,
            "thornscape-battlemage-red-kicker",
            triggerEventFor(bm),
            [{ type: "player", id: "p2" }]
        );
        expect(state.players[1].life).toBe(20);

        pushTrigger(
            state,
            bm,
            "thornscape-battlemage-white-kicker",
            triggerEventFor(bm),
            [{ type: "permanent", id: "art3" }]
        );
        expect(state.players[1].battlefield.some((c) => c.id === "art3")).toBe(
            false
        );
        expect(state.players[1].graveyard.some((c) => c.id === "art3")).toBe(
            true
        );
    });

    it("kicked with BOTH kickers: deals 2 damage AND destroys the target", () => {
        const bm = makeInstance(thornscapeBattlemage.id, {
            id: "bm4",
            controllerId: "p1",
            ownerId: "p1",
            kickerPayments: { "kicker-r": 1, "kicker-w": 1 },
        });
        const artifact = makeInstance(mirrorwoodTreefolk.id, {
            id: "art4",
            controllerId: "p2",
            ownerId: "p2",
            types: ["Artifact"],
            subtypes: [],
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bm], life: 20 }),
                makePlayer("p2", { battlefield: [artifact], life: 20 }),
            ],
        });
        pushTrigger(
            state,
            bm,
            "thornscape-battlemage-red-kicker",
            triggerEventFor(bm),
            [{ type: "player", id: "p2" }]
        );
        expect(state.players[1].life).toBe(18);

        pushTrigger(
            state,
            bm,
            "thornscape-battlemage-white-kicker",
            triggerEventFor(bm),
            [{ type: "permanent", id: "art4" }]
        );
        expect(state.players[1].battlefield.some((c) => c.id === "art4")).toBe(
            false
        );
    });
});

// ─────────────────────────────────────────────────────────────────────────
// Thornscape Battlemage — CR 603.4 per-Kicker check-time gate (PR #2040
// round 2, issue #2015). The tests above push the trigger stack items
// DIRECTLY (`pushTrigger`), which bypasses `matches`/`collectTriggers`
// entirely and therefore never exercises the gate itself — the bug (#2039's
// class, reproduced on this card because it shipped before #2039 landed) is
// that BOTH triggers used to always reach the stack regardless of which
// Kicker was actually paid, announcing a target and firing a real
// `BECAME_TARGET` event even for the unpaid leg. Only the REAL cast path
// (`pushSpell` -> `resolveTopOfStack` -> battlefield entry -> `collectTriggers`)
// exercises `matches`/`gate`, so this block pushes the CREATURE SPELL, not
// the trigger, and censuses which of the two ETB abilities the engine
// actually allows onto the stack — one test per (kickers paid) cell,
// including the must-NOT cells, which are the whole point (mirrors
// Thunderscape Battlemage's `pls/red.ts` census exactly).
// ─────────────────────────────────────────────────────────────────────────
const TB_ARTIFACT_ID = "test-pls-green-battlemage-artifact";
registerTokenDefinition({
    id: TB_ARTIFACT_ID,
    name: TB_ARTIFACT_ID,
    rarity: "common",
    manaCost: { X: 1 },
    types: ["Artifact"],
});

const TB_WITNESS_ID = "test-pls-green-battlemage-target-witness";
registerTokenDefinition({
    id: TB_WITNESS_ID,
    name: TB_WITNESS_ID,
    rarity: "common",
    manaCost: { X: 1 },
    types: ["Creature"],
    power: 1,
    toughness: 1,
    triggeredAbilities: [
        {
            id: "tb-witness-player-became-target",
            oracleText:
                "Whenever a player becomes the target of an ability, you gain 5 life.",
            event: "BECAME_TARGET",
            matches: (event) =>
                event.type === "BECAME_TARGET" &&
                event.target.type === "player",
            effects: [{ op: "gainLife", player: "controller", amount: 5 }],
        },
    ],
});

describe("Thornscape Battlemage — CR 603.4 per-Kicker check-time gate (issue #2015)", () => {
    /** Every queued `BECAME_TARGET` naming a PLAYER — the exact event a
     *  phantom red-kicker announcement fires (`emitBecameTargetEvents`). Read
     *  before the engine drains `pendingEvents`; the witness creature covers
     *  the already-drained case. */
    function playerBecameTargetEvents(state: GameState) {
        return (state.pendingEvents ?? []).filter(
            (e) => e.type === "BECAME_TARGET" && e.target.type === "player"
        );
    }

    /** Casts the Battlemage through the real path with the given per-Kicker
     *  payment record, resolves the creature spell (choosing a player target
     *  for the {R} trigger when it reaches the stack, since "any" offers
     *  more than one legal candidate and is never auto-selected), and
     *  reports which ETB triggers the engine actually allowed onto the
     *  stack. */
    function castKickedWith(payments?: Record<string, number>): {
        state: GameState;
        triggersOnStack: string[];
    } {
        const artifact = makeInstance(TB_ARTIFACT_ID, {
            id: "gate-art",
            controllerId: "p2",
            ownerId: "p2",
        });
        const witness = makeInstance(TB_WITNESS_ID, {
            id: "gate-witness",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", {
                    battlefield: [artifact, witness],
                    life: 20,
                }),
            ],
        });
        const item = pushSpell(state, thornscapeBattlemage.id, "p1");
        if (payments) item.kickerPayments = payments;
        resolveTopOfStack(state);
        // CR 603.3b — when BOTH triggers fire from the same event the engine
        // suspends on a `trigger-order` PendingChoice and holds the batch
        // off-stack; submit the ordering so the census below sees the stack.
        resolveTriggerOrder(state);
        if (state.pendingTarget?.targetType === "any") {
            applyOneTargetSelection(state, "p1", {
                targetType: "player",
                targetId: "p2",
            });
        }
        return {
            state,
            triggersOnStack: state.stack
                .map((s) => s.triggeredAbilityId)
                .filter((id): id is string => id !== undefined),
        };
    }

    /** Resolves everything left on the stack — the damage trigger's own
     *  resolution, then any secondary trigger it raises (the witness's
     *  BECAME_TARGET gain-life ability) — so a test can observe the fully
     *  resolved outcome after first taking its "reached the stack" census. */
    function drainStack(state: GameState): void {
        let guard = 0;
        while (state.stack.length > 0 && guard++ < 10) {
            resolveTopOfStack(state);
            resolveTriggerOrder(state);
        }
    }

    it("unkicked: NEITHER trigger reaches the stack (no target announced at all)", () => {
        const { state, triggersOnStack } = castKickedWith();
        expect(triggersOnStack).toEqual([]);
        expect(state.pendingTarget).toBeUndefined();
        expect(playerBecameTargetEvents(state)).toEqual([]);
        expect(state.players[1].life).toBe(20); // no BECAME_TARGET witnessed
    });

    it("kicked with {W} ONLY: the artifact-destroy trigger reaches the stack; the {R} damage trigger does NOT, and announces no target", () => {
        const { state, triggersOnStack } = castKickedWith({ "kicker-w": 1 });
        expect(triggersOnStack).toEqual(["thornscape-battlemage-white-kicker"]);
        expect(triggersOnStack).not.toContain(
            "thornscape-battlemage-red-kicker"
        );
        // The regression this issue exists for: the {R} trigger used to ride
        // onto the stack on the aggregate `wasKicked` flag and prompt for
        // "any target", firing a real BECAME_TARGET on the chosen target.
        expect(state.pendingTarget).toBeUndefined();
        expect(playerBecameTargetEvents(state)).toEqual([]);
        expect(state.players[1].life).toBe(20);
        // The {W} trigger's own target IS announced (sole legal artifact,
        // auto-selected per CR 603.3d) — the gate suppresses only the unpaid
        // Kicker's trigger, never the paid one.
        const destroyItem = state.stack.find(
            (s) => s.triggeredAbilityId === "thornscape-battlemage-white-kicker"
        );
        expect(destroyItem?.targets).toEqual([
            { type: "permanent", id: "gate-art" },
        ]);
    });

    it("kicked with {R} ONLY: the damage trigger reaches the stack and announces a target; the {W} destroy trigger does NOT", () => {
        const { state, triggersOnStack } = castKickedWith({ "kicker-r": 1 });
        expect(triggersOnStack).toEqual(["thornscape-battlemage-red-kicker"]);
        expect(triggersOnStack).not.toContain(
            "thornscape-battlemage-white-kicker"
        );
        // Choosing the player target DOES fire BECAME_TARGET — the witness
        // proves the event path is live, so the must-NOT rows above are
        // meaningful absence, not a dead observation.
        expect(playerBecameTargetEvents(state)).toHaveLength(1);
        // …and the witness actually collects it once the stack drains, which
        // is what makes its SILENCE in the must-NOT rows above meaningful.
        drainStack(state);
        // 20 base − 2 (the {R} trigger's own damage, targeted at the player)
        // + 5 (the witness's BECAME_TARGET gain-life ability) = 23.
        expect(state.players[1].life).toBe(23);
    });

    it("kicked with BOTH Kickers: both triggers reach the stack", () => {
        const { triggersOnStack } = castKickedWith({
            "kicker-r": 1,
            "kicker-w": 1,
        });
        expect(triggersOnStack.sort()).toEqual([
            "thornscape-battlemage-red-kicker",
            "thornscape-battlemage-white-kicker",
        ]);
    });

    it("no Battlemage in the cycle declares an `interveningIf` (the re-check would read a blinked permanent's cleared record) — Thornscape included", () => {
        for (const ability of thornscapeBattlemage.triggeredAbilities ?? []) {
            expect({
                ability: ability.id,
                interveningIf: ability.interveningIf,
            }).toEqual({
                ability: ability.id,
                interveningIf: undefined,
            });
            // …and each one still carries BOTH halves of the correct pair:
            // the check-time gate, and a resolution-time `if { kickerPaid }`
            // branch reading the resolving stack item's own record.
            expect(ability.gate).toBeDefined();
            expect(JSON.stringify(ability.effects)).toContain("kickerPaid");
        }
    });

    it("wire format: the per-Kicker record survives projectPublicState, so the gate reads the same answer client-side", () => {
        const { state } = castKickedWith({ "kicker-w": 1 });
        const bm = state.players[0].battlefield.find(
            (c) => c.card.id === thornscapeBattlemage.id
        )!;
        expect(
            kickerPaidCondition("kicker-w")(bm as unknown as PermanentView)
        ).toBe(true);
        expect(
            kickerPaidCondition("kicker-r")(bm as unknown as PermanentView)
        ).toBe(false);

        // `projectPublicState` strips `card.card` to `{ id }` and reshapes
        // the hidden zones; re-run the same assertion on the projected
        // permanent, since the client-side Brain evaluates the very same
        // gate predicate.
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === bm.id
        )!;
        expect(
            kickerPaidCondition("kicker-w")(slim as unknown as PermanentView)
        ).toBe(true);
        expect(
            kickerPaidCondition("kicker-r")(slim as unknown as PermanentView)
        ).toBe(false);
    });
});
