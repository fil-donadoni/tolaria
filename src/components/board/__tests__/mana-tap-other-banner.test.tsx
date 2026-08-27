// Non-stack mana ability's tap-other pick prompt (CR 602.1/118.8/605.3c,
// issue #2371 — Urza, Lord High Artificer). No dom test existed before issue
// #2730's v4 re-skin (the retired card-domain title face) — covers the
// heading, progress text and Cancel, pinning the display face so a revert
// is caught here.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { CardInstance } from "~/types/game";
import type { ManaTapOtherPick } from "~/hooks/useBattlefieldVisualState";
import {
    mockInstanceManaCost,
    type ManaCostSource,
} from "~/lib/testing/convex-cards-mock";

// `displayCardId` (`~/lib/card-utils`, unmocked, real) reaches
// `tryGetDefinition` from this same barrel — mocking `@convex/cards`
// partially without it fails `convex-cards-barrel-mock.test.ts` (#2339: the
// mock must define every name this suite's import graph reaches, not just
// the ones this file calls directly).
vi.mock("@convex/cards", () => {
    const def = (id: string) => ({ id, name: `Card ${id}` });
    return {
        getDefinition: def,
        tryGetDefinition: def,
        getInstanceManaCost: (c: ManaCostSource) => mockInstanceManaCost(c),
    };
});

import ManaTapOtherBanner from "../mana-tap-other-banner";

afterEach(cleanup);

function source(): CardInstance {
    return {
        id: "src",
        card: { id: "urza-lord-high-artificer" },
        controllerId: "me",
        ownerId: "me",
        zone: "battlefield",
        isTapped: false,
        types: ["Legendary", "Creature"],
    } as never;
}

function pick(over: Partial<ManaTapOtherPick> = {}): ManaTapOtherPick {
    return {
        sourceId: "src",
        abilityId: "tap-artifact",
        spec: { filter: { types: "Artifact" }, count: 1 },
        candidates: [{ id: "art1", power: 0 }],
        picked: [],
        ...over,
    };
}

describe("ManaTapOtherBanner (CR 602.1/118.8, issue #2371)", () => {
    it("shows the source name in the display face, not the retired Beleren card face", () => {
        render(
            <ManaTapOtherBanner
                pick={pick()}
                source={source()}
                onCancel={() => {}}
            />
        );
        const title = screen.getByText("Card urza-lord-high-artificer");
        expect(title.className).toContain("text-display");
        expect(title.className).not.toContain("font-beleren");
    });

    it("names the outstanding tap-other pick", () => {
        render(
            <ManaTapOtherBanner
                pick={pick()}
                source={source()}
                onCancel={() => {}}
            />
        );
        expect(screen.getByText(/tap an artifact/)).toBeTruthy();
    });

    it("Cancel invokes onCancel", () => {
        const onCancel = vi.fn();
        render(
            <ManaTapOtherBanner
                pick={pick()}
                source={source()}
                onCancel={onCancel}
            />
        );
        fireEvent.click(screen.getByText("Cancel"));
        expect(onCancel).toHaveBeenCalled();
    });
});
