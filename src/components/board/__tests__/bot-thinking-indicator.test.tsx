// Bot "thinking" indicator (issue #113). Shows only while the bot searches and
// clears the moment it acts. See `../bot-thinking-indicator`.
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import BotThinkingIndicator from "../bot-thinking-indicator";

describe("BotThinkingIndicator (issue #113)", () => {
    it("renders nothing when the bot is not thinking", () => {
        const { container } = render(<BotThinkingIndicator thinking={false} />);
        expect(container.firstChild).toBeNull();
    });

    it("shows the indicator while the bot is thinking", () => {
        const { getByText } = render(<BotThinkingIndicator thinking={true} />);
        expect(getByText(/thinking/i)).toBeTruthy();
    });
});
