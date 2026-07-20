// Board chrome specimens + the dead layer + the application map.
import { useState } from "react";
import TitleTreatment from "@/components/ui/title-treatment";
import OrnamentalDivider from "@/components/ui/ornamental-divider";
import { Section, Specimen, Where } from "./lib";

function MockCard({ label }: { label: string }) {
    return (
        <div className="flex h-28 w-20 items-center justify-center rounded-[7%] border border-border-accent/60 bg-linear-to-b from-surface-elevated to-surface">
            <span className="px-1 text-center font-beleren text-[10px] text-text-muted">
                {label}
            </span>
        </div>
    );
}

export function BoardDeadSections() {
    const [glowKey, setGlowKey] = useState(0);

    return (
        <>
            <Section
                id="board-chrome"
                index="11"
                title="Board chrome"
                blurb="Board-only chrome atoms: preview dock glow, arrival glow, minimized-choice pill, nameplate mini-brackets, controller cue dots. Mostly token-clean already; cue dots + nameplate brackets migrate to signal/accent tokens."
            >
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <Specimen label="card-preview-dock glow" tone="plain">
                        <div className="card-preview-dock w-fit rounded-[7%]">
                            <MockCard label="Preview dock" />
                        </div>
                        <Where>index.css .card-preview-dock (#332)</Where>
                    </Specimen>
                    <Specimen
                        label="arrival glow (phase 1)"
                        tone="plain"
                        note="one-shot, reduced-motion gated"
                    >
                        <button
                            className="btn-base btn-tone-secondary mb-2 px-2 py-1 text-[10px]"
                            onClick={() => setGlowKey((k) => k + 1)}
                        >
                            replay
                        </button>
                        <div className="relative w-fit" key={glowKey}>
                            <MockCard label="Arrived" />
                            <span className="arrival-glow pointer-events-none absolute inset-0 rounded-[8%]" />
                        </div>
                    </Specimen>
                    <Specimen label="minimized-choice pill" tone="plain">
                        <span className="inline-flex animate-pulse items-center gap-2 rounded-full border border-accent bg-accent-soft px-3 py-1 text-xs text-accent-strong">
                            Choice pending…
                        </span>
                        <Where>minimized-choice-indicator:26</Where>
                    </Specimen>
                    <Specimen
                        label="attack-direction arrows + prompt info (QA)"
                        tone="next"
                        note="attacker → player/planeswalker"
                    >
                        <div className="flex items-center gap-3">
                            <MockCard label="Attacker" />
                            <svg
                                viewBox="0 0 120 40"
                                className="h-10 w-28 shrink-0"
                                aria-hidden
                            >
                                <defs>
                                    <linearGradient
                                        id="ds-arrow-grad"
                                        x1="0"
                                        y1="0"
                                        x2="1"
                                        y2="0"
                                    >
                                        <stop
                                            offset="0%"
                                            stopColor="var(--color-accent)"
                                        />
                                        <stop
                                            offset="100%"
                                            stopColor="var(--color-accent-strong)"
                                        />
                                    </linearGradient>
                                </defs>
                                <path
                                    d="M4 32 C 40 34, 74 20, 108 10"
                                    fill="none"
                                    stroke="url(#ds-arrow-grad)"
                                    strokeWidth="2.4"
                                    strokeLinecap="round"
                                />
                                <path
                                    d="M104 4 L116 8 L106 16 Z"
                                    fill="var(--color-accent-strong)"
                                />
                            </svg>
                            <MockCard label="Planeswalker" />
                        </div>
                        <p className="mt-2 text-xs text-text-muted">
                            While declaring attackers, every declared attacker
                            draws a gold filament to its target — the defending
                            player&apos;s nameplate or the chosen planeswalker —
                            reusing the board-arrows layer (blocker arrows
                            already exist). Plus an info box during the prompt:
                            what to click, how to retarget, how to confirm.
                        </p>
                        <Where>
                            target-arrow-geometry.ts (buildCombatArrows → +
                            attack arrows) · combat prompt info box
                        </Where>
                    </Specimen>
                    <Specimen
                        label="cue dots (current emerald/amber)"
                        tone="now"
                        note="→ signal-self / signal-pending"
                    >
                        <div className="flex items-center gap-3">
                            <span className="flex items-center gap-1.5 text-xs text-text-muted">
                                <span className="h-2 w-2 rounded-full bg-emerald-400" />
                                Your Go
                            </span>
                            <span className="flex items-center gap-1.5 text-xs text-text-muted">
                                <span className="h-2 w-2 rounded-full bg-amber-400/70" />
                                Waiting
                            </span>
                        </div>
                        <Where>controller-cue-badge:8-20</Where>
                    </Specimen>
                </div>
            </Section>

            <Section
                id="dead-layer"
                index="12"
                title="Dead layer — prune or adopt?"
                blurb="Shipped atoms with zero (or token) production consumers. Verdicts after review: TitleTreatment ADOPTED (game-over dialog), OrnamentalDivider KEPT, keyrune KEPT, StatChip PRUNED."
            >
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                    <Specimen
                        label="TitleTreatment — ADOPTED"
                        tone="next"
                        note="now headlines the game-over dialog (Victory/Defeat)"
                    >
                        <div className="rounded-md border border-border-subtle/50 bg-surface-base">
                            <TitleTreatment
                                title="Victory"
                                subtitle="The duel is decided"
                            />
                        </div>
                        <Where>
                            ui/title-treatment.tsx + .title-treatment-glow /
                            .runic-ring (built for #597, never wired)
                        </Where>
                    </Specimen>
                    <Specimen
                        label="StatChip — PRUNED"
                        tone="now"
                        note="deleted (0 consumers): component, .stat-chip CSS, tests updated"
                    >
                        <p className="text-xs text-text-muted">
                            The GameDialog <code>stats</code> slot stays and
                            accepts any node; if a before/after atom is ever
                            needed it can be rebuilt from tokens.
                        </p>
                    </Specimen>
                    <Specimen
                        label="OrnamentalDivider — KEPT"
                        tone="plain"
                        note="part of the chrome atom set (dashboard-top-bar)"
                    >
                        <OrnamentalDivider />
                        <Where>dashboard-top-bar:150</Where>
                    </Specimen>
                    <Specimen
                        label="keyrune font — KEPT"
                        tone="plain"
                        note="user call: the set glyph stays in set-filter"
                    >
                        <div className="flex items-center gap-4">
                            <i className="ss ss-lea ss-2x" />
                            <i className="ss ss-mir ss-2x" />
                            <span className="rounded-sm border border-border-accent/60 px-1.5 py-0.5 font-mono text-[10px] text-accent-strong">
                                LEA
                            </span>
                        </div>
                        <Where>
                            set-filter.tsx:18 (only ss-* consumer in src) — font
                            ships for this one icon
                        </Where>
                    </Specimen>
                </div>
            </Section>

            <Section
                id="application-map"
                index="13"
                title="Application map"
                blurb="Where the unification lands once the page is validated. Every area, one pass."
            >
                <Specimen label="Rollout" tone="next">
                    <div className="overflow-x-auto">
                        <table className="w-full min-w-[640px] text-left text-xs">
                            <thead>
                                <tr className="text-[10px] tracking-wider text-text-disabled uppercase">
                                    <th className="py-1 pr-4 font-medium">
                                        Area
                                    </th>
                                    <th className="py-1 pr-4 font-medium">
                                        What changes
                                    </th>
                                    <th className="py-1 font-medium">
                                        Touches
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="text-text-muted">
                                {[
                                    [
                                        "index.css",
                                        "token edits (text-disabled, +border-strong, +scrim, +signal/combat, +z layers); input-field border/focus; btn-disabled inherits new text-disabled",
                                        "1 file",
                                    ],
                                    [
                                        "ui/",
                                        "Button → plate tones; +Banner; +BoardBanner shell; bug-report → GameDialog; Input recipe; scrim on Dialog overlay",
                                        "6 files",
                                    ],
                                    [
                                        "lobby/",
                                        "btn-tone raw buttons → Button; 6 error banners → Banner; info notes → Banner; active-game strip → Banner prominent; keyrune → text chip",
                                        "~15 files",
                                    ],
                                    [
                                        "board/",
                                        "15 floating banners → BoardBanner; 60 brackets → Panel overlay; turn pills/cue dots/priority → signal tokens; selection rings → signal tokens; Beleren plates → Button; surface-2/muted → surface-elevated",
                                        "~40 files",
                                    ],
                                    [
                                        "board/ QA",
                                        "pile browse dialogs close on overlay click (GameDialog self-dismiss); counter chips → plate language; attack-direction arrows (attacker → player/planeswalker) + declare-attackers info box",
                                        "~8 files",
                                    ],
                                    [
                                        "cards/",
                                        "selectable-card rings → signal tokens; pickers → BoardBanner; token placeholder stone-* → tokens",
                                        "~8 files",
                                    ],
                                    [
                                        "limited/",
                                        "2 error banners → Banner; incompleteness/cube notes → Banner info; timer chip → Badge tones",
                                        "~6 files",
                                    ],
                                    [
                                        "auth/ + join/",
                                        "error text → Banner; join Button mix → one system",
                                        "3 files",
                                    ],
                                    ["debug/", "exempt (dev tooling)", "0"],
                                ].map(([area, what, n]) => (
                                    <tr
                                        key={area}
                                        className="border-t border-border-subtle/40 align-top"
                                    >
                                        <td className="py-1.5 pr-4 font-mono text-[11px] text-accent-strong">
                                            {area}
                                        </td>
                                        <td className="py-1.5 pr-4">{what}</td>
                                        <td className="py-1.5">{n}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </Specimen>
                <p className="text-center text-xs text-text-disabled">
                    This page is permanent — update it when the system changes.
                </p>
            </Section>
        </>
    );
}
