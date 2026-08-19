import * as React from "react";
import { ChevronUp, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import CornerFiligreeFrame from "./corner-filigree-frame";
import CornerBracketFrame from "./corner-bracket-frame";
import SunburstIcon from "./sunburst-icon";
import SubtitleFlourish from "./subtitle-flourish";

type PanelSize = "default" | "wide" | "full";
type PanelTone = "neutral" | "accent";

/** Density scale v3 (ADR 0101 §2, issue #2581). Three rungs with base units
 *  8 / 10 / 12px, exposed as `--density-unit` / `--panel-pad` by the
 *  `[data-density]` rules in `src/index.css`.
 *
 *  This SUBSUMES the v2 enum (`default` / `compact` / `compact-mobile`) rather
 *  than sitting beside it — two density scales in one system is how 41 render
 *  sites reflow while every test stays green. The rename is 1:1 and rendered
 *  padding is unchanged at every rung:
 *
 *    v2 "default"        → `roomy`        p-6 (24px), still the prop default
 *    v2 "compact"        → `compact`      p-2 (8px), the banner/picker rung
 *    v2 "compact-mobile" → `comfortable`  p-3 below 420px, p-6 at/above it
 *
 *  `comfortable` is the phone-aware rung (issue #1817): the pile browser and
 *  the manual peek dialog need the extra grid width below 420px and the full
 *  padding above it. See `PILE_GRID_COMPACT_BREAKPOINT_PX`
 *  (`src/lib/card-layout.ts`) for the breakpoint it must stay in sync with.
 *
 *  **1:1 is a claim about PADDING, not about the whole Panel.** The internal
 *  rhythm changes on purpose, and it does reflow every Panel by a few pixels:
 *  `PanelBody`/`PanelFooter` top margin `mt-4` (a flat 16px) becomes
 *  `calc(--density-unit * 1.5)` = 12 / 15 / 18px; `PanelBody`'s `gap-3` (12px)
 *  becomes `var(--density-unit)` = 8 / 10 / 12px; and the header band trades
 *  `-mx-2 sm:-mx-4` / `px-3` / `py-2` for `-mx-[--panel-pad]` /
 *  `px-[--panel-header-pad-x]` (20px, the bracket-clearance invariant) /
 *  `py-[calc(--density-unit * 0.8)]`. Deliberate v3 changes — the point is
 *  that they are density-derived rather than hard-coded — but not "no
 *  reflow". */
type PanelDensity = "compact" | "comfortable" | "roomy";

const SIZE_CLASSES: Record<PanelSize, string> = {
    default: "",
    wide: "max-w-[90vw]",
    full: "w-full",
};

/**
 * Shared panel — the single chrome frame (ADR 0007 / ADR 0101 §2), composition
 * API (`Panel` + `PanelHeader` / `PanelBody` / `PanelFooter`).
 *
 * Physical look (issue #595): a layered OPAQUE bezel (`.panel-physical` — inner
 * gold hairline, even/symmetric inner shade, drop shadow; no asymmetric
 * fake-3D).
 *
 * v3 frame (issue #2581): four **10px inset brackets** at 1px / opacity .5,
 * replacing the 40px SVG corner filigree the viewport audit measured
 * overlapping dialog titles. The filigree survives ONLY where a caller opts
 * back in with `ornament` — an explicit prop, never a heuristic, so a Panel
 * that says nothing gets v3.
 *
 * `overlay` mode renders ONLY the frame, stretched `inset-0` to the nearest
 * positioned ancestor, so an already-built `relative` panel can be framed
 * without re-wrapping it (and without the zero-height collapse a self-sizing
 * wrapper would cause).
 */
function Panel({
    size = "default",
    tone = "neutral",
    density = "roomy",
    ornament = false,
    overlay = false,
    className,
    children,
}: {
    size?: PanelSize;
    tone?: PanelTone;
    density?: PanelDensity;
    /** Opt in to the rich 40px corner filigree instead of the v3 brackets.
     *  ADR 0101 §2 allows it only in waiting states — the lobby hero, Game
     *  Over and Match Result — and only above 844x390, so the ornament is
     *  additionally gated to non-phone viewports and the brackets take over
     *  below that. Explicit opt-in by design: inferring "is this the lobby?"
     *  from context is how an ornament rule quietly grows exceptions. */
    ornament?: boolean;
    overlay?: boolean;
    className?: string;
    children?: React.ReactNode;
}) {
    const frame = ornament ? (
        <>
            {/* Above 844x390 the rich ornament; at or below it the v3
                brackets. `compact-chrome` is the existing phone-shaped
                variant (portrait <768px OR landscape <=500px tall) — the same
                pair of queries `useViewportMode()` discriminates on. */}
            <CornerFiligreeFrame
                overlay
                className="z-[1] compact-chrome:hidden"
            />
            <CornerBracketFrame className="z-[1] hidden compact-chrome:block" />
        </>
    ) : (
        // `z-[1]`: the frame is rendered BEFORE `children`, and PanelHeader's
        // band now bleeds to the panel border — without a rung the top two
        // corners paint underneath it. Decorative and `pointer-events-none`,
        // so it steals nothing.
        <CornerBracketFrame className="z-[1]" />
    );

    if (overlay) return frame;

    return (
        <div
            data-slot="panel"
            data-density={density}
            className={cn(
                "panel-physical relative rounded-md border p-[var(--panel-pad)] text-text select-none",
                tone === "accent" ? "border-accent/40" : "border-border-subtle",
                SIZE_CLASSES[size],
                className
            )}
        >
            {frame}
            {children}
        </div>
    );
}

/**
 * Engraved header band (v3, ADR 0101 §2): small-caps Beleren title on the
 * LEFT over a darker full-bleed band, a 1px gold rule beneath, optional
 * leading sunburst icon, optional subtitle (clasp-flanked), and an optional
 * collapse chevron pinned right.
 *
 * The band bleeds to the panel border by cancelling `--panel-pad`, and the
 * title starts at `--panel-header-pad-x` measured FROM THAT BORDER — which is
 * exactly the quantity the bracket-clearance guard in `design-tokens.test.ts`
 * compares against the bracket reach. v2 centred the title over a band inset
 * by a hard-coded `-mx-4` regardless of density, which is how the 40px
 * ornament came to overlap dialog titles in the first place.
 */
function PanelHeader({
    title,
    subtitle,
    icon,
    collapsible = false,
    collapsed = false,
    onToggleCollapse,
    titleId,
    className,
}: {
    title: React.ReactNode;
    subtitle?: React.ReactNode;
    icon?: React.ReactNode;
    collapsible?: boolean;
    collapsed?: boolean;
    onToggleCollapse?: () => void;
    /** Render the title element with this id (e.g. for DialogTitle wiring). */
    titleId?: string;
    className?: string;
}) {
    return (
        <div
            data-slot="panel-header"
            className={cn(
                "flex gap-4 sm:gap-6",
                icon ? "flex-col items-center sm:flex-row" : "flex-col",
                className
            )}
        >
            {icon && <SunburstIcon>{icon}</SunburstIcon>}

            <div className="flex w-full min-w-0 flex-1 flex-col">
                <div className="panel-header-band relative -mx-[var(--panel-pad)] -mt-[var(--panel-pad)] flex items-center justify-between gap-2 rounded-t-md px-[var(--panel-header-pad-x)] py-[calc(var(--density-unit)*0.8)]">
                    <h2
                        id={titleId}
                        data-slot="panel-title"
                        className="heading-panel min-w-0 flex-1 text-left text-[length:var(--t-lg)] tracking-[0.16em] uppercase"
                    >
                        {title}
                    </h2>
                    {collapsible && (
                        <button
                            type="button"
                            onClick={onToggleCollapse}
                            aria-label={collapsed ? "Expand" : "Collapse"}
                            aria-expanded={!collapsed}
                            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-sm border border-border-accent/60 text-text-muted transition-colors hover:text-accent-strong"
                        >
                            {collapsed ? (
                                <ChevronDown className="h-3 w-3" />
                            ) : (
                                <ChevronUp className="h-3 w-3" />
                            )}
                        </button>
                    )}
                    {/* 1px gold rule under the band (v3: no diamond node — the
                        centred node contradicts a left-aligned title). */}
                    <span className="panel-rule absolute bottom-0 left-0 h-px w-full" />
                </div>

                {subtitle && (
                    <div className="mt-3 flex items-center gap-2 text-sm text-text-muted">
                        <SubtitleFlourish side="left" />
                        <span>{subtitle}</span>
                        <SubtitleFlourish side="right" />
                    </div>
                )}
            </div>
        </div>
    );
}

function PanelBody({
    className,
    children,
}: {
    className?: string;
    children: React.ReactNode;
}) {
    return (
        <div
            data-slot="panel-body"
            className={cn(
                "mt-[calc(var(--density-unit)*1.5)] flex flex-col gap-[var(--density-unit)]",
                className
            )}
        >
            {children}
        </div>
    );
}

/**
 * Footer actions: right-aligned on tablet and up, **stacked full-width on
 * phone** (ADR 0101 §2). `items-stretch` in the column direction is what makes
 * each action full-width, so a caller needs no per-button width class.
 */
function PanelFooter({
    className,
    children,
}: {
    className?: string;
    children: React.ReactNode;
}) {
    return (
        <div
            data-slot="panel-footer"
            className={cn(
                "mt-[calc(var(--density-unit)*1.5)] flex flex-col items-stretch gap-2 border-t border-border-accent/20 pt-3 sm:flex-row sm:items-center sm:justify-end",
                className
            )}
        >
            {children}
        </div>
    );
}

export { Panel, PanelHeader, PanelBody, PanelFooter, SunburstIcon };
export type { PanelDensity };
