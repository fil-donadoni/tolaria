// PLS (Planeshift) — green card behavior tests (ADR 0043 colour split).
// Each card's describe block cites the CR section it exercises.
import { describe, it, expect } from "vitest";
import { amphibiousKavu, mirrorwoodTreefolk, quirionExplorer } from "../green";
import { crawWurm } from "../../lea/green";
import { lightningBolt } from "../../lea/red";
import { airElemental } from "../../lea/blue";
import { blackKnight } from "../../lea/black";
import { forest, island, mountain, swamp } from "../../lea/colorless";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import { projectPublicState } from "../../../../gameProjections";
import { resolveTopOfStack } from "../../../../gre/state";
import type { CardInstanceState, GameState } from "../../../../gre/state";
import {
    getEffectiveManaChoices,
    getManaTapOptionsDetailed,
} from "../../../../gre/constants";
import {
    getEffectivePower,
    getEffectiveToughness,
} from "../../../../gre/layers";
import {
    emitBlockersConfirmedEvents,
    advancePhase,
} from "../../../../gre/phases";
import { getLegalActions } from "../../../../gre/rules";
import type { TargetSelection } from "../../../types";

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
