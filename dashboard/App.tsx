/**
 * The dashboard shell, as the React tree that replaces
 * `scripts/telemetry-dashboard.html` (ADR 0117).
 *
 * S0 of PRD #3148 is the BUILD seam and nothing else: this component renders
 * the exact markup the hand-written shell rendered — same ids, same classes,
 * same ARIA wiring — because the vanilla modules under `scripts/dashboard/`
 * still attach to it by `getElementById`. Every id below is therefore load
 * bearing until the slice that ports its section (S2 for Now, S3 for History)
 * deletes both halves together.
 *
 * That is what makes this a strangler rather than a rewrite: at every commit
 * the page is a React tree, and at every commit it behaves exactly as it did.
 */
export function App() {
    return (
        <>
            <div className="wrap">
                <header>
                    <h1>Tolaria telemetry</h1>
                    <span className="sub" id="meta-line">
                        loading…
                    </span>
                    {/*
                        #2635 — the only affordance that makes the keyboard
                        layer discoverable without already knowing `?` opens it.
                    */}
                    <button
                        className="shortcuts-btn"
                        id="shortcuts-btn"
                        type="button"
                        aria-haspopup="dialog"
                    >
                        Keyboard shortcuts
                    </button>
                    <button className="theme" id="theme">
                        theme
                    </button>
                </header>

                {/*
                    Two explicit modes. Now is operations and reads only
                    /api/loop-status (no database); History is analysis and
                    reads the telemetry store. The active one lives in ?view=.
                */}
                <nav
                    className="tabs"
                    role="tablist"
                    aria-label="Dashboard view"
                >
                    <button
                        className="tab"
                        id="tab-now"
                        type="button"
                        role="tab"
                        data-view="now"
                        aria-controls="view-now"
                        aria-selected="true"
                    >
                        Now
                    </button>
                    <button
                        className="tab"
                        id="tab-history"
                        type="button"
                        role="tab"
                        data-view="history"
                        aria-controls="view-history"
                        aria-selected="false"
                    >
                        History
                    </button>
                </nav>

                <div
                    className="view"
                    id="view-now"
                    role="tabpanel"
                    aria-labelledby="tab-now"
                >
                    <section className="card" id="loop-status-card">
                        <h2>Loop status</h2>
                        <div className="h-sub" id="loop-status-sub">
                            loading…
                        </div>
                        <div id="loop-status-body" />
                    </section>
                </div>

                <div
                    className="view"
                    id="view-history"
                    role="tabpanel"
                    aria-labelledby="tab-history"
                    hidden
                >
                    <div className="filters" id="filters" />
                    <div className="tiles" id="tiles" />

                    <section className="card">
                        <h2>Issues</h2>
                        <div className="h-sub" id="issues-sub" />
                        <div className="row-filters" id="issues-filters" />
                        <div className="tbl-wrap">
                            <table id="issues-tbl" />
                        </div>
                    </section>

                    <section className="card">
                        <h2>Sessions</h2>
                        <div className="h-sub">
                            One row per session in range. Click a header to
                            sort, a row for its agent runs.
                        </div>
                        <div className="row-filters" id="sessions-filters" />
                        <div className="tbl-wrap">
                            <table id="sessions-tbl" />
                        </div>
                    </section>

                    <section className="card">
                        <h2 id="fam-title">Agent family × role</h2>
                        <div className="h-sub" id="fam-sub" />
                        <div className="tbl-wrap">
                            <table id="families-tbl" />
                        </div>
                    </section>

                    <section className="card">
                        <h2 id="ts-title">Over time</h2>
                        <div className="h-sub" id="ts-sub" />
                        <div className="scroll">
                            <svg id="ts" />
                        </div>
                        <div className="legend" id="ts-legend" />
                    </section>

                    <section className="card">
                        <h2 id="rank-title">Ranking</h2>
                        <div className="h-sub" id="rank-sub" />
                        <div className="scroll">
                            <svg id="rank" />
                        </div>
                    </section>

                    <section className="card">
                        <h2>Table</h2>
                        <div className="h-sub" id="tbl-sub" />
                        <div className="tbl-wrap">
                            <table id="tbl" />
                        </div>
                    </section>
                </div>
            </div>
            {/* Outside both views: the tooltip layer is position:fixed chrome. */}
            <div id="tip" />
        </>
    );
}
