// inv (Invasion) — colorless card behavior tests (ADR 0043 per-colour split).
//
// Tsabo's Web is a DSL card whose ETB cantrip reuses the already-exercised
// `draw` Op (covered catalogue-wide by the effect-script smoke test), so no
// hand-written draw test is required (per-Op regime). Its untap lock, however,
// introduces a NEW engine capability — the `dynamicMatch` refinement on
// `StaticUntapRestriction` (CR 502.1) — so that capability earns a dedicated
// GRE test here, including the mandatory wire-format projection re-assert for a
// board-visible continuous effect.

import { describe, expect, it } from "vitest";
import { emitBlockersConfirmedEvents, untapStep } from "../../../../gre/phases";
import { recordBlockedAttackers } from "../../../../gre/banding";
import {
    getEffectivePower,
    getEffectiveToughness,
} from "../../../../gre/layers";
import {
    applyCostModifiers,
    applySourceStaticEffects,
    getCostModifiers,
    normalizeManaCost,
    processPendingActionTriggers,
    resolveTopOfStack,
} from "../../../../gre/state";
import { checkStateBasedActions } from "../../../../gre/sba";
import { applyPendingChoiceSubmit } from "../../../../gre/pendingChoiceSubmit";
import { projectPublicState } from "../../../../gameProjections";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import { resolveActivated, resolveTrigger } from "./helpers";
import { getDefinition } from "../../../index";
import { applyDrawCardOnTap, tapSourceIntoPayment } from "../../../../game";
import {
    alloyGolem,
    archaeologicalDig,
    chromaticSphere,
    juntuStakes,
    lotusGuardian,
    phyrexianAltar,
    phyrexianLens,
    planarPortal,
    sparringGolem,
    tek,
    tsabosWeb,
    urzasFilter,
} from "../colorless";
import { mishrasFactory } from "../../atq/colorless";
import { creepingTarPit } from "../../wwk/colorless";
import { forest, island, mountain, plains, swamp } from "../../lea/colorless";
import { grizzlyBears } from "../../lea/green";
import { spectralShield } from "../../ice/multicolor";
import { sheoldredTheApocalypse } from "../../dmu/black";
import { hasNonManaActivatedAbility } from "../../../abilities/static/untapRestriction";

describe("Tsabo's Web (INV) — definition wiring", () => {
    it("is a {2} artifact with the ETB draw trigger and the untap-lock static", () => {
        expect(tsabosWeb.types).toEqual(["Artifact"]);
        expect(tsabosWeb.manaCost).toEqual({ X: 2 });
        expect(tsabosWeb.rarity).toBe("rare");

        // Part (a): self-scoped ETB trigger running a single `draw` Op (CR 603.6a).
        const etb = (tsabosWeb.triggeredAbilities ?? []).find(
            (t) => t.id === "tsabos-web-etb-draw"
        );
        expect(etb).toBeDefined();
        expect(etb?.effects).toEqual([
            { op: "draw", player: "controller", count: 1 },
        ]);

        // Part (b): continuous untap-restriction static (CR 502.1) with a hard
        // skip (maxUntap 0) refined by `dynamicMatch`.
        const restriction = (tsabosWeb.staticEffects ?? []).find(
            (e) => e.kind === "untap-restriction"
        );
        expect(restriction).toBeDefined();
        expect(restriction).toMatchObject({
            kind: "untap-restriction",
            maxUntap: 0,
            filter: { types: "Land" },
        });
        expect(
            (restriction as { dynamicMatch?: unknown }).dynamicMatch
        ).toBeTypeOf("function");
    });

    it("hasNonManaActivatedAbility classifies lands per CR 605.1a (no tap-cost requirement)", () => {
        // Mishra's Factory has "{T}: Target Assembly-Worker gets +1/+1"
        // (useStack:true) → a non-mana ability.
        expect(hasNonManaActivatedAbility(mishrasFactory)).toBe(true);
        // Creeping Tar Pit's animate ability is `{1}{U}{B}:` with NO {T} in its
        // cost (useStack:true) — a non-mana ability under the CR 605.1 test.
        // The old classifier wrongly required `cost.tap` and returned false,
        // letting the creatureland escape the lock; the modern oracle has no
        // tap clause, so it MUST be classified as locked.
        expect(hasNonManaActivatedAbility(creepingTarPit)).toBe(true);
        // A basic Plains has only its intrinsic mana ability → not locked.
        expect(hasNonManaActivatedAbility(plains)).toBe(false);
    });
});

