// Frontend wiring for the name-keyed `activation-restriction` static (CR 602.5
// / 605.1a — Pithing Needle, Phyrexian Revoker: "Activated abilities of sources
// with the chosen name can't be activated[ unless they're mana abilities]").
// The lock reads the restricting permanent's `chosenName`, a field
// `projectPublicState` and `buildTriggerStateView` must both carry: a hand-built
// view would carry it by construction and prove nothing, so every board here
// crosses the real projection and the real reducer.

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
    getStackAbilities,
    hasManaAbility,
} from "../card-utils";

function board(
    lock: "Pithing Needle" | "Phyrexian Revoker",
    named: string | undefined
): GameState {
    const perm = (name: string, id: string, owner = "p1") =>
        makeInstance(getCardByName(name).id, {
            id,
            controllerId: owner,
            ownerId: owner,
            zone: "battlefield",
            isSummoningSick: false,
        });
    const locker = perm(lock, "lock", "p2");
    if (named !== undefined) locker.chosenName = named;
    return makeState({
        players: [
            makePlayer("p1", {
                battlefield: [
                    perm("Prodigal Sorcerer", "tim"),
                    perm("Llanowar Elves", "elves"),
                ],
            }),
            // The lock binds every player, so it sits on the OPPONENT's side:
            // the scan must read the other battlefield's chosen name off the wire.
            makePlayer("p2", { battlefield: [locker] }),
        ],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
    });
}

function onWire(state: GameState) {
    const projected = projectPublicState(state, 1, "p1");
    const players = projected.players as unknown as Player[];
    const view = buildTriggerStateView(players, projected.activePlayerId);
    const mine = players.find((p) => p.id === "p1")!.battlefield;
    const card = (id: string) => mine.find((c) => c.id === id) as CardInstance;
    return { view, card };
}

describe("chosen-name activation lock on the wire (CR 602.5 / 605.1a)", () => {
    const ping = getCardByName("Prodigal Sorcerer").activatedAbilities![0]!.id;

    it("hides the named source's stack ability", () => {
        const offered = (named: string | undefined) => {
            const { view, card } = onWire(board("Pithing Needle", named));
            return getStackAbilities(
                card("tim"),
                "PRECOMBAT_MAIN",
                true,
                view,
                20
            ).map((a) => a.id);
        };
        expect(offered(undefined)).toContain(ping);
        expect(offered("Llanowar Elves")).toContain(ping);
        expect(offered("Prodigal Sorcerer")).not.toContain(ping);
    });

    it("an exempting lock leaves the named mana source tappable; Revoker withdraws it", () => {
        const needle = onWire(board("Pithing Needle", "Llanowar Elves"));
        expect(hasManaAbility(needle.card("elves"), needle.view)).toBe(true);
        const revoker = onWire(board("Phyrexian Revoker", "Llanowar Elves"));
        expect(hasManaAbility(revoker.card("elves"), revoker.view)).toBe(false);
    });
});
