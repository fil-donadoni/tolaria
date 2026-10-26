// The Limited setup route end to end through the real flow component (PRD
// #5383, issue #5387): rail + active step, Create live on arrival with the
// defaults, the remembered last setup, Sealed hiding the timer and disabling
// the cube, the fallback note. The rules themselves are
// `src/lib/limited/__tests__/limitedSetup.test.ts`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { DraftableSetInfo, PackSourceInfo } from "~/hooks/useLimitedEvent";
import { LIMITED_SETUP_STORAGE_KEY } from "~/lib/limited/limitedSetup";
import LimitedSetupFlow from "../limited-setup-flow";

const navigate = vi.fn();
const create = vi.fn();
const packSourcesMock = vi.fn();

vi.mock("@tanstack/react-router", () => ({
    useNavigate: () => navigate,
}));

vi.mock("~/hooks/useLimitedEvent", async (importOriginal) => {
    const actual =
        await importOriginal<typeof import("~/hooks/useLimitedEvent")>();
    return {
        ...actual,
        usePackSources: () => packSourcesMock(),
        useLimitedEventMutations: () => ({ create }),
    };
});

function source(
    key: string,
    name: string,
    over: Partial<PackSourceInfo> & { set?: Partial<DraftableSetInfo> } = {}
): PackSourceInfo {
    const { set, ...rest } = over;
    return {
        key,
        name,
        description: `About ${name}.`,
        featureCardId: null,
        draftOnly: false,
        draftable: true,
        sets: [
            {
                setCode: key,
                draftable: true,
                missingCardCount: 0,
                sheets: [{ sheetName: "common", coverage: 1, passes: true }],
                ...set,
            },
        ],
        ...rest,
    };
}

const SOURCES = [
    source("vintage-cube", "Vintage Cube", {
        draftOnly: true,
        set: { isCube: true, availableCardCount: 540, sheets: [] },
    }),
    source("lea", "Limited Edition Alpha"),
    source("ice", "Ice Age", {
        draftable: false,
        set: { draftable: false, missingCardCount: 4 },
    }),
];

const railStep = (key: string) =>
    document.querySelector<HTMLButtonElement>(`[data-setup-step="${key}"]`)!;

beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    packSourcesMock.mockReturnValue(SOURCES);
    create.mockResolvedValue("event-1");
});

afterEach(cleanup);