describe("Tsabo's Web untap lock (CR 502.1, dynamicMatch)", () => {
    // Scenario: Tsabo's Web in play; a tapped Mishra's Factory (non-mana {T}
    // ability → locked) and a tapped Plains (mana-only → untaps normally), all
    // controlled by the active player at their untap step.
    function makeLockScenario() {
        const web = makeInstance(tsabosWeb.id, { id: "web" });
        const factory = makeInstance(mishrasFactory.id, {
            id: "factory",
            isTapped: true,
        });
        const land = makeInstance(plains.id, { id: "plain", isTapped: true });
        return makeState({
            phase: "UNTAP",
            players: [
                makePlayer("p1", { battlefield: [web, factory, land] }),
                makePlayer("p2"),
            ],
        });
    }

    it("keeps a land with a non-mana {T} ability tapped while a plain land untaps", () => {
        const state = makeLockScenario();
        untapStep(state);

        const factory = state.players[0].battlefield.find(
            (c) => c.id === "factory"
        )!;
        const land = state.players[0].battlefield.find(
            (c) => c.id === "plain"
        )!;
        // Hard skip (maxUntap 0) — no prompt, auto-resolved.
        expect(state.pendingChoices ?? []).toEqual([]);
        expect(factory.isTapped).toBe(true);
        expect(land.isTapped).toBe(false);
    });

    it("locks a creatureland whose non-mana animate ability has NO {T} in its cost (Creeping Tar Pit)", () => {
        // Regression: Creeping Tar Pit's `{1}{U}{B}:` animate ability carries no
        // tap cost, so the old `cost.tap === true` classifier let it untap under
        // Tsabo's Web. The modern oracle has no tap clause — it MUST stay locked.
        const web = makeInstance(tsabosWeb.id, { id: "web" });
        const tarpit = makeInstance(creepingTarPit.id, {
            id: "tarpit",
            isTapped: true,
        });
        const land = makeInstance(plains.id, { id: "plain", isTapped: true });
        const state = makeState({
            phase: "UNTAP",
            players: [
                makePlayer("p1", { battlefield: [web, tarpit, land] }),
                makePlayer("p2"),
            ],
        });
        untapStep(state);

        const tarpitAfter = state.players[0].battlefield.find(
            (c) => c.id === "tarpit"
        )!;
        const landAfter = state.players[0].battlefield.find(
            (c) => c.id === "plain"
        )!;
        // Hard skip (maxUntap 0) — no prompt, auto-resolved.
        expect(state.pendingChoices ?? []).toEqual([]);
        expect(tarpitAfter.isTapped).toBe(true);
        // A mana-only land is unaffected and untaps normally.
        expect(landAfter.isTapped).toBe(false);
    });

    it("removing Tsabo's Web lets the utility land untap again (control)", () => {
        const factory = makeInstance(mishrasFactory.id, {
            id: "factory",
            isTapped: true,
        });
        const land = makeInstance(plains.id, { id: "plain", isTapped: true });
        const state = makeState({
            phase: "UNTAP",
            players: [
                makePlayer("p1", { battlefield: [factory, land] }),
                makePlayer("p2"),
            ],
        });
        untapStep(state);
        // Without the Web in play, the utility land untaps like any other.
        expect(
            state.players[0].battlefield.find((c) => c.id === "factory")!
                .isTapped
        ).toBe(false);
    });

    it("survives the wire projection: the lock still holds on PublicGameState", () => {
        const state = makeLockScenario();
        untapStep(state);
        // The untap decision has already been applied server-side; the
        // projection must carry the resulting tapped/untapped state faithfully
        // (the client renders from the projected board, ADR 0043 wire test).
        const projected = projectPublicState(state, 1, "p1");
        const factory = projected.players[0].battlefield.find(
            (c) => c.id === "factory"
        )!;
        const land = projected.players[0].battlefield.find(
            (c) => c.id === "plain"
        )!;
        expect(factory.isTapped).toBe(true);
        expect(land.isTapped).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────
// Free tranche (issue #1074) — the remaining 11 of 13 colourless cards.
// ─────────────────────────────────────────────────────────────────────────

describe("Alloy Golem (ETB choose a color, is the chosen color; CR 105.2 / 613.1e / 603.6b, resolve() justification)", () => {
    it("is a 4/4 artifact creature with the self-scoped ETB colour-choice trigger", () => {
        expect(alloyGolem.types).toEqual(["Artifact", "Creature"]);
        expect(alloyGolem.power).toBe(4);
        expect(alloyGolem.toughness).toBe(4);
        const etb = (alloyGolem.triggeredAbilities ?? []).find(
            (t) => t.id === "alloy-golem-choose-color"
        );
        expect(etb).toBeDefined();
        expect(etb?.event).toBe("PERMANENT_ENTERED");
    });

    it("applies the chosen color indefinitely, surviving the wire projection", () => {
        const golem = makeInstance(alloyGolem.id, {
            id: "golem1",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [golem] }),
                makePlayer("p2"),
            ],
        });
        resolveTrigger(state, golem, "alloy-golem-choose-color", {
            type: "PERMANENT_ENTERED",
            instanceId: golem.id,
            controllerId: "p1",
            types: golem.types,
        });
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("option-pick");
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["R"],
        });
        const onBoard = state.players[0].battlefield.find(
            (c) => c.id === "golem1"
        )!;
        expect(onBoard.colorOverride).toEqual(["R"]);

        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "golem1"
        )!;
        expect(slim.colorOverride).toEqual(["R"]);
    });
});

