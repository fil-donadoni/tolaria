// Foundations: palette + contrast, signal hues, typography, radius/scrim/z.
import { RatioBadge, Section, Specimen, Sub, NextScope } from "./lib";
import { contrastRatio } from "./contrast";
import { cn } from "@/lib/utils";
import { PALETTE_TOKENS, SIGNAL_TOKENS } from "@/lib/design-tokens";

/** The three surface tokens every ratio on this page is measured against.
 *  Read from the typed mirror, not hand-listed: these were spelled out as
 *  Antique Bronze hexes until identity v4 (issue #2722) moved all three, at
 *  which point every "on surface" ratio the page printed would have been a
 *  ratio against a ground the app no longer paints — the exact failure mode
 *  the mirror exists to close. */
const paletteHex = (name: string): string => {
    const t = [...PALETTE_TOKENS, ...SIGNAL_TOKENS].find(
        (t) => t.name === name
    );
    // Throw rather than fall back: a swatch that silently renders `undefined`
    // is a census row quietly describing a token that does not exist, which is
    // the exact failure this lookup replaced.
    if (!t) throw new Error(`no such design token: ${name}`);
    return t.hex;
};

const SURFACES: Array<[string, string]> = [
    ["base", paletteHex("surface-base")],
    ["surface", paletteHex("surface")],
    ["elevated", paletteHex("surface-elevated")],
];

/** Current semantic palette + the phase-3 additions. Both arrays now come from
 *  the typed token mirror (`src/lib/design-tokens.ts`) instead of being
 *  hand-maintained here: `design-tokens.test.ts` asserts every hex against
 *  `@theme inline`, so this census can no longer describe a palette the
 *  stylesheet has moved on from. (It did: `text-disabled` was still listed at
 *  its retired #6f6244 value.) */
