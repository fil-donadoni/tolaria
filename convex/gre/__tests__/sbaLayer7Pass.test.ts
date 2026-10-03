// The zero-toughness SBA (CR 704.5f) reads every creature's toughness through
// ONE layer-7 pass per scan (issue #4462): the board's P/T source set is walked
// once for the scan instead of once per creature. These tests pin what that
// cache may NOT do — hold a creature's P/T, or outlive the board it was read
// from — on the real sweep, with a real lord (Lord of Atlantis, CR 613.4c).
import { describe, it, expect } from "vitest";
import type { CardInstanceState } from "../state";
import { checkZeroToughnessSBA } from "../sba";
import { getEffectivePT } from "../layers";
import { makePlayer, makeState } from "../../cards/__tests__/setup.helper";
import { lordOfAtlantis } from "../../cards/sets/lea/index.cards";

function merfolk(
    id: string,
    counters?: Record<string, number>
): CardInstanceState {
    return {
        id,
        card: { id: `def-${id}` },
        types: ["Creature"],
        subtypes: ["Merfolk"],
        power: 1,
        toughness: 1,
        staticAbilities: [],
        controllerId: "p1",
        ownerId: "p1",
        zone: "battlefield",
        isTapped: false,
        counters,
    };
}

function lord(counters?: Record<string, number>): CardInstanceState {
    return {
        id: "lord",
        card: { id: lordOfAtlantis.id },
        types: ["Creature"],
        subtypes: ["Merfolk"],
        power: 2,
        toughness: 2,
        staticAbilities: [],
        controllerId: "p1",
        ownerId: "p1",
        zone: "battlefield",
        isTapped: false,
        counters,
    };
}

function board(cards: CardInstanceState[]) {
    return makeState({
        players: [makePlayer("p1", { battlefield: cards }), makePlayer("p2")],
    });
}

const onBattlefield = (state: ReturnType<typeof board>): string[] =>
    state.players[0].battlefield.map((c) => c.id);

describe("zero-toughness SBA over a Layer7Pass (CR 704.5f, CR 613.4c, issue #4462)", () => {
    it("a counter placed DURING the sweep is seen by the sweep's next P/T read", () => {
        // `doomed` is 1/1, +1/+1 from the lord, -2/-2 from its counters: it
        // is the first victim. `late` is a healthy 2/2 when the sweep starts.
        const doomed = merfolk("doomed", { "-1/-1": 2 });
        const late = merfolk("late");
        const state = board([lord(), doomed, late]);
        expect(getEffectivePT(state, late)).toEqual({ power: 2, toughness: 2 });

        // The injection point: the first time `late` is looked at AFTER
        // `doomed` has left the battlefield — i.e. mid-sweep, once the sweep
        // has already read `late` alive and walked the board's P/T sources —
        // two -1/-1 counters land on it, once. Nothing the sweep read before
        // that moment may answer for `late` afterwards.
        let armed = true;
        let types = late.types;
        Object.defineProperty(late, "types", {
            configurable: true,
            enumerable: true,
            get() {
                if (armed && !state.players[0].battlefield.includes(doomed)) {
                    armed = false;
                    late.counters = { "-1/-1": 2 };
                }
                return types;
            },
            // The death itself rewrites the card (`removePermanentTo`).
            set(next: CardInstanceState["types"]) {
                types = next;
            },
        });

        expect(checkZeroToughnessSBA(state)).toBe(true);

        expect(armed).toBe(false);
        // 1/1 base, +1/+1 from the lord, -2/-2 from the counters: 0/0.
        expect(onBattlefield(state)).toEqual(["lord"]);
        expect(state.players[0].graveyard.map((c) => c.id)).toEqual([
            "doomed",
            "late",
        ]);
    });

    it("a P/T source that dies in the sweep stops applying in the SAME sweep", () => {
        // The lord is 2/2 with two -1/-1 counters: it dies. The Merfolk is a
        // 1/1 with one -1/-1 counter, alive only for as long as the lord's
        // +1/+1 applies — so the lord's death is the Merfolk's.
        const follower = merfolk("follower", { "-1/-1": 1 });
        const state = board([follower, lord({ "-1/-1": 2 })]);
        expect(getEffectivePT(state, follower)).toEqual({
            power: 1,
            toughness: 1,
        });

        expect(checkZeroToughnessSBA(state)).toBe(true);

        expect(onBattlefield(state)).toEqual([]);
        expect(state.players[0].graveyard.map((c) => c.id).sort()).toEqual([
            "follower",
            "lord",
        ]);
    });

    it("the pass leaves nothing behind on the state", () => {
        const state = board([lord(), merfolk("a"), merfolk("b")]);
        const before = JSON.stringify(state);

        expect(checkZeroToughnessSBA(state)).toBe(false);

        expect(JSON.stringify(state)).toBe(before);
    });
});