// Chromatic Sphere's mana ability shares the `manaChoices` "any colour" shape
// already exercised by Lotus Guardian / Phyrexian Lens / Chromatic Star
// (tsp/colorless.ts) above, so the new surface here is purely the
// `drawsCardOnTap` rider (issue #1093) — a `resolve()`-adjacent engine
// behavior change (a new declarative rider on `ActivatedAbility`, wired at
// FOUR call sites in convex/game.ts), so it gets the full GRE test regime
// per `.claude/rules/gre-development.md`, not just the per-Op DSL sweep.
describe("Chromatic Sphere ({1}, {T}, Sacrifice: add one mana of any color, draw a card — CR 605.1a / 121.1, issue #1093)", () => {
    it("declares the mana ability with the drawsCardOnTap rider", () => {
        expect(chromaticSphere.manaCost).toEqual({ X: 1 });
        const mana = chromaticSphere.activatedAbilities!.find(
            (a) => a.id === "chromatic-sphere-mana"
        )!;
        expect(mana.useStack).toBe(false);
        expect(mana.manaChoices).toHaveLength(5);
        expect(mana.cost).toMatchObject({
            tap: true,
            sacrifice: true,
            mana: { X: 1 },
        });
        expect(mana.drawsCardOnTap).toBe(1);
    });

    // CR 605.1a / 601.2f — the payment-tap path is the REAL commit path this
    // card actually goes through (its mana ability has a {1} cost, which only
    // tapSourceIntoPayment/applyManaAbilityManaCost validates — same as
    // Chromatic Star, tsp/colorless.ts). Backs BOTH tapForPayment and
    // tapForActivationPayment (ADR: one shared helper, per game.ts's own
    // doc comment).
    it("payment-tap path (tapSourceIntoPayment): pays {1}, sacrifices the source, adds the chosen color, and draws exactly one card", () => {
        const sphere = makeInstance(chromaticSphere.id, { id: "sphere" });
        const lib = ["l0", "l1"].map((id) =>
            makeInstance(grizzlyBears.id, {
                id,
                controllerId: "p1",
                ownerId: "p1",
                zone: "library",
            })
        );
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [sphere],
                    library: lib,
                    // Float a red to pay the {1} activation cost.
                    manaPool: { W: 0, U: 0, B: 0, R: 1, G: 0, C: 0 },
                }),
                makePlayer("p2"),
            ],
        });
        const p1 = state.players[0];

        // Choice option index 1 = {U} (manaChoices[1]). Pays {1} from the
        // floated red, adds {U}.
        tapSourceIntoPayment(state, p1, sphere, 1, []);

        expect(p1.manaPool.U).toBe(1);
        expect(p1.manaPool.R).toBe(0);
        // CR 603.6 / 700.4 — sacrificed to pay its own activation cost.
        expect(p1.battlefield.some((c) => c.id === "sphere")).toBe(false);
        expect(p1.graveyard.some((c) => c.id === "sphere")).toBe(true);
        // CR 605.1a / 121.1 — the drawsCardOnTap rider draws exactly one card,
        // even though the source was just sacrificed.
        expect(p1.hand).toHaveLength(1);
        expect(p1.library).toHaveLength(1);
    });

    it("the draw emits CARD_DRAWN so 'whenever you draw a card' triggers still see it (Sheoldred)", () => {
        const sphere = makeInstance(chromaticSphere.id, { id: "sphere" });
        const sheoldred = makeInstance(sheoldredTheApocalypse.id, {
            id: "sheoldred",
            controllerId: "p1",
            ownerId: "p1",
        });
        const lib = [
            makeInstance(grizzlyBears.id, {
                id: "l0",
                controllerId: "p1",
                ownerId: "p1",
                zone: "library",
            }),
        ];
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [sphere, sheoldred],
                    library: lib,
                    manaPool: { W: 0, U: 0, B: 0, R: 1, G: 0, C: 0 },
                }),
                makePlayer("p2"),
            ],
        });
        const p1 = state.players[0];

        // Choice option index 0 = {W}.
        tapSourceIntoPayment(state, p1, sphere, 0, []);
        expect(p1.hand).toHaveLength(1);
        // Not resolved yet — the trigger is still queued, not applied.
        expect(p1.life).toBe(20);

        // Drain the queued CARD_DRAWN event into a trigger pass and resolve
        // Sheoldred's "whenever you draw a card, you gain 2 life."
        processPendingActionTriggers(state);
        expect(state.stack).toHaveLength(1);
        resolveTopOfStack(state);
        expect(p1.life).toBe(22);
    });

    // CR 605.1a — verifies the OTHER commit path this rider is wired into
    // (`tapUntap`'s shared post-branch call site). There is no convex-test
    // harness in this repo to drive the `tapUntap` mutation end-to-end (see
    // untapRefundsLife.test.ts), so this calls the REAL `applyDrawCardOnTap`
    // function directly — the same call `tapUntap` makes once
    // `producedThisActivation` is set, covering both its choice and fixed
    // branches with one shared site.
    it("fires from the direct-tap call site too (tapUntap's shared post-branch, applyDrawCardOnTap)", () => {
        const sphere = makeInstance(chromaticSphere.id, { id: "sphere" });
        const lib = [
            makeInstance(grizzlyBears.id, {
                id: "l0",
                controllerId: "p1",
                ownerId: "p1",
                zone: "library",
            }),
        ];
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [sphere], library: lib }),
                makePlayer("p2"),
            ],
        });
        const p1 = state.players[0];
        const ability = chromaticSphere.activatedAbilities!.find(
            (a) => a.id === "chromatic-sphere-mana"
        )!;

        applyDrawCardOnTap(state, ability, p1.id);

        expect(p1.hand).toHaveLength(1);
        expect(p1.library).toHaveLength(0);
    });

    it("no-ops when the ability declares no drawsCardOnTap rider (Lotus Guardian)", () => {
        const state = makeState();
        const p1 = state.players[0];
        const noRiderAbility = lotusGuardian.activatedAbilities!.find(
            (a) => a.id === "lotus-guardian-mana"
        );

        applyDrawCardOnTap(state, noRiderAbility, p1.id);

        expect(p1.hand).toHaveLength(0);
    });
});