describe("LimitedSetupFlow (issue #5387)", () => {
    it("renders the rail with the defaults and creates the event on arrival", async () => {
        render(<LimitedSetupFlow />);
        expect(railStep("type").textContent).toContain("Draft");
        expect(railStep("packSource").textContent).toContain("Vintage Cube");
        expect(railStep("table").textContent).toContain("8 seats");

        const createButton = screen.getByRole("button", {
            name: "Create Event",
        });
        expect((createButton as HTMLButtonElement).disabled).toBe(false);
        fireEvent.click(createButton);

        await vi.waitFor(() => expect(navigate).toHaveBeenCalled());
        expect(create).toHaveBeenCalledWith({
            type: "draft",
            seatCount: 8,
            packSource: "vintage-cube",
            sealedBoosterCount: 6,
            timerEnabled: true,
            gamesFormat: "bo3",
            botDifficulty: "medium",
            roundDeadlineMinutes: undefined,
            openDecklists: false,
        });
        expect(navigate).toHaveBeenCalledWith({
            to: "/limited/$eventId",
            params: { eventId: "event-1" },
        });
    });

    it("preselects the last choices on a returning visit", () => {
        localStorage.setItem(
            LIMITED_SETUP_STORAGE_KEY,
            JSON.stringify({
                type: "sealed",
                packSource: "lea",
                seats: 4,
                gamesFormat: 1,
                boostersPerSeat: 4,
                openDecklists: true,
            })
        );
        render(<LimitedSetupFlow />);
        expect(railStep("type").textContent).toContain("Sealed");
        expect(railStep("packSource").textContent).toContain(
            "Limited Edition Alpha"
        );
        expect(railStep("table").textContent).toContain("4 seats");
        expect(railStep("table").textContent).toContain("Bo1");
    });

    it("remembers a change for the next visit", () => {
        render(<LimitedSetupFlow />);
        fireEvent.click(screen.getByRole("button", { name: /^Sealed/ }));
        const saved = JSON.parse(
            localStorage.getItem(LIMITED_SETUP_STORAGE_KEY) ?? "{}"
        );
        expect(saved).toMatchObject({ type: "sealed", packSource: "lea" });
    });

    it("loads past a corrupt store", () => {
        localStorage.setItem(LIMITED_SETUP_STORAGE_KEY, "{not json");
        render(<LimitedSetupFlow />);
        expect(railStep("type").textContent).toContain("Draft");
    });

    it("falls back from a stored source that is no longer draftable, with a note", () => {
        localStorage.setItem(
            LIMITED_SETUP_STORAGE_KEY,
            JSON.stringify({ packSource: "ice" })
        );
        render(<LimitedSetupFlow />);
        fireEvent.click(railStep("packSource"));
        expect(railStep("packSource").textContent).toContain("Vintage Cube");
        expect(
            screen.getByText(/Ice Age is no longer draftable/).textContent
        ).toContain("Vintage Cube is selected instead");
    });

    it("Sealed disables the cube with its reason and hides the pick timer", () => {
        render(<LimitedSetupFlow />);
        fireEvent.click(screen.getByRole("button", { name: /^Sealed/ }));
        fireEvent.click(railStep("packSource"));
        const cube = document.querySelector<HTMLButtonElement>(
            '[data-pack-source-thumb="vintage-cube"]'
        )!;
        expect(cube.disabled).toBe(true);
        expect(cube.textContent).toContain("Draft only");

        fireEvent.click(railStep("table"));
        expect(
            screen.queryByRole("radiogroup", { name: "Pick Timer" })
        ).toBeNull();
        expect(screen.getByText("Boosters per Seat")).toBeTruthy();
    });

    it("shows the Pack Source hero and steps with next", () => {
        render(<LimitedSetupFlow />);
        fireEvent.click(railStep("packSource"));
        expect(
            document.querySelector("[data-pack-source-hero]")?.textContent
        ).toContain("Vintage Cube");
        fireEvent.click(
            screen.getByRole("button", { name: "Next Pack Source" })
        );
        expect(
            document.querySelector("[data-pack-source-hero]")?.textContent
        ).toContain("Limited Edition Alpha");
        expect(
            document.querySelector("[data-pack-source-hero]")?.textContent
        ).toContain("100% implemented");
    });

    it("a Type pick opens Pack Source; a thumbnail pick opens Table (issue #5934)", () => {
        render(<LimitedSetupFlow />);
        const title = () =>
            document.querySelector('[data-slot="panel-title"]')?.textContent;
        expect(title()).toBe("Type");
        fireEvent.click(screen.getByRole("button", { name: /^Sealed/ }));
        expect(title()).toBe("Pack Source");
        fireEvent.click(
            screen.getByRole("button", { name: "Next Pack Source" })
        );
        expect(title()).toBe("Pack Source");
        fireEvent.click(
            document.querySelector('[data-pack-source-thumb="lea"]')!
        );
        expect(title()).toBe("Table");
    });

    it("re-opening a step advances to the one after it; the last step has no Next", () => {
        render(<LimitedSetupFlow />);
        const title = () =>
            document.querySelector('[data-slot="panel-title"]')?.textContent;
        fireEvent.click(railStep("table"));
        expect(screen.queryByRole("button", { name: "Next" })).toBeNull();
        fireEvent.click(railStep("type"));
        fireEvent.click(screen.getByRole("button", { name: /^Draft/ }));
        expect(title()).toBe("Pack Source");
    });

    it("shows the failure and re-enables Create when the mutation fails", async () => {
        create.mockRejectedValueOnce(new Error("boom"));
        render(<LimitedSetupFlow />);
        fireEvent.click(screen.getByRole("button", { name: "Create Event" }));
        await vi.waitFor(() =>
            expect(screen.getByRole("alert").textContent).toContain("boom")
        );
        expect(
            (
                screen.getByRole("button", {
                    name: "Create Event",
                }) as HTMLButtonElement
            ).disabled
        ).toBe(false);
    });
});

describe("LimitedSetupFlow — number fields (issue #5387 review)", () => {
    it("lets the seat count be cleared and retyped without snapping mid-keystroke", () => {
        render(<LimitedSetupFlow />);
        fireEvent.click(railStep("table"));
        const seats = screen.getByLabelText(/^Seats/) as HTMLInputElement;
        fireEvent.change(seats, { target: { value: "" } });
        expect(seats.value).toBe("");
        fireEvent.change(seats, { target: { value: "5" } });
        expect(seats.value).toBe("5");
        expect(railStep("table").textContent).toContain("5 seats");
    });

    it("clamps an out-of-range seat count when leaving the field", () => {
        render(<LimitedSetupFlow />);
        fireEvent.click(railStep("table"));
        const seats = screen.getByLabelText(/^Seats/) as HTMLInputElement;
        fireEvent.change(seats, { target: { value: "26" } });
        expect(seats.value).toBe("26");
        fireEvent.blur(seats);
        expect(seats.value).toBe("8");
    });
});
