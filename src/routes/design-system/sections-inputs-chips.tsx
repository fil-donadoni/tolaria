// Inputs + chips/badges: field languages and every small labelled atom.
import { Input } from "@/components/ui/input";
import { Section, Specimen, Where, NextScope } from "./lib";

export function InputsChipsSections() {
    return (
        <>
            <Section
                id="inputs"
                index="09"
                title="Inputs"
                blurb={
                    <>
                        Three field languages: <code>.input-field</code> (8
                        consumers: auth, search, selects), shadcn{" "}
                        <code>&lt;Input&gt;</code> (8 uses), and debug
                        black-glass (duplicated consts). Resting border is
                        1.19:1 and the focus indicator 1.41:1 — both fail. One
                        recipe, stronger edge, visible focus.
                    </>
                }
            >
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
                    <Specimen label=".input-field (current)" tone="now">
                        <input
                            className="input-field w-full"
                            placeholder="border-border-subtle/40 — 1.19:1"
                        />
                        <Where>
                            auth-form ×3 · search-bar · save-deck-bar ·
                            deck-import (textarea) · 4 selects
                        </Where>
                    </Specimen>
                    <Specimen label="shadcn Input (current)" tone="now">
                        <Input placeholder="border-input — near-invisible" />
                        <Where>
                            bug-report ×3 · create-limited-event ×2 ·
                            dashboard-top-bar · pick-rating ×2
                        </Where>
                    </Specimen>
                    <Specimen label="debug black-glass (stays)" tone="now">
                        <input
                            className="w-full rounded border border-white/20 bg-black/40 px-2 py-1 text-xs text-white outline-none placeholder:text-white/30"
                            placeholder="debug only"
                        />
                        <Where>debug/* — dev tooling, exempt</Where>
                    </Specimen>
                </div>
                <NextScope>
                    <Specimen
                        label="Proposed unified field"
                        tone="next"
                        note="border-strong (≥3:1) · focus: accent border + ring · disabled/invalid states"
                    >
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <input
                                className="w-full rounded-sm border border-border-strong bg-surface-elevated/20 px-3 py-2 text-sm text-text placeholder:text-text-disabled focus:border-accent focus:ring-2 focus:ring-accent/50 focus:outline-none"
                                placeholder="Resting — border-strong 3.6:1"
                            />
                            <input
                                className="w-full rounded-sm border border-accent bg-surface-elevated/30 px-3 py-2 text-sm text-text ring-2 ring-accent/50 outline-none"
                                defaultValue="Focused (simulated)"
                            />
                            <input
                                className="w-full rounded-sm border border-border-subtle bg-surface px-3 py-2 text-sm text-text-disabled"
                                disabled
                                value="Disabled"
                                readOnly
                            />
                            <input
                                className="w-full rounded-sm border border-danger bg-surface-elevated/20 px-3 py-2 text-sm text-text ring-2 ring-danger/40 outline-none"
                                defaultValue="Invalid — danger ring"
                                readOnly
                            />
                        </div>
                        <p className="mt-2 text-xs text-text-muted">
                            shadcn &lt;Input&gt; re-points at the same recipe;
                            selects keep .input-field. Focus indicator: ring
                            accent at 8.2:1 (was 1.41).
                        </p>
                    </Specimen>
                </NextScope>
            </Section>

            <Section
                id="chips"
                index="10"
                title="Chips, badges & rings"
                blurb="Every small labelled atom in the app: filter chips, segmented controls, timer, turn/priority signals, legality, counters, loyalty, combat-group and selection rings. Chromatic ones migrate to the signal tokens."
            >
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                    <Specimen
                        label="Filter chips + segmented (token-clean already)"
                        tone="plain"
                    >
                        <div className="flex flex-wrap gap-2">
                            <span className="filter-chip-active rounded-sm px-2 py-1 text-xs">
                                White
                            </span>
                            <span className="filter-chip-inactive rounded-sm px-2 py-1 text-xs">
                                Blue
                            </span>
                            <span className="rounded-sm bg-surface-elevated/40 px-2 py-1">
                                <span className="segment-active rounded-sm px-2 py-0.5 text-xs">
                                    Ranked
                                </span>
                                <span className="segment-inactive px-2 py-0.5 text-xs">
                                    Casual
                                </span>
                            </span>
                        </div>
                        <Where>
                            color-filter · match-mode-pills ·
                            difficulty-selector · match-format-selector
                        </Where>
                    </Specimen>
                    <Specimen
                        label="Counter buff/debuff + loyalty + damage"
                        tone="now"
                        note="QA: counter UI to align — raw emerald/red/amber fills, white text ≤3:1"
                    >
                        <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded bg-emerald-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
                                +1/+1
                            </span>
                            <span className="rounded bg-red-700 px-1.5 py-0.5 text-[10px] font-bold text-white">
                                -1/-1
                            </span>
                            <span className="rounded bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold text-black">
                                3 loyalty
                            </span>
                            <span className="rounded-xs bg-red-600 px-1 py-0.5 text-[10px] font-bold text-white">
                                4 dmg
                            </span>
                        </div>
                        <Where>
                            counter-badges:5 · planeswalker-loyalty-badge:19 ·
                            battlefield-card damage
                        </Where>
                    </Specimen>
                    <Specimen
                        label="Counter chips redesigned (QA)"
                        tone="next"
                        note="plate language: solid token fill + dark engraved label + darker border — readable over any art"
                    >
                        <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded-sm border border-success/60 bg-success px-1.5 py-0.5 text-[10px] font-bold text-surface-base">
                                +1/+1 ×3
                            </span>
                            <span className="rounded-sm border border-danger/60 bg-danger px-1.5 py-0.5 text-[10px] font-bold text-parchment">
                                -1/-1
                            </span>
                            <span className="rounded-sm border border-signal-pending/60 bg-signal-pending px-1.5 py-0.5 text-[10px] font-bold text-surface-base">
                                charge ×2
                            </span>
                            <span className="rounded-sm border border-accent/60 bg-accent px-1.5 py-0.5 text-[10px] font-bold text-primary-foreground">
                                3 loyalty
                            </span>
                            <span className="rounded-sm border border-danger/60 bg-danger px-1 py-0.5 text-[10px] font-bold text-parchment">
                                4 dmg
                            </span>
                        </div>
                        <p className="mt-2 text-xs text-text-muted">
                            buff → success plate (5.4:1) · debuff + damage →
                            danger plate (4.6:1) · neutral counters →
                            signal-pending plate · loyalty → accent plate (was
                            amber-500).
                        </p>
                    </Specimen>
                    <Specimen
                        label="Selection + combat rings (current)"
                        tone="now"
                    >
                        <div className="flex flex-wrap items-center gap-3">
                            <span className="rounded-sm p-2 ring-2 ring-emerald-400">
                                <span className="text-xs">picked</span>
                            </span>
                            <span className="rounded-sm p-2 ring-2 ring-violet-400/60">
                                <span className="text-xs">targetable</span>
                            </span>
                            <span className="rounded-sm p-2 ring-2 ring-amber-400">
                                <span className="text-xs">pending</span>
                            </span>
                            <span className="rounded-sm p-2 ring-2 ring-red-500">
                                <span className="text-xs">band A</span>
                            </span>
                            <span className="rounded-sm p-2 ring-2 ring-blue-500">
                                <span className="text-xs">band B</span>
                            </span>
                        </div>
                        <Where>
                            useBattlefieldVisualState ×7 · board-hand-card:233 ·
                            selectable-card:84 · cards-pile:107 · game-stack:226
                            · combat-colors.ts
                        </Where>
                    </Specimen>
                    <NextScope>
                        <Specimen
                            label="Same rings on signal tokens"
                            tone="next"
                            note="identical hues, one source of truth"
                        >
                            <div className="flex flex-wrap items-center gap-3">
                                <span
                                    className="rounded-sm p-2 ring-2"
                                    style={
                                        {
                                            "--tw-ring-color":
                                                "var(--color-signal-self)",
                                        } as React.CSSProperties
                                    }
                                >
                                    <span className="text-xs">picked</span>
                                </span>
                                <span
                                    className="rounded-sm p-2 ring-2"
                                    style={
                                        {
                                            "--tw-ring-color":
                                                "var(--color-signal-target)",
                                        } as React.CSSProperties
                                    }
                                >
                                    <span className="text-xs">targetable</span>
                                </span>
                                <span
                                    className="rounded-sm p-2 ring-2"
                                    style={
                                        {
                                            "--tw-ring-color":
                                                "var(--color-signal-pending)",
                                        } as React.CSSProperties
                                    }
                                >
                                    <span className="text-xs">pending</span>
                                </span>
                                <span
                                    className="rounded-sm p-2 ring-2"
                                    style={
                                        {
                                            "--tw-ring-color":
                                                "var(--color-combat-1)",
                                        } as React.CSSProperties
                                    }
                                >
                                    <span className="text-xs">band A</span>
                                </span>
                                <span
                                    className="rounded-sm p-2 ring-2"
                                    style={
                                        {
                                            "--tw-ring-color":
                                                "var(--color-combat-2)",
                                        } as React.CSSProperties
                                    }
                                >
                                    <span className="text-xs">band B</span>
                                </span>
                            </div>
                            <p className="mt-2 text-xs text-text-muted">
                                Turn pill: bg-signal-self/20
                                text-signal-self-strong · opponent:
                                signal-opponent · waiting: signal-pending.
                            </p>
                        </Specimen>
                    </NextScope>
                </div>
            </Section>
        </>
    );
}
