// Bot-play sweep (ADR 0105 § 7.2, issue #3830) — draw sorceries and enters-trigger Abilities.
// One fixture per outcome on the generated position; the sweep itself runs over the whole
// `ready` set in `oracle:compile`, these files are the evidence its verdicts
// mean what the lockfile says (split by cost, issue #6148).

import { describe, expect, it } from "vitest";
import { getCardByName } from "../../../cards";
import { withTemporaryDefinition } from "../../../cards/registry";
import { playBotReach } from "../botReach";
import {
    DRAW_SORCERY,
    SACRIFICE_DRAW_SORCERY,
    KICKED_SWEEP_CREATURE,
    ETB_WALL_REMOVER,
    ETB_UNPOSABLE_REMOVER,
    ETB_GOBLIN_LOOKER,
    ETB_DISCARDER,
} from "./botReachPlay.fixture";

describe("Bot-play sweep (ADR 0105 § 7.2) — draw sorceries and enters-trigger Abilities", () => {
    // Issue #4266: the generated library was basic lands, so what a draw
    // spell found was worth nothing and `pass` beat the cast on every seed.
    it("played — a draw spell the Bot casts once its library holds spells", () => {
        withTemporaryDefinition(DRAW_SORCERY, () => {
            expect(playBotReach(DRAW_SORCERY)).toEqual({ outcome: "played" });
        });
        // Issue #5029: paid for with a creature, the draw has to find more
        // than the body, and over the filler pile it did not (1/20 seat-seeds
        // cast). The pose stocks the holder's whole library.
        withTemporaryDefinition(SACRIFICE_DRAW_SORCERY, () => {
            expect(playBotReach(SACRIFICE_DRAW_SORCERY)).toEqual({
                outcome: "played",
            });
        });
        // The catalogue cards of the same shape: a sorcery (`ignored` on the
        // filler pile) and an instant, whose last window a library of nothing
        // but spells could turn into a reason to wait.
        for (const name of ["Skulltap", "Village Rites"])
            expect(playBotReach(getCardByName(name)), name).toEqual({
                outcome: "played",
            });
    }, 300_000);

    it("position-unmodelled — a creature whose ETB Ability finds no legal target is held, and the refusal is the position's (issue #4758)", () => {
        withTemporaryDefinition(ETB_UNPOSABLE_REMOVER, () => {
            expect(playBotReach(ETB_UNPOSABLE_REMOVER)).toMatchObject({
                outcome: "ignored",
                cause: "position-unmodelled",
            });
        });
    });

    // Issue #4904: `targetPose` posed only a SPELL's target, so a creature's
    // ETB Ability found the generic fillers and no Wall, and the Bot's hold
    // read as `never-chosen`.
    it("played — an ETB Ability's narrowed target is posed like a spell's (issue #4904)", () => {
        withTemporaryDefinition(ETB_WALL_REMOVER, () => {
            expect(playBotReach(ETB_WALL_REMOVER)).toEqual({
                outcome: "played",
            });
        });
    });

    it("played — an ETB Ability that aims a discard finds a hand worth taking (issue #4904)", () => {
        withTemporaryDefinition(ETB_DISCARDER, () => {
            expect(playBotReach(ETB_DISCARDER)).toEqual({ outcome: "played" });
        });
    });

    it("played — an ETB look-and-distribute finds the cards it keeps in the library (issue #4904)", () => {
        withTemporaryDefinition(ETB_GOBLIN_LOOKER, () => {
            expect(playBotReach(ETB_GOBLIN_LOOKER)).toEqual({
                outcome: "played",
            });
        });
    });

    it("played — a card whose value lies in its kicked branch is cast kicked", () => {
        withTemporaryDefinition(KICKED_SWEEP_CREATURE, () => {
            expect(playBotReach(KICKED_SWEEP_CREATURE)).toEqual({
                outcome: "played",
            });
        });
    });
});
