// Per-attacker MANA attack tax prompt (CR 508.1c/1g — Propaganda / Ghostly
// Prison). No dom test existed before issue #2730's v4 re-skin (`Panel` +
// `font-beleren` → the chrome display face) — covers the title, the mana
// pips and the Auto-tap/Cancel actions, and pins the display-face title so a
// revert to Beleren (ADR 0103 §4: confined to the card domain) is caught.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { Id } from "@convex/_generated/dataModel";
import type { AttackManaTaxPayment } from "@convex/gre/state";

type MutArgs = Record<string, unknown>;
type MutFn = (args?: MutArgs) => Promise<void>;
const autoTapForAttackTax = vi.fn<MutFn>(() => Promise.resolve());
const cancelAttackTax = vi.fn<MutFn>(() => Promise.resolve());
const MUTATIONS: Record<string, MutFn> = {
    autoTapForAttackTax,
    cancelAttackTax,
};

vi.mock("convex/react", () => ({
    useMutation: (ref: { _name: string }) => MUTATIONS[ref._name],
    useQuery: () => undefined,
}));

vi.mock("@convex/_generated/api", () => ({
    api: {
        game: {
            autoTapForAttackTax: { _name: "autoTapForAttackTax" },
            cancelAttackTax: { _name: "cancelAttackTax" },
        },
    },
}));

import AttackManaTaxBanner from "../attack-mana-tax-banner";

afterEach(cleanup);

function payment(
    over: Partial<AttackManaTaxPayment> = {}
): AttackManaTaxPayment {
    return {
        playerId: "me",
        cost: { generic: 2 },
        reason: "Attacking creatures cost {2} more to declare",
        tappedLandIds: [],
        ...over,
    };
}

describe("AttackManaTaxBanner (CR 508.1c/1g)", () => {
    it("shows the display-face title, not the retired Beleren card face", () => {
        render(
            <AttackManaTaxBanner
                gameId={"g1" as Id<"games">}
                playerId="me"
                payment={payment()}
            />
        );
        const title = screen.getByText("Attack Tax");
        expect(title.className).toContain("text-display");
        expect(title.className).not.toContain("font-beleren");
    });

    it("Auto-tap invokes autoTapForAttackTax", () => {
        render(
            <AttackManaTaxBanner
                gameId={"g1" as Id<"games">}
                playerId="me"
                payment={payment()}
            />
        );
        fireEvent.click(screen.getByText("Auto-tap"));
        expect(autoTapForAttackTax).toHaveBeenCalledWith({
            gameId: "g1",
            playerId: "me",
        });
    });

    it("Cancel invokes cancelAttackTax", () => {
        render(
            <AttackManaTaxBanner
                gameId={"g1" as Id<"games">}
                playerId="me"
                payment={payment()}
            />
        );
        fireEvent.click(screen.getByText("Cancel"));
        expect(cancelAttackTax).toHaveBeenCalledWith({
            gameId: "g1",
            playerId: "me",
        });
    });
});
