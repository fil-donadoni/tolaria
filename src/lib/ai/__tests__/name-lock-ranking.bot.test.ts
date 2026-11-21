/**
 * Issue #10225 — an as-enters name LOCK (CR 614.12a) names what it denies the
 * opponent, not a fallback. Pithing Needle (CR 602.5 / 605.1a: activated
 * abilities, mana abilities exempt) and Meddling Mage (CR 601.3a: spells),
 * each resolved up to its as-enters name window, answered by BOTH doors: the
 * search's name-lock node (`settleAnswers`) and the live Brain's default
 * (`nameCardDefault`, through the real `projectPublicState`). They read one
 * ranking (`rankNameLockName`), so they must agree.
 */

import { describe, expect, it } from "vitest";
import { getCardByName } from "@convex/cards";
import type { ScenarioSpec } from "@convex/debugScenarioSpec";
import { projectPublicState } from "@convex/gameProjections";
import { buildBotView } from "../bot-view";
import type { GameState } from "@convex/gre/state";
import { resolveTopOfStack } from "@convex/gre/state";
import { enumerateMoves } from "@convex/gre/moves";
import { applyMoveInSearch } from "@convex/gre/search";
import { isLegalNamedCard } from "@convex/gre/pendingChoiceSubmit";
import { settleAnswers } from "@convex/gre/ai/choiceCandidates";
import { buildPositionFromSpec } from "@convex/gre/ai/blade/build";

type SpecCard = ScenarioSpec["cards"][number];

const idOf = (c: { card: unknown }) => (c.card as { id?: string }).id;

/** Cast `lock` and resolve it up to its as-enters name choice. */
function midLock(lock: string, mana: string[], extra: SpecCard[]): GameState {
    const s = buildPositionFromSpec({
        cards: [
            { name: lock, owner: "me", zone: "hand" },
            ...mana.map(
                (name): SpecCard => ({ name, owner: "me", zone: "battlefield" })
            ),
            ...extra,
        ],
        phase: "PRECOMBAT_MAIN",
        turn: 3,
        libraryCount: 20,
    });
    const me = s.activePlayerId;
    const lockId = getCardByName(lock).id;
    const card = s.players
        .find((p) => p.id === me)!
        .hand.find((c) => idOf(c) === lockId)!;
    const cast = enumerateMoves(s, me).find(
        (m) => m.kind === "cast-spell" && m.cardInstanceId === card.id
    );
    if (!cast) throw new Error(`no ${lock} cast`);
    applyMoveInSearch(s, me, cast);
    resolveTopOfStack(s);
    const head = s.pendingChoices?.[0];
    if (head?.kind !== "name-card") throw new Error("no name window");
    return s;
}

/** Both doors' names for the window. */
function answers(s: GameState): { search?: string; live?: string } {
    const head = s.pendingChoices![0]!;
    // The search's node: one branch, the ranked name.
    const opened = settleAnswers(s, head);
    expect(opened).toHaveLength(1);
    const forced = opened[0];
    const bot = head.playerId;
    const live = buildBotView(projectPublicState(s, 1, bot), bot).owedChoice
        ?.nameCardDefault;
    return {
        search: forced?.kind === "name-card" ? forced.cardName : undefined,
        live,
    };
}

describe("name lock names what it denies (issue #10225)", () => {
    it("Pithing Needle names the opponent's Tormod's Crypt, never a basic land (CR 602.5, 605.1a)", () => {
        const s = midLock(
            "Pithing Needle",
            ["Plains"],
            [
                { name: "Tormod's Crypt", owner: "opp", zone: "battlefield" },
                { name: "Plains", owner: "opp", zone: "battlefield" },
                { name: "Island", owner: "opp", zone: "battlefield" },
            ]
        );
        expect(answers(s)).toEqual({
            search: "Tormod's Crypt",
            live: "Tormod's Crypt",
        });
    });

    it("Pithing Needle never locks the Bot itself while an opponent-only name exists", () => {
        // Prodigal Sorcerer bites harder (on the opponent's battlefield), but
        // the Bot controls one too; Tormod's Crypt binds only the opponent.
        const s = midLock(
            "Pithing Needle",
            ["Plains"],
            [
                {
                    name: "Prodigal Sorcerer",
                    owner: "opp",
                    zone: "battlefield",
                },
                { name: "Prodigal Sorcerer", owner: "me", zone: "battlefield" },
                { name: "Tormod's Crypt", owner: "opp", zone: "graveyard" },
            ]
        );
        expect(answers(s)).toEqual({
            search: "Tormod's Crypt",
            live: "Tormod's Crypt",
        });
    });

    it("Meddling Mage names the instant in the opponent's graveyard, never a land (CR 601.3a)", () => {
        const s = midLock(
            "Meddling Mage",
            ["Plains", "Island"],
            [
                { name: "Lightning Bolt", owner: "opp", zone: "graveyard" },
                { name: "Mountain", owner: "opp", zone: "battlefield" },
                { name: "Forest", owner: "opp", zone: "graveyard" },
            ]
        );
        expect(answers(s)).toEqual({
            search: "Lightning Bolt",
            live: "Lightning Bolt",
        });
    });

    it("no useful candidate: both doors still submit a legal name (no freeze)", () => {
        const s = midLock(
            "Pithing Needle",
            ["Plains"],
            [{ name: "Plains", owner: "opp", zone: "battlefield" }]
        );
        const head = s.pendingChoices![0]!;
        const { search, live } = answers(s);
        expect(search).toBeDefined();
        expect(live).toBeDefined();
        expect(isLegalNamedCard(s, head, search!)).toBe(true);
        expect(isLegalNamedCard(s, head, live!)).toBe(true);
    });
});
