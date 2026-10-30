// `selectAtRandom` (issue #1702, CR 609.3) — choose N cards AT RANDOM out of
// a zone pool read in the `choice` Op's own vocabulary (zone, zoneOwnerId,
// filter, a library `top` window) and bind them, moving nothing. Exercised
// through the real interpreter: the picks are observed by a following
// `moveZone` of the binding (or by the binding never being captured).
import { describe, expect, it } from "vitest";
import { withTemporaryDefinition } from "../../../cards/registry";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../cards/__tests__/setup.helper";
import type { CardDefinition, EffectOp } from "../../../cards/types";
import { forest } from "../../../cards/sets/lea/colorless.cards";
import { grizzlyBears } from "../../../cards/sets/lea/green.cards";
import { projectPublicState } from "../../../gameProjections";
import {
    getPlayer,
    resolveTopOfStack,
    type CardInstanceState,
    type GameState,
} from "../../state";
import { validateEffectScript } from "../validate";

type Zone = "hand" | "graveyard" | "library" | "exile";

function withScript<T>(effects: EffectOp[], fn: (id: string) => T): T {
    const def: CardDefinition = {
        id: "t1702-select",
        name: "t1702-select",
        rarity: "common",
        manaCost: { B: 1 },
        types: ["Sorcery"],
        effects,
    };
    return withTemporaryDefinition(def, () => fn(def.id));
}

/** `selectAtRandom` then exile the picks, so the picked set is observable. */
const pickThenExile = (
    pick: Omit<Extract<EffectOp, { op: "selectAtRandom" }>, "op" | "bind">
): EffectOp[] => [
    { op: "selectAtRandom", ...pick, bind: "$r" },
    {
        op: "moveZone",
        cards: { ref: "$r" },
        player: pick.zoneOwnerId ?? "controller",
        from: pick.zone,
        to: "exile",
    },
];

const cards = (owner: string, zone: Zone, n: number, cardId: string) =>
    Array.from({ length: n }, (_, i) =>
        makeInstance(cardId, {
            id: `${owner}-${zone}-${cardId.slice(0, 4)}-${i}`,
            controllerId: owner,
            ownerId: owner,
            zone,
        })
    );

function stateWith(
    p1: Partial<Record<Zone, CardInstanceState[]>>,
    p2: Partial<Record<Zone, CardInstanceState[]>> = {},
    rng: { rngSeed?: number; rngCounter?: number } = {}
): GameState {
    return makeState({
        players: [makePlayer("p1", p1), makePlayer("p2", p2)],
        ...rng,
    });
}

const ids = (list: readonly { id: string }[]) => list.map((c) => c.id);

function resolve(state: GameState, id: string): GameState {
    pushSpell(state, id, "p1");
    resolveTopOfStack(state);
    return state;
}

