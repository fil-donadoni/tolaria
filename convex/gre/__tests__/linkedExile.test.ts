// Linked-exile tracking foundation (issue #1319, CR 610.3 "exiled with ~"
// linked-ability style). No card ships this yet — Emperor of Bones /
// Agatha's Cauldron (#917's #12/#14) are the future consumers. The core
// primitives (`SpellContext.linkExileToSource` / `getCardsExiledWith`, backed
// by `CardInstanceState.exiledBySourceId`) already shipped under issue #791
// (Currency Converter) — this suite generalizes the coverage past that one
// card:
//   1. The link/query primitives work for ANY source/card pair, independent
//      of a specific card's `resolve()`.
//   2. The full "put a creature card exiled with this permanent onto the
//      battlefield" action path composes from EXISTING primitives —
//      `getCardsExiledWith` + `SpellContext.returnToBattlefield` — no new
//      primitive needed (mandatory primitive-reuse check).
//   3. A regression guard for a real gap this issue closes: the exile
//      provenance link must not survive a departure from the exile zone by
//      ANY path (previously only cast-from-exile cleared it), or a later,
//      unrelated re-exile of the same instance id would silently inherit a
//      stale source.

import { describe, it, expect } from "vitest";
import { buildSpellContext, getPlayer, type GameState } from "../state";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup";
import { grizzlyBears } from "../../cards/sets/lea/green";
import { compactState, expandState } from "../serialize";

// `sourceId` param is unused by buildSpellContext itself — every call site
// below passes explicit source ids straight to linkExileToSource /
// getCardsExiledWith, independent of the pushed stack item's own id. Kept as
// a named helper purely for readability at each call site.
function ctxFor(state: GameState) {
    const item = pushSpell(state, grizzlyBears.id, "p1");
    return buildSpellContext(state, item);
}

