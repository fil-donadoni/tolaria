import { describe, it } from "vitest";
import { buildBladeState } from "../runner";
import { materialMargin } from "../../../evaluate";
import {
    applyMoveInSearch,
    decidingPlayer,
    settleStackForBreakdown,
} from "../../../search";
import { enumerateMoves } from "../../../moves";
import { cloneGameState } from "../../../clone";
import { findBladeScenario } from "../registry";

describe("probe 3377d", () => {
    it("where the sacrifice is lost", () => {
        const out: string[] = [];
        const s = findBladeScenario(
            "sacrifice sign: does not cast a creature whose ETB eats its own board"
        )!;
        const state = buildBladeState(s);
        const bid = decidingPlayer(state)!;
        const cast = enumerateMoves(state, bid).find(
            (m) => m.kind === "cast-spell"
        )!;
        const probe = cloneGameState(state);
        applyMoveInSearch(probe, bid, cast);
        const show = (label: string, st: typeof probe) => {
            const me = st.players.find((p) => p.id === bid)!;
            out.push(
                `${label}: stack=${st.stack.length} pendingChoices=${(st.pendingChoices ?? []).length} ` +
                    `head=${JSON.stringify((st.pendingChoices ?? [])[0] ? { kind: (st.pendingChoices as never[])[0]["kind"], player: (st.pendingChoices as never[])[0]["playerId"] } : null)} ` +
                    `pendingTarget=${!!st.pendingTarget} pendingCast=${!!st.pendingCast} pendingActivation=${!!st.pendingActivation} ` +
                    `battlefield=[${me.battlefield.map((c) => c.card.name).join(", ")}] margin=${materialMargin(st, bid)}`
            );
        };
        show("after applyMoveInSearch", probe);
        const settled = settleStackForBreakdown(probe, bid);
        show("after settleStackForBreakdown", settled);
        require("fs").writeFileSync(process.env.PROBE_OUT!, out.join("\n"));
    });
});
