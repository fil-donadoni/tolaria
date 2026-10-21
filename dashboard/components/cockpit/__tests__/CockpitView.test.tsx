// Assertions read the DOM directly rather than through jest-dom's matchers —
// the project's tsconfig does not pick up jest-dom's type augmentation (same
// workaround as `components/__tests__/Term.test.tsx`).
import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { CockpitView } from "../CockpitView";
import { readCockpit } from "../../../lib/cockpit";
import { fixtureReading } from "./fixture";

/**
 * The cockpit's page (issue #5652): every panel populated from one reading,
 * and a source the reading lacks shown as missing — never as an empty panel
 * that reads as "nothing happened".
 */

const section = (id: string) => {
    const el = document.getElementById(id);
    if (!el) throw new Error(`no #${id} on the page`);
    return within(el);
};

describe("CockpitView — one page of trends", () => {
    it("renders every panel, each with its figures", () => {
        render(
            <CockpitView
                state={{ status: "ready", reading: fixtureReading() }}
            />
        );
        const headings = screen
            .getAllByRole("heading", { level: 2 })
            .map((h) => h.textContent);
        expect(headings).toEqual([
            "Throughput",
            "Failed landings",
            "RED episodes",
            "Cost per issue",
            "Latency",
            "Flaky tests",
            "Machines",
            "Runners",
        ]);
        // Throughput and the drain forecast: 441 ready at 47.5 closed a day.
        expect(section("throughput").getByText("441")).toBeTruthy();
        expect(section("throughput").getByText("9.3")).toBeTruthy();
        expect(section("throughput").getByText("+45")).toBeTruthy();
        // Failed landings: every cause a row, the recorded rebase episode.
        const causes = within(
            section("landings").getByRole("table", {
                name: "Failed landings by cause",
            })
        );
        expect(causes.getAllByRole("row")).toHaveLength(1 + 7);
        expect(
            causes.getByText("rebase conflict").closest("tr")!.textContent
        ).toBe("rebase conflict1");
        // RED: the recorded episodes and the owner-free share.
        expect(section("red").getByText("67 %")).toBeTruthy();
        // Cost: per model tier and per area.
        expect(section("cost").getByText("sonnet")).toBeTruthy();
        expect(section("cost").getByText("workflow")).toBeTruthy();
        expect(section("cost").getByText("(none)")).toBeTruthy();
        // Machines: both, this one marked.
        expect(
            section("machines").getByText("filippos-macbook-pro (this one)")
        ).toBeTruthy();
        // Runners: the recorded seven, one idle.
        expect(section("runners").getByText("macbook-seed-1")).toBeTruthy();
        expect(
            section("runners").getByText("6 busy", { exact: false })
        ).toBeTruthy();
        // The header says what the reading covers.
        expect(
            screen.getByText(
                "read 2026-10-20 10:30 UTC · window 2026-10-18 → 2026-10-20 · this machine: filippos-macbook-pro"
            )
        ).toBeTruthy();
    });

    it("draws each daily series with its figures in its accessible name", () => {
        render(
            <CockpitView
                state={{ status: "ready", reading: fixtureReading() }}
            />
        );
        const chart = section("cost").getByRole("img");
        expect(chart.getAttribute("aria-label")).toBe(
            "Pass cost by day: 10-18 $0.00, 10-19 $6.75, 10-20 $0.00"
        );
    });

    it("names what a reading could not read, and still shows the rest", () => {
        render(
            <CockpitView
                state={{
                    status: "ready",
                    reading: fixtureReading({
                        trends: null,
                        errors: ["GitHub could not be read: HTTP 502"],
                    }),
                }}
            />
        );
        expect(
            screen.getByText("GitHub could not be read: HTTP 502")
        ).toBeTruthy();
        expect(screen.getByText("GitHub could not be read")).toBeTruthy();
        expect(screen.queryByText("Throughput")).toBeNull();
        expect(document.getElementById("runners")).not.toBeNull();
    });

    it("a missing runner list is a banner, not an empty table", () => {
        render(
            <CockpitView
                state={{
                    status: "ready",
                    reading: fixtureReading({ runners: null }),
                }}
            />
        );
        expect(document.getElementById("runners")).toBeNull();
        expect(
            screen.getByText("GitHub's runner list could not be read")
        ).toBeTruthy();
    });

    it("no reading at all says why", () => {
        render(
            <CockpitView
                state={{
                    status: "failed",
                    reason: "no cockpit reading yet — run: bun run cockpit",
                }}
            />
        );
        expect(
            screen.getByText("no cockpit reading yet — run: bun run cockpit")
        ).toBeTruthy();
    });
});

describe("readCockpit — the page's one read", () => {
    const answer = (status: number, body: string) => async () =>
        new Response(body, { status });

    it("a reading of its version is ready", async () => {
        const body = JSON.stringify(fixtureReading());
        const s = await readCockpit(answer(200, body) as typeof fetch);
        expect(s.status).toBe("ready");
    });

    it("the server's own reason, a foreign version, a dead server: each a failure that says so", async () => {
        await expect(
            readCockpit(
                answer(
                    503,
                    JSON.stringify({
                        error: "no cockpit reading yet — run: bun run cockpit",
                    })
                ) as typeof fetch
            )
        ).resolves.toEqual({
            status: "failed",
            reason: "no cockpit reading yet — run: bun run cockpit",
        });
        const foreign = await readCockpit(
            answer(200, JSON.stringify({ version: 9 })) as typeof fetch
        );
        expect(foreign).toMatchObject({ status: "failed" });
        const dead = await readCockpit((async () => {
            throw new TypeError("Failed to fetch");
        }) as typeof fetch);
        expect(dead).toMatchObject({ status: "failed" });
    });
});
