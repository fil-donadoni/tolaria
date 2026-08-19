import * as React from "react";
import { ChevronUp, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import CornerFiligreeFrame from "./corner-filigree-frame";
import SunburstIcon from "./sunburst-icon";
import SubtitleFlourish from "./subtitle-flourish";

type PanelSize = "default" | "wide" | "full";
type PanelTone = "neutral" | "accent";
/** `"compact-mobile"` (issue #1817, opus review round 2): a MOBILE-ONLY
 *  padding reduction — `p-3` below `min-[420px]`, reverting to the default
 *  `p-6` at and above it. Distinct from flat `"compact"` (`p-2` at every
 *  width, used by ~15 small banners/pickers that want tight padding
 *  everywhere): those callers must keep their unconditional padding, so this
 *  is a new value rather than a redefinition of `"compact"`. Opt-in via
 *  `GameDialog`'s `density` passthrough — every other wide dialog keeps
 *  `"default"` (unchanged, `p-6` at every width). See
 *  `PILE_GRID_COMPACT_BREAKPOINT_PX` (`src/lib/card-layout.ts`) for the
 *  breakpoint this must stay in sync with. */
type PanelDensity = "default" | "compact" | "compact-mobile";

const SIZE_CLASSES: Record<PanelSize, string> = {
    default: "",
    wide: "max-w-[90vw]",
    full: "w-full",
};

const DENSITY_CLASSES: Record<PanelDensity, string> = {
    default: "p-6",
    compact: "p-2",
    "compact-mobile": "p-3 min-[420px]:p-6",
};

/**
 * Shared panel — the single chrome frame (ADR 0007), composition API
 * (`Panel` + `PanelHeader` / `PanelBody` / `PanelFooter`).
 *
 * Physical look (issue #595): a layered OPAQUE bezel (`.panel-physical` — inner
 * gold hairline, even/symmetric inner shade, drop shadow; no asymmetric
 * fake-3D) framed by SVG corner filigree.
 *
 * `overlay` mode renders ONLY the corner filigree, stretched `inset-0` to the
 * nearest positioned ancestor, so an already-built `relative` panel can be
 * framed without re-wrapping it (and without the zero-height collapse a
 * self-sizing wrapper would cause).
 */
function Panel({
    size = "default",
    tone = "neutral",
    density = "default",
    overlay = false,
    className,
    frameClassName,
    children,
}: {
    size?: PanelSize;
    tone?: PanelTone;
    density?: PanelDensity;
    overlay?: boolean;
    className?: string;
    /** Extra classes merged onto the decorative `CornerFiligreeFrame` alone
     *  (never the panel body) — e.g. `compact-chrome:hidden` to drop the 40px
     *  ornament where a caller has decided vertical space is scarce (issue
     *  #2515). Every existing caller omits it and is unaffected. */
    frameClassName?: string;
    children?: React.ReactNode;
}) {
    if (overlay) {
        return <CornerFiligreeFrame overlay className={frameClassName} />;
    }

    return (
        <div
            data-slot="panel"
            className={cn(
                "panel-physical relative rounded-md border text-text select-none",
                DENSITY_CLASSES[density],
                tone === "accent" ? "border-accent/40" : "border-border-subtle",
                SIZE_CLASSES[size],
                className
            )}
        >
            <CornerFiligreeFrame overlay className={frameClassName} />
            {children}
        </div>
    );
}

/**
 * Engraved header band: small-caps Beleren title centred over a darker inset
 * band, a gold rule beneath with a centred diamond node, optional leading
 * sunburst icon, optional subtitle (clasp-flanked), and an optional collapse
 * chevron.
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
                <div className="panel-header-band relative -mx-2 -mt-2 flex items-center justify-center rounded-t-md px-3 py-2 sm:-mx-4 sm:-mt-4">
                    <h2
                        id={titleId}
                        data-slot="panel-title"
                        className="heading-panel text-base tracking-[0.16em] uppercase sm:text-lg"
                    >
                        {title}
                    </h2>
                    {collapsible && (
                        <button
                            type="button"
                            onClick={onToggleCollapse}
                            aria-label={collapsed ? "Expand" : "Collapse"}
                            aria-expanded={!collapsed}
                            className="absolute right-3 flex h-5 w-5 items-center justify-center rounded-sm border border-border-accent/60 text-text-muted transition-colors hover:text-accent-strong"
                        >
                            {collapsed ? (
                                <ChevronDown className="h-3 w-3" />
                            ) : (
                                <ChevronUp className="h-3 w-3" />
                            )}
                        </button>
                    )}
                    {/* gold rule with a centred diamond node sitting on it */}
                    <span className="panel-rule absolute bottom-0 left-0 h-px w-full" />
                    <span className="divider-node absolute -bottom-[3px] left-1/2 h-1.5 w-1.5 -translate-x-1/2 rotate-45" />
                </div>

                {subtitle && (
                    <div className="mt-3 flex items-center justify-center gap-2 text-center text-sm text-text-muted">
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
            className={cn("mt-4 flex flex-col gap-3", className)}
        >
            {children}
        </div>
    );
}

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
                "mt-4 flex justify-end gap-2 border-t border-border-accent/20 pt-3",
                className
            )}
        >
            {children}
        </div>
    );
}

export { Panel, PanelHeader, PanelBody, PanelFooter, SunburstIcon };
export type { PanelDensity };
