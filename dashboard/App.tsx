import { useSyncExternalStore } from "react";
import { Shell } from "./components/Shell";
import { Section } from "./components/Section";
import { ShortcutsSheet } from "./components/ShortcutsSheet";
import { NowView } from "./components/now/NowView";
import { getView, subscribeToView } from "./lib/view";
import { useShortcuts } from "./lib/shortcuts";

/**
 * The dashboard's page (PRD #3148 S0 → S2).
 *
 * S0 reproduced the hand-written shell verbatim so the port could not change
 * anything. S1 replaced the CHROME — header, tabs, theme, the framed section.
 * S2 replaces the NOW view outright: `<NowView>` owns its own transport, so
 * `scripts/dashboard/main.js` no longer starts a loop-status poll and no
 * `getElementById` handle survives on that half.
 *
 * HISTORY is still the vanilla graph, still filled by `getElementById`, so
 * every id in that branch below is load bearing until S3 ports it. The legacy
 * class names ride along for the same reason: `dashboard.css` is unlayered and
 * is imported after the Tailwind entry, so where the two overlap the legacy
 * rule still wins and an un-ported section looks exactly as it did. Each class
 * disappears with the module that needs it.
 */
export function App() {
    const view = useSyncExternalStore(subscribeToView, getView);
    useShortcuts();
    return (
        <>
            <Shell
                view={view}
                now={<NowView />}
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
            <ShortcutsSheet />

            {/*
                Outside the shell: the vanilla tooltip layer is `position:fixed`
                chrome, and `scripts/dashboard/tooltip.js` resolves it by id.
                It serves the `data-term` strings HISTORY still paints; every
                React surface uses `<Term>` / `<DynamicTerm>` and the shadcn
                tooltip. Both read `dashboard/glossary.ts`, so they cannot
                drift. This element dies with S3.
            */}
            <div id="tip" />
        </>
    );
}
