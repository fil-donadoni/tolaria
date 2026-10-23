// Frontend wiring for the `activation-restriction` static (CR 602.5, Cursed
// Totem: "Activated abilities of creatures can't be activated."). The client
// offers an ability or a mana tap only through view reducers, and the scan
// that finds the Totem reads each battlefield row's `card` reference — a field
// `buildTriggerStateView` must carry across `projectPublicState`. Every board
// here crosses the real projection and the real reducer: a hand-built view
// would carry the field by construction and prove nothing.

import { describe, expect, it } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "@convex/cards/__tests__/setup.helper";
import { getCardByName } from "@convex/cards";
import { projectPublicState } from "@convex/gameProjections";
import type { GameState } from "@convex/gre/state";
import type { CardInstance, Player } from "~/types/game";
import {
    buildTriggerStateView,
    getActivatedManaMenuEntry,
    getManaCostMenuAbility,
    getStackAbilities,
    hasManaAbility,
} from "../card-utils";

function board(withTotem: boolean): GameState {
    const perm = (name: string, id: string, owner = "p1") =>
        makeInstance(getCardByName(name).id, {
            id,
            controllerId: owner,
            ownerId: owner,
            zone: "battlefield",
            isSummoningSick: false,
        });
    const forestCreature = perm("Forest", "arbor");
    forestCreature.types = ["Land", "Creature"];
    return makeState({
        players: [
            makePlayer("p1", {
                battlefield: [
                    perm("Shivan Dragon", "dragon"),
                    perm("Llanowar Elves", "elves"),
                    perm("Farrelite Priest", "priest"),
                    forestCreature,
                    perm("Sol Ring", "ring"),
                ],
            }),
            // The Totem binds every player, so it sits on the OPPONENT's side:
            // the scan must read both battlefields off the wire.
            makePlayer("p2", {
                battlefield: withTotem
                    ? [perm("Cursed Totem", "totem", "p2")]
                    : [],
            }),
        ],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
    });
}

/** The viewer's board and gate view exactly as the battlefield hooks build
 *  them, from the projected state. */
function onWire(state: GameState) {
    const projected = projectPublicState(state, 1, "p1");
    const players = projected.players as unknown as Player[];
    const view = buildTriggerStateView(players, projected.activePlayerId);
    const mine = players.find((p) => p.id === "p1")!.battlefield;
    const card = (id: string) => mine.find((c) => c.id === id) as CardInstance;
    return { view, card };
}

describe("activation-restriction on the wire (CR 602.5 / 605.1a)", () => {
    it("hides a creature's stack ability", () => {
        const offered = (withTotem: boolean) => {
            const { view, card } = onWire(board(withTotem));
            return getStackAbilities(
                card("dragon"),
                "PRECOMBAT_MAIN",
                true,
                view,
                20
            ).map((a) => a.id);
        };
        expect(offered(false)).toContain("shivan-dragon-pump");
        expect(offered(true)).not.toContain("shivan-dragon-pump");
    });

    it("withdraws a creature's tap-for-mana affordance", () => {
        const free = onWire(board(false));
        expect(hasManaAbility(free.card("elves"), free.view)).toBe(true);
        const locked = onWire(board(true));
        expect(hasManaAbility(locked.card("elves"), locked.view)).toBe(false);
        expect(
            getActivatedManaMenuEntry(locked.card("elves"), locked.view)
        ).toBeNull();
    });

    it("withdraws a land creature's intrinsic mana (CR 305.6)", () => {
        const free = onWire(board(false));
        expect(hasManaAbility(free.card("arbor"), free.view)).toBe(true);
        const locked = onWire(board(true));
        expect(hasManaAbility(locked.card("arbor"), locked.view)).toBe(false);
    });

    it("withdraws a creature's non-tap mana ability menu entry", () => {
        const free = onWire(board(false));
        expect(
            getManaCostMenuAbility(free.card("priest"), free.view)
        ).not.toBeNull();
        const locked = onWire(board(true));
        expect(
            getManaCostMenuAbility(locked.card("priest"), locked.view)
        ).toBeNull();
    });

    it("leaves a noncreature mana source alone", () => {
        const locked = onWire(board(true));
        expect(hasManaAbility(locked.card("ring"), locked.view)).toBe(true);
    });
});
