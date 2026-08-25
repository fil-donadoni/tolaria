// Shared building blocks for the /design-system census page (permanent
// design-system reference, phase 3 — kept, unlike /prototype/* spikes).
import * as React from "react";
import { cn } from "@/lib/utils";
import { contrastRatio } from "./contrast";
import {
    PALETTE_TOKENS,
    SIGNAL_TOKENS,
    type TokenGroup,
} from "@/lib/design-tokens";

export function RatioBadge({
    fg,
    bg,
    threshold = 4.5,
    label,
}: {
    fg: string;
    bg: string;
    threshold?: number;
    label?: string;
}) {
    const r = contrastRatio(fg, bg);
    const pass = r >= threshold;
    return (
        <span
            className={cn(
                "inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 font-mono text-[10px] tabular-nums",
                pass
                    ? "bg-success/20 text-success-strong"
                    : "bg-danger/20 text-danger-strong"
            )}
            title={`${r.toFixed(2)}:1 vs ${bg} (needs ≥ ${threshold}:1)`}
        >
            {label && <span className="opacity-70">{label}</span>}
            {r.toFixed(2)}
        </span>
    );
}

/** The token / value / role table every mirrored family renders as. Shared by
 *  the v3 and identity-v4 sections so a new family is one array, not a new
 *  table. */
export function TokenRows({ group }: { group: TokenGroup }) {
    return (
        // Tab stop on the scroller — axe `scrollable-region-focusable`
        // (issue #2593).
        <div
            tabIndex={0}
            role="region"
            aria-label={`${group.title} tokens (scrollable)`}
            className="overflow-x-auto"
        >
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

/* ── Page scaffolding ─────────────────────────────────────────────────── */

export function Section({
    id,
    index,
    title,
    blurb,
    children,
}: {
    id: string;
    index: string;
    title: string;
    blurb?: React.ReactNode;
    children: React.ReactNode;
}) {
    return (
        <section id={id} className="scroll-mt-6">
            <div className="flex items-baseline gap-3">
                <span className="text-display text-sm text-accent">
                    {index}
                </span>
                <h2 className="heading-panel text-left">{title}</h2>
            </div>
            <span className="panel-rule mt-2 block h-px w-full" />
            {blurb && (
                <p className="mt-3 max-w-3xl text-sm text-text-muted">
                    {blurb}
                </p>
            )}
            <div className="mt-5 flex flex-col gap-6">{children}</div>
        </section>
    );
}

export function Sub({
    title,
    note,
    children,
}: {
    title: React.ReactNode;
    note?: React.ReactNode;
    children: React.ReactNode;
}) {
    return (
        <div>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h3 className="text-display text-sm text-parchment">{title}</h3>
                {note && (
                    <span className="text-xs text-text-muted">{note}</span>
                )}
            </div>
            <div className="mt-2">{children}</div>
        </div>
    );
}

/** A bordered specimen box. `tone` marks census (now) vs proposal (next). */
export function Specimen({
    label,
    tone = "now",
    note,
    className,
    children,
}: {
    label: React.ReactNode;
    tone?: "now" | "next" | "plain";
    note?: React.ReactNode;
    className?: string;
    children: React.ReactNode;
}) {
    return (
        <div
            className={cn(
                "rounded-md border p-3",
                tone === "now" && "border-border-subtle bg-surface-base/60",
                tone === "next" &&
                    "border-accent/50 bg-surface shadow-[0_0_18px_color-mix(in_srgb,var(--color-accent)_12%,transparent)]",
                tone === "plain" && "border-border-subtle/50",
                className
            )}
        >
            <div className="mb-2 flex flex-wrap items-center gap-2">
                <span
                    className={cn(
                        "rounded-sm px-1.5 py-0.5 text-[10px] font-bold tracking-wider uppercase",
                        tone === "now" && "bg-surface-elevated text-text-muted",
                        tone === "next" &&
                            "bg-accent-soft/50 text-accent-strong",
                        tone === "plain" &&
                            "bg-surface-elevated text-text-muted"
                    )}
                >
                    {tone === "now" ? "now" : tone === "next" ? "next" : "·"}
                </span>
                <span className="text-xs font-medium text-text">{label}</span>
                {note && (
                    <span className="text-[11px] text-text-muted">{note}</span>
                )}
            </div>
            {children}
        </div>
    );
}

/** Small file/count annotation used across the census. */
export function Where({ children }: { children: React.ReactNode }) {
    return (
        <span className="font-mono text-[10px] text-text-disabled">
            {children}
        </span>
    );
}

/* ── Candidate token scope for "next" specimens ─────────────────────────
 * Overrides/proposes tokens inside a subtree: Tailwind v4 utilities resolve
 * var(--color-*) at the use site, so wrapping a specimen in this style makes
 * the real classes render with the candidate values.
 *
 * Read from the typed mirror rather than hand-listed: the two palette entries
 * that used to be spelled out here (`--color-text-disabled` #968a68,
 * `--color-border-strong` #7d6b42) were the SHIPPED values when they were
 * written, and identity v4 moved both — so a hand-listed override would have
 * pinned every "next" specimen to the retired palette while the rest of the
 * page rendered the new one. */
const NEXT_TOKENS = {
    ...Object.fromEntries(
        [...PALETTE_TOKENS, ...SIGNAL_TOKENS].map((t) => [
            `--color-${t.name}`,
            t.hex,
        ])
    ),
    "--color-scrim": "rgb(0 0 0 / 0.62)",
} as React.CSSProperties;

export function NextScope({ children }: { children: React.ReactNode }) {
    return <div style={NEXT_TOKENS}>{children}</div>;
}
