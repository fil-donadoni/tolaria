// MH3 — colorless (lands + colourless artifacts). One describe per card
// (ADR 0043); fixtures from `convex/cards/__tests__/setup.ts`.

import { describe, it, expect } from "vitest";
import { tapSourceIntoPayment } from "../../../../game";
import { restoreExertOnUntap } from "../../../../gre/exert";
import { resolveEntersTapped } from "../../../entersTapped";
import { buildAutoTapSources } from "../../../../gre/autoTap";
import { getDefinition } from "../../..";
import { makeInstance, makeState } from "../../../__tests__/setup";

const ARENA_OF_GLORY = "dd148edc-9e43-41aa-bb50-f912115d3e72";
const MOUNTAIN = "eace2c85-976c-425e-9800-5a6ccbd91b56";

describe("Arena of Glory (CR 701.43a/c — exert as an activation cost leg)", () => {
    function setup() {
        const arena = makeInstance(ARENA_OF_GLORY, { id: "arena" });
        const state = makeState({ phase: "PRECOMBAT_MAIN" });
        state.players[0].battlefield = [arena];
        state.players[0].manaPool.R = 1;
        return { state, arena };
    }

    /** Index of the "{R}, {T}, Exert this land: Add {R}{R}" option in the
     *  card's declared ability order — the same order the mana-tap option list
     *  is built from. */
    const EXERT_ABILITY_INDEX = 1;

    it("paying the exert leg taps the land, spends {R}, adds {R}{R} and stamps the missed untap", () => {
        const { state, arena } = setup();
        const tapped: string[] = [];
        tapSourceIntoPayment(
            state,
            state.players[0],
            arena,
            EXERT_ABILITY_INDEX,
            tapped
        );

        expect(arena.isTapped).toBe(true);
        // CR 701.43a — the land won't untap during its controller's next
        // untap step. CR 701.43c is structural: an activation cost is paid by a
        // source on the battlefield.
        expect(arena.skipNextUntap).toBe(true);
        // {R} paid in, {R}{R} added out. CR 106.6 (issue #3354) — the output
        // carries the haste rider, so it floats in the parallel
        // `restrictedMana` pool TAGGED but UNGATED (no `restriction`: it may
        // still pay for anything) rather than in the fungible pool.
        expect(state.players[0].manaPool.R).toBe(0);
        expect(state.players[0].restrictedMana).toEqual([
            { color: "R", amount: 2, hasteRider: true },
        ]);
        // CR 701.43a — the exert emitted its event for any watcher.
        expect(
            state.pendingEvents?.some((e) => e.type === "PERMANENT_EXERTED")
        ).toBe(true);
    });

    it("reversing the payment tap un-exerts the land it exerted (CR 106.4 / 701.43b)", () => {
        const { state, arena } = setup();
        tapSourceIntoPayment(
            state,
            state.players[0],
            arena,
            EXERT_ABILITY_INDEX,
            []
        );
        expect(arena.exertedThisTap).toBe(true);

        restoreExertOnUntap(state, arena);
        expect(arena.skipNextUntap).toBeUndefined();
        expect(arena.exertedThisTap).toBeUndefined();
    });

    it("keeps an EARLIER exert when the payment tap is reversed (CR 701.43b — each effect is its own)", () => {
        const { state, arena } = setup();
        // Something else already exerted it this turn.
        arena.skipNextUntap = true;
        tapSourceIntoPayment(
            state,
            state.players[0],
            arena,
            EXERT_ABILITY_INDEX,
            []
        );
        expect(arena.exertedThisTap).toBeUndefined();

        restoreExertOnUntap(state, arena);
        expect(arena.skipNextUntap).toBe(true);
    });

    it("the auto-tap solver is offered the FREE option only — never the exert one (CR 701.43a)", () => {
        const { state, arena } = setup();
        const sources = buildAutoTapSources(state.players[0].battlefield);
        const arenaSource = sources.find((s) => s.cardId === arena.id);
        expect(arenaSource).toBeDefined();
        // `solveSmartAutoTap` minimises tap COUNT, so an admitted {R}{R} option
        // would beat two ordinary lands for any cost of 2+ — paying an exert
        // the player never chose, and (with an empty pool) throwing out of the
        // ability's own {R} leg and rolling the whole mutation back.
        expect(arenaSource!.options).toHaveLength(1);
        expect(arenaSource!.options[0].mana).toMatchObject({ R: 1 });
    });

    it("un-exerting a reversed payment tap also drops the queued exert event (CR 106.4 / 607.2h)", () => {
        const { state, arena } = setup();
        tapSourceIntoPayment(
            state,
            state.players[0],
            arena,
            EXERT_ABILITY_INDEX,
            []
        );
        expect(
            state.pendingEvents?.filter((e) => e.type === "PERMANENT_EXERTED")
        ).toHaveLength(1);

        restoreExertOnUntap(state, arena);
        // Leaving the event queued would fire a linked "when you do" trigger
        // (CR 607.2h) for an exert that no longer happened.
        expect(
            state.pendingEvents?.filter(
                (e) => e.type === "PERMANENT_EXERTED"
            ) ?? []
        ).toHaveLength(0);
    });

    it("enters tapped unless you control a Mountain (CR 614.1c)", () => {
        const { state, arena } = setup();
        const def = getDefinition(ARENA_OF_GLORY);
        expect(resolveEntersTapped(def, arena, state)).toBe(true);

        state.players[0].battlefield.push(
            makeInstance(MOUNTAIN, { id: "mtn" })
        );
        expect(resolveEntersTapped(def, arena, state)).toBe(false);
    });
});
