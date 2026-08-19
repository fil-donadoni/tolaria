// c13 — black card behavior tests (ADR 0043 colour split).

import { describe, it, expect } from "vitest";
import { toxicDeluge } from "../../c13";
import { grizzlyBears, crawWurm } from "../../lea";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import { resolveTopOfStack } from "../../../../gre/state";
import { checkStateBasedActions } from "../../../../gre/sba";
import {
    getEffectivePower,
    getEffectiveToughness,
} from "../../../../gre/layers";
import { projectPublicState } from "../../../../gameProjections";

// Toxic Deluge — {2}{B} Sorcery. "As an additional cost to cast this spell,
// pay X life. All creatures get -X/-X until end of turn." (CR 118.4 / 119.4
// pay-X-life additional cost, CR 611.2 temporary P/T reduction). Shipped as issue #926's
// motivating card: a forEach sweep (no `controller` — EVERY player's
// creatures) whose `pump` amounts are `{ negate: { X: true } }`, the negated
// chosen-cost X the SIGNED value grammar now supports. `forEach`/`pump`/`X`/
// `negate` each carry their own interpreter tests (per the per-Op regime),
// but the auto-generated catalogue smoke test explicitly SKIPS a `pump` whose
// power/toughness are not a plain number literal — an intentional, documented
// skip (`convex/gre/effects/scenarioGenerator.ts`), which is this file's
// justification for a hand-written test.
describe("Toxic Deluge ({X}{2}{B} sorcery — pay X life, all creatures get -X/-X, CR 118.4 / 119.4 / 611.2, issue #926)", () => {
    it("sweeps every creature on BOTH sides for -X/-X — a 2/2 dies (CR 704.5f), a 6/4 survives shrunk", () => {
        const bear = makeInstance(grizzlyBears.id, {
            id: "deluge-bear",
            controllerId: "p1",
            ownerId: "p1",
        });
        const wurm = makeInstance(crawWurm.id, {
            id: "deluge-wurm",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bear], life: 20 }),
                makePlayer("p2", { battlefield: [wurm], life: 20 }),
            ],
        });
        const item = pushSpell(state, toxicDeluge.id, "p1");
        item.chosenX = 2;
        resolveTopOfStack(state);
        const wurmAfterPump = state.players[1].battlefield.find(
            (c) => c.id === "deluge-wurm"
        )!;
        // Grizzly Bears 2/2 → -2/-2 = 0/0 (before SBA sweep).
        const bearAfterPump = state.players[0].battlefield.find(
            (c) => c.id === "deluge-bear"
        );
        expect(bearAfterPump).toBeDefined();
        expect(getEffectivePower(state, bearAfterPump!)).toBe(0);
        expect(getEffectiveToughness(state, bearAfterPump!)).toBe(0);
        // Craw Wurm 6/4 → -2/-2 = 4/2 (survives — non-lethal toughness).
        expect(getEffectivePower(state, wurmAfterPump)).toBe(4);
        expect(getEffectiveToughness(state, wurmAfterPump)).toBe(2);
        checkStateBasedActions(state);
        // The 0-toughness bear is destroyed (CR 704.5f); the wurm remains.
        expect(
            state.players[0].battlefield.some((c) => c.id === "deluge-bear")
        ).toBe(false);
        expect(
            state.players[1].battlefield.some((c) => c.id === "deluge-wurm")
        ).toBe(true);
        const survivingWurm = state.players[1].battlefield.find(
            (c) => c.id === "deluge-wurm"
        )!;
        expect(getEffectivePower(state, survivingWurm)).toBe(4);
        expect(getEffectiveToughness(state, survivingWurm)).toBe(2);
    });

    it("wire format: the surviving creature's shrunk P/T survives projectPublicState", () => {
        const wurm = makeInstance(crawWurm.id, {
            id: "deluge-wurm-wire",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { life: 20 }),
                makePlayer("p2", { battlefield: [wurm], life: 20 }),
            ],
        });
        const item = pushSpell(state, toxicDeluge.id, "p1");
        item.chosenX = 3;
        resolveTopOfStack(state);
        // Craw Wurm 6/4 → -3/-3 = 3/1.
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[1].battlefield.find(
            (c) => c.id === "deluge-wurm-wire"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(3);
        expect(getEffectiveToughness(projected, slim)).toBe(1);
    });
});
