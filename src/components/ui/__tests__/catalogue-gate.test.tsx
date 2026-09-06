import { describe, it, expect, vi, afterEach } from "vitest";
import {
    render,
    screen,
    cleanup,
    waitFor,
    fireEvent,
} from "@testing-library/react";

const hydrateCatalogue = vi.fn<() => Promise<number>>();
vi.mock("@/lib/catalogueArtifact", () => ({ hydrateCatalogue }));

const { default: CatalogueGate } = await import("../catalogue-gate");

/**
 * The loading gate (issue #3053, ADR 0113 §3).
 *
 * The acceptance criterion it stands for is "a cold load renders nothing that
 * reads the registry before hydration completes". That is a claim about what
 * is in the DOM, so it is asserted on the DOM: the children must not be
 * MOUNTED while the promise is pending — rendering them hidden, or rendering
 * them and patching up afterwards, would both satisfy a weaker assertion and
 * both would call `getDefinition` against a half-empty registry.
 */
afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

const CHILD = <p>catalogue consumer</p>;

describe("CatalogueGate", () => {
    it("mounts nothing that reads the registry while the fetch is pending", () => {
        hydrateCatalogue.mockReturnValue(new Promise(() => {}));

        render(<CatalogueGate>{CHILD}</CatalogueGate>);

        expect(screen.queryByText("catalogue consumer")).toBeNull();
        expect(screen.getByText("Loading cards...")).toBeTruthy();
    });

    it("renders its children once the registry is hydrated", async () => {
        hydrateCatalogue.mockResolvedValue(2278);

        render(<CatalogueGate>{CHILD}</CatalogueGate>);

        await waitFor(() =>
            expect(screen.getByText("catalogue consumer")).toBeTruthy()
        );
        expect(screen.queryByText("Loading cards...")).toBeNull();
    });

    it("names a failure and re-fetches on retry, instead of a white screen", async () => {
        hydrateCatalogue.mockRejectedValueOnce(new Error("HTTP 503"));
        render(<CatalogueGate>{CHILD}</CatalogueGate>);

        await waitFor(() => expect(screen.getByText("HTTP 503")).toBeTruthy());
        expect(screen.queryByText("catalogue consumer")).toBeNull();

        hydrateCatalogue.mockResolvedValueOnce(2278);
        fireEvent.click(screen.getByRole("button", { name: "Retry" }));

        await waitFor(() =>
            expect(screen.getByText("catalogue consumer")).toBeTruthy()
        );
        expect(hydrateCatalogue).toHaveBeenCalledTimes(2);
    });
});