describe("Juntu Stakes untap lock (CR 502.1, power 1-or-less, dynamicMatch)", () => {
    // Scenario: Juntu Stakes in play with a power-1 creature (locked) and a
    // power-2 creature (untaps normally), both tapped at the active player's
    // untap step.
    function makeLockScenario() {
        const stakes = makeInstance(juntuStakes.id, { id: "stakes" });
        const weak = makeInstance(grizzlyBears.id, {
            id: "weak",
            power: 1,
            toughness: 1,
            isTapped: true,
        });
        const strong = makeInstance(grizzlyBears.id, {
            id: "strong",
            isTapped: true,
        }); // base 2/2 Grizzly Bears
        return makeState({
            phase: "UNTAP",
            players: [
                makePlayer("p1", { battlefield: [stakes, weak, strong] }),
                makePlayer("p2"),
            ],
        });
    }

    it("keeps a power-1-or-less creature tapped while a bigger creature untaps", () => {
        const state = makeLockScenario();
        untapStep(state);
        const weak = state.players[0].battlefield.find((c) => c.id === "weak")!;
        const strong = state.players[0].battlefield.find(
            (c) => c.id === "strong"
        )!;
        // Hard skip (maxUntap 0) — no prompt, auto-resolved.
        expect(state.pendingChoices ?? []).toEqual([]);
        expect(weak.isTapped).toBe(true);
        expect(strong.isTapped).toBe(false);
    });

    it("survives the wire projection: the lock still holds on PublicGameState", () => {
        const state = makeLockScenario();
        untapStep(state);
        const projected = projectPublicState(state, 1, "p1");
        const weak = projected.players[0].battlefield.find(
            (c) => c.id === "weak"
        )!;
        const strong = projected.players[0].battlefield.find(
            (c) => c.id === "strong"
        )!;
        expect(weak.isTapped).toBe(true);
        expect(strong.isTapped).toBe(false);
    });
});

