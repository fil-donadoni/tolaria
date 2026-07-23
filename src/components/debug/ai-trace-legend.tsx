// Symbol legend for the AI decision trace.
//
// The trace packs every candidate into one dense line of abbreviations
// (v/r/a, Δ, clk, self/opp term letters). The label tells you WHAT the bot
// chose at a glance, but the metrics are cryptic until you've memorised them.
// This legend spells each symbol out so the parameters are recognisable
// without leaving the panel. Toggled from the trace header; collapsed by
// default so it costs no space once learned.

/** Every glyph the trace can render, paired with its human-readable meaning.
 *  Grouped: per-candidate search stats, then the position eval terms shared by
 *  the `self` / `opp` blocks. */
const LEGEND: { group: string; items: [string, string][] }[] = [
    {
        group: "Search",
        items: [
            ["v", "Visits — times this move was simulated"],
            ["r", "Mean reward — win-rate estimate, 0–1"],
            ["a", "Availability — times the move was a legal option"],
        ],
    },
    {
        group: "Position",
        items: [
            ["Δ", "Material margin (self − opp); green = ahead"],
            ["clk", "Danger Clock — race term; negative = losing the race"],
        ],
    },
    {
        group: "Eval terms (self / opp)",
        items: [
            ["L", "Life"],
            ["H", "Hand (cards in hand)"],
            ["C", "Creatures"],
            ["Pm", "Permanents (non-creature)"],
            ["M", "Mana (available)"],
            ["Fx", "Flexibility (options / reach)"],
        ],
    },
];

export default function AiTraceLegend() {
    return (
        <div className="mb-1 rounded-sm border border-border-subtle bg-surface-elevated/30 px-2 py-1.5 text-[10px] leading-snug">
            {LEGEND.map(({ group, items }) => (
                <div key={group} className="mb-1 last:mb-0">
                    <div className="text-label">{group}</div>
                    {items.map(([sym, meaning]) => (
                        <div key={sym} className="flex gap-1.5">
                            <span className="w-6 shrink-0 text-right font-semibold text-text tabular-nums">
                                {sym}
                            </span>
                            <span className="text-text-muted">{meaning}</span>
                        </div>
                    ))}
                </div>
            ))}
        </div>
    );
}
