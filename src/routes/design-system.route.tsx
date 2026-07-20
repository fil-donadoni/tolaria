// /design-system — the living design-system census (phase 3). Every macro and
// micro element of the Tolaria UI: tokens with live WCAG ratios, chrome,
// component variants, and the phase-3 unification map. PERMANENT — unlike
// /prototype/* spikes this page is kept and evolves with the system.
import AmbientPageGround from "@/components/ui/ambient-page-ground";
import { FoundationsSections } from "./design-system/sections-foundations";
import { ButtonsSection } from "./design-system/sections-buttons";
import { BannersSection } from "./design-system/sections-banners";
import { PanelsDialogsSections } from "./design-system/sections-panels-dialogs";
import { InputsChipsSections } from "./design-system/sections-inputs-chips";
import { BoardDeadSections } from "./design-system/sections-board-dead";

const TOC: Array<[string, string]> = [
    ["palette", "01 Palette & contrast"],
    ["signal-hues", "02 Signal hues"],
    ["typography", "03 Typography"],
    ["scales", "04 Radius · scrim · z"],
    ["buttons", "05 Buttons"],
    ["banners", "06 Banners"],
    ["panels", "07 Panel & atoms"],
    ["dialogs", "08 Modal languages"],
    ["inputs", "09 Inputs"],
    ["chips", "10 Chips & rings"],
    ["board-chrome", "11 Board chrome"],
    ["dead-layer", "12 Dead layer"],
    ["application-map", "13 Application map"],
];

export default function DesignSystemRoute() {
    return (
        <div className="relative min-h-dvh bg-surface-base text-text">
            <AmbientPageGround />
            <div className="relative z-10 mx-auto max-w-6xl px-4 py-10 sm:px-8">
                <header>
                    <p className="text-label">reference — phase 3</p>
                    <h1 className="heading-panel mt-1 text-left text-3xl">
                        Design system census
                    </h1>
                    <span className="panel-rule mt-3 block h-px w-full" />
                    <p className="mt-3 max-w-3xl text-sm text-text-muted">
                        Every element of the Tolaria UI: the retired recipes (
                        <span className="rounded-sm bg-surface-elevated px-1.5 py-0.5 text-[10px] font-bold tracking-wider text-text-muted uppercase">
                            now
                        </span>
                        ) vs the unified phase-3 variant (
                        <span className="rounded-sm bg-accent-soft/50 px-1.5 py-0.5 text-[10px] font-bold tracking-wider text-accent-strong uppercase">
                            next
                        </span>
                        ). Contrast ratios computed live (WCAG). Source:
                        docs/superpowers/specs/2026-07-20-ui-ux-revamp-design.md.
                        This page is permanent — update it when the system
                        changes.
                    </p>
                    <nav className="mt-4 flex flex-wrap gap-x-4 gap-y-1">
                        {TOC.map(([id, label]) => (
                            <a
                                key={id}
                                href={`#${id}`}
                                className="text-xs text-accent-strong underline-offset-4 hover:underline"
                            >
                                {label}
                            </a>
                        ))}
                    </nav>
                </header>

                <main className="mt-10 flex flex-col gap-14">
                    <FoundationsSections />
                    <ButtonsSection />
                    <BannersSection />
                    <PanelsDialogsSections />
                    <InputsChipsSections />
                    <BoardDeadSections />
                </main>
            </div>
        </div>
    );
}
