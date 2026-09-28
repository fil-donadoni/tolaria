/**
 * The resolved-payoff credit (issue #3388) exists precisely because the
 * material tie-break's `meanMargin` is accumulated over the whole SUBTREE and
 * can rank a strictly-worse `pass` above a cast whose SETTLED resolution
 * pays — rollout noise, not a real preference. Every existing shape of that
 * credit (`cheat-into-play-payoff.bot.test.ts`, `optional-put-payoff.bot.test.ts`)
 * needs the cast to raise a resolution-time CHOICE (`reachesOnlyOwnSideThroughChoice`
 * gates on `announcementCanSuspend`), because that gate's underlying probe
 * (`isSelfConfinedFutileMove`) refuses to run at all on a permanent spell —
 * "board presence is a real delta", `ai/dominance.ts`'s `isProbeEligibleMove`.
 *
 * A VANILLA permanent — no target, no ETB, nothing to choose — is the
 * SIMPLEST possible self-confined cast, yet it fell through that gate
 * entirely and was left to the bare tie-break with no rescue (issue #4785).
 * `isSelfConfinedVanillaPermanentCast` closes that gap, reusing the SAME
 * allowlisted `resolved-payoff` mechanism rather than adding a new root rule
 * — but only for NON-creatures: a creature is left to the search, exactly as
 * `isSorcerySpeedPermanentCast`'s free-development class already does (issue
 * #4070, "a beater held back can carry sequencing value"). The second test
 * below pins that exclusion with the issue's OWN card, Sadistic Hypnotist —
 * a creature whose only ability is a sacrifice outlet, structurally the same
 * shape as Seal of Doom's sacrifice-for-removal outlet below, differing in
 * nothing but `types`.
 */

import { describe, expect, it } from "vitest";
import { selectRootMove, type Edge, type Node } from "../../search";
import { DEFAULT_EVAL_WEIGHTS } from "../evalWeights";
import { enumerateMoves, type Move } from "../../moves";
import { getCardByName } from "../../../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../../cards/__tests__/setup";
import type { GameState } from "../../state";
import type { RootDecisionMechanism } from "../decisionTelemetry";

describe("resolved-payoff reaches a vanilla permanent cast (issue #4785)", () => {
    const SEAL = getCardByName("Seal of Doom").id; // {2}{B} enchantment, sac-only outlet, no ETB/target on cast
    const HYPNOTIST = getCardByName("Sadistic Hypnotist").id; // {3}{B}{B} CREATURE, same sac-outlet shape

    /** `cardId` in hand, enough black-and-colourless mana on the battlefield
     *  to cast either fixture (5 Swamps covers both costs), one spare body on
     *  each side so the position is never an empty-board degenerate case. */
    function position(cardId: string): { state: GameState; botId: string } {
        const hand = [
            makeInstance(cardId, {
                id: "subject",
                controllerId: "p1",
                ownerId: "p1",
                zone: "hand",
            }),
        ];
        const SWAMP = getCardByName("Swamp").id;
        const BEARS = getCardByName("Grizzly Bears").id;
        const battlefield = [
            ...["s1", "s2", "s3", "s4", "s5"].map((id) =>
                makeInstance(SWAMP, {
                    id,
                    controllerId: "p1",
                    ownerId: "p1",
                    zone: "battlefield",
                })
            ),
            makeInstance(BEARS, {
                id: "my-bear",
                controllerId: "p1",
                ownerId: "p1",
                zone: "battlefield",
            }),
        ];
        const oppBattlefield = [
            makeInstance(BEARS, {
                id: "opp-bear",
                controllerId: "p2",
                ownerId: "p2",
                zone: "battlefield",
            }),
        ];
        const state = makeState({
            phase: "PRECOMBAT_MAIN",
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            players: [
                makePlayer("p1", { hand, battlefield }),
                makePlayer("p2", { battlefield: oppBattlefield }),
            ],
        });
        return { state, botId: "p1" };
    }

    /** A hand-built root with exactly two edges, rigged into the noise-pin
     *  shape issue #4785 measured: outcome-tied (within `outcomeEps`) but
     *  `pass`'s SUBTREE `meanMargin` edges out `cast`'s — 400 vs 350 here,
     *  the same ~50-point spread as the real seed 17 reading (347.76 vs
     *  345.53) scaled up for a robust assertion. */
    function riggedRoot(cast: Move, pass: Move, botId: string): Node {
        const children = new Map<string, Edge>();
        const visits = 100;
        children.set("pass", {
            move: pass,
            key: "pass",
            mover: botId,
            node: { children: new Map() },
            visits,
            totalReward: 0.6 * visits,
            totalMargin: 400 * visits,
            avail: visits,
        });
        children.set("cast", {
            move: cast,
            key: "cast",
            mover: botId,
            node: { children: new Map() },
            visits,
            totalReward: 0.62 * visits,
            totalMargin: 350 * visits,
            avail: visits,
        });
        return { children };
    }

    function pickedMechanism(cardId: string): {
        moveKind: string;
        mechanism?: RootDecisionMechanism;
    } {
        const { state, botId } = position(cardId);
        const moves = enumerateMoves(state, botId);
        const cast = moves.find((m) => m.kind === "cast-spell");
        const pass = moves.find((m) => m.kind === "pass");
        expect(cast, "the position must offer the cast").toBeTruthy();
        expect(pass, "the position must offer pass").toBeTruthy();

        const root = riggedRoot(cast!, pass!, botId);
        const out: { mechanism?: RootDecisionMechanism } = {};
        const picked = selectRootMove(
            root,
            moves,
            state,
            botId,
            undefined,
            DEFAULT_EVAL_WEIGHTS,
            undefined,
            out as { mechanism: RootDecisionMechanism }
        );
        return { moveKind: picked.kind, mechanism: out.mechanism };
    }

    it("rescues a NON-creature sacrifice-outlet cast (Seal of Doom) via `resolved-payoff`", () => {
        const { moveKind, mechanism } = pickedMechanism(SEAL);
        expect(moveKind).toBe("cast-spell");
        expect(mechanism).toBe("resolved-payoff");
    });

    it("does NOT rescue the structurally-identical CREATURE shape (Sadistic Hypnotist) — left to the search, per issue #4070", () => {
        const { moveKind } = pickedMechanism(HYPNOTIST);
        expect(moveKind).toBe("pass");
    });
});
