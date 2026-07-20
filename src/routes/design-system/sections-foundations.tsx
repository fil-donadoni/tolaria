// Foundations: palette + contrast, signal hues, typography, radius/scrim/z.
import { RatioBadge, Section, Specimen, Sub, NextScope } from "./lib";
import { contrastRatio } from "./contrast";
import { cn } from "@/lib/utils";

const SURFACES: Array<[string, string]> = [
    ["base", "#0d0b07"],
    ["surface", "#16110a"],
    ["elevated", "#241d12"],
];

/** Current semantic palette (index.css @theme) with the role it plays. */
const TOKENS: Array<{ name: string; hex: string; role: string }> = [
    { name: "surface-base", hex: "#0d0b07", role: "app ground" },
    { name: "surface", hex: "#16110a", role: "panel ground" },
    { name: "surface-elevated", hex: "#241d12", role: "raised plate" },
    { name: "border-subtle", hex: "#2e2516", role: "hairlines" },
    { name: "border-accent", hex: "#6b5a36", role: "gold trim" },
    { name: "accent", hex: "#c9a24b", role: "primary gold" },
    { name: "accent-strong", hex: "#ecc878", role: "bright gold" },
    { name: "accent-soft", hex: "#4a3a1c", role: "gold wash" },
    { name: "secondary-accent", hex: "#5f97a8", role: "cool teal" },
    { name: "secondary-accent-strong", hex: "#9cc6d4", role: "bright teal" },
    { name: "secondary-accent-soft", hex: "#234049", role: "teal wash" },
    { name: "danger", hex: "#b1473a", role: "garnet fill" },
    { name: "danger-strong", hex: "#e89384", role: "danger text" },
    { name: "danger-soft", hex: "#4a1a14", role: "danger wash" },
    { name: "success", hex: "#6fa05a", role: "success fill" },
    { name: "success-strong", hex: "#a8d292", role: "success text" },
    { name: "success-soft", hex: "#274a1f", role: "success wash" },
    { name: "parchment", hex: "#f3ead2", role: "brightest text" },
    { name: "text", hex: "#e9e0cb", role: "body text" },
    { name: "text-muted", hex: "#b7a984", role: "secondary text" },
    { name: "text-disabled", hex: "#6f6244", role: "labels / disabled" },
];

const NEW_TOKENS: Array<{ name: string; hex: string; role: string }> = [
    { name: "text-disabled", hex: "#968a68", role: "was #6f6244 (2.78–3.28)" },
    { name: "border-strong", hex: "#7d6b42", role: "input/control edges" },
    { name: "signal-self", hex: "#34d399", role: "my turn/priority/selection" },
    { name: "signal-self-strong", hex: "#6ee7b7", role: "self, bright" },
    { name: "signal-opponent", hex: "#fb7185", role: "opponent turn" },
    {
        name: "signal-opponent-strong",
        hex: "#fda4af",
        role: "opponent, bright",
    },
    { name: "signal-pending", hex: "#fbbf24", role: "waiting/urgent" },
    { name: "signal-pending-strong", hex: "#fcd34d", role: "pending, bright" },
    { name: "signal-target", hex: "#a78bfa", role: "targetable/pickable" },
    { name: "signal-target-strong", hex: "#c4b5fd", role: "target, bright" },
    { name: "combat-1", hex: "#ef4444", role: "combat group ring" },
    { name: "combat-2", hex: "#3b82f6", role: "combat group ring" },
    { name: "combat-3", hex: "#22c55e", role: "combat group ring" },
    { name: "combat-4", hex: "#eab308", role: "combat group ring" },
];

function Swatch({ hex, name }: { hex: string; name: string }) {
    return (
        <span
            className="inline-block h-6 w-10 rounded-sm border border-black/60"
            style={{ background: hex }}
            title={name}
        />
    );
}

