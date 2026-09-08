// Assertions read the DOM directly — see the note in `Term.test.tsx`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { VerdictBand } from "../VerdictBand";
import { NowSection } from "../NowSection";
import { VERDICT_TONE, verdictTone } from "../../../lib/verdict";
import { ACTION_LABEL } from "../../../lib/actions";
import { resetPendingAction } from "../../../lib/confirm";
import { resetOverlays } from "../../../lib/overlays";
import { jumpToSection, resetSectionFlash } from "../../../lib/sections";
import type { LoopVerdict, LoopVerdictState } from "../../../lib/nowPayload";

/**
 * The loop verdict band (#2624/#2630/#2636), migrated with its subject in
 * PRD #3148 S4 from `scripts/__tests__/loop-status-dashboard.test.ts`.
 *
 * #2624's point is that the dashboard is the SECOND consumer of a verdict the
 * engine derives — before it, the panel hand-concatenated `armed` / `pidAlive`
 * / `stopFilePresent` into its own health wording, two formatters of the same
 * three facts, free to disagree. So the band states the SHARED verdict and
 * nothing of its own, and that is the first case below.
 *
 * The copy affordance is the other half: a remedy is PROSE with its literals
 * in backticks, so a button wired to the whole remedy would put an English
 * sentence on the clipboard.
 */

const verdict = (over: Partial<LoopVerdict> = {}): LoopVerdict =>
    ({
        state: "STALLED",
        sentence: "No pass has finished in 3h",
        remedy: "check the driver log",
        remedyAction: null,
        findings: [],
        ...over,
    }) as LoopVerdict;

const renderBand = (v: LoopVerdict) =>
    render(
        <TooltipProvider>
            <VerdictBand verdict={v} />
        </TooltipProvider>
    );

beforeEach(() => {
    resetPendingAction();
    resetOverlays();
    resetSectionFlash();
});
afterEach(() => {
    resetPendingAction();
    resetOverlays();
    resetSectionFlash();
    vi.unstubAllGlobals();
});

describe("verdict band — it states the SHARED verdict, never its own", () => {
    it("renders the verdict's sentence, remedy and findings rather than composing anything", () => {
        renderBand(
            verdict({
                findings: [{ code: "NO_PROGRESS", detail: "queue unchanged" }],
            })
        );
        expect(screen.getByText(/No pass has finished in 3h/)).not.toBeNull();
        expect(screen.getByText(/check the driver log/)).not.toBeNull();
        expect(screen.getByText(/queue unchanged/)).not.toBeNull();
        // The raw driver facts are NOT what the band states.
        expect(screen.queryByText(/armed/)).toBeNull();
        expect(screen.queryByText(/stop-file/)).toBeNull();
    });

    it("names EVERY verdict state in its tone map, so a new state cannot ship unstyled", () => {
        // The map is a `Record<LoopVerdictState, Tone>`, so a missing state is
        // a COMPILE error — this is the runtime shadow of that, plus a
        // vacuity guard: the union really does have every state the engine
        // emits, and `dashboard-now-port.test.ts` is what checks it against
        // `LOOP_VERDICT_STATES` on the server side.
        const states: LoopVerdictState[] = [
            "NEEDS ATTENTION",
            "STALLED",
            "STOPPED",
            "RUNNING",
            "IDLE",
        ];
        for (const state of states) {
            expect(
                Object.prototype.hasOwnProperty.call(VERDICT_TONE, state),
                state
            ).toBe(true);
        }
        expect(Object.keys(VERDICT_TONE).sort()).toEqual([...states].sort());
    });

    it("falls back to the loud tone on an unknown state — an unrecognised verdict must never render as health", () => {
        // The map is a `Record` over the union, so an omission is a compile
        // error too; this is the RUNTIME half, for a payload from an engine
        // that grew a state this build does not know.
        expect(
            verdictTone("A STATE THE ENGINE GREW LATER" as LoopVerdictState)
        ).toBe("bad");
    });

    it("renders a sentence that LOOKS like markup as the literal characters it is", () => {
        renderBand(verdict({ sentence: "<img src=x onerror=alert(1)>" }));
        expect(
            screen.getByText(/<img src=x onerror=alert\(1\)>/)
        ).not.toBeNull();
        expect(document.querySelectorAll("img").length).toBe(0);
    });
});

