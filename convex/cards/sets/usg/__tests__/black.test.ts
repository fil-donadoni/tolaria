// Per-card test for usg/black.ts. Exhume's `forEach(players)` construct
// iterates a runtime-selected set — `effectScriptSmoke.test.ts` explicitly
// SKIPS it ("covered by the card's own tests"), so per
// `.claude/rules/gre-development.md` § DSL-first authoring this card earns a
// hand-written test.
import { describe, it, expect } from "vitest";
import { exhume, yawgmothsWill } from "..";
import { grizzlyBears, lightningBolt, mountain } from "../../lea";
import {
    getPlayer,
    removeFromZone,
    resolveTopOfStack,
    type StackItem,
} from "../../../../gre/state";
import { applyPendingChoiceSubmit } from "../../../../gre/pendingChoiceSubmit";
import {
    locateCastSource,
    castRawManaCost,
    graveyardCastStackFlags,
} from "../../../../game";
import { applyPlayLandFromGraveyard } from "../../../../gre/playLand";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";

describe("Exhume (CR 400.7 reanimation, CR 101.4 APNAP order — Innocent Blood pattern)", () => {
    it("each player puts a creature card from their OWN graveyard onto the battlefield, active player first", () => {
        const p1Bear = makeInstance(grizzlyBears.id, {
            id: "p1bear",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const p2Bear = makeInstance(grizzlyBears.id, {
            id: "p2bear",
            controllerId: "p2",
            ownerId: "p2",
            zone: "graveyard",
        });
        const state = makeState({
            activePlayerId: "p1",
            players: [
                makePlayer("p1", { graveyard: [p1Bear] }),
                makePlayer("p2", { graveyard: [p2Bear] }),
            ],
        });
        pushSpell(state, exhume.id, "p1");
        expect(resolveTopOfStack(state)).toBeNull(); // suspends on p1's pick first (CR 101.4)
        let pending = state.pendingChoices![0];
        expect(pending.kind).toBe("choose-graveyard-card");
        expect(pending.playerId).toBe("p1");
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: pending.stackItemId,
            step: pending.step,
            choiceId: pending.choiceId,
            cardInstanceIds: ["p1bear"],
        });
        // p1's sacrifice/reanimation resolves before p2's pick is even raised
        // (engine simplification, CR 101.4d — flagged on Innocent Blood).
        expect(
            state.players[0].battlefield.some((c) => c.id === "p1bear")
        ).toBe(true);
        pending = state.pendingChoices![0];
        expect(pending.playerId).toBe("p2");
        applyPendingChoiceSubmit(state, {
            playerId: "p2",
            stackItemId: pending.stackItemId,
            step: pending.step,
            choiceId: pending.choiceId,
            cardInstanceIds: ["p2bear"],
        });
        expect(
            state.players[1].battlefield.some((c) => c.id === "p2bear")
        ).toBe(true);
    });

    it("skips a player with no creature cards in their graveyard entirely (CR 608.2b)", () => {
        const p1Bear = makeInstance(grizzlyBears.id, {
            id: "p1bear2",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const state = makeState({
            activePlayerId: "p1",
            players: [
                makePlayer("p1", { graveyard: [p1Bear] }),
                makePlayer("p2"), // no creature cards in graveyard
            ],
        });
        pushSpell(state, exhume.id, "p1");
        expect(resolveTopOfStack(state)).toBeNull();
        const pending = state.pendingChoices![0];
        expect(pending.playerId).toBe("p1");
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: pending.stackItemId,
            step: pending.step,
            choiceId: pending.choiceId,
            cardInstanceIds: ["p1bear2"],
        });
        // p2 has nothing to pick — no prompt raised, script completes.
        expect(state.pendingChoices ?? []).toHaveLength(0);
        expect(
            state.players[0].battlefield.some((c) => c.id === "p1bear2")
        ).toBe(true);
    });
});