describe("Lotus Guardian (flying; {T}: add one mana of any color, CR 702.9b / 605.1a)", () => {
    it("is a 4/4 flying Dragon with a 5-way any-color mana ability", () => {
        expect(lotusGuardian.staticAbilities).toContain("flying");
        expect(lotusGuardian.power).toBe(4);
        expect(lotusGuardian.toughness).toBe(4);
        const ability = lotusGuardian.activatedAbilities?.[0];
        expect(ability?.cost).toEqual({ tap: true });
        expect(ability?.useStack).toBe(false);
        expect(ability?.manaChoices).toHaveLength(5);
    });
});

describe("Phyrexian Altar (sacrifice a creature: add one mana of any color; CR 602.1/118.5, 605.1a)", () => {
    it("declares a filtered-sacrifice cost and a 5-mode colour-choice effect", () => {
        const ability = phyrexianAltar.activatedAbilities?.[0];
        expect(ability?.cost).toEqual({
            sacrificeFilter: { types: "Creature" },
        });
        expect(ability?.useStack).toBe(true);
        expect(ability?.effects?.[0]).toMatchObject({ op: "optionChoice" });
    });

    it("resolves the chosen colour into the controller's mana pool", () => {
        const altar = makeInstance(phyrexianAltar.id, { id: "altar" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [altar] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, altar, "phyrexian-altar-mana");
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("option-pick");
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["B"], // colorChoiceModes ids are the color codes
        });
        expect(state.players[0].manaPool.B).toBe(1);
    });
});

describe("Phyrexian Lens ({T}, Pay 1 life: add one mana of any color, CR 605.1a / 118.4)", () => {
    it("declares a tap + life-payment cost with a 5-way any-color choice", () => {
        const ability = phyrexianLens.activatedAbilities?.[0];
        expect(ability?.cost).toEqual({ tap: true, life: 1 });
        expect(ability?.useStack).toBe(false);
        expect(ability?.manaChoices).toHaveLength(5);
    });
});

describe("Planar Portal ({6}, {T}: search library for a card into hand, then shuffle; CR 701.20a)", () => {
    it("puts the found card into hand and shuffles the rest back", () => {
        const cards = ["a", "b", "c"].map((id) =>
            makeInstance(grizzlyBears.id, {
                id,
                controllerId: "p1",
                ownerId: "p1",
                zone: "library",
            })
        );
        const portal = makeInstance(planarPortal.id, { id: "portal" });
        const state = makeState({
            players: [
                makePlayer("p1", { library: cards, battlefield: [portal] }),
                makePlayer("p2"),
            ],
        });
        // `resolveActivated` pushes the ability and resolves once; the search
        // Op suspends on the first pass, leaving a `search-library` pending
        // choice for the test to answer (Manipulate Fate's pattern, this set).
        resolveActivated(state, portal, "planar-portal-tutor");
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("search-library");
        expect(head.count).toBe(1);
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["b"],
        });
        expect(state.players[0].hand.map((c) => c.id)).toEqual(["b"]);
        expect(state.players[0].library.map((c) => c.id).sort()).toEqual([
            "a",
            "c",
        ]);
    });
});

