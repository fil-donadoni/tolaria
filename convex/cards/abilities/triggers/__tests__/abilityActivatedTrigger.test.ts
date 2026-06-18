import { describe, expect, it, vi } from "vitest";
import { abilityActivatedTrigger } from "../abilityActivatedTrigger";
import type {
    AbilityActivatedEvent,
    CardType,
    GameEvent,
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
    overrides: Partial<AbilityActivatedEvent> = {}
): AbilityActivatedEvent {
    return {
        type: "ABILITY_ACTIVATED",
        permanentId: "art",
        controllerId: "p1",
        permanentTypes: ["Artifact"] as CardType[],
        permanentSubtypes: [],
        abilityId: "some-ability",
        ...overrides,
    };
}

describe("abilityActivatedTrigger factory (CR 602.1)", () => {
    it("declares ABILITY_ACTIVATED event kind and id/oracleText pass-through", () => {
        const t = abilityActivatedTrigger({
            id: "x",
            oracleText: "ot",
            scope: "any",
            resolve: () => {},
        });
        expect(t.event).toBe("ABILITY_ACTIVATED");
        expect(t.id).toBe("x");
        expect(t.oracleText).toBe("ot");
    });

    it("rejects non-ABILITY_ACTIVATED events without invoking the body", () => {
        const body = vi.fn();
        const t = abilityActivatedTrigger({
            id: "x",
            oracleText: "",
            scope: "any",
            resolve: body,
        });
        const tapped: GameEvent = {
            type: "PERMANENT_TAPPED",
            permanentId: "art",
            controllerId: "p1",
            permanentTypes: ["Artifact"],
            permanentSubtypes: [],
            forMana: false,
        };
        expect(t.matches(tapped, makeSelf())).toBe(false);
    });

    it("scope: opponents matches only a different controller", () => {
        const t = abilityActivatedTrigger({
            id: "x",
            oracleText: "",
            scope: "opponents",
            resolve: () => {},
        });
        expect(t.matches(makeEvent({ controllerId: "p2" }), makeSelf())).toBe(
            true
        );
        expect(t.matches(makeEvent({ controllerId: "p1" }), makeSelf())).toBe(
            false
        );
    });

    it("filter narrows by permanent type (Artifact-only)", () => {
        const t = abilityActivatedTrigger({
            id: "x",
            oracleText: "",
            scope: "any",
            filter: { types: "Artifact" },
            resolve: () => {},
        });
        expect(t.matches(makeEvent(), makeSelf())).toBe(true);
        expect(
            t.matches(makeEvent({ permanentTypes: ["Creature"] }), makeSelf())
        ).toBe(false);
    });

    it("condition (host check) gates on self.attachedTo", () => {
        const t = abilityActivatedTrigger({
            id: "x",
            oracleText: "",
            scope: "any",
            condition: (event, self) =>
                !!self.attachedTo && event.permanentId === self.attachedTo,
            resolve: () => {},
        });
        const attached = makeSelf({ attachedTo: "art" });
        expect(t.matches(makeEvent({ permanentId: "art" }), attached)).toBe(
            true
        );
        expect(t.matches(makeEvent({ permanentId: "other" }), attached)).toBe(
            false
        );
        expect(t.matches(makeEvent({ permanentId: "art" }), makeSelf())).toBe(
            false
        );
    });

    it("resolve passes a narrowed event + last-known payload to the body", () => {
        const body = vi.fn();
        const t = abilityActivatedTrigger({
            id: "x",
            oracleText: "",
            scope: "any",
            resolve: body,
        });
        const ev = makeEvent({ permanentId: "art", controllerId: "p2" });
        // ctx is unused by this body; cast a minimal stub.
        t.resolve({} as never, ev);
        expect(body).toHaveBeenCalledTimes(1);
        const payload = body.mock.calls[0][2];
        expect(payload).toEqual({
            id: "art",
            controllerId: "p2",
            types: ["Artifact"],
            subtypes: [],
        });
    });

    it("interveningIf returns false for non-ABILITY_ACTIVATED events", () => {
        const t = abilityActivatedTrigger({
            id: "x",
            oracleText: "",
            scope: "any",
            interveningIf: () => true,
            resolve: () => {},
        });
        const tapped: GameEvent = {
            type: "PERMANENT_TAPPED",
            permanentId: "art",
            controllerId: "p1",
            permanentTypes: ["Artifact"],
            permanentSubtypes: [],
            forMana: false,
        };
        expect(t.interveningIf!(tapped, makeSelf())).toBe(false);
    });
});
