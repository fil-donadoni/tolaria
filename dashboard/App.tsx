import { useSyncExternalStore } from "react";
import { Shell } from "./components/Shell";
import { Section } from "./components/Section";
import { getView, subscribeToView } from "./lib/view";

/**
 * The dashboard's page (PRD #3148 S0 → S1).
 *
 * S0 reproduced the hand-written shell verbatim so the port could not change
 * anything. S1 replaces the CHROME — header, tabs, theme, shortcuts, the
 * framed section — with React and shadcn, and leaves the two view BODIES
 * exactly where they were: the vanilla modules under `scripts/dashboard/`
 * still fill them, still by `getElementById`, so every id below is load
 * bearing until the slice that ports its section (S2 for Now, S3 for History)
 * deletes both halves together.
 *
 * The legacy class names ride along for the same reason. `dashboard.css` is
 * unlayered and is imported after the Tailwind entry, so where the two overlap
 * the legacy rule still wins and an un-ported section looks exactly as it did.
 * Each class disappears with the module that needs it.
 */
export function App() {
    const view = useSyncExternalStore(subscribeToView, getView);
    return (
        <>
            <Shell
                view={view}
                now={
                    <Section
                        id="loop-status-card"
                        className="card"
                        title="Loop status"
                        meta={
                            <div className="h-sub" id="loop-status-sub">
                                loading…
                            </div>
                        }
                    >
                        <div id="loop-status-body" />
                    </Section>
                }
                history={
                    <>
                        <div className="filters" id="filters" />
                        <div className="tiles" id="tiles" />

                        <Section
                            className="card"
                            title="Issues"
                            meta={<div className="h-sub" id="issues-sub" />}
                        >
                            <div className="row-filters" id="issues-filters" />
                            <div className="tbl-wrap">
                                <table id="issues-tbl" />
                            </div>
                        </Section>

                        <Section
                            className="card"
                            title="Sessions"
                            meta={
                                <div className="h-sub">
                                    One row per session in range. Click a header
                                    to sort, a row for its agent runs.
                                </div>
                            }
                        >
                            <div
                                className="row-filters"
                                id="sessions-filters"
                            />
                            <div className="tbl-wrap">
                                <table id="sessions-tbl" />
                            </div>
                        </Section>

                        <Section
                            className="card"
                            title={
                                <span id="fam-title">Agent family × role</span>
                            }
                            meta={<div className="h-sub" id="fam-sub" />}
                        >
                            <div className="tbl-wrap">
                                <table id="families-tbl" />
                            </div>
                        </Section>

                        <Section
                            className="card"
                            title={<span id="ts-title">Over time</span>}
                            meta={<div className="h-sub" id="ts-sub" />}
                        >
                            <div className="scroll">
                                <svg id="ts" />
                            </div>
                            <div className="legend" id="ts-legend" />
                        </Section>

                        <Section
                            className="card"
                            title={<span id="rank-title">Ranking</span>}
                            meta={<div className="h-sub" id="rank-sub" />}
                        >
                            <div className="scroll">
                                <svg id="rank" />
                            </div>
                        </Section>

                        <Section
                            className="card"
                            title="Table"
                            meta={<div className="h-sub" id="tbl-sub" />}
                        >
                            <div className="tbl-wrap">
                                <table id="tbl" />
                            </div>
                        </Section>
                    </>
                }
            />
            {/*
                Outside the shell: the vanilla tooltip layer is `position:fixed`
                chrome, and `scripts/dashboard/tooltip.js` resolves it by id.
                It serves the `data-term` strings the un-ported views still
                paint; the React chrome uses `<Term>` and the shadcn tooltip.
                Both read `dashboard/glossary.ts`, so they cannot drift.
            */}
            <div id="tip" />
        </>
    );
}
