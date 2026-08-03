// C19 (Commander 2019) — white behavior tests (ADR 0043 colour split).
//
// Sevinne's Reclamation returns a permanent card of mana value ≤ 3 from the
// controller's graveyard to the battlefield (CR 400.7); when the spell itself
// was flashed back (cast from a graveyard, CR 702.34a), its controller may copy
// it (CR 707.12) and retarget the copy. The flashback exile is covered
// class-wide by convex/gre/__tests__/flashback.test.ts.
import { describe, it, expect } from "vitest";
import { sevinnesReclamation } from "../white";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import {
    resolveTopOfStack,
    getPlayer,
    type StackItem,
} from "../../../../gre/state";
import { getLegalTargets, NO_TARGETING_SOURCE } from "../../../../gre/rules";
import { grizzlyBears } from "../../lea";
import { serraAngel } from "../../lea";

describe("Sevinne's Reclamation (reanimate MV ≤ 3 + copy-if-flashed-back, CR 400.7 / 702.34)", () => {
    it("is a {2}{W} sorcery with Flashback {4}{W}", () => {
        expect(sevinnesReclamation.manaCost).toEqual({ X: 2, W: 1 });
        expect(sevinnesReclamation.flashback).toEqual({ X: 4, W: 1 });
    });

    it("mvFilter restricts legal graveyard targets to permanent cards of MV ≤ 3", () => {
        // Grizzly Bears ({1}{G}, MV 2) is legal; Serra Angel ({3}{W}{W}, MV 5) is not.
        const bear = makeInstance(grizzlyBears.id, {
            id: "gy-bear",
            zone: "graveyard",
            controllerId: "p1",
            ownerId: "p1",
        });
        const angel = makeInstance(serraAngel.id, {
            id: "gy-angel",
            zone: "graveyard",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { graveyard: [bear, angel] }),
                makePlayer("p2"),
            ],
        });
        const legal = getLegalTargets(
            state,
            sevinnesReclamation.targetRequirement!,
            NO_TARGETING_SOURCE,
            "p1"
        );
        const ids = legal.map((t) => t.id);
        expect(ids).toContain("gy-bear");
        expect(ids).not.toContain("gy-angel");
    });

    it("returns the targeted MV ≤ 3 permanent to the battlefield (no copy when cast from hand)", () => {
        const bear = makeInstance(grizzlyBears.id, {
            id: "gy-bear-2",
            zone: "graveyard",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { graveyard: [bear] }),
                makePlayer("p2"),
            ],
        });
        // Cast from hand (no castFromGraveyard flag).
        state.stack.push({
            ...makeInstance(sevinnesReclamation.id, {
                id: "sev",
                zone: "stack",
                controllerId: "p1",
                ownerId: "p1",
            }),
            castById: "p1",
            targets: [
                { type: "graveyard-card", id: "gy-bear-2", playerId: "p1" },
            ],
        } as StackItem);
        const result = resolveTopOfStack(state);
        expect(result).not.toBeNull(); // resolves fully — no copy prompt

        // Bear reanimated to p1's battlefield; no copy prompt appeared.
        expect(
            getPlayer(state, "p1").battlefield.some((c) => c.id === "gy-bear-2")
        ).toBe(true);
        expect(state.pendingChoices ?? []).toHaveLength(0);
    });

    it("offers the copy choice when the spell was cast from a graveyard (declining makes no copy)", () => {
        const bear = makeInstance(grizzlyBears.id, {
            id: "gy-bear-3",
            zone: "graveyard",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { graveyard: [bear] }),
                makePlayer("p2"),
            ],
        });
        // Flashed back — castFromGraveyard set (as the cast commit would stamp it).
        state.stack.push({
            ...makeInstance(sevinnesReclamation.id, {
                id: "sev2",
                zone: "stack",
                controllerId: "p1",
                ownerId: "p1",
            }),
            castById: "p1",
            castFromGraveyard: true,
            exileOnResolve: true,
            targets: [
                { type: "graveyard-card", id: "gy-bear-3", playerId: "p1" },
            ],
        } as StackItem);

        const first = resolveTopOfStack(state);
        expect(first).toBeNull(); // suspended on the "you may copy" choice
        // Reanimation already happened in step 0.
        expect(
            getPlayer(state, "p1").battlefield.some((c) => c.id === "gy-bear-3")
        ).toBe(true);
        const stackBefore = state.stack.length;

        // Decline the copy (may-pay answered "no": stored[0] !== "yes").
        const head = state.pendingChoices![0];
        const item = state.stack.find((s) => s.id === head.stackItemId)!;
        item.collectedChoices = {
            ...(item.collectedChoices ?? {}),
            [`${head.step}:${head.choiceId}`]: ["no"],
        };
        state.pendingChoices = undefined;
        resolveTopOfStack(state);
        // No copy was created (stack didn't grow with a Sevinne's copy).
        expect(state.stack.length).toBeLessThanOrEqual(stackBefore);
    });

    it("accepting the copy makes exactly ONE copy, and the copy does not re-offer the clause (CR 707.10 — a copy was NOT cast from a graveyard)", () => {
        // Two permanent cards in the graveyard: the original reanimates one, the
        // copy (retargeted) reanimates the other.
        const bearA = makeInstance(grizzlyBears.id, {
            id: "gy-bear-A",
            zone: "graveyard",
            controllerId: "p1",
            ownerId: "p1",
        });
        const bearB = makeInstance(grizzlyBears.id, {
            id: "gy-bear-B",
            zone: "graveyard",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { graveyard: [bearA, bearB] }),
                makePlayer("p2"),
            ],
        });
        // Flashed back — castFromGraveyard + exileOnResolve set (as the cast
        // commit stamps them for a flashback cast, CR 702.34).
        state.stack.push({
            ...makeInstance(sevinnesReclamation.id, {
                id: "sev3",
                zone: "stack",
                controllerId: "p1",
                ownerId: "p1",
            }),
            castById: "p1",
            castFromGraveyard: true,
            exileOnResolve: true,
            targets: [
                { type: "graveyard-card", id: "gy-bear-A", playerId: "p1" },
            ],
        } as StackItem);

        // First resolve — suspends on the "you may copy" choice; bear A already
        // reanimated in step 0.
        expect(resolveTopOfStack(state)).toBeNull();
        expect(
            getPlayer(state, "p1").battlefield.some((c) => c.id === "gy-bear-A")
        ).toBe(true);

        // Accept the copy (may-pay answered "yes").
        const head = state.pendingChoices![0];
        const original = state.stack.find((s) => s.id === head.stackItemId)!;
        original.collectedChoices = {
            ...(original.collectedChoices ?? {}),
            [`${head.step}:${head.choiceId}`]: ["yes"],
        };
        state.pendingChoices = undefined;
        resolveTopOfStack(state);

        // Exactly ONE Sevinne's copy now sits on the stack (the original popped).
        const copies = state.stack.filter(
            (s) =>
                (s.card as { id?: string }).id === sevinnesReclamation.id &&
                s.isCopy === true
        );
        expect(copies).toHaveLength(1);
        const copy = copies[0];

        // Regression for CR 707.10: a copy is created, not *cast*, so it must NOT
        // inherit the flashback cast-provenance flags. If it did, the copy's
        // step-1 wasCastFromGraveyard() would read true and spawn another copy →
        // unbounded copies.
        expect(copy.castFromGraveyard).not.toBe(true);
        expect(copy.exileOnResolve).not.toBe(true);

        // Retarget the copy at bear B and clear the copy-retarget pendingTarget,
        // then resolve the copy.
        copy.targets = [
            { type: "graveyard-card", id: "gy-bear-B", playerId: "p1" },
        ];
        state.pendingTarget = undefined;
        const copyResult = resolveTopOfStack(state);

        // The copy resolves FULLY (no suspension) — it did not re-offer the copy
        // clause because wasCastFromGraveyard() is false for a copy.
        expect(copyResult).not.toBeNull();
        expect(
            getPlayer(state, "p1").battlefield.some((c) => c.id === "gy-bear-B")
        ).toBe(true);
        // No second-generation copy, and no dangling may-pay choice.
        expect(
            state.stack.filter(
                (s) => (s.card as { id?: string }).id === sevinnesReclamation.id
            )
        ).toHaveLength(0);
        expect(state.pendingChoices ?? []).toHaveLength(0);
    });
});