const TOKENS = PALETTE_TOKENS;
const NEW_TOKENS = SIGNAL_TOKENS;

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
    tokens: readonly { name: string; hex: string; role: string }[];
    note?: string;
}) {
    return (
        // A horizontal scroller needs its own tab stop, or a keyboard user
        // cannot reach the columns past the fold (axe
        // `scrollable-region-focusable`, WCAG 2.1.1) — issue #2593.
        <div
            tabIndex={0}
            role="region"
            aria-label={`${title} tokens (scrollable)`}
            className="overflow-x-auto"
        >
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
                        // `border-strong` is a UI BOUNDARY, not text: WCAG
                        // 1.4.11 binds it at 3:1, and judging it by the 4.5:1
                        // text floor printed a red "fail" badge on a token
                        // that passes its own rule (it did, on both palettes).
                        const floor = t.name === "border-strong" ? 3 : 4.5;
                        const fails =
                            t.name.startsWith("text") ||
                            t.name.includes("strong")
                                ? SURFACES.some(
                                      ([, bg]) =>
                                          contrastRatio(t.hex, bg) < floor
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
                        Single palette, identity v4 — "quiet chrome, loud world"
                        (ADR 0103; roles unchanged from ADR 0007, values
                        superseded). A cold graphite ground under monochrome
                        ivory chrome, so card art, mana symbols and the signal
                        hues are the only colour on screen. Ratios are computed
                        live (WCAG relative luminance) against the three surface
                        tokens. AA needs ≥4.5:1 for text, ≥3:1 for UI
                        boundaries; every row below passes, and{" "}
                        <code>design-tokens.test.ts</code> re-derives the same
                        arithmetic from <code>src/index.css</code> so it stays
                        that way.
                    </>
                }
            >
                <Sub title="Current tokens" note="src/index.css @theme">
                    <Specimen label="Semantic palette census" tone="plain">
                        <TokenTable title="token" tokens={TOKENS} />
                    </Specimen>
                </Sub>
                <Sub
                    title="Signal, combat and boundary tokens"
                    note="every value verified ≥4.5 on every surface (≥3:1 for border-strong)"
                >
                    <NextScope>
                        <Specimen
                            label="Signal / combat / boundary"
                            tone="next"
                            note="hues unchanged by identity v4 (ADR 0103 §3: meaning-carrying colour stays) — only the surfaces under them moved, so every ratio here is re-derived"
                        >
                            <TokenTable title="token" tokens={NEW_TOKENS} />
                            <p className="mt-3 text-xs text-text-muted">
                                What a FAILING ratio looks like, on the v4
                                ground:{" "}
                                <span className="rounded-sm bg-surface px-2 py-0.5">
                                    {/* The RETIRED hex, rendered so the page
                                        shows the before/after side by side.
                                        Failing 4.5:1 is the point of it — the
                                        exemption attribute below is what keeps
                                        the gate's floor honest anyway, see
                                        `scripts/ui-gate/index.ts`. */}
                                    <span
                                        data-axe-exempt="Retired token #6f6244, rendered as the failing half of a before/after contrast comparison (issue #2593)."
                                        style={{ color: "#6f6244" }}
                                    >
                                        Retired disabled label (
                                        {contrastRatio(
                                            "#6f6244",
                                            paletteHex("surface")
                                        ).toFixed(2)}
                                        )
                                    </span>
                                    <span className="mx-2 text-text-disabled">
                                        →
                                    </span>
                                    <span className="text-text-disabled">
                                        v4 disabled label (
                                        {contrastRatio(
                                            paletteHex("text-disabled"),
                                            paletteHex("surface")
                                        ).toFixed(2)}
                                        )
                                    </span>
                                </span>{" "}
                                <span className="rounded-sm bg-surface px-2 py-0.5">
                                    <span
                                        data-axe-exempt="Retired token #b1473a, rendered as the failing half of a before/after contrast comparison (issue #2593)."
                                        style={{ color: "#b1473a" }}
                                    >
                                        danger as TEXT (
                                        {contrastRatio(
                                            "#b1473a",
                                            paletteHex("surface")
                                        ).toFixed(2)}
                                        )
                                    </span>
                                    <span className="mx-2 text-text-disabled">
                                        →
                                    </span>
                                    <span className="text-danger-strong">
                                        danger-strong (
                                        {contrastRatio(
                                            "#e89384",
                                            paletteHex("surface")
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
                                    "signal-self",
                                ],
                                [
                                    "rose-400/300 opponent pill, pod border",
                                    "signal-opponent",
                                    "signal-opponent",
                                ],
                                [
                                    "amber-400/300 priority, timer, pending",
                                    "signal-pending",
                                    "signal-pending",
                                ],
                                [
                                    "violet-400/300 targetable hand ring",
                                    "signal-target",
                                    "signal-target",
                                ],
                                [
                                    "emerald-600 buff / red-700 debuff",
                                    "success / danger",
                                    "success",
                                ],
                                [
                                    "red-600 damage badge",
                                    "danger (fill)",
                                    "danger",
                                ],
                                [
                                    "combat-colors.ts red/blue/green/yellow-500",
                                    "combat-1..4",
                                    "combat-1",
                                ],
                                [
                                    "white rings (divide targets)",
                                    "parchment",
                                    "parchment",
                                ],
                            ].map(([from, to, token]) => (
                                <div
                                    key={from}
                                    className="flex items-center gap-2 rounded-sm border border-border-subtle/50 px-2 py-1.5"
                                >
                                    <span
                                        className="h-3 w-3 shrink-0 rounded-full"
                                        style={{
                                            background: paletteHex(token),
                                        }}
                                    />
                                    <span className="text-text-muted">
                                        {from}
                                    </span>
                                    <span className="text-text-disabled">
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
                blurb={
                    <>
                        ONE chrome face: Geist Variable, in two registers —
                        display (weight 500, −0.025em tracking, lining tabular
                        numerals) for titles, buttons, life totals and counts;
                        UI (400/600) for everything else. Beleren is retired
                        from the chrome and reserved for the card domain (ADR
                        0103 §4): <code>--font-beleren</code> is still declared
                        in <code>:root</code> for the card renderers, but it is
                        no longer exported through <code>@theme inline</code>,
                        so no <code>font-beleren</code> utility exists for a
                        chrome class to resolve to.
                    </>
                }
            >
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                    <Specimen
                        label="Display — Geist 500"
                        tone="plain"
                        note=".text-display · −0.025em · lining tabular"
                    >
                        <p className="heading-panel text-left">
                            Panel heading (.heading-panel)
                        </p>
                        <p className="text-display mt-3 text-base tracking-[0.16em] uppercase">
                            Eyebrow label (uppercase, 0.16em)
                        </p>
                        <p className="text-display mt-3 text-sm">
                            Button label / stat chip
                        </p>
                        <p className="text-display mt-3 text-2xl tabular-nums">
                            20 · 17 · 4 — life totals never change width
                        </p>
                        <p className="title-treatment-glow text-display mt-3 text-2xl">
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
                blurb="Three scales that drifted: radius had 19 distinct values (rounded-sm dominates chrome at 155 uses, and every card surface carved its own 6/7/8%), scrims ranged bg-black/10 → /70, and z-index is a flat ladder where z-100 serves 35 consumers and z-[110]/[120] exist only to beat it. Identity v4 closes the card half of the radius drift with --card-radius (a proportional 4.8% / 3.45%, the printed corner) and pins the scrim at one token; the chrome radii are unchanged."
            >
                <Sub
                    title="Radius"
                    note="chrome radii unchanged by v4; the card corner becomes a token"
                >
                    <div className="flex flex-wrap gap-3">
                        {[
                            ["rounded-sm", "chrome controls · 155", "now"],
                            ["rounded-md", "panels/buttons · 19", "now"],
                            ["rounded-xl", "dialog popup · 9", "now"],
                            ["card-corner", "--card-radius · v4", "now"],
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
                    note="one token: --color-scrim, deepened 0.5 → 0.62 for the graphite ground"
                >
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                        {[10, 40, 50, 60].map((pct) => (
                            <div key={pct} className="text-center">
                                <div className="relative h-20 overflow-hidden rounded-sm border border-border-subtle">
                                    <div className="absolute inset-0 bg-[linear-gradient(45deg,#5f97a8_25%,#efe9da_25%,#efe9da_50%,#b1473a_50%,#b1473a_75%,#6fa05a_75%)] bg-[size:24px_24px]" />
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
                                [
                                    "z-chip",
                                    "portrait stack chip / chip row (#1823)",
                                    "chip (shipped)",
                                ],
                                [
                                    "z-banner",
                                    "centered prompt banner, portrait default (#1813/#1823)",
                                    "banner (shipped)",
                                ],
                                [
                                    "z-stack",
                                    "open portrait stack panel — always under choice prompts (#1885)",
                                    "stack (shipped)",
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