function TokenTable({
    title,
    tokens,
    note,
}: {
    title: string;
    tokens: Array<{ name: string; hex: string; role: string }>;
    note?: string;
}) {
    return (
        <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-xs">
                <thead>
                    <tr className="text-[10px] tracking-wider text-text-disabled uppercase">
                        <th className="py-1 pr-3 font-medium">{title}</th>
                        <th className="py-1 pr-3 font-medium">hex</th>
                        <th className="py-1 pr-3 font-medium">role</th>
                        {SURFACES.map(([n]) => (
                            <th key={n} className="py-1 pr-3 font-medium">
                                on {n}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {tokens.map((t) => {
                        const fails =
                            t.name.startsWith("text") ||
                            t.name.includes("strong")
                                ? SURFACES.some(
                                      ([, bg]) => contrastRatio(t.hex, bg) < 4.5
                                  )
                                : false;
                        return (
                            <tr
                                key={t.name}
                                className={cn(
                                    "border-t border-border-subtle/40",
                                    fails && "bg-danger/5"
                                )}
                            >
                                <td className="py-1.5 pr-3">
                                    <span className="flex items-center gap-2">
                                        <Swatch hex={t.hex} name={t.name} />
                                        <span className="font-mono text-[11px] text-text">
                                            {t.name}
                                        </span>
                                        {fails && (
                                            <span className="rounded-sm bg-danger/20 px-1 text-[9px] font-bold text-danger-strong uppercase">
                                                fail
                                            </span>
                                        )}
                                    </span>
                                </td>
                                <td className="py-1.5 pr-3 font-mono text-[11px] text-text-muted">
                                    {t.hex}
                                </td>
                                <td className="py-1.5 pr-3 text-text-muted">
                                    {t.role}
                                    {note && (
                                        <span className="text-text-disabled">
                                            {" "}
                                            {note}
                                        </span>
                                    )}
                                </td>
                                {SURFACES.map(([n, bg]) => (
                                    <td key={n} className="py-1.5 pr-3">
                                        <RatioBadge fg={t.hex} bg={bg} />
                                    </td>
                                ))}
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}

export function FoundationsSections() {
    return (
        <>
            <Section
                id="palette"
                index="01"
                title="Palette & contrast"
                blurb={
                    <>
                        Single Antique Bronze palette (ADR 0007). Ratios are
                        computed live (WCAG relative luminance) against the
                        three surface tokens. AA needs ≥4.5:1 for text, ≥3:1 for
                        UI boundaries. Two failures today:{" "}
                        <code className="text-danger-strong">
                            text-disabled
                        </code>{" "}
                        (3.13, used by .text-label, placeholders, disabled
                        controls) and{" "}
                        <code className="text-danger-strong">danger</code> when
                        used as text (3.43 — the 7 error banners).
                    </>
                }
            >
                <Sub title="Current tokens" note="src/index.css @theme">
                    <Specimen label="Semantic palette census" tone="plain">
                        <TokenTable title="token" tokens={TOKENS} />
                    </Specimen>
                </Sub>
                <Sub
                    title="Proposed edits + new tokens"
                    note="values verified ≥4.5 on every surface"
                >
                    <NextScope>
                        <Specimen
                            label="New / changed tokens"
                            tone="next"
                            note="text-disabled #6f6244 → #968a68 · danger-as-text → danger-strong (existing) · + border-strong, signal-*, combat-*"
                        >
                            <TokenTable title="token" tokens={NEW_TOKENS} />
                            <p className="mt-3 text-xs text-text-muted">
                                Side-by-side on a panel:{" "}
                                <span className="rounded-sm bg-surface px-2 py-0.5">
                                    <span style={{ color: "#6f6244" }}>
                                        Old disabled label (3.13)
                                    </span>
                                    <span className="mx-2 text-border-accent">
                                        →
                                    </span>
                                    <span className="text-text-disabled">
                                        New disabled label (
                                        {contrastRatio(
                                            "#968a68",
                                            "#16110a"
                                        ).toFixed(2)}
                                        )
                                    </span>
                                </span>{" "}
                                <span className="rounded-sm bg-surface px-2 py-0.5">
                                    <span style={{ color: "#b1473a" }}>
                                        Old error text (3.43)
                                    </span>
                                    <span className="mx-2 text-border-accent">
                                        →
                                    </span>
                                    <span className="text-danger-strong">
                                        New error text (
                                        {contrastRatio(
                                            "#e89384",
                                            "#16110a"
                                        ).toFixed(2)}
                                        )
                                    </span>
                                </span>
                            </p>
                        </Specimen>
                    </NextScope>
                </Sub>
            </Section>

            <Section
                id="signal-hues"
                index="02"
                title="Signal hues"
                blurb={
                    <>
                        343 chromatic Tailwind utilities in 71 files (ADR 0007
                        breach): turn/priority emerald-rose-amber, selection
                        violet, combat-group red/blue/green/yellow, buff/debuff
                        emerald/red, plus one-off ambers. All collapse onto
                        tokens: <code>signal-self/opponent/pending/target</code>{" "}
                        (+strong), <code>combat-1..4</code>, and the existing{" "}
                        <code>success/danger</code> families for buff/debuff.
                    </>
                }
            >
                <Sub title="Current → proposed mapping">
                    <Specimen label="Signal map" tone="plain">
                        <div className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
                            {[
                                [
                                    "emerald-400/300 rings, pills, dots",
                                    "signal-self",
                                    "#34d399",
                                ],
                                [
                                    "rose-400/300 opponent pill, pod border",
                                    "signal-opponent",
                                    "#fb7185",
                                ],
                                [
                                    "amber-400/300 priority, timer, pending",
                                    "signal-pending",
                                    "#fbbf24",
                                ],
                                [
                                    "violet-400/300 targetable hand ring",
                                    "signal-target",
                                    "#a78bfa",
                                ],
                                [
                                    "emerald-600 buff / red-700 debuff",
                                    "success / danger",
                                    "#6fa05a",
                                ],
                                [
                                    "red-600 damage badge",
                                    "danger (fill)",
                                    "#b1473a",
                                ],
                                [
                                    "combat-colors.ts red/blue/green/yellow-500",
                                    "combat-1..4",
                                    "#ef4444",
                                ],
                                [
                                    "white rings (divide targets)",
                                    "parchment",
                                    "#f3ead2",
                                ],
                            ].map(([from, to, hex]) => (
                                <div
                                    key={from}
                                    className="flex items-center gap-2 rounded-sm border border-border-subtle/50 px-2 py-1.5"
                                >
                                    <span
                                        className="h-3 w-3 shrink-0 rounded-full"
                                        style={{ background: hex }}
                                    />
                                    <span className="text-text-muted">
                                        {from}
                                    </span>
                                    <span className="text-border-accent">
                                        →
                                    </span>
                                    <span className="font-mono text-[11px] text-accent-strong">
                                        {to}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </Specimen>
                </Sub>
            </Section>

            <Section
                id="typography"
                index="03"
                title="Typography"
                blurb="Two faces: Beleren (display — headings, buttons, numbers on plates) and Geist Variable (UI body). Scale is small and ad-hoc but consistent in practice; the fix is codifying it, not changing it."
            >
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                    <Specimen label="Display — Beleren" tone="plain">
                        <p className="heading-panel text-left">
                            Panel heading (.heading-panel)
                        </p>
                        <p className="mt-3 font-beleren text-base tracking-[0.16em] uppercase">
                            Panel title (uppercase, 0.16em)
                        </p>
                        <p className="mt-3 font-beleren text-sm">
                            Button label / stat chip
                        </p>
                        <p className="title-treatment-glow mt-3 font-beleren text-2xl font-bold">
                            Title treatment glow
                        </p>
                    </Specimen>
                    <Specimen label="Body — Geist" tone="plain">
                        <p className="text-sm text-text">
                            Body text sm — the workhorse (text-text)
                        </p>
                        <p className="mt-2 text-sm text-text-muted">
                            Secondary text sm (text-text-muted)
                        </p>
                        <p className="mt-2 text-xs text-text">
                            Fine print xs (rules text, hints)
                        </p>
                        <p className="text-label mt-2">
                            Label — .text-label 10px uppercase
                        </p>
                        <p className="mt-2 font-mono text-xs tabular-nums">
                            0123456789 — mono/tabular (timers, ratios)
                        </p>
                    </Specimen>
                </div>
            </Section>

            <Section
                id="scales"
                index="04"
                title="Radius · scrim · z-index"
                blurb="Three scales that drifted: radius has 19 distinct values (rounded-sm dominates chrome at 155 uses, cards carve their own 7%), scrims range bg-black/10 → /70, and z-index is a flat ladder where z-100 serves 35 consumers and z-[110]/[120] exist only to beat it."
            >
                <Sub
                    title="Radius"
                    note="proposal: codify 5 roles, migrate outliers"
                >
                    <div className="flex flex-wrap gap-3">
                        {[
                            ["rounded-sm", "chrome controls · 155", "now"],
                            ["rounded-md", "panels/buttons · 19", "now"],
                            ["rounded-xl", "dialog popup · 9", "now"],
                            ["rounded-[7%]", "card art · 10", "now"],
                            ["rounded-full", "pips/badges · 42", "now"],
                        ].map(([cls, use]) => (
                            <div key={cls} className="text-center">
                                <div
                                    className={cn(
                                        "h-14 w-20 border border-border-accent/60 bg-surface-elevated",
                                        cls
                                    )}
                                />
                                <p className="mt-1 font-mono text-[10px] text-text">
                                    {cls}
                                </p>
                                <p className="text-[10px] text-text-disabled">
                                    {use}
                                </p>
                            </div>
                        ))}
                    </div>
                </Sub>
                <Sub
                    title="Scrim"
                    note="dialog scrim is bg-black/10 today (spec: raise to 40–60%)"
                >
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                        {[10, 40, 50, 60].map((pct) => (
                            <div key={pct} className="text-center">
                                <div className="relative h-20 overflow-hidden rounded-sm border border-border-subtle">
                                    <div className="absolute inset-0 bg-[linear-gradient(45deg,#5f97a8_25%,#c9a24b_25%,#c9a24b_50%,#b1473a_50%,#b1473a_75%,#6fa05a_75%)] bg-[size:24px_24px]" />
                                    <div
                                        className="absolute inset-0"
                                        style={{
                                            background: `rgba(0,0,0,${pct / 100})`,
                                        }}
                                    />
                                    {pct === 50 && (
                                        <span className="absolute right-1 bottom-1 rounded-sm bg-accent px-1 text-[9px] font-bold text-primary-foreground">
                                            pick
                                        </span>
                                    )}
                                </div>
                                <p className="mt-1 font-mono text-[10px] text-text">
                                    black/{pct}
                                    {pct === 10 ? " (dialog today)" : ""}
                                </p>
                            </div>
                        ))}
                    </div>
                    <p className="mt-2 text-xs text-text-muted">
                        Proposal: single <code>--color-scrim</code> = black/50
                        (matches ActionSheet), used by dialog, pickers,
                        lightbox, overlays.
                    </p>
                </Sub>
                <Sub
                    title="z-index"
                    note="107 utilities, no tokens; z-100 = 35 consumers"
                >
                    <Specimen
                        label="Current ladder → named layers"
                        tone="plain"
                    >
                        <div className="flex flex-col gap-1 text-xs">
                            {[
                                ["z-[120]", "depth fan", "modal-top"],
                                ["z-[110]", "stack fan badges", "modal-top"],
                                [
                                    "z-100",
                                    "dialogs, toasts, dock, pickers, debug (35!)",
                                    "modal",
                                ],
                                ["z-[60]", "arrow layer", "arrows"],
                                [
                                    "z-50",
                                    "sheets, order pickers, bug button",
                                    "sheet",
                                ],
                                [
                                    "z-40",
                                    "controller pod, priority, dismiss layers",
                                    "hud",
                                ],
                                [
                                    "z-30",
                                    "card action buttons, pile buttons",
                                    "card-top",
                                ],
                                [
                                    "z-20",
                                    "badges, glows, mana pool",
                                    "card-badge",
                                ],
                                [
                                    "z-10",
                                    "in-card overlays, sticky headers (29)",
                                    "card-ui",
                                ],
                                ["z-[5]", "card art ring", "card-art"],
                            ].map(([now, use, next]) => (
                                <div
                                    key={now}
                                    className="grid grid-cols-[70px_1fr_90px] items-center gap-2 rounded-sm border border-border-subtle/40 px-2 py-1"
                                >
                                    <span className="font-mono text-[11px] text-text-muted">
                                        {now}
                                    </span>
                                    <span className="text-text-muted">
                                        {use}
                                    </span>
                                    <span className="text-right font-mono text-[11px] text-accent-strong">
                                        {next}
                                    </span>
                                </div>
                            ))}
                        </div>
                        <p className="mt-2 text-xs text-text-muted">
                            Proposal: named CSS-var layers (--z-card-art 5 …
                            --z-modal 100, --z-modal-top 110/120) + tiny utility
                            classes; migrate the 107 bare numbers.
                        </p>
                    </Specimen>
                </Sub>
            </Section>
        </>
    );
}
