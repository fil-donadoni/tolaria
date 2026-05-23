import { describe, expect, it, vi } from "vitest";
import { tappedTrigger } from "../tappedTrigger";
import type {
    CardType,
    GameEvent,
    PermanentTappedEvent,
    PermanentView,
} from "../../../types";

function makeSelf(overrides: Partial<PermanentView> = {}): PermanentView {
    return {
        id: "self",
        controllerId: "p1",
        ownerId: "p1",
        types: ["Enchantment"] as CardType[],
        subtypes: [],
        isTapped: false,
        card: {},
        ...overrides,
    };
}

function makeEvent(
    overrides: Partial<PermanentTappedEvent> = {}
): PermanentTappedEvent {
    return {
        type: "PERMANENT_TAPPED",
        permanentId: "land",
        controllerId: "p1",
        permanentTypes: ["Land"] as CardType[],
        permanentSubtypes: [],
        forMana: false,
        ...overrides,
    };
}

describe("tappedTrigger factory (CR 701.20a / 605)", () => {
    it("declares PERMANENT_TAPPED event kind and id/oracleText pass-through", () => {
        const t = tappedTrigger({
            id: "x",
            oracleText: "ot",
            scope: "any",
            resolve: () => {},
        });
        expect(t.event).toBe("PERMANENT_TAPPED");
        expect(t.id).toBe("x");
        expect(t.oracleText).toBe("ot");
    });

    it("rejects non-PERMANENT_TAPPED events without invoking the body", () => {
        const t = tappedTrigger({
            id: "x",
            oracleText: "",
            scope: "any",
            resolve: () => {},
        });
        const phase: GameEvent = {
            type: "PHASE_BEGIN",
            phase: "UPKEEP",
            activePlayerId: "p1",
        };
        expect(t.matches(phase, makeSelf())).toBe(false);
    });

    it("forMana=true filters out non-mana taps; undefined matches either", () => {
        const onlyMana = tappedTrigger({
            id: "m",
            oracleText: "",
            scope: "any",
            forMana: true,
            resolve: () => {},
        });
        expect(onlyMana.matches(makeEvent({ forMana: true }), makeSelf())).toBe(
            true
        );
        expect(
            onlyMana.matches(makeEvent({ forMana: false }), makeSelf())
        ).toBe(false);

        const anyTap = tappedTrigger({
            id: "a",
            oracleText: "",
            scope: "any",
            resolve: () => {},
        });
        expect(anyTap.matches(makeEvent({ forMana: true }), makeSelf())).toBe(
            true
        );
        expect(anyTap.matches(makeEvent({ forMana: false }), makeSelf())).toBe(
            true
        );
    });

    it("forMana=false filters out mana taps", () => {
        const nonManaOnly = tappedTrigger({
            id: "nm",
            oracleText: "",
            scope: "any",
            forMana: false,
            resolve: () => {},
        });
        expect(
            nonManaOnly.matches(makeEvent({ forMana: false }), makeSelf())
        ).toBe(true);
        expect(
            nonManaOnly.matches(makeEvent({ forMana: true }), makeSelf())
        ).toBe(false);
    });

    it("filter is combined with scope (AND)", () => {
        const t = tappedTrigger({
            id: "t",
            oracleText: "",
            scope: "opponents",
            filter: { subtypes: "Forest" },
            resolve: () => {},
        });
        const self = makeSelf({ controllerId: "p1" });
        // wrong scope (same controller) — rejected
        expect(
            t.matches(
                makeEvent({
                    controllerId: "p1",
                    permanentSubtypes: ["Forest"],
                }),
                self
            )
        ).toBe(false);
        // wrong filter (no Forest subtype) — rejected
        expect(
            t.matches(
                makeEvent({
                    controllerId: "p2",
                    permanentSubtypes: ["Mountain"],
                }),
                self
            )
        ).toBe(false);
        // both pass
        expect(
            t.matches(
                makeEvent({
                    controllerId: "p2",
                    permanentSubtypes: ["Forest"],
                }),
                self
            )
        ).toBe(true);
    });

    it("condition runs after scope+filter+forMana pass", () => {
        const cond = vi.fn(() => false);
        const t = tappedTrigger({
            id: "c",
            oracleText: "",
            scope: "any",
            condition: cond,
            resolve: () => {},
        });
        // forMana shortcut: condition only invoked when prior checks pass.
        const tForMana = tappedTrigger({
            id: "c2",
            oracleText: "",
            scope: "any",
            forMana: true,
            condition: cond,
            resolve: () => {},
        });
        expect(
            tForMana.matches(makeEvent({ forMana: false }), makeSelf())
        ).toBe(false);
        expect(cond).not.toHaveBeenCalled();

        expect(t.matches(makeEvent(), makeSelf())).toBe(false);
        expect(cond).toHaveBeenCalledOnce();
    });

    it("interveningIf is exposed on the produced ability and pre-narrows the event", () => {
        const iif = vi.fn(() => true);
        const t = tappedTrigger({
            id: "i",
            oracleText: "",
            scope: "any",
            interveningIf: iif,
            resolve: () => {},
        });
        expect(t.interveningIf).toBeDefined();
        t.interveningIf!(makeEvent(), makeSelf());
        expect(iif).toHaveBeenCalledOnce();
    });

    it("interveningIf returns false for non-PERMANENT_TAPPED events", () => {
        const iif = vi.fn(() => true);
        const t = tappedTrigger({
            id: "i",
            oracleText: "",
            scope: "any",
            interveningIf: iif,
            resolve: () => {},
        });
        const phase: GameEvent = {
            type: "PHASE_BEGIN",
            phase: "UPKEEP",
            activePlayerId: "p1",
        };
        expect(t.interveningIf!(phase, makeSelf())).toBe(false);
        expect(iif).not.toHaveBeenCalled();
    });

    it("omitted interveningIf is not set on the returned ability", () => {
        const t = tappedTrigger({
            id: "n",
            oracleText: "",
            scope: "any",
            resolve: () => {},
        });
        expect(t.interveningIf).toBeUndefined();
    });

    it("resolve receives a derived payload mirroring the event", () => {
        const resolveBody = vi.fn();
        const t = tappedTrigger({
            id: "r",
            oracleText: "",
            scope: "any",
            resolve: resolveBody,
        });
        const event = makeEvent({
            forMana: true,
            manaProduced: { G: 1 },
            permanentSubtypes: ["Forest"],
        });
        const fakeCtx = {} as Parameters<typeof resolveBody>[0];
        t.resolve(fakeCtx, event);
        expect(resolveBody).toHaveBeenCalledWith(fakeCtx, event, {
            id: "land",
            controllerId: "p1",
            types: ["Land"],
            subtypes: ["Forest"],
            forMana: true,
            manaProduced: { G: 1 },
        });
    });

    it("resolve no-ops for non-PERMANENT_TAPPED events (defensive narrowing)", () => {
        const resolveBody = vi.fn();
        const t = tappedTrigger({
            id: "r2",
            oracleText: "",
            scope: "any",
            resolve: resolveBody,
        });
        const phase: GameEvent = {
            type: "PHASE_BEGIN",
            phase: "UPKEEP",
            activePlayerId: "p1",
        };
        t.resolve({} as never, phase);
        expect(resolveBody).not.toHaveBeenCalled();
    });
});
