// CR 614.12a / CR 106.5 — `manaColorSource: { colors: "chosen-color" }`: a mana
// ability whose offer is the colour the source stored as it entered.
//
// The data form the compiler emits for "{T}: Add one mana of the chosen color."
// Every consumer reads it through `getDynamicManaChoices`, so the tests stand on
// that one authority, on the "could produce" read beside it, and on the wire: the
// client's picker runs the same resolver over the projected permanent.
import { describe, expect, it } from "vitest";
import {
    getDefinitionProducibleColors,
    getEffectiveManaChoices,
    getProducibleColorsOnBoard,
} from "../constants";
import { projectPublicState } from "../../gameProjections";
import { getDefinition } from "../../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";

const QUIRION_ELVES = "be9a64fb-1e8d-4ed8-b4c5-3d44db9c1d3b";

function board(chosenModeId: string | undefined) {
    const elf = makeInstance(QUIRION_ELVES, {
        id: "elf",
        ...(chosenModeId === undefined ? {} : { chosenModeId }),
    });
    const state = makeState({
        players: [makePlayer("p1", { battlefield: [elf] }), makePlayer("p2")],
    });
    const battlefields = state.players.map((p) => ({
        playerId: p.id,
        battlefield: p.battlefield,
    }));
    return { elf, state, battlefields };
}

describe('manaColorSource "chosen-color" (CR 614.12a, CR 106.5)', () => {
    it("offers the stored colour and only it", () => {
        const { elf, battlefields } = board("U");
        expect(getEffectiveManaChoices(elf, "p1", battlefields)).toEqual([
            { U: 1 },
        ]);
    });

    // CR 106.5 — an undefined type is no mana. `[]`, never `null`: `null` falls
    // through to the five-colour no-board list and offers a phantom WUBRG.
    it("offers nothing when no colour is stored", () => {
        const { elf, battlefields } = board(undefined);
        expect(getEffectiveManaChoices(elf, "p1", battlefields)).toEqual([]);
    });

    // CR 106.7 — on a board it could produce its fixed {G} and the stored
    // colour, not the five-colour fallback list.
    it("could produce the stored colour on a board", () => {
        const { elf, battlefields } = board("U");
        expect(
            [...getProducibleColorsOnBoard(elf, battlefields)].sort()
        ).toEqual(["G", "U"]);
    });

    // A descriptor reading this permanent (Fellwar Stone reading a chosen-colour
    // land) evaluates it at the depth bound, where no board read runs: the
    // stored colour must still be the answer, never the no-board list.
    it("could produce the stored colour at the descriptor depth bound", () => {
        const { elf, battlefields } = board("U");
        expect(
            [...getProducibleColorsOnBoard(elf, battlefields, 1)].sort()
        ).toEqual(["G", "U"]);
    });

    // CR 106.7 — off the battlefield it may yet choose any of the five, so
    // deck analysis keeps reading it as a five-colour source.
    it("could produce all five off the battlefield", () => {
        expect(
            [
                ...getDefinitionProducibleColors(getDefinition(QUIRION_ELVES)),
            ].sort()
        ).toEqual(["B", "G", "R", "U", "W"]);
    });

    // The projection strips `card.card`: the client's picker reads the stored
    // colour off the projected permanent, through the same resolver.
    it("survives the wire — the same offer on the projected permanent", () => {
        const { state } = board("R");
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0]!.battlefield.find(
            (c) => c.id === "elf"
        )!;
        expect(
            getEffectiveManaChoices(
                slim,
                "p1",
                projected.players.map((p) => ({
                    playerId: p.id,
                    battlefield: p.battlefield,
                }))
            )
        ).toEqual([{ R: 1 }]);
    });
});
