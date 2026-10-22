// The Join and Cockatrice branches' wiring (PRD #5334 stories 21, 27–28,
// issue #5342): Bot is disabled with its reason in Cockatrice, the table list
// shows only the chosen game mode's tables, and join by code is reachable from
// the flow. The branch rules are `src/lib/__tests__/matchSetup.test.ts`.
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import {
    EMPTY_SETUP,
    applyChange,
    type MatchSetup,
    type OpenTable,
} from "~/lib/matchSetup";
import MatchSetupPanes from "../match-setup-panes";

const TABLES: OpenTable[] = [
    {
        _id: "arena-1",
        name: "Arena table",
        matchFormat: "premodern",
        bestOf: 3,
        players: [{ name: "Ada" }],
    },
    {
        _id: "manual-1",
        name: "Cockatrice table",
        mode: "manual",
        matchFormat: "manual",
        bestOf: 1,
        players: [{ name: "Bo" }],
    },
];

function Harness({ initial }: { initial: MatchSetup }) {
    const [setup, setSetup] = useState(initial);
    return (
        <MatchSetupPanes
            setup={setup}
            decks={[]}
            tables={TABLES}
            onChange={(patch) => setSetup((s) => applyChange(s, patch, []))}
            canStart={false}
            busy={false}
            error={null}
            onStart={() => {}}
        />
    );
}

const activeTitle = () =>
    document.querySelector('[data-slot="panel-title"]')?.textContent;

const joining: MatchSetup = {
    ...EMPTY_SETUP,
    mode: "arena",
    opponent: "join",
};

describe("Cockatrice branch", () => {
    it("disables Bot with its reason", () => {
        render(<Harness initial={{ ...EMPTY_SETUP, mode: "cockatrice" }} />);
        const bot = screen.getByRole("button", { name: /^Bot/ });
        expect((bot as HTMLButtonElement).disabled).toBe(true);
        expect(bot.textContent).toMatch(/cannot play Manual decks/);
    });
});

describe("Join branch", () => {
    it("opens on the table step, skipping the Match Format step", () => {
        render(<Harness initial={joining} />);
        expect(activeTitle()).toBe("Table");
        expect(document.querySelector('[data-setup-step="format"]')).toBeNull();
    });

    it("lists only the chosen mode's tables, with their formats", () => {
        render(<Harness initial={joining} />);
        const list = document.querySelector("[data-open-tables]")!;
        expect(list.textContent).toContain("Arena table");
        expect(list.textContent).toContain("Premodern");
        expect(list.textContent).toContain("Bo3");
        expect(list.textContent).not.toContain("Cockatrice table");
    });

    it("lists the Manual tables in Cockatrice, and offers no code", () => {
        render(<Harness initial={{ ...joining, mode: "cockatrice" }} />);
        const list = document.querySelector("[data-open-tables]")!;
        expect(list.textContent).toContain("Cockatrice table");
        expect(list.textContent).not.toContain("Arena table");
        expect(
            screen.queryByRole("button", { name: "Join by code" })
        ).toBeNull();
    });

    it("picking a table moves on to the deck step", () => {
        render(<Harness initial={joining} />);
        fireEvent.click(screen.getByRole("button", { name: /Arena table/ }));
        expect(activeTitle()).toBe("Your deck");
    });

    it("join by code keeps the code; Next moves on to the deck step (issue #5934)", async () => {
        render(<Harness initial={joining} />);
        fireEvent.click(screen.getByRole("button", { name: "Join by code" }));
        fireEvent.change(screen.getByLabelText("Join code"), {
            target: { value: "abc-123" },
        });
        fireEvent.click(screen.getByRole("button", { name: "Use code" }));
        await screen.findByText(/Code ABC123/);
        expect(activeTitle()).toBe("Table");
        fireEvent.click(screen.getByRole("button", { name: "Next" }));
        expect(activeTitle()).toBe("Your deck");
    });
});
