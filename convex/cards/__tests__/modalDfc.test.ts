// CR 712.3 / 712.8f — the modal back-face TWIN builder (ADR 0122 §1).
//
// The twin is where a modal face becomes a real `CardDefinition`, and every
// field it forgets is lost silently: the face simply does not have the ability,
// on a card whose front face still looks and plays correctly. So the builder
// gets its own unit coverage for the fields no SHIPPED card exercises yet —
// the two cube cards use `entersTappedUnlessPay` and an activated ability, and
// a field only a future card would fill is exactly the field that rots.

import { describe, it, expect } from "vitest";
import { getDefinition } from "../index";
import { modalBackTwinDefinition } from "../modalDfc";
import type { CardDefinition } from "../types";

const SINK_INTO_STUPOR = "5358b87a-1a29-426d-b165-40c97da2c14d";

describe("modalBackTwinDefinition (CR 712.8f)", () => {
    it("rebuilds the face's CR 611 static effects from its keys", () => {
        // `staticEffectKeys` is a KEY list, not a closure list, because the
        // nonmodal sibling rides a content-derived id (`gre/transform.ts`).
        // The twin needs no codec, but it still has to resolve the keys
        // through the SAME shared factory table — dropping them would leave a
        // face declaring a continuous effect that nothing applies.
        const parent = getDefinition(SINK_INTO_STUPOR);
        const withStatic: CardDefinition = {
            ...parent,
            backFace: {
                ...parent.backFace!,
                staticEffectKeys: ["cant-be-enchanted-self"],
            },
        };

        const twin = modalBackTwinDefinition(withStatic);

        expect(twin?.staticEffects?.length).toBeGreaterThan(0);
    });

    it("returns undefined for a NONMODAL back face — that face is transform's, not this builder's", () => {
        const parent = getDefinition(SINK_INTO_STUPOR);
        const asTransform: CardDefinition = {
            ...parent,
            backFace: { ...parent.backFace!, kind: "nonmodal" },
        };

        expect(modalBackTwinDefinition(asTransform)).toBeUndefined();
    });

    it("carries the print's BACK face for art (CR 111.1 / issue #3321)", () => {
        const twin = modalBackTwinDefinition(getDefinition(SINK_INTO_STUPOR));

        // `?? parent.id` is the load-bearing half: without it the twin's own
        // `#`-bearing id reaches the Scryfall URL builder and truncates at the
        // fragment delimiter into a 404.
        expect(twin?.imagePrintId).toBe(SINK_INTO_STUPOR);
        expect(twin?.imagePrintFace).toBe("back");
    });
});