describe("Sparring Golem (becomes blocked → +1/+1 per blocker, CR 509.1h — every blocker counts, no 'beyond the first')", () => {
    function setupBlockedCombat(blockerCount: number) {
        const attacker = makeInstance(sparringGolem.id, {
            id: "golem",
            controllerId: "p1",
            ownerId: "p1",
            isAttacking: true,
        });
        const blockerIds = Array.from(
            { length: blockerCount },
            (_, i) => `blk${i}`
        );
        const blockers = blockerIds.map((id) =>
            makeInstance(grizzlyBears.id, {
                id,
                controllerId: "p2",
                ownerId: "p2",
                isBlocking: true,
            })
        );
        const blockerAssignments: Record<string, string[]> = {};
        for (const id of blockerIds) blockerAssignments[id] = ["golem"];
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [attacker] }),
                makePlayer("p2", { battlefield: blockers }),
            ],
            phase: "DECLARE_BLOCKERS",
            combat: {
                attackerIds: ["golem"],
                confirmed: true,
                blockerAssignments,
                blockersConfirmed: true,
            },
        });
        recordBlockedAttackers(state);
        return state;
    }

    it("blocked by one creature: fires once, +1/+1 (every blocker counts)", () => {
        const state = setupBlockedCombat(1);
        emitBlockersConfirmedEvents(state);
        expect(
            state.stack.filter(
                (s) => s.triggeredAbilityId === "sparring-golem-becomes-blocked"
            )
        ).toHaveLength(1);
        resolveTopOfStack(state);
        const golem = state.players[0].battlefield.find(
            (c) => c.id === "golem"
        )!;
        expect(getEffectivePower(state, golem)).toBe(3); // base 2/2 + 1
        expect(getEffectiveToughness(state, golem)).toBe(3);
    });

    it("blocked by three creatures: fires ONCE (dedup), +3/+3", () => {
        const state = setupBlockedCombat(3);
        emitBlockersConfirmedEvents(state);
        // Three BLOCKERS_CONFIRMED pairs are emitted, but the dedupe collapses
        // the trigger to a single stack entry.
        expect(
            state.stack.filter(
                (s) => s.triggeredAbilityId === "sparring-golem-becomes-blocked"
            )
        ).toHaveLength(1);
        resolveTopOfStack(state);
        const golem = state.players[0].battlefield.find(
            (c) => c.id === "golem"
        )!;
        expect(getEffectivePower(state, golem)).toBe(5); // base 2/2 + 3
        expect(getEffectiveToughness(state, golem)).toBe(5);
    });
});

