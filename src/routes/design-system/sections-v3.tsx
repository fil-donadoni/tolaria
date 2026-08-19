// Design system v3 census (ADR 0101 §2, PRD #2405, issue #2581): the token
// families that refound the system underneath the Antique Bronze identity —
// fluid type, density, pointer control heights, motion — plus the Panel v3
// anatomy that replaced the 40px corner ornament.
//
// Every value on this page is read from the typed mirror
// (`src/lib/design-tokens.ts`), which `src/__tests__/design-tokens.test.ts`
// pins to `src/index.css`. The page cannot describe a token the stylesheet no
// longer declares — which is exactly what the old hand-maintained arrays did.
import { Section, Specimen, Sub } from "./lib";
import {
    Panel,
    PanelHeader,
    PanelBody,
    PanelFooter,
} from "@/components/ui/panel";
import { Button } from "@/components/ui/button";
import {
    V3_TOKEN_GROUPS,
    DENSITY_RUNGS,
    FLUID_TYPE_TOKENS,
    CONTROL_HEIGHT_TOKENS,
    bracketTitleGapPx,
    type TokenGroup,
} from "@/lib/design-tokens";

function TokenRows({ group }: { group: TokenGroup }) {
    return (
        <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-xs">
                <thead>
                    <tr className="text-text-disabled">
                        <th className="py-1 pr-3 font-normal">token</th>
                        <th className="py-1 pr-3 font-normal">value</th>
                        <th className="py-1 font-normal">role</th>
                    </tr>
                </thead>
                <tbody>
                    {group.tokens.map((t) => (
                        <tr
                            key={t.name}
                            className="border-t border-border-subtle/40"
                        >
                            <td className="py-1.5 pr-3 font-mono text-[11px] text-accent-strong">
                                {t.name}
                            </td>
                            <td className="py-1.5 pr-3 font-mono text-[11px] break-all text-text">
                                {t.value}
                            </td>
                            <td className="py-1.5 text-[11px] text-text-muted">
                                {t.role}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

/** Live specimens: each step rendered AT its own clamp, so resizing the window
 *  shows the interpolation rather than describing it. */
function FluidTypeSpecimens() {
    return (
        <div className="flex flex-col gap-2">
            {FLUID_TYPE_TOKENS.map((t) => (
                <div key={t.name} className="flex items-baseline gap-3">
                    <span className="w-20 shrink-0 font-mono text-[10px] text-text-disabled">
                        {t.name}
                    </span>
                    <span
                        className="text-text"
                        style={{ fontSize: `var(${t.name})` }}
                    >
                        Antique Bronze — {t.role}
                    </span>
                </div>
            ))}
        </div>
    );
}

function DensitySpecimens() {
    return (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            {DENSITY_RUNGS.map((rung) => (
                <div key={rung.density}>
                    <Panel density={rung.density}>
                        <PanelHeader title={rung.density} />
                        <PanelBody>
                            <p className="text-xs text-text-muted">
                                unit {rung.unit} · padding {rung.panelPad}
                                {rung.panelPadWide
                                    ? ` → ${rung.panelPadWide} at 420px`
                                    : ""}
                            </p>
                        </PanelBody>
                        <PanelFooter>
                            <Button size="sm" variant="secondary">
                                Cancel
                            </Button>
                            <Button size="sm">Confirm</Button>
                        </PanelFooter>
                    </Panel>
                    <p className="mt-1 text-[10px] text-text-disabled">
                        {rung.replaces}
                    </p>
                </div>
            ))}
        </div>
    );
}

/** Renders the two rungs side by side at their literal heights, and marks
 *  which one the CURRENT pointer resolves to via the token itself. */
function ControlHeightSpecimens() {
    return (
        <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-end gap-3">
                {CONTROL_HEIGHT_TOKENS.filter((t) =>
                    t.value.endsWith("px")
                ).map((t) => (
                    <div key={t.name} className="text-center">
                        <div
                            className="flex w-32 items-center justify-center rounded-sm border border-border-accent/60 bg-surface-elevated text-[11px] text-text"
                            style={{ height: t.value }}
                        >
                            {t.value}
                        </div>
                        <p className="mt-1 font-mono text-[10px] text-text-disabled">
                            {t.name}
                        </p>
                    </div>
                ))}
                <div className="text-center">
                    <div className="flex w-32 items-center justify-center rounded-sm border border-accent bg-accent-soft/30 text-[11px] text-accent-strong h-[var(--control-h)]">
                        this pointer
                    </div>
                    <p className="mt-1 font-mono text-[10px] text-text-disabled">
                        --control-h
                    </p>
                </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" variant="secondary">
                    sm · --control-h-sm
                </Button>
                <Button size="default">default · --control-h</Button>
                <Button size="lg">lg · --control-h</Button>
                <span className="segment-pill segment-active">segment</span>
                <span className="segment-pill segment-inactive">segment</span>
            </div>
            <p className="text-xs text-text-muted">
                The rung is chosen by <code>@media (pointer: coarse)</code>, not
                by viewport width: a 1180px tablet in landscape is a touch
                device and a 700px desktop window is not. Icon-only buttons keep
                their glyph sizes — retargeting every board HUD glyph to a 44px
                square is a layout change, and belongs to the touch-primitives
                slice (#2583).
            </p>
            <p className="text-xs text-text-muted">
                <strong className="text-text">
                    Not yet on the rung, and why.
                </strong>{" "}
                The <code>.input-field</code> recipe (9 files) and the filter
                chips (<code>.filter-chip-active/-inactive</code>, 20-32px at
                their call sites) still size themselves. The wiring was written
                and <em>measured</em>, not skipped: putting either on the rung
                regresses the deck-builder on <code>bun run check:ui</code> —
                chips take <code>ctrlsStranded</code> 4→5 at 1440x900, 9→10 at
                820x1180 and 6→7 at 1180x820; the input recipe takes{" "}
                <code>ctrlsOcc</code> 2→3 at 844x390. Both land in the same
                clipped, non-growing zone control row, and a control stranded
                outside a pane with no scroller is worse than an undersized one.
                Deferred to #2585, which re-homes that row into a sheet /
                popover; both recipes go on the rung there, together.
            </p>
        </div>
    );
}

function PanelAnatomy() {
    const gap = bracketTitleGapPx();
    return (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Specimen label="Panel v3 — the default frame" tone="plain">
                <Panel>
                    <PanelHeader
                        title="Panel v3"
                        subtitle="title left · 1px rule"
                    />
                    <PanelBody>
                        <p className="text-xs text-text-muted">
                            Four 10px inset brackets at 1px / opacity .5. The
                            band bleeds to the panel border and the title starts
                            at <code>--panel-header-pad-x</code> from it.
                        </p>
                    </PanelBody>
                    <PanelFooter>
                        <Button size="sm" variant="secondary">
                            Cancel
                        </Button>
                        <Button size="sm">Confirm</Button>
                    </PanelFooter>
                </Panel>
            </Specimen>
            <Specimen
                label="Panel — rich ornament (opt-in, above 844x390)"
                tone="plain"
            >
                <Panel ornament tone="accent">
                    <PanelHeader title="Waiting state" />
                    <PanelBody>
                        <p className="text-xs text-text-muted">
                            The 40px filigree survives on three surfaces only —
                            lobby hero, Game Over, Match Result — behind an
                            explicit <code>ornament</code> prop, never a
                            heuristic. Below 844x390 it falls back to the
                            brackets.
                        </p>
                    </PanelBody>
                </Panel>
            </Specimen>
            <div className="lg:col-span-2">
                <p className="text-xs text-text-muted">
                    <strong className="text-text">Clearance:</strong> a title
                    never sits within{" "}
                    <code>--panel-title-bracket-clearance</code> of a bracket.
                    Title inset − (bracket inset + bracket size) ={" "}
                    <span className="font-mono text-accent-strong">
                        {gap}px
                    </span>
                    . Asserted arithmetically from the tokens in{" "}
                    <code>src/__tests__/design-tokens.test.ts</code>, never
                    geometrically: happy-dom has no layout engine, so a
                    <code> getBoundingClientRect()</code> assertion would pass
                    on a title sitting underneath the bracket.
                </p>
            </div>
        </div>
    );
}

export function V3Sections() {
    return (
        <Section
            id="v3-tokens"
            index="14"
            title="Design system v3 — tokens & Panel v3"
            blurb="ADR 0101 §2 refounds the system underneath the identity: fluid type on clamp(), a density scale, pointer-aware control heights, motion tokens, and a Panel frame sized to the screen. Values are read from the typed mirror, which the token test pins to src/index.css."
        >
            <Sub title="Fluid type" note="--t-xs … --t-2xl, 390px → 1440px">
                <Specimen label="Live specimens" tone="plain">
                    <FluidTypeSpecimens />
                </Specimen>
                <TokenRows group={V3_TOKEN_GROUPS[0]} />
            </Sub>

            <Sub
                title="Density"
                note="compact / comfortable / roomy — base units 8 / 10 / 12px"
            >
                <DensitySpecimens />
                <TokenRows group={V3_TOKEN_GROUPS[1]} />
            </Sub>

            <Sub
                title="Control heights"
                note="coarse 44 / fine 32, chosen by pointer"
            >
                <ControlHeightSpecimens />
                <TokenRows group={V3_TOKEN_GROUPS[2]} />
            </Sub>

            <Sub title="Motion" note="honours prefers-reduced-motion">
                <TokenRows group={V3_TOKEN_GROUPS[3]} />
            </Sub>

            <Sub
                title="Panel v3 anatomy"
                note="10px brackets, title left + rule"
            >
                <PanelAnatomy />
                <TokenRows group={V3_TOKEN_GROUPS[4]} />
            </Sub>
        </Section>
    );
}
