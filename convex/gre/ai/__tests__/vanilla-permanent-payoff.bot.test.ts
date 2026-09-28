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
 * entirely and was left to the bare tie-break with no rescue (issue #4785,
 * Sadistic Hypnotist: a +51-point settled margin lost to `pass` on the
 * subtree's rollout noise at issue #4764's refit). `isSelfConfinedVanillaPermanentCast`
 * closes that gap for exactly the no-choice case, reusing the SAME allowlisted
 * `resolved-payoff` mechanism rather than adding a new root rule.
 */

import { describe, expect, it } from "vitest";
import { selectRootMove, type Edge, type Node } from "../../search";
import { DEFAULT_EVAL_WEIGHTS } from "../evalWeights";
import { enumerateMoves, type Move } from "../../moves";
import { buildBladeState } from "../blade/runner";
import { BLADE_SCENARIOS } from "../blade/registry";
import type { RootDecisionMechanism } from "../decisionTelemetry";

describe("resolved-payoff reaches a vanilla permanent cast (issue #4785)", () => {
    // Sacrifice-for-discard outlet blade entry's own position: Sadistic
    // Hypnotist in hand (only an `activatedAbilities[]` outlet — no
    // triggered ability, no static/replacement effect, no target on the
    // cast itself), five Swamps, a spare body on each side.
    const scenario = BLADE_SCENARIOS.find(
        (s) => s.label === "Sacrifice-for-discard outlet: casts the creature"
    );
    if (!scenario) throw new Error("blade entry not found — renamed?");

    function position(): {
        state: ReturnType<typeof buildBladeState>;
        botId: string;
    } {
        const state = buildBladeState(scenario!);
        return { state, botId: state.players[0].id };
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

    it("rescues the cast via `resolved-payoff` when the bare tie-break would settle on `pass`", () => {
        const { state, botId } = position();
        const moves = enumerateMoves(state, botId);
        const cast = moves.find((m) => m.kind === "cast-spell");
        const pass = moves.find((m) => m.kind === "pass");
        expect(cast, "the position must offer the Hypnotist cast").toBeTruthy();
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

        expect(picked.kind).toBe("cast-spell");
        expect(out.mechanism).toBe("resolved-payoff");
    });
});