describe("verdict band — the copy affordance copies the COMMAND, never the sentence", () => {
    it("offers one button per backticked literal, each carrying exactly that span", () => {
        renderBand(
            verdict({
                remedy: "`bun run loop:doctor` to inspect, `bun run loop:doctor --release` to drop it",
            })
        );
        expect(
            screen.getByRole("button", { name: "Copy bun run loop:doctor" })
        ).not.toBeNull();
        expect(
            screen.getByRole("button", {
                name: "Copy bun run loop:doctor --release",
            })
        ).not.toBeNull();
        // The prose around the literals is still prose.
        expect(screen.getByText(/to inspect,/)).not.toBeNull();
        // Nothing offered for copying is a sentence.
        for (const b of screen.getAllByRole("button", { name: /^Copy / })) {
            expect(b.getAttribute("aria-label")).not.toContain(" to inspect");
        }
    });

    it("offers no copy affordance for a remedy that names no command", () => {
        renderBand(verdict({ remedy: "check the driver log" }));
        expect(screen.queryByRole("button", { name: /^Copy / })).toBeNull();
    });

    it("the accessible name states exactly what the button puts on the clipboard — a backticked LABEL is not a command (PR #2837 review)", () => {
        // `REMEDY.orphans` backticks `in-progress` and `REMEDY.feed` backticks
        // `ready-for-agent`: both GitHub label names you paste into `gh`, not
        // things you run. The button may still offer them; it may not call
        // them a command.
        renderBand(
            verdict({
                remedy: "drop `in-progress` on the orphans, then label issues `ready-for-agent`",
            })
        );
        for (const literal of ["in-progress", "ready-for-agent"]) {
            const button = screen.getByRole("button", {
                name: `Copy ${literal}`,
            });
            expect(button.getAttribute("aria-label")).toBe(`Copy ${literal}`);
            expect(button.getAttribute("aria-label")).not.toContain("command");
        }
    });
});

describe("verdict band — the action button is offered only where the engine says so (#2636)", () => {
    it("renders a Stop-driver button for driver.stop, alongside the copy-command fallback", () => {
        renderBand(
            verdict({
                state: "RUNNING",
                remedy: "nothing to do — `bun run loop:afk --stop` asks the driver to stop after the current pass",
                remedyAction: "driver.stop",
            })
        );
        expect(
            screen.getByRole("button", { name: ACTION_LABEL["driver.stop"] })
        ).not.toBeNull();
        // The fallback the AC requires on a refused/failed action is not built
        // by the button — it is the copy affordance ALREADY there.
        expect(
            screen.getByRole("button", {
                name: "Copy bun run loop:afk --stop",
            })
        ).not.toBeNull();
    });

    it("renders a Resume-driver button for driver.resume", () => {
        renderBand(
            verdict({
                state: "STOPPED",
                remedy: "`bun run loop:afk --resume` clears the stop-file",
                remedyAction: "driver.resume",
            })
        );
        expect(
            screen.getByRole("button", { name: ACTION_LABEL["driver.resume"] })
        ).not.toBeNull();
    });

    it("renders NO action button when remedyAction is null — a button whose action is not currently sensible is not shown", () => {
        renderBand(
            verdict({
                state: "IDLE",
                remedy: "label issues `ready-for-agent` to give the loop work",
                remedyAction: null,
            })
        );
        expect(screen.queryByRole("button", { name: /driver/i })).toBeNull();
    });

    it("renders NO action button when remedyAction is ABSENT — a fixture predating #2636, and `undefined` must not accidentally match a lookup key", () => {
        const v = verdict({ state: "IDLE", remedy: "r" });
        delete (v as Partial<LoopVerdict>).remedyAction;
        renderBand(v);
        expect(screen.queryByRole("button", { name: /driver/i })).toBeNull();
    });

    it("renders no action button for an UNRECOGNISED remedyAction — unknown must never render as an offered action", () => {
        renderBand(
            verdict({
                state: "IDLE",
                remedy: "r",
                remedyAction:
                    "some-future-action" as LoopVerdict["remedyAction"],
            })
        );
        // NOT "no button whose name matches /driver/" — that passes against an
        // implementation that renders a button with an EMPTY label, which is
        // what this component did before S4's migration reached for the
        // vanilla case. The band offers NO action at all.
        expect(screen.queryAllByRole("button")).toEqual([]);
    });
});

describe("the landing mark is its own role (PR #2837 review)", () => {
    it("marks the jumped-to section with the FOCUS ring token, never with a state token — 'you landed here' is not a verdict", () => {
        render(
            <TooltipProvider>
                <NowSection
                    id="ls-section-driver"
                    term="section.driver"
                    title="Driver"
                >
                    body
                </NowSection>
            </TooltipProvider>
        );
        const section = document.getElementById("ls-section-driver")!;
        expect(section.className).not.toMatch(/state-(good|warn|bad|unknown)/);

        // The mark is a RING driven by the flash store — one class, one token,
        // and it cannot be confused with "I could not tell". The vanilla
        // version painted `.ls-flash` from the stylesheet and a review had to
        // check by hand that it used a highlight token rather than a state
        // one; here the class list IS the assertion.
        act(() => {
            jumpToSection("ls-section-driver");
        });
        const flashedEl = document.getElementById("ls-section-driver")!;
        expect(flashedEl.className).toContain("ring-ring");
        expect(flashedEl.className).not.toMatch(/state-/);
    });
});
