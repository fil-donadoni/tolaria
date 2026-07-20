// Panels & dialogs: the universal frame, chrome atoms, and the modal languages.
import { useState } from "react";
import {
    Panel,
    PanelHeader,
    PanelBody,
    PanelFooter,
} from "@/components/ui/panel";
import GameDialog from "@/components/ui/game-dialog";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from "@/components/ui/dialog";
import ActionSheet from "@/components/ui/action-sheet";
import SunburstIcon from "@/components/ui/sunburst-icon";
import SubtitleFlourish from "@/components/ui/subtitle-flourish";
import OrnamentalDivider from "@/components/ui/ornamental-divider";
import { Section, Specimen, Sub, Where } from "./lib";
import { Sparkles } from "lucide-react";

export function PanelsDialogsSections() {
    const [gameOpen, setGameOpen] = useState(false);
    const [shadcnOpen, setShadcnOpen] = useState(false);
    const [sheetOpen, setSheetOpen] = useState(false);

    return (
        <>
            <Section
                id="panels"
                index="07"
                title="Panel & chrome atoms"
                blurb="The universal frame (ADR 0007): one Panel owns the physical bezel + corner filigree; everything panel-like composes it. Atoms: sunburst well, subtitle flourish, ornamental divider, stat chip, heading treatment."
            >
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                    <Panel>
                        <PanelHeader
                            title="Panel — neutral, default density"
                            subtitle="composition API"
                            icon={
                                <Sparkles className="h-8 w-8 text-accent-strong" />
                            }
                            collapsible
                        />
                        <PanelBody>
                            <p className="text-sm text-text-muted">
                                Panel + PanelHeader + PanelBody + PanelFooter.
                                38 GameDialog consumers + lobby/deck surfaces
                                sit on this frame.
                            </p>
                        </PanelBody>
                        <PanelFooter>
                            <button className="btn-base btn-tone-ghost px-3 py-1.5 text-xs">
                                Cancel
                            </button>
                            <button className="btn-base btn-tone-primary px-3 py-1.5 text-xs">
                                Confirm
                            </button>
                        </PanelFooter>
                    </Panel>
                    <div className="flex flex-col gap-4">
                        <Panel tone="accent" density="compact">
                            <p className="text-xs text-text-muted">
                                tone=&quot;accent&quot;
                                density=&quot;compact&quot; — same frame,
                                tighter padding.
                            </p>
                        </Panel>
                        <Specimen label="overlay mode" tone="plain">
                            <div className="relative rounded-md border border-border-subtle bg-surface p-4">
                                <Panel overlay />
                                <p className="text-xs text-text-muted">
                                    &lt;Panel overlay /&gt; stretches the
                                    filigree onto an existing relative box —
                                    this is what the 60 inline bracket copies
                                    collapse into.
                                </p>
                            </div>
                        </Specimen>
                        <Specimen label="Chrome atoms" tone="plain">
                            <div className="flex flex-wrap items-center gap-6">
                                <SunburstIcon size={48}>
                                    <Sparkles className="h-6 w-6 text-accent-strong" />
                                </SunburstIcon>
                                <span className="flex items-center gap-2 text-sm text-text-muted">
                                    <SubtitleFlourish side="left" />
                                    subtitle
                                    <SubtitleFlourish side="right" />
                                </span>
                            </div>
                            <OrnamentalDivider className="mt-4" />
                            <Where>
                                sunburst (panel/game-dialog) · flourish
                                (panel/title-treatment) · divider
                                (dashboard-top-bar) · StatChip PRUNED
                            </Where>
                        </Specimen>
                    </div>
                </div>
            </Section>

            <Section
                id="dialogs"
                index="08"
                title="Modal languages"
                blurb={
                    <>
                        Four languages today: <b>A</b> GameDialog (Panel frame —
                        the canonical one, 38 uses), <b>B</b> plain shadcn
                        popover (bug-report only, plus the command palette),{" "}
                        <b>C</b> the hand-rolled ActionSheet (mobile, ADR 0009 —
                        survives), <b>D</b> bespoke fixed overlays (order
                        pickers, mana/mode/phyrexian pickers, lightbox).
                        Proposal: converge B+D onto A; keep C for touch.
                    </>
                }
            >
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <Specimen label="A · GameDialog ×38" tone="now">
                        <button
                            className="btn-base btn-tone-primary w-full px-3 py-1.5 text-xs"
                            onClick={() => setGameOpen(true)}
                        >
                            Open live demo
                        </button>
                        <Where>ui/game-dialog.tsx · board+lobby+limited</Where>
                    </Specimen>
                    <Specimen label="B · plain shadcn" tone="now">
                        <button
                            className="btn-base btn-tone-secondary w-full px-3 py-1.5 text-xs"
                            onClick={() => setShadcnOpen(true)}
                        >
                            Open live demo
                        </button>
                        <Where>
                            bug-report-dialog · command.tsx (multi-combobox)
                        </Where>
                    </Specimen>
                    <Specimen label="C · ActionSheet (mobile)" tone="now">
                        <button
                            className="btn-base btn-tone-secondary w-full px-3 py-1.5 text-xs"
                            onClick={() => setSheetOpen(true)}
                        >
                            Open live demo
                        </button>
                        <Where>
                            activatable-ability-menu · hand-card-action-menu ·
                            selectable-card
                        </Where>
                    </Specimen>
                    <Specimen label="D · bespoke overlay" tone="now">
                        <div className="rounded-lg bg-black/90 p-3 ring-1 ring-white/20">
                            <p className="text-xs text-white">
                                bg-black/90 ring-white/20 — mana-choice-picker
                            </p>
                        </div>
                        <Where>
                            mana-choice · alt-cost · mode · phyrexian ·
                            library-order · trigger-order
                        </Where>
                    </Specimen>
                </div>

                <GameDialog
                    open={gameOpen}
                    onOpenChange={setGameOpen}
                    title="GameDialog"
                    subtitle="the canonical modal language"
                    icon={<Sparkles className="h-8 w-8 text-accent-strong" />}
                    showCloseButton
                    footer={
                        <button
                            className="btn-base btn-tone-primary px-3 py-1.5 text-xs"
                            onClick={() => setGameOpen(false)}
                        >
                            Done
                        </button>
                    }
                >
                    <p className="text-sm text-text-muted">
                        Panel frame, heading-panel title, gold rule — every
                        gameplay and lobby dialog speaks this.
                    </p>
                </GameDialog>

                <Dialog open={shadcnOpen} onOpenChange={setShadcnOpen}>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>Plain shadcn dialog</DialogTitle>
                            <DialogDescription>
                                bg-popover + ring-foreground/10 (1.27:1 edge) +
                                bg-black/10 scrim — the two contrast failures
                                live here. Bug-report is the only production
                                consumer; it migrates to GameDialog.
                            </DialogDescription>
                        </DialogHeader>
                        <DialogFooter showCloseButton />
                    </DialogContent>
                </Dialog>

                <ActionSheet
                    open={sheetOpen}
                    onClose={() => setSheetOpen(false)}
                    items={[
                        {
                            key: "a",
                            label: "Mobile bottom sheet (kept per ADR 0009)",
                            onSelect: () => {},
                        },
                        {
                            key: "b",
                            label: "Second action",
                            onSelect: () => {},
                        },
                    ]}
                />

                <Sub title="Convergence map">
                    <Specimen label="Who moves where" tone="next">
                        <ul className="list-inside list-disc space-y-1 text-xs text-text-muted">
                            <li>
                                bug-report-dialog → GameDialog (drops the last
                                plain-shadcn surface; scrim + edge fixed by the
                                frame)
                            </li>
                            <li>
                                <b>
                                    overlay-click dismissal unified (QA): the
                                    GameDialog popup spans ~90vw/80vh, so the
                                    backdrop is unreachable and graveyard /
                                    library / hand / exile browse dialogs
                                    don&apos;t close on overlay click.
                                </b>{" "}
                                Fix: the popup self-dismisses when the click
                                lands on the flex container itself (target ===
                                currentTarget), emulating backdrop dismissal on
                                every GameDialog.
                            </li>
                            <li>
                                command palette (multi-combobox) → Panel skin on
                                the same primitive
                            </li>
                            <li>
                                mana/alt-cost/mode/phyrexian pickers →
                                BoardBanner shell (Panel frame + scrim token)
                            </li>
                            <li>
                                library-order / trigger-order full-screen
                                pickers → scrim token + Panel frame
                            </li>
                            <li>
                                ActionSheet stays as the mobile touch pattern,
                                restyled onto tokens (bg-surface + border-accent
                                handle already; scrim → token)
                            </li>
                            <li>
                                shadcn Dialog primitive stays under GameDialog —
                                it is the behaviour layer, never a skin
                            </li>
                        </ul>
                    </Specimen>
                </Sub>
            </Section>
        </>
    );
}