describe("Tek (land-gated P/T + keyword grants, CR 613.1c/1d, issue #1850)", () => {
    it("is a 2/2 artifact Dragon with one pt-cda and three keyword-grant static effects, no unconditional staticAbilities", () => {
        expect(tek.power).toBe(2);
        expect(tek.toughness).toBe(2);
        expect(tek.staticAbilities).toBeUndefined();
        expect(tek.staticEffects?.some((e) => e.kind === "pt-cda")).toBe(true);
        const grants = (tek.staticEffects ?? []).filter(
            (e) => e.kind === "keyword-grant"
        );
        expect(grants.map((g) => g.keyword)).toEqual([
            "flying",
            "first strike",
            "trample",
        ]);
    });

    it("gets +0/+2 controlling a Plains and +2/+0 controlling a Swamp, summed", () => {
        const dragon = makeInstance(tek.id, { id: "tek1" });
        const plainsCard = makeInstance(plains.id, { id: "p" });
        const swampCard = makeInstance(swamp.id, { id: "s" });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [dragon, plainsCard, swampCard],
                }),
                makePlayer("p2"),
            ],
        });
        expect(getEffectivePower(state, dragon)).toBe(4); // 2 + 2 (Swamp)
        expect(getEffectiveToughness(state, dragon)).toBe(4); // 2 + 2 (Plains)

        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "tek1"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(4);
        expect(getEffectiveToughness(projected, slim)).toBe(4);
    });

    it("stays base 2/2 controlling neither a Plains nor a Swamp", () => {
        const dragon = makeInstance(tek.id, { id: "tek1" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [dragon] }),
                makePlayer("p2"),
            ],
        });
        expect(getEffectivePower(state, dragon)).toBe(2);
        expect(getEffectiveToughness(state, dragon)).toBe(2);
    });

    // `keyword-grant` is MATERIALIZED into `staticAbilities` at apply time
    // (not recomputed at every read like `pt-buff`/`pt-cda`), so each "as long
    // as you control a <land type>" gate only stays live because the real
    // production SBA path (`checkStateBasedActions` → `refreshCounterGatedStatics`)
    // re-runs `condition` every SBA pass — mirrors Kavu Runner's shipped test
    // shape (`inv/red.ts`/`__tests__/red.test.ts`, issue #1095).
    function makeTekState() {
        const dragon = makeInstance(tek.id, {
            controllerId: "p1",
            ownerId: "p1",
            id: "tek1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [dragon] }),
                makePlayer("p2"),
            ],
        });
        applySourceStaticEffects(state, dragon);
        return { state, dragon };
    }

    it("has none of flying/first strike/trample controlling no basic lands", () => {
        const { dragon } = makeTekState();
        expect(dragon.staticAbilities ?? []).not.toContain("flying");
        expect(dragon.staticAbilities ?? []).not.toContain("first strike");
        expect(dragon.staticAbilities ?? []).not.toContain("trample");
    });

    it("gains flying only while controlling an Island (re-evaluated via checkStateBasedActions)", () => {
        const { state, dragon } = makeTekState();
        expect(dragon.staticAbilities ?? []).not.toContain("flying");

        const islandCard = makeInstance(island.id, {
            controllerId: "p1",
            id: "isl",
        });
        state.players[0].battlefield.push(islandCard);
        checkStateBasedActions(state);
        expect(dragon.staticAbilities).toContain("flying");
        expect(dragon.staticAbilities).not.toContain("first strike");
        expect(dragon.staticAbilities).not.toContain("trample");

        state.players[0].battlefield = state.players[0].battlefield.filter(
            (c) => c.id !== "isl"
        );
        checkStateBasedActions(state);
        expect(dragon.staticAbilities ?? []).not.toContain("flying");
    });

    it("gains first strike only while controlling a Mountain", () => {
        const { state, dragon } = makeTekState();
        const mountainCard = makeInstance(mountain.id, {
            controllerId: "p1",
            id: "mtn",
        });
        state.players[0].battlefield.push(mountainCard);
        checkStateBasedActions(state);
        expect(dragon.staticAbilities).toContain("first strike");
        expect(dragon.staticAbilities).not.toContain("flying");
        expect(dragon.staticAbilities).not.toContain("trample");
    });

    it("gains trample only while controlling a Forest", () => {
        const { state, dragon } = makeTekState();
        const forestCard = makeInstance(forest.id, {
            controllerId: "p1",
            id: "frs",
        });
        state.players[0].battlefield.push(forestCard);
        checkStateBasedActions(state);
        expect(dragon.staticAbilities).toContain("trample");
        expect(dragon.staticAbilities).not.toContain("flying");
        expect(dragon.staticAbilities).not.toContain("first strike");
    });

    // Wire format (mandatory, `.claude/rules/gre-development.md` § Frontend
    // wiring analysis): the materialized "flying" keyword must survive
    // `projectPublicState`'s slim reshape, both while present and once the
    // board-state gate has removed it.
    it("flying presence/absence survives projectPublicState (wire format)", () => {
        const { state, dragon } = makeTekState();

        const islandCard = makeInstance(island.id, {
            controllerId: "p1",
            id: "isl",
        });
        state.players[0].battlefield.push(islandCard);
        checkStateBasedActions(state);

        const projectedWithFlying = projectPublicState(state, 1, "p1");
        const slimWithFlying = projectedWithFlying.players[0].battlefield.find(
            (c) => c.id === dragon.id
        )!;
        expect(slimWithFlying.staticAbilities).toContain("flying");

        state.players[0].battlefield = state.players[0].battlefield.filter(
            (c) => c.id !== "isl"
        );
        checkStateBasedActions(state);

        const projectedNoFlying = projectPublicState(state, 2, "p1");
        const slimNoFlying = projectedNoFlying.players[0].battlefield.find(
            (c) => c.id === dragon.id
        )!;
        expect(slimNoFlying.staticAbilities ?? []).not.toContain("flying");
    });

    // CR 611.2c's gate is "AS LONG AS **YOU** CONTROL" — every clause below
    // routes through the same file-scope `controlsBasicLandType` predicate
    // (both `pt-cda` and all three `keyword-grant`s), so the controller
    // dimension is a single shared leg, not five independent ones. Every test
    // above only ever builds an OPPONENT battlefield that is empty, so this
    // leg had zero coverage — an opponent's basic land satisfied every clause
    // unnoticed. One case per clause below closes it.
    it("is not granted a keyword by an OPPONENT's basic land (CR 611.2c 'you control')", () => {
        const { state, dragon } = makeTekState();
        const oppIsland = makeInstance(island.id, {
            controllerId: "p2",
            ownerId: "p2",
            id: "opp-isl",
        });
        state.players[1].battlefield.push(oppIsland);
        checkStateBasedActions(state);
        expect(dragon.staticAbilities ?? []).not.toContain("flying");
    });

    it("does not gain first strike from an OPPONENT's Mountain", () => {
        const { state, dragon } = makeTekState();
        const oppMountain = makeInstance(mountain.id, {
            controllerId: "p2",
            ownerId: "p2",
            id: "opp-mtn",
        });
        state.players[1].battlefield.push(oppMountain);
        checkStateBasedActions(state);
        expect(dragon.staticAbilities ?? []).not.toContain("first strike");
    });

    it("does not gain trample from an OPPONENT's Forest", () => {
        const { state, dragon } = makeTekState();
        const oppForest = makeInstance(forest.id, {
            controllerId: "p2",
            ownerId: "p2",
            id: "opp-frs",
        });
        state.players[1].battlefield.push(oppForest);
        checkStateBasedActions(state);
        expect(dragon.staticAbilities ?? []).not.toContain("trample");
    });

    it("stays base 2/2 controlling neither Plains nor Swamp even when the OPPONENT controls both", () => {
        const dragon = makeInstance(tek.id, {
            controllerId: "p1",
            ownerId: "p1",
            id: "tek1",
        });
        const oppPlains = makeInstance(plains.id, {
            controllerId: "p2",
            ownerId: "p2",
            id: "opp-p",
        });
        const oppSwamp = makeInstance(swamp.id, {
            controllerId: "p2",
            ownerId: "p2",
            id: "opp-s",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [dragon] }),
                makePlayer("p2", { battlefield: [oppPlains, oppSwamp] }),
            ],
        });
        expect(getEffectivePower(state, dragon)).toBe(2);
        expect(getEffectiveToughness(state, dragon)).toBe(2);
    });
});