describe("linked-exile tracking (CR 610.3 / issue #791, generalized #1319)", () => {
    it("linkExileToSource + getCardsExiledWith round-trips an arbitrary source/card pair", () => {
        const exiled = makeInstance(grizzlyBears.id, {
            id: "bear-exiled",
            controllerId: "p1",
            ownerId: "p1",
            zone: "exile",
        });
        const state = makeState({
            players: [makePlayer("p1", { exile: [exiled] }), makePlayer("p2")],
        });
        const ctx = ctxFor(state);

        expect(ctx.getCardsExiledWith("any-source-id")).toEqual([]);
        ctx.linkExileToSource("bear-exiled", "any-source-id");
        const linked = ctx.getCardsExiledWith("any-source-id");
        expect(linked).toHaveLength(1);
        expect(linked[0]).toMatchObject({
            id: "bear-exiled",
            ownerId: "p1",
            name: "Grizzly Bears",
        });
    });

    it("getCardsExiledWith finds a linked card even in an OPPONENT's exile (CR 400.7)", () => {
        const exiled = makeInstance(grizzlyBears.id, {
            id: "bear-p2-exile",
            controllerId: "p2",
            ownerId: "p2",
            zone: "exile",
        });
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2", { exile: [exiled] })],
        });
        const ctx = ctxFor(state);
        ctx.linkExileToSource("bear-p2-exile", "src");

        const linked = ctx.getCardsExiledWith("src");
        expect(linked).toHaveLength(1);
        expect(linked[0]!.ownerId).toBe("p2");
    });

    it("a card linked to source A is NOT returned when querying source B", () => {
        const exiled = makeInstance(grizzlyBears.id, {
            id: "bear-other-link",
            controllerId: "p1",
            ownerId: "p1",
            zone: "exile",
        });
        const state = makeState({
            players: [makePlayer("p1", { exile: [exiled] }), makePlayer("p2")],
        });
        const ctx = ctxFor(state);
        ctx.linkExileToSource("bear-other-link", "source-a");

        expect(ctx.getCardsExiledWith("source-b")).toEqual([]);
        expect(ctx.getCardsExiledWith("source-a")).toHaveLength(1);
    });

    it("composes with returnToBattlefield: puts a creature card exiled with this permanent onto the battlefield", () => {
        const exiled = makeInstance(grizzlyBears.id, {
            id: "bear-to-return",
            controllerId: "p1",
            ownerId: "p1",
            zone: "exile",
        });
        const state = makeState({
            players: [makePlayer("p1", { exile: [exiled] }), makePlayer("p2")],
        });
        const ctx = ctxFor(state);
        ctx.linkExileToSource("bear-to-return", "reanimator-id");

        // The action path a future card composes: enumerate the linked set,
        // pick one, put it onto the battlefield.
        const linked = ctx.getCardsExiledWith("reanimator-id");
        expect(linked.map((c) => c.id)).toEqual(["bear-to-return"]);

        const ok = ctx.returnToBattlefield("p1", "bear-to-return", "exile");
        expect(ok).toBe(true);

        const onBattlefield = getPlayer(state, "p1").battlefield.find(
            (c) => c.id === "bear-to-return"
        );
        expect(onBattlefield).toBeDefined();
        expect(onBattlefield!.zone).toBe("battlefield");
        // CR 302.6 / 400.7 — a fresh object entering the battlefield is
        // summoning sick and untapped.
        expect(onBattlefield!.isSummoningSick).toBe(true);
        expect(onBattlefield!.isTapped).toBe(false);
        expect(getPlayer(state, "p1").exile).toHaveLength(0);
    });

    it("regression: the stale link is cleared once the card leaves exile via returnToBattlefield (issue #1319)", () => {
        const exiled = makeInstance(grizzlyBears.id, {
            id: "bear-stale-1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "exile",
        });
        const state = makeState({
            players: [makePlayer("p1", { exile: [exiled] }), makePlayer("p2")],
        });
        const ctx = ctxFor(state);
        ctx.linkExileToSource("bear-stale-1", "old-source");
        ctx.returnToBattlefield("p1", "bear-stale-1", "exile");

        const onBattlefield = getPlayer(state, "p1").battlefield.find(
            (c) => c.id === "bear-stale-1"
        )!;
        expect(onBattlefield.exiledBySourceId).toBeUndefined();

        // Send it BACK to exile without a fresh link call (simulates an
        // unrelated later effect that exiles the same instance id).
        ctx.exile({ type: "permanent", id: "bear-stale-1" });
        // A DIFFERENT query for "old-source" must NOT find it — the stale
        // link from its first life in exile must not have survived.
        expect(ctx.getCardsExiledWith("old-source")).toEqual([]);
    });

    it("regression: the stale link is cleared on exile -> hand / graveyard via moveCardById (general zone-mover)", () => {
        const toHand = makeInstance(grizzlyBears.id, {
            id: "bear-stale-hand",
            controllerId: "p1",
            ownerId: "p1",
            zone: "exile",
        });
        const toGraveyard = makeInstance(grizzlyBears.id, {
            id: "bear-stale-gy",
            controllerId: "p1",
            ownerId: "p1",
            zone: "exile",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { exile: [toHand, toGraveyard] }),
                makePlayer("p2"),
            ],
        });
        const ctx = ctxFor(state);
        ctx.linkExileToSource("bear-stale-hand", "src");
        ctx.linkExileToSource("bear-stale-gy", "src");
        expect(ctx.getCardsExiledWith("src")).toHaveLength(2);

        ctx.moveCardById("p1", "bear-stale-hand", "exile", "hand");
        ctx.moveCardById("p1", "bear-stale-gy", "exile", "graveyard");

        expect(ctx.getCardsExiledWith("src")).toEqual([]);
        expect(
            getPlayer(state, "p1").hand.find((c) => c.id === "bear-stale-hand")
                ?.exiledBySourceId
        ).toBeUndefined();
        expect(
            getPlayer(state, "p1").graveyard.find(
                (c) => c.id === "bear-stale-gy"
            )?.exiledBySourceId
        ).toBeUndefined();
    });

    it("survives the DB round trip while sitting in exile (serialize drift guard, CR 111)", () => {
        const exiled = makeInstance(grizzlyBears.id, {
            id: "bear-persist",
            controllerId: "p1",
            ownerId: "p1",
            zone: "exile",
        });
        exiled.exiledBySourceId = "persisted-source-id";
        const state = makeState({
            players: [makePlayer("p1", { exile: [exiled] }), makePlayer("p2")],
        });

        const roundTripped = expandState(compactState(state));
        const got = roundTripped.players[0]!.exile.find(
            (c) => c.id === "bear-persist"
        )!;
        expect(got.exiledBySourceId).toBe("persisted-source-id");
    });
});
