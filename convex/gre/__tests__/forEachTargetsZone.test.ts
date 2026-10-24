// `forEach { set: "targets", zone: "graveyard" }` (CR 601.2c + CR 400.7) — the
// validator admits the one narrowing and nothing past it.

import { describe, expect, it } from "vitest";
import { validateEffectScript } from "../effects/validate";
import type { EffectOp } from "../../cards/types";

function errorsFor(select: unknown): string[] {
    const effects = [
        {
            op: "forEach",
            select,
            effects: [
                {
                    op: "moveZone",
                    target: { ref: "$each" },
                    from: "graveyard",
                    to: "hand",
                },
            ],
        },
    ] as unknown as EffectOp[];
    return validateEffectScript({
        id: "probe",
        name: "Probe",
        effects,
    } as Parameters<typeof validateEffectScript>[0]);
}

describe("forEach targets selector — graveyard narrowing (CR 601.2c)", () => {
    it("admits the graveyard narrowing", () => {
        expect(errorsFor({ set: "targets", zone: "graveyard" })).toEqual([]);
    });

    it("admits the bare announced set", () => {
        expect(errorsFor({ set: "targets" })).toEqual([]);
    });

    it("refuses any other zone and any extra field", () => {
        expect(errorsFor({ set: "targets", zone: "exile" })).not.toEqual([]);
        expect(
            errorsFor({ set: "targets", zone: "graveyard", controller: "you" })
        ).not.toEqual([]);
    });
});
