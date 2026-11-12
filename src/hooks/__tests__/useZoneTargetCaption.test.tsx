// Issue #9326 — a zone viewer shows position numbers ONLY while the stack
// targets that zone; a targeted card also shows a thumbnail + stack number of
// each object targeting it.
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import type { CardInstance, Player, StackItem } from "~/types/game";
import { GameContext } from "~/hooks/useGameContext";
import { useZoneTargetCaption } from "../useZoneTargetCaption";

vi.mock("~/components/cards/card-image", () => ({
    default: () => <span data-testid="card-image" />,
}));

const card = (id: string) => ({ id, card: { id: "def" } }) as CardInstance;
const GRAVEYARD = [card("elf-1"), card("elf-2"), card("elf-3")];
const P2 = { id: "p2", name: "Opp", graveyard: GRAVEYARD, exile: [] };

const item = (id: string, targets: StackItem["targets"]) =>
    ({ id, card: { id: "def" }, targets }) as unknown as StackItem;

function Captions({ player }: { player: Player }) {
    const captionFor = useZoneTargetCaption(player, "graveyard");
    return (
        <div>
            {captionFor === undefined
                ? "no-captions"
                : player.graveyard.map((c) => (
                      <div key={c.id} data-card={c.id}>
                          {captionFor(c) as ReactNode}
                      </div>
                  ))}
        </div>
    );
}

function renderCaptions(stack: StackItem[]) {
    const value = {
        stackItems: stack,
    } as unknown as React.ContextType<typeof GameContext>;
    return render(
        <GameContext value={value}>
            <Captions player={P2 as unknown as Player} />
        </GameContext>
    );
}

describe("useZoneTargetCaption", () => {
    it("an untargeted graveyard shows no numbers", () => {
        const { container } = renderCaptions([
            item("bolt", [{ type: "player", id: "p2" }]),
        ]);
        expect(container.textContent).toBe("no-captions");
    });

    it("a targeted graveyard numbers every card; the targeted one shows each source's thumbnail and stack number", () => {
        const { container } = renderCaptions([
            item("reanimate", [
                { type: "graveyard-card", id: "elf-2", playerId: "p2" },
            ]),
            item("deathrite", [
                { type: "graveyard-card", id: "elf-2", playerId: "p2" },
            ]),
        ]);
        const at = (id: string) =>
            container.querySelector(`[data-card="${id}"]`)!;
        expect(at("elf-1").textContent).toBe("#1");
        expect(at("elf-3").textContent).toBe("#3");
        const targeted = at("elf-2");
        expect(
            Array.from(
                targeted.querySelectorAll("[data-zone-target-source]")
            ).map((s) => [
                s.getAttribute("data-zone-target-source"),
                s.textContent,
            ])
        ).toEqual([
            // 2-item stack: deathrite (top) is row #1, reanimate row #2.
            ["reanimate", "#2"],
            ["deathrite", "#1"],
        ]);
        expect(
            targeted.querySelectorAll("[data-testid='card-image']")
        ).toHaveLength(2);
        expect(targeted.textContent).toMatch(/^#2/);
    });
});
