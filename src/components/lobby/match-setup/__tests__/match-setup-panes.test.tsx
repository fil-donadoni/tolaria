// The recap rail's wiring (PRD #5334 stories 16–18, issue #5340): steps ahead
// of the first unanswered one are disabled, and an answered step re-opens on
// click. The step rules themselves are `src/lib/__tests__/matchSetup.test.ts`.
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { EMPTY_SETUP, applyChange, type MatchSetup } from "~/lib/matchSetup";
import MatchSetupPanes from "../match-setup-panes";

function Harness({ initial }: { initial: MatchSetup }) {
    const [setup, setSetup] = useState(initial);
    return (
        <MatchSetupPanes
            setup={setup}
            tables={[]}
            decks={[]}
            onChange={(patch) => setSetup((s) => applyChange(s, patch, []))}
            canStart={false}
            busy={false}
            error={null}
            onStart={() => {}}
        />
    );
}

const railStep = (key: string) =>
    document.querySelector<HTMLButtonElement>(`[data-setup-step="${key}"]`)!;

const activeTitle = () =>
    document.querySelector('[data-slot="panel-title"]')?.textContent;

describe("MatchSetupPanes — the recap rail (issue #5340)", () => {
    it("disables every step ahead of the first unanswered one", () => {
        render(<Harness initial={{ ...EMPTY_SETUP, mode: "arena" }} />);
        expect(railStep("mode").disabled).toBe(false);
        expect(railStep("opponent").disabled).toBe(false);
        expect(railStep("format").disabled).toBe(true);
        expect(railStep("myDeck").disabled).toBe(true);
        expect(activeTitle()).toBe("Opponent");
    });

    it("answering a step opens the next one and enables it in the rail", () => {
        render(<Harness initial={{ ...EMPTY_SETUP, mode: "arena" }} />);
        fireEvent.click(screen.getByRole("button", { name: /^Bot/ }));
        expect(activeTitle()).toBe("Match Format");
        expect(railStep("format").disabled).toBe(false);
        expect(railStep("myDeck").disabled).toBe(true);
    });

    it("re-opens an answered step on click, then returns to the one after it", () => {
        render(
            <Harness
                initial={{ ...EMPTY_SETUP, mode: "arena", opponent: "bot" }}
            />
        );
        expect(activeTitle()).toBe("Match Format");
        fireEvent.click(railStep("mode"));
        expect(activeTitle()).toBe("Game mode");
        expect(railStep("mode").getAttribute("aria-current")).toBe("step");
        expect(
            screen
                .getByRole("button", { name: /^Arena/ })
                .getAttribute("aria-pressed")
        ).toBe("true");
        fireEvent.click(screen.getByRole("button", { name: /^Arena/ }));
        expect(activeTitle()).toBe("Opponent");
    });
});

describe("MatchSetupPanes — advancing (issue #5934)", () => {
    it("a single-control choice opens the next step", () => {
        render(<Harness initial={EMPTY_SETUP} />);
        fireEvent.click(screen.getByRole("button", { name: /^Arena/ }));
        expect(activeTitle()).toBe("Opponent");
    });

    it("a multi-control step stays put; Next is disabled until answered", () => {
        render(
            <Harness
                initial={{ ...EMPTY_SETUP, mode: "arena", opponent: "solo" }}
            />
        );
        expect(activeTitle()).toBe("Match Format");
        const next = () => screen.getByRole("button", { name: "Next" });
        expect((next() as HTMLButtonElement).disabled).toBe(true);
        fireEvent.click(screen.getByRole("radio", { name: "Bo3" }));
        expect(activeTitle()).toBe("Match Format");
        fireEvent.click(screen.getByRole("button", { name: /^Alpha/ }));
        expect(activeTitle()).toBe("Match Format");
        expect((next() as HTMLButtonElement).disabled).toBe(false);
        fireEvent.click(next());
        expect(activeTitle()).toBe("Your deck");
        expect(screen.queryByRole("button", { name: "Next" })).toBeNull();
    });

    it("a re-opened step advances to the one after it, not the first open", () => {
        render(
            <Harness
                initial={{
                    ...EMPTY_SETUP,
                    mode: "arena",
                    opponent: "bot",
                    matchFormat: "alpha-40",
                }}
            />
        );
        expect(activeTitle()).toBe("Your deck");
        fireEvent.click(railStep("mode"));
        fireEvent.click(screen.getByRole("button", { name: /^Arena/ }));
        expect(activeTitle()).toBe("Opponent");
    });
});
