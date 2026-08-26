// Rung 5 of the bot's liveness ladder (issue #2284) — the human's manual
// exit. No dom test existed before issue #2730's v4 re-skin (bespoke
// `rounded-md border-border bg-surface shadow-lg` box → the shared `Banner`
// danger tone + `Button`). Covers the window label, the Continue action, and
// pins that it renders through `Banner` (`data-slot="banner"`).
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import BotStuckNotice from "../bot-stuck-notice";

afterEach(cleanup);

describe("BotStuckNotice (issue #2284)", () => {
    it("renders nothing when not stuck", () => {
        const { container } = render(
            <BotStuckNotice stuck={null} onResolve={() => Promise.resolve()} />
        );
        expect(container.firstChild).toBeNull();
    });

    it("names the window the AI could not act in, through the shared Banner", () => {
        const { container } = render(
            <BotStuckNotice
                stuck={{ expectedKind: "target" }}
                onResolve={() => Promise.resolve()}
            />
        );
        expect(screen.getByText(/choosing a target/)).toBeTruthy();
        expect(container.querySelector('[data-slot="banner"]')).not.toBeNull();
    });

    it("Continue game invokes onResolve", () => {
        const onResolve = vi.fn(() => Promise.resolve());
        render(
            <BotStuckNotice
                stuck={{ expectedKind: "priority" }}
                onResolve={onResolve}
            />
        );
        fireEvent.click(screen.getByText("Continue game"));
        expect(onResolve).toHaveBeenCalled();
    });
});