describe("Effect Script Op: selectAtRandom (CR 609.3, issue #1702)", () => {
    it("picks exactly min(count, pool) DISTINCT cards, all from the pool", () => {
        withScript(pickThenExile({ zone: "graveyard", count: 3 }), (id) => {
            const yard = cards("p1", "graveyard", 6, forest().id);
            const pool = ids(yard);
            const state = resolve(stateWith({ graveyard: yard }), id);
            const exiled = ids(getPlayer(state, "p1").exile);
            expect(exiled).toHaveLength(3);
            expect(new Set(exiled).size).toBe(3);
            for (const picked of exiled) expect(pool).toContain(picked);
            // The three unpicked cards stay, beside the resolved sorcery.
            const left = ids(getPlayer(state, "p1").graveyard);
            expect(left.filter((c) => pool.includes(c))).toHaveLength(3);
        });
    });

    it("a pool smaller than count yields the whole pool (CR 609.3)", () => {
        withScript(pickThenExile({ zone: "graveyard", count: 4 }), (id) => {
            const yard = cards("p1", "graveyard", 2, forest().id);
            const pool = ids(yard);
            const state = resolve(stateWith({ graveyard: yard }), id);
            expect(ids(getPlayer(state, "p1").exile).sort()).toEqual(
                pool.sort()
            );
        });
    });

    it("every pick satisfies the pool's filter", () => {
        const script = pickThenExile({
            zone: "graveyard",
            filter: { type: "Creature" },
            count: 2,
        });
        withScript(script, (id) => {
            const bears = cards("p1", "graveyard", 2, grizzlyBears().id);
            const lands = cards("p1", "graveyard", 5, forest().id);
            const bearIds = ids(bears);
            const state = resolve(
                stateWith({ graveyard: [...lands, ...bears] }),
                id
            );
            expect(ids(getPlayer(state, "p1").exile).sort()).toEqual(
                bearIds.sort()
            );
        });
    });

    it("reads the zone owner the Op names, never the controller's zone", () => {
        const script = pickThenExile({
            zone: "hand",
            zoneOwnerId: "opponent",
            count: 1,
        });
        withScript(script, (id) => {
            const mine = cards("p1", "hand", 3, forest().id);
            const theirs = cards("p2", "hand", 3, forest().id);
            const theirIds = ids(theirs);
            const state = resolve(
                stateWith({ hand: mine }, { hand: theirs }),
                id
            );
            expect(getPlayer(state, "p1").hand).toHaveLength(3);
            const exiled = ids(getPlayer(state, "p2").exile);
            expect(exiled).toHaveLength(1);
            expect(theirIds).toContain(exiled[0]);
        });
    });

    it("moves nothing on its own: every zone is untouched", () => {
        const script: EffectOp[] = [
            { op: "selectAtRandom", zone: "graveyard", count: 2, bind: "$r" },
        ];
        withScript(script, (id) => {
            const yard = cards("p1", "graveyard", 4, forest().id);
            const library = cards("p1", "library", 4, forest().id);
            const [yardIds, libraryIds] = [ids(yard), ids(library)];
            const state = resolve(stateWith({ graveyard: yard, library }), id);
            expect(ids(getPlayer(state, "p1").graveyard).slice(0, 4)).toEqual(
                yardIds
            );
            expect(ids(getPlayer(state, "p1").library)).toEqual(libraryIds);
            expect(getPlayer(state, "p1").exile).toHaveLength(0);
        });
    });

    it("an empty pool binds nothing and the script continues", () => {
        const script: EffectOp[] = [
            ...pickThenExile({ zone: "graveyard", count: 2 }),
            { op: "gainLife", player: "controller", amount: 3 },
        ];
        withScript(script, (id) => {
            const state = resolve(stateWith({}), id);
            expect(getPlayer(state, "p1").exile).toHaveLength(0);
            expect(getPlayer(state, "p1").life).toBe(23);
        });
    });

    it("the same seed reproduces the picks; another rngCounter can differ", () => {
        withScript(pickThenExile({ zone: "graveyard", count: 2 }), (id) => {
            const run = (rngCounter: number) => {
                const yard = cards("p1", "graveyard", 10, forest().id);
                const state = resolve(
                    stateWith(
                        { graveyard: yard },
                        {},
                        { rngSeed: 7, rngCounter }
                    ),
                    id
                );
                return ids(getPlayer(state, "p1").exile).join(",");
            };
            expect(run(0)).toBe(run(0));
            const outcomes = new Set(
                Array.from({ length: 12 }, (_, i) => run(i))
            );
            expect(outcomes.size).toBeGreaterThan(1);
        });
    });

    it("a library `top` window: only the top N cards are eligible", () => {
        const script = pickThenExile({ zone: "library", top: 3, count: 3 });
        withScript(script, (id) => {
            const library = cards("p1", "library", 8, forest().id);
            const libraryIds = ids(library);
            const state = resolve(stateWith({ library }), id);
            expect(ids(getPlayer(state, "p1").exile).sort()).toEqual(
                libraryIds.slice(0, 3).sort()
            );
            expect(ids(getPlayer(state, "p1").library)).toEqual(
                libraryIds.slice(3)
            );
        });
    });

    it("a library shorter than the window uses what is there", () => {
        const script = pickThenExile({ zone: "library", top: 8, count: 4 });
        withScript(script, (id) => {
            const library = cards("p1", "library", 2, forest().id);
            const state = resolve(stateWith({ library }), id);
            expect(getPlayer(state, "p1").exile).toHaveLength(2);
            expect(getPlayer(state, "p1").library).toHaveLength(0);
        });
    });

    it("the picks reach the client: the projected exile holds them", () => {
        withScript(pickThenExile({ zone: "graveyard", count: 2 }), (id) => {
            const yard = cards("p1", "graveyard", 5, forest().id);
            const state = resolve(stateWith({ graveyard: yard }), id);
            const projected = projectPublicState(state, 1, "p2");
            expect(ids(projected.players[0]!.exile).sort()).toEqual(
                ids(getPlayer(state, "p1").exile).sort()
            );
            expect(projected.players[0]!.exile).toHaveLength(2);
        });
    });

    it("validates the Op and refuses `top` outside a library", () => {
        const validate = (effects: EffectOp[]) =>
            validateEffectScript({ id: "t1702-v", name: "t1702-v", effects });
        expect(
            validate(pickThenExile({ zone: "library", top: 8, count: 4 }))
        ).toEqual([]);
        expect(
            validate(pickThenExile({ zone: "graveyard", top: 8, count: 1 }))
        ).not.toEqual([]);
        expect(
            validate([
                {
                    op: "selectAtRandom",
                    zone: "battlefield",
                    count: 1,
                    bind: "$r",
                },
            ] as unknown as EffectOp[])
        ).not.toEqual([]);
    });
});
