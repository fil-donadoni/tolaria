// Cast-side payment parks (ADR 0091, issue #2135) — the mandatory additional
// costs a CAST owes are carried ON the `cast-spell` Move and CHARGED by the
// search sandboxes.
//
// The activation side won this seam first (`costPicks`, issues #1209 / #2155 /
// #2297); the cast side never did. A cast whose card declares
// `additionalCosts.sacrificeFilter` (Metamorphosis's "sacrifice a creature"),
// `additionalCosts.exileFilter` (Soul Exchange), or one subject to a board-wide
// static additional sacrifice (Drought) parks a `pendingCast` at announcement
// and blocks commit until the caster names the victim — but the search sandboxes
// (`applyMoveForSearch` / `applyMoveInSearch`) charged NOTHING, so a spell that
// must sacrifice a creature to cast was valued as if the sacrifice were free.
//
// K=1 for every cast-side park (`gre/parkKinds.ts`): the pick is fungible, so
// the deterministic cheapest-first victim is carried on the move and the search
// applies exactly what the executor later submits. These tests pin (a) that the
// pick travels on the move, (b) that both sandboxes charge the same victim, and
// (c) that the enumeration does NOT multiply variants per victim (K=1).
import { describe, expect, it } from "vitest";
import { getCardByName } from "../../cards";
import { enumerateMoves, type Move } from "../moves";
import { applyMoveInSearch } from "../search";
import { applyMoveForSearch } from "../applyMove";
import { cloneGameState } from "../clone";
import { PARK_VARIANT_K } from "../parkKinds";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import type { GameState } from "../state";

const BOT = "p2";
const OPP = "p1";

const METAMORPHOSIS = getCardByName("Metamorphosis");
const SOUL_EXCHANGE = getCardByName("Soul Exchange");
const DROUGHT = getCardByName("Drought");
const DARK_RITUAL = getCardByName("Dark Ritual");
const BEAR = getCardByName("Grizzly Bears").id; // {1}{G} 2/2
const WURM = getCardByName("Craw Wurm").id; // {4}{G}{G} 6/4
const SWAMP = getCardByName("Swamp").id;

function bf(cardId: string, id: string, owner = BOT) {
    return makeInstance(cardId, {
        id,
        controllerId: owner,
        ownerId: owner,
        zone: "battlefield",
    });
}

function inZone(cardId: string, id: string, zone: "hand" | "graveyard") {
    return makeInstance(cardId, {
        id,
        controllerId: BOT,
        ownerId: BOT,
        zone,
    });
}

function botOf(state: GameState) {
    return state.players.find((p) => p.id === BOT)!;
}

function castOf(state: GameState, cardInstanceId: string) {
    return enumerateMoves(state, BOT).find(
        (m): m is Extract<Move, { kind: "cast-spell" }> =>
            m.kind === "cast-spell" && m.cardInstanceId === cardInstanceId
    );
}

