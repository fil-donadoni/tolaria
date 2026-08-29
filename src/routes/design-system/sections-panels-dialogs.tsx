// Panels & dialogs: the universal frame, chrome atoms, and the modal languages.
// Frame census refreshed for identity v4 (ADR 0103 §5, issue #2723).
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
                blurb="The universal frame (ADR 0007, re-skinned by ADR 0103 §5): one Panel owns the material and the edge; everything panel-like composes it. v4 is hairline + material — a 1px ivory/12 border on a 6px corner, one top-light gradient, a soft elevation shadow, and NO corner ornament. The 40px filigree (#595) and the 10px brackets that replaced it (#2581) both left Panel in #2723. Atoms that survive: sunburst well, subtitle flourish, and the ornamental divider — the one ornament the ADR keeps."
            >
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                    <Panel>
                        <PanelHeader
                            title="Panel v4 — neutral, default density"
                            subtitle="hairline + material · composition API"
                            icon={
                                <Sparkles className="h-8 w-8 text-accent-strong" />
                            }
                            collapsible
                        />
                        <PanelBody>
                            <p className="text-sm text-text-muted">
                                Panel + PanelHeader + PanelBody + PanelFooter.
                                38 GameDialog consumers + lobby/deck surfaces
                                sit on this frame. The composition API is
                                unchanged by v4 — no consumer file moved.
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
                                tighter padding. In v4 the tone picks the
                                hairline STRENGTH (ivory/12 → ivory/30), not a
                                different colour: the chrome is monochrome.
                            </p>
                        </Panel>
                        <Specimen label="overlay mode" tone="plain">
                            <div className="relative rounded-md border border-border-subtle bg-surface p-4">
                                <Panel overlay />
                                <p className="text-xs text-text-muted">
                                    &lt;Panel overlay /&gt; stretches the v4
                                    EDGE onto an existing relative box, so an
                                    already-positioned panel can be framed
                                    without re-wrapping it. It used to stretch
                                    the corner frame; the corners are gone, the
                                    seam is not.
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
                                (panel/title-treatment) · divider — the ONE
                                ornament ADR 0103 §5 keeps · StatChip PRUNED
                            </Where>
                            <p className="mt-2 text-xs text-text-muted">
                                <strong className="text-text">
                                    Deleted (issue #2734).
                                </strong>{" "}
                                <code>CornerBracket*</code> /{" "}
                                <code>CornerFiligree*</code> left Panel itself
                                in #2723; the last production consumer (
                                <code>chrome/app-header.tsx</code>) dropped its
                                manual <code>CornerBracketFrame</code> overlay
                                in #2734, which deleted the four atom
                                components, their CSS recipes and the{" "}
                                <code>--panel-bracket-*</code> tokens together.
                            </p>
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
                    <Specimen label="D · AnchoredPicker overlay" tone="now">
                        <div className="rounded-lg bg-black/90 p-3 ring-1 ring-white/20">
                            <p className="text-xs text-white">
                                Panel (density=compact) — shared shell, issue
                                #2920 folded mana-choice's last bespoke recipe
                                into it
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
