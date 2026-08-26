import * as React from "react";
import { ChevronUp, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import SunburstIcon from "./sunburst-icon";
import SubtitleFlourish from "./subtitle-flourish";

type PanelSize = "default" | "wide" | "full";
type PanelTone = "neutral" | "accent";

/** The v4 frame is an EDGE, not an ornament (ADR 0103 §5). Both strengths are
 *  the TRANSLUCENT hairline pair, never the flattened `border-*` hexes: a
 *  Panel is routinely laid over card art, a gradient or an art-backed tile,
 *  where a flattened edge paints a visible grey line. */
const TONE_EDGE: Record<PanelTone, string> = {
    neutral: "border-[var(--hairline)]",
    accent: "border-[var(--hairline-strong)]",
};

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
 * **v4 frame — hairline + material, no brackets** (ADR 0103 §5, issue #2723).
 * A 1px translucent-ivory edge, a 6px corner (`--panel-radius`), one top-light
 * gradient and a soft elevation shadow (`.panel-physical`, re-skinned in
 * `index.css`). Nothing is drawn at the corners.
 *
 * What this replaced, in two steps: the 40px SVG corner filigree of issue #595
 * (which the ADR 0101 viewport audit measured overlapping dialog titles), then
 * the four 10px inset brackets of issue #2581 that took its place. Both were
 * ornament ON a box; v4's frame IS the box's edge, so a panel recedes and the
 * card art carries the screen.
 *
 * `overlay` mode renders ONLY the edge, stretched `inset-0` to the nearest
 * positioned ancestor, so an already-built `relative` panel can be framed
 * without re-wrapping it (and without the zero-height collapse a self-sizing
 * wrapper would cause).
 *
 * The frame carries the panel's own corner, NOT `.card-corner`: a card corner
 * is a fraction of the card (`--card-radius`, ADR 0103 §7) and a panel is not
 * a card. Mixing them is what made the v3 dialogs read as oversized cards.
 */
function Panel({
    size = "default",
    tone = "neutral",
    density,
    overlay = false,
    className,
    children,
}: {
    size?: PanelSize;
    tone?: PanelTone;
    /** Explicit rung for this Panel and its subtree — an override. Omitted
     *  (the common case) means "use the ambient rung": `[data-density]` is
     *  never rendered by this Panel, so `--density-unit`/`--panel-pad` fall
     *  through the CSS cascade from the nearest ancestor that DOES set it —
     *  today that is `<html data-density>`, driven by the user's Settings
     *  preference (issue #2595), defaulting to `roomy` there so a Panel that
     *  says nothing renders exactly as it always did. A banner/picker that
     *  wants a rung regardless of the user's global choice (the `compact`
     *  board-prompt rung, the `comfortable` phone-aware dialogs) still passes
     *  it explicitly — that pin is unaffected by any of this. */
    density?: PanelDensity;
    /** RETIRED by ADR 0103 §5 — accepted and ignored.
     *
     *  It used to opt a Panel back into the 40px corner filigree (lobby hero,
     *  Game Over, Match Result). v4 has no corner ornament at all: the one
     *  surviving ornament atom is `OrnamentalDivider`, which those waiting
     *  states place themselves, in their own content.
     *
     *  The prop STAYS in the signature on purpose. Two call sites pass it
     *  (`game-over-dialog` via `GameDialog`, and the design-system v3 census;
     *  the third, `dashboard-play-box`, retired with its file in #2726) and
     *  this slice's contract is that no consumer file changes — removing it
     *  would be a compile error in each.
     *  Issue #2734 (the closure slice) drops the prop and its call sites
     *  together. */
    ornament?: boolean;
    overlay?: boolean;
    className?: string;
    children?: React.ReactNode;
}) {
    // Overlay mode: the edge alone, stretched onto a caller's own positioned
    // box. `pointer-events-none` because it sits over that box's content.
    if (overlay)
        return (
            <div
                data-slot="panel-frame"
                aria-hidden
                className={cn(
                    "pointer-events-none absolute inset-0 rounded-[var(--panel-radius)] border",
                    TONE_EDGE[tone],
                    className
                )}
            />
        );

    return (
        <div
            data-slot="panel"
            {...(density ? { "data-density": density } : {})}
            className={cn(
                "panel-physical relative rounded-[var(--panel-radius)] border p-[var(--panel-pad)] text-text select-none",
                TONE_EDGE[tone],
                SIZE_CLASSES[size],
                className
            )}
        >
            {children}
        </div>
    );
}

/**
 * Header band (ADR 0101 §2 layout, ADR 0103 §5 skin): display-face title on
 * the LEFT over a full-bleed band, ONE hairline rule beneath, optional leading
 * sunburst icon, optional subtitle (clasp-flanked), and an optional collapse
 * chevron pinned right.
 *
 * v4 (issue #2723) quiets the band itself: the darker gold-washed strip and
 * its gold `border-bottom` are gone (`.panel-header-band` / `.panel-rule` in
 * `index.css`), leaving a faint top-light and a single ivory/30 rule. The v3
 * recipe drew that edge twice — a border AND the rule span — which on a
 * hairline frame reads as a double-struck line.
 *
 * The band bleeds to the panel border by cancelling `--panel-pad`, and the
 * title starts at `--panel-header-pad-x` measured FROM THAT BORDER. That
 * inset is unchanged: v2 centred the title over a band inset by a hard-coded
 * `-mx-4` regardless of density, which is how the 40px ornament came to
 * overlap dialog titles in the first place.
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
            className={cn("flex flex-col", className)}
        >
            <div className="panel-header-band relative -mx-[var(--panel-pad)] -mt-[var(--panel-pad)] flex items-center justify-between gap-3 rounded-t-[var(--panel-radius)] px-[var(--panel-header-pad-x)] py-[calc(var(--density-unit)*0.8)]">
                {/* The icon well sits INSIDE the band. As a sibling COLUMN it
                    pushed the band into the remaining width, where the band's
                    own `-mx-[--panel-pad]` bleed then ran under the icon on the
                    left while the title and subtitle were squeezed into a
                    ~200px column (measured on the auth screens). Inside the
                    band the bleed is honest, the title keeps its
                    `--panel-header-pad-x` clearance on the icon-less side, and
                    the subtitle beneath spans the whole panel instead of a
                    third of it. */}
                {icon && <SunburstIcon size={44}>{icon}</SunburstIcon>}

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
                        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-sm border border-[var(--hairline-strong)] text-text-muted transition-colors hover:text-parchment"
                    >
                        {collapsed ? (
                            <ChevronDown className="h-3 w-3" />
                        ) : (
                            <ChevronUp className="h-3 w-3" />
                        )}
                    </button>
                )}
                {/* The one hairline rule under the band (no diamond node —
                    a centred node contradicts a left-aligned title). */}
                <span className="panel-rule absolute bottom-0 left-0 h-px w-full" />
            </div>

            {subtitle && (
                <div className="mt-3 flex items-center justify-center gap-2 text-center text-sm text-text-muted">
                    <SubtitleFlourish side="left" />
                    <span className="min-w-0">{subtitle}</span>
                    <SubtitleFlourish side="right" />
                </div>
            )}
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
 *
 * `layout="stack"` keeps the column at EVERY width. It exists because the
 * responsive default cannot be opted out of from the outside: a caller passing
 * `className="flex-col items-stretch"` still gets `sm:flex-row` (a variant
 * class tailwind-merge has no unprefixed counterpart to drop), so above 640px
 * the row silently came back — which is how the auth screens ended up with
 * "No account? Sign up" wrapped into a 60px column beside the CTA. A stacked
 * footer is right whenever the actions are a primary CTA plus a secondary
 * text link that belongs UNDER it, not beside it.
 */
type PanelFooterLayout = "responsive" | "stack";

function PanelFooter({
    layout = "responsive",
    className,
    children,
}: {
    layout?: PanelFooterLayout;
    className?: string;
    children: React.ReactNode;
}) {
    return (
        <div
            data-slot="panel-footer"
            data-layout={layout}
            className={cn(
                "mt-[calc(var(--density-unit)*1.5)] flex flex-col items-stretch gap-2 border-t border-[var(--hairline)] pt-3",
                layout === "responsive" &&
                    "sm:flex-row sm:items-center sm:justify-end",
                className
            )}
        >
            {children}
        </div>
    );
}

export { Panel, PanelHeader, PanelBody, PanelFooter, SunburstIcon };
export type { PanelDensity, PanelFooterLayout };