describe("Urza's Filter (multicolored spells cost {2} less to cast, CR 601.2f / 202.2)", () => {
    function effectiveSpellCost(
        state: ReturnType<typeof makeState>,
        spellCardId: string,
        controllerId: string
    ): Record<string, number> {
        const def = getDefinition(spellCardId);
        const spellView = makeInstance(spellCardId, {
            controllerId,
            zone: "stack",
        });
        const cost = normalizeManaCost(def.manaCost ?? {});
        applyCostModifiers(cost, getCostModifiers(state, spellView, "spell"));
        return cost;
    }

    function boardWith(controllerId = "p1") {
        return makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        makeInstance(urzasFilter.id, {
                            id: "filter",
                            controllerId,
                        }),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
    }

    it("definition: {4} Artifact with a cost-modifier static", () => {
        expect(urzasFilter.manaCost).toEqual({ X: 4 });
        expect(
            urzasFilter.staticEffects?.some((e) => e.kind === "cost-modifier")
        ).toBe(true);
    });

    it("reduces a multicolored spell's generic mana by {2}, floored at 0 (Spectral Shield {1}{W}{U} → {W}{U})", () => {
        const state = boardWith();
        expect(effectiveSpellCost(state, spectralShield.id, "p1")).toEqual({
            W: 1,
            U: 1,
        });
    });

    it("does not affect a monocolored spell (Grizzly Bears stays {1}{G})", () => {
        const state = boardWith();
        expect(effectiveSpellCost(state, grizzlyBears.id, "p1")).toEqual({
            X: 1,
            G: 1,
        });
    });

    it("applies to ANY player's multicolored spell, not just its controller's", () => {
        const state = boardWith("p1");
        // Cast by p2, Urza's Filter controlled by p1 — the discount is global.
        expect(effectiveSpellCost(state, spectralShield.id, "p2")).toEqual({
            W: 1,
            U: 1,
        });
    });
});

describe("Archaeological Dig (Land, {T}: add {C}; {T}, sac: add one mana of any color)", () => {
    it("is a colorless land with a fixed-{C} ability and a self-sac any-color ability", () => {
        expect(archaeologicalDig.types).toEqual(["Land"]);
        expect(archaeologicalDig.manaCost).toEqual({});
        const fixed = archaeologicalDig.activatedAbilities?.find(
            (a) => a.id === "archaeological-dig-colorless"
        );
        expect(fixed?.cost).toEqual({ tap: true });
        expect(fixed?.useStack).toBe(false);
        expect(fixed?.manaProduced).toEqual({ C: 1 });

        const sac = archaeologicalDig.activatedAbilities?.find(
            (a) => a.id === "archaeological-dig-sac"
        );
        expect(sac?.cost).toEqual({ tap: true, sacrifice: true });
        expect(sac?.useStack).toBe(false);
        expect(sac?.manaChoices).toHaveLength(5);
    });
});
