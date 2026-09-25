// The Engine View badge's Op count reaches every nesting shape the Effect
// Script DSL has (issue #4654). `countEffectOps` used to reflect on the
// `effects` / `then` / `else` / `modes` field names, so an Op under a
// coin-flip branch or a `divideIntoPiles` pile was never counted; it now walks
// `childOpArrays`, and this test holds it to the shared nesting-shape fixture.
import { describe, it, expect } from "vitest";
import { computeEngineViewBadge } from "~/lib/engine-view-badge";
import type { CardDefinition } from "@convex/cards/types";
import {
    NESTING_SHAPES,
    markerOp,
} from "@convex/gre/__tests__/fixtures/nestedOpShapes";

describe("computeEngineViewBadge — nested Op count (issue #4654)", () => {
    it.each(NESTING_SHAPES.map((shape) => [shape.label, shape] as const))(
        "counts the marker under %s",
        (_label, shape) => {
            const def = {
                name: "Nesting Probe",
                effects: [shape.nest([markerOp()])],
            } as unknown as CardDefinition;
            // The host Op plus the one marker nested under it.
            expect(computeEngineViewBadge(def)).toEqual({
                kind: "dsl",
                opCount: 2,
            });
        }
    );
});
