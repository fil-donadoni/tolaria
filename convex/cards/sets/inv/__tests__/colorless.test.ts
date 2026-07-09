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
import { untapStep } from "../../../../gre/phases";
import { projectPublicState } from "../../../../gameProjections";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import { tsabosWeb } from "../colorless";
import { mishrasFactory } from "../../atq/colorless";
import { creepingTarPit } from "../../wwk/colorless";
import { plains } from "../../lea/colorless";
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
