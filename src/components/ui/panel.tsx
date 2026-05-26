import * as React from "react";
import { cn } from "@/lib/utils";

type PanelSize = "default" | "wide" | "full";
type PanelTone = "neutral" | "accent";
type PanelDensity = "default" | "compact";

const SIZE_CLASSES: Record<PanelSize, string> = {
    default: "",
    wide: "max-w-[90vw]",
    full: "w-full",
};

function CornerBracket({ className }: { className: string }) {
    return (
        <div
            data-slot="corner-bracket"
            className={cn(
                "absolute w-4 h-4 after:absolute after:w-1 after:h-1 after:bg-text-muted/40",
                className
            )}
        />
    );
}

function CornerBrackets() {
    return (
        <>
            <CornerBracket className="top-2 left-2 border-t border-l border-border-accent/40 after:top-1 after:left-1" />
            <CornerBracket className="top-2 right-2 border-t border-r border-border-accent/40 after:top-1 after:right-1" />
            <CornerBracket className="bottom-2 left-2 border-b border-l border-border-accent/40 after:bottom-1 after:left-1" />
            <CornerBracket className="bottom-2 right-2 border-b border-r border-border-accent/40 after:bottom-1 after:right-1" />
        </>
    );
}

function SunburstIcon({ children }: { children: React.ReactNode }) {
    return (
        <div className="relative shrink-0 w-28 h-28 sm:w-36 sm:h-36 flex items-center justify-center overflow-hidden rounded-full border border-border-subtle/30 bg-surface/40">
            <div
                className="absolute inset-0 opacity-35 mix-blend-color-dodge animate-[spin_80s_linear_infinite]"
                style={{
                    backgroundImage:
                        "repeating-conic-gradient(from 0deg, #d97706 0deg 4deg, transparent 4deg 12deg)",
                }}
            />
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_10%,var(--color-surface)_70%)]" />
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(245,158,11,0.2)_0%,transparent_60%)]" />
            <div className="relative z-10 flex items-center justify-center drop-shadow-[0_0_20px_rgba(245,158,11,0.5)]">
                {children}
            </div>
        </div>
    );
}

function Panel({
    size = "default",
    tone = "neutral",
    density = "default",
    className,
    children,
}: {
    size?: PanelSize;
    tone?: PanelTone;
    density?: PanelDensity;
    className?: string;
    children: React.ReactNode;
}) {
    return (
        <div
            data-slot="panel"
            className={cn(
                "relative bg-surface/90 border backdrop-blur-md rounded-sm text-text shadow-[0_0_50px_rgba(0,0,0,0.8)] select-none opacity-80",
                tone === "accent"
                    ? "border-accent/30"
                    : "border-border-subtle/80",
                density === "compact" ? "p-2" : "p-4 sm:p-6",
                SIZE_CLASSES[size],
                className
            )}
        >
            <CornerBrackets />
            {children}
        </div>
    );
}

function PanelHeader({
    title,
    subtitle,
    icon,
    className,
}: {
    title: string;
    subtitle?: string;
    icon?: React.ReactNode;
    className?: string;
}) {
    return (
        <div
            data-slot="panel-header"
            className={cn(
                "flex gap-4 sm:gap-6",
                icon ? "flex-col sm:flex-row items-center" : "flex-col",
                className
            )}
        >
            {icon && <SunburstIcon>{icon}</SunburstIcon>}
            <div className="flex-1 flex flex-col w-full min-w-0">
                <h2 className="text-xl sm:text-2xl font-bold tracking-wide text-parchment font-beleren text-center drop-shadow-[0_2px_4px_rgba(0,0,0,0.6)]">
                    {title}
                </h2>
                {subtitle && (
                    <p className="text-text-muted text-sm text-center mt-1">
                        {subtitle}
                    </p>
                )}
                <div className="h-px w-full bg-linear-to-r from-transparent via-border-accent/40 to-transparent my-2" />
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
            className={cn("flex flex-col gap-3", className)}
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
                "flex justify-end gap-2 mt-4 pt-3 border-t border-border-accent/20",
                className
            )}
        >
            {children}
        </div>
    );
}

export {
    Panel,
    PanelHeader,
    PanelBody,
    PanelFooter,
    SunburstIcon,
    CornerBrackets,
};