// Yawgmoth's Will (issue #1149) — both new Ops (`grantGraveyardPlay`,
// `armGraveyardRedirect`) already earn their own full per-Op interpreter +
// wire-format test regime (convex/gre/effects/__tests__/interpreter.test.ts)
// and the catalogue-wide static sweep + auto-generated smoke test both pass
// (this card reuses only already-exercised Ops). This describe block
// demonstrates the CARD-LEVEL composition the printed text depends on: both
// clauses land from ONE resolution, and they interact — a card cast from the
// graveyard under the freshly-granted permission is redirected to EXILE
// (not the graveyard) as it leaves the stack, because the SAME resolution
// also armed the graveyard-bound redirect.
describe("Yawgmoth's Will (CR 305.1-analog / 601 permission + CR 614 redirect, issue #1149)", () => {
    it("resolving grants BOTH the graveyard-cast permission and the graveyard-bound redirect in one shot", () => {
        const p1 = makePlayer("p1", {
            graveyard: [makeInstance(yawgmothsWill.id)],
        });
        const state = makeState({ players: [p1, makePlayer("p2")] });
        pushSpell(state, yawgmothsWill.id, "p1");
        resolveTopOfStack(state);

        expect(state.graveyardPlayPermissionThisTurn).toEqual([
            { playerId: "p1", zones: ["land", "spell"], maxManaValue: undefined },
        ]);
        expect(state.graveyardBoundRedirectThisTurn).toEqual([
            { ownerId: "p1" },
        ]);
    });

    it("a card cast from the graveyard under the fresh permission is exiled instead of returned to the graveyard (the two clauses compose)", () => {
        const gyBolt = makeInstance(lightningBolt.id, {
            id: "gy-bolt",
            zone: "graveyard",
            controllerId: "p1",
            ownerId: "p1",
        });
        const p1 = makePlayer("p1", { graveyard: [gyBolt] });
        const state = makeState({ players: [p1, makePlayer("p2")] });
        // Resolve Yawgmoth's Will first (from the stack, not the graveyard —
        // its own zone origin is irrelevant to the clauses it grants).
        pushSpell(state, yawgmothsWill.id, "p1");
        resolveTopOfStack(state);

        // Now cast Lightning Bolt from the graveyard under the permission.
        const src = locateCastSource(state, getPlayer(state, "p1"), "gy-bolt");
        expect(src.zone).toBe("graveyard");
        expect(castRawManaCost(state, src.card!, src.zone)).toEqual({ R: 1 });
        const removed = removeFromZone(getPlayer(state, "p1"), "gy-bolt", src.zone);
        const stackItem: StackItem = {
            ...removed,
            castById: "p1",
            targets: [{ type: "player", id: "p2" }],
            ...graveyardCastStackFlags(state, removed, src.zone),
        };
        expect(stackItem.exileOnResolve).toBeUndefined(); // not a Flashback cast
        state.stack.push(stackItem);
        resolveTopOfStack(state);

        expect(getPlayer(state, "p2").life).toBe(17); // 20 - 3
        // The graveyard-bound redirect (armed by the SAME Yawgmoth's Will
        // resolution) catches the bolt as it would enter the graveyard and
        // sends it to exile instead (CR 614).
        expect(
            getPlayer(state, "p1").exile.some((c) => c.id === "gy-bolt")
        ).toBe(true);
        expect(
            getPlayer(state, "p1").graveyard.some((c) => c.id === "gy-bolt")
        ).toBe(false);
    });

    it("a land is also playable from the graveyard under the fresh permission", () => {
        const gyMountain = makeInstance(mountain.id, {
            id: "gy-mountain",
            zone: "graveyard",
            controllerId: "p1",
            ownerId: "p1",
        });
        const p1 = makePlayer("p1", { graveyard: [gyMountain] });
        const state = makeState({
            players: [p1, makePlayer("p2")],
            activePlayerId: "p1",
        });
        pushSpell(state, yawgmothsWill.id, "p1");
        resolveTopOfStack(state);

        applyPlayLandFromGraveyard(state, p1, "gy-mountain");
        expect(p1.battlefield.map((c) => c.id)).toContain("gy-mountain");
        expect(p1.landsPlayedThisTurn).toBe(1);
    });
});
