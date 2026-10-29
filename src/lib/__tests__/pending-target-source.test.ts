// Issue #6984 — the ONE source lookup behind the target-selection banner and
// the graveyard target dialog title. Every `PendingTarget.kind` must name its
// source (CR 601.2 cast, CR 602.1 activated ability, CR 603.3d trigger, CR
// 707.10 copy-retarget); the old dialog lookup read the hand only and fell to
// "spell" for all but a hand cast.
import { describe, it, expect, vi } from "vitest";
import type {
    CardInstance,
    PendingTarget,
    Player,
    StackItem,
} from "~/types/game";

vi.mock("@convex/cards", () => ({
    getInstanceManaCost: (c: ManaCostSource) =>
        mockInstanceManaCost(c, (id: string) => ({ id, name: `Card ${id}` })),
    tryGetDefinition: (id: string) =>
        id.startsWith("emblem-") ? undefined : { id, name: `Card ${id}` },
}));
vi.mock("@convex/cards/emblems", () => ({
    tryGetEmblemDefinition: (id: string) =>
        id.startsWith("emblem-") ? { name: `Emblem ${id}` } : undefined,
}));

import {
    mockInstanceManaCost,
    type ManaCostSource,
} from "~/lib/testing/convex-cards-mock";
import { resolvePendingTargetSource } from "../pending-target-source";

function inst(id: string, defId: string): CardInstance {
    return { id, card: { id: defId } } as CardInstance;
}

function target(kind: PendingTarget["kind"], id: string): PendingTarget {
    return { kind, cardInstanceId: id } as PendingTarget;
}

const me = {
    id: "me",
    hand: [null, inst("h1", "bolt")],
    graveyard: [inst("g1", "flash")],
    exile: [inst("e1", "foretold")],
    battlefield: [inst("b1", "pw")],
} as unknown as Player;

const stack = [
    inst("s1", "portal"),
    inst("s2", "emblem-chandra"),
] as unknown as StackItem[];

describe("resolvePendingTargetSource", () => {
    it("names a spell cast from hand", () => {
        expect(
            resolvePendingTargetSource(target("cast", "h1"), me, stack).name
        ).toBe("Card bolt");
    });

    it("names a spell cast from the graveyard", () => {
        expect(
            resolvePendingTargetSource(target("cast", "g1"), me, stack).name
        ).toBe("Card flash");
    });

    it("names a spell cast from exile", () => {
        expect(
            resolvePendingTargetSource(target("cast", "e1"), me, stack).name
        ).toBe("Card foretold");
    });

    it("names an activated ability by its battlefield permanent", () => {
        const r = resolvePendingTargetSource(
            target("ability", "b1"),
            me,
            stack
        );
        expect(r.name).toBe("Card pw");
        expect(r.sourcePermanent?.id).toBe("b1");
    });

    it("names a triggered ability by its stack item", () => {
        expect(
            resolvePendingTargetSource(target("trigger", "s1"), me, stack).name
        ).toBe("Card portal");
    });

    it("names an emblem-sourced trigger via the emblem registry", () => {
        expect(
            resolvePendingTargetSource(target("trigger", "s2"), me, stack).name
        ).toBe("Emblem emblem-chandra");
    });

    it("reads a copy-retarget as Copy, and falls back to spell", () => {
        expect(
            resolvePendingTargetSource(target("copy-retarget", "zz"), me, stack)
                .name
        ).toBe("Copy");
        expect(
            resolvePendingTargetSource(target("cast", "zz"), me, stack).name
        ).toBe("spell");
    });
});