describe("cast-side payment parks travel on the move (issue #2135)", () => {
    it("the K table records K=1 for every cast-side park (the single authority)", () => {
        // `PARK_VARIANT_K` is the documented K table (`gre/parkKinds.ts`); this
        // asserts the cast side really is all-K=1, so a future cast park that
        // earns a variant axis cannot ship with a table that forgot it.
        const castKinds = Object.values(PARK_VARIANT_K);
        expect(castKinds.length).toBe(6);
        expect(castKinds.every((k) => k === 1)).toBe(true);
    });

    it("Metamorphosis — the cast carries the cheapest sacrifice victim and both sandboxes charge it (CR 601.2f / 701.21)", () => {
        const state = makeState({
            players: [
                makePlayer(OPP),
                makePlayer(BOT, {
                    hand: [inZone(METAMORPHOSIS.id, "meta", "hand")],
                    battlefield: [bf(BEAR, "bear"), bf(WURM, "wurm")],
                    manaPool: { W: 0, U: 0, B: 0, R: 0, G: 1, C: 0 },
                }),
            ],
            activePlayerId: BOT,
            priorityPlayerId: BOT,
            phase: "PRECOMBAT_MAIN",
        });

        const move = castOf(state, "meta");
        expect(move).toBeDefined();
        // The deterministic cheapest-first victim (Bears mv 2 over Wurm mv 6).
        expect(move!.castCostPicks?.sacrificeIds).toEqual(["bear"]);

        // The ISMCTS leaf — applied in place.
        const tree = cloneGameState(state);
        applyMoveInSearch(tree, BOT, move!);
        expect(
            botOf(tree)
                .battlefield.map((c) => c.id)
                .sort()
        ).toEqual(["wurm"]);
        expect(botOf(tree).graveyard.map((c) => c.id)).toEqual(["bear"]);

        // The greedy sandbox — same move, same victim. It RESOLVES the spell
        // (unlike the ISMCTS leaf), so the sacrificed victim AND the resolved
        // sorcery both land in the graveyard.
        const greedy = applyMoveForSearch(state, BOT, move!);
        expect(botOf(greedy).graveyard.map((c) => c.id)).toContain("bear");
        expect(
            botOf(greedy)
                .battlefield.map((c) => c.id)
                .sort()
        ).toEqual(["wurm"]);
    });

    it("K=1 — the sacrifice victim is NOT a variant axis (one cast per mode, no per-victim multiplication)", () => {
        // Metamorphosis has 5 colour modes but ONE deterministic victim. The
        // cast enumerator must emit exactly the mode count, not mode × victims.
        const state = makeState({
            players: [
                makePlayer(OPP),
                makePlayer(BOT, {
                    hand: [inZone(METAMORPHOSIS.id, "meta", "hand")],
                    battlefield: [bf(BEAR, "bear"), bf(WURM, "wurm")],
                    manaPool: { W: 0, U: 0, B: 0, R: 0, G: 1, C: 0 },
                }),
            ],
            activePlayerId: BOT,
            priorityPlayerId: BOT,
            phase: "PRECOMBAT_MAIN",
        });

        const casts = enumerateMoves(state, BOT).filter(
            (m) => m.kind === "cast-spell" && m.cardInstanceId === "meta"
        );
        expect(casts.length).toBeGreaterThan(0);
        // Every cast names the SAME deterministic victim — no variant ever
        // carries `["wurm"]`.
        for (const m of casts) {
            const picks = m.kind === "cast-spell" ? m.castCostPicks : undefined;
            expect(picks?.sacrificeIds).toEqual(["bear"]);
        }
    });

    it("Soul Exchange — the exile additional cost is charged in the search (CR 701.13 / 118.8)", () => {
        const state = makeState({
            players: [
                makePlayer(OPP),
                makePlayer(BOT, {
                    hand: [inZone(SOUL_EXCHANGE.id, "soul", "hand")],
                    battlefield: [bf(BEAR, "bear"), bf(WURM, "wurm")],
                    graveyard: [inZone(BEAR, "gy-bear", "graveyard")],
                    manaPool: { W: 0, U: 0, B: 2, R: 0, G: 0, C: 0 },
                }),
            ],
            activePlayerId: BOT,
            priorityPlayerId: BOT,
            phase: "PRECOMBAT_MAIN",
        });

        const move = castOf(state, "soul");
        expect(move).toBeDefined();
        expect(move!.castCostPicks?.additionalCostCardId).toBe("bear");

        // The exile happened in the leaf, the (unresolved) spell did not touch
        // the graveyard target.
        const tree = cloneGameState(state);
        applyMoveInSearch(tree, BOT, move!);
        expect(botOf(tree).exile.map((c) => c.id)).toContain("bear");
        expect(
            botOf(tree)
                .battlefield.map((c) => c.id)
                .sort()
        ).toEqual(["wurm"]);
        expect(botOf(tree).graveyard.map((c) => c.id)).toContain("gy-bear");
    });

    it("Drought — a black spell carries the static Swamp sacrifice and the search charges it (CR 601.2f / 118.5)", () => {
        const state = makeState({
            players: [
                makePlayer(OPP, {
                    battlefield: [bf(DROUGHT.id, "drought", OPP)],
                }),
                makePlayer(BOT, {
                    hand: [inZone(DARK_RITUAL.id, "ritual", "hand")],
                    battlefield: [bf(SWAMP, "swamp")],
                    manaPool: { W: 0, U: 0, B: 1, R: 0, G: 0, C: 0 },
                }),
            ],
            activePlayerId: BOT,
            priorityPlayerId: BOT,
            phase: "PRECOMBAT_MAIN",
        });

        const move = castOf(state, "ritual");
        expect(move).toBeDefined();
        // One black pip in {B} → one Swamp owed (CR 118.5). A single Swamp is a
        // FUNGIBLE victim, so the server auto-resolves it at announcement and
        // the payer submits nothing — but the park still rides the move (an
        // empty `castCostPicks`) so the search charges the auto-resolved victim.
        expect(move!.castCostPicks).toBeDefined();
        expect(move!.castCostPicks?.sacrificeIds ?? []).toEqual([]);

        const tree = cloneGameState(state);
        applyMoveInSearch(tree, BOT, move!);
        expect(botOf(tree).battlefield).toHaveLength(0);
        expect(botOf(tree).graveyard.map((c) => c.id)).toEqual(["swamp"]);
    });

    it("Drought unpayable — a black spell with no Swamp is not enumerated (no move the executor cannot pay)", () => {
        const state = makeState({
            players: [
                makePlayer(OPP, {
                    battlefield: [bf(DROUGHT.id, "drought", OPP)],
                }),
                makePlayer(BOT, {
                    hand: [inZone(DARK_RITUAL.id, "ritual", "hand")],
                    battlefield: [bf(BEAR, "bear")],
                    manaPool: { W: 0, U: 0, B: 1, R: 0, G: 0, C: 0 },
                }),
            ],
            activePlayerId: BOT,
            priorityPlayerId: BOT,
            phase: "PRECOMBAT_MAIN",
        });

        expect(castOf(state, "ritual")).toBeUndefined();
    });
});
