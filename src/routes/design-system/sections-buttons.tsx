// Buttons: the three coexisting systems, then the proposed unified matrix.
import { Button } from "@/components/ui/button";
import { Section, Specimen, Sub, Where } from "./lib";

function Row({ children }: { children: React.ReactNode }) {
    return <div className="flex flex-wrap items-center gap-2">{children}</div>;
}

export function ButtonsSection() {
    return (
        <Section
            id="buttons"
            index="05"
            title="Buttons"
            blurb={
                <>
                    Three systems coexist: the forged-plate{" "}
                    <code>.btn-tone-*</code> (42 uses/21 files, lobby-heavy),
                    the shadcn <code>&lt;Button&gt;</code> cva (10 uses/5
                    files), and ad-hoc board plates (~30 recipes). Proposal: ONE
                    component — <code>ui/Button</code> re-mapped onto the
                    forged-plate tones; shadcn keeps behaviour/accessibility,
                    all colour from the plate classes. Board's{" "}
                    <code>ActionButton</code> becomes a thin re-export.
                </>
            }
        >
            <Sub
                title="System A — .btn-tone-* forged plate"
                note="index.css:223-317 · 42 uses in 21 files"
            >
                <Specimen label="btn-base + btn-tone-*" tone="now">
                    <Row>
                        <button className="btn-base btn-tone-primary px-3 py-1.5 text-xs">
                            Primary
                        </button>
                        <button className="btn-base btn-tone-secondary px-3 py-1.5 text-xs">
                            Secondary
                        </button>
                        <button className="btn-base btn-tone-destructive px-3 py-1.5 text-xs">
                            Destructive
                        </button>
                        <button className="btn-base btn-tone-ghost px-3 py-1.5 text-xs">
                            Ghost
                        </button>
                        <button className="btn-base btn-disabled px-3 py-1.5 text-xs">
                            Disabled
                        </button>
                    </Row>
                    <Where>
                        lobby.tsx ×7, dashboard-top-bar ×3, ActionButton (board)
                        ×28, auth, join, limited…
                    </Where>
                </Specimen>
            </Sub>

            <Sub
                title="System B — shadcn Button (cva)"
                note="ui/button.tsx · was 10 uses in 5 files — MERGED"
            >
                <Specimen
                    label="<Button variant=…> — now re-mapped onto plates"
                    tone="next"
                    note="retired variants: default → primary, outline → secondary; same API, plate colour"
                >
                    <Row>
                        <Button>Primary</Button>
                        <Button variant="secondary">Secondary</Button>
                        <Button variant="ghost">Ghost</Button>
                        <Button variant="destructive">Destructive</Button>
                        <Button variant="link">Link</Button>
                        <Button disabled>Disabled</Button>
                    </Row>
                    <Where>
                        bug-report ×4, join ×3, cast-cost-dialog ×2,
                        waiting-for-opponent ×2 — all migrated
                    </Where>
                </Specimen>
            </Sub>

            <Sub
                title="System C — ad-hoc plates"
                note="~30 bespoke recipes, board-dominant"
            >
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                    <Specimen
                        label='Bespoke "display plate" (15 uses in 10 files)'
                        tone="now"
                    >
                        <Row>
                            <button className="text-display rounded-sm border border-accent bg-accent-soft px-3 py-1.5 text-xs text-accent-strong hover:bg-accent-soft/80">
                                Confirm
                            </button>
                            <button className="text-display rounded-sm border border-danger bg-danger-soft px-3 py-1.5 text-xs text-danger-strong hover:bg-danger-soft/80">
                                Decline
                            </button>
                        </Row>
                        <Where>
                            pending-choice-prompt ×3, pile-division ×3,
                            target-selection ×2, mulligan…
                        </Where>
                    </Specimen>
                    <Specimen
                        label="success/danger soft plates + circle/pill"
                        tone="now"
                    >
                        <Row>
                            <button className="rounded-sm border border-success bg-success-soft px-3 py-1.5 text-xs text-success-strong">
                                Pay {"{G}"}
                            </button>
                            <button className="flex h-8 w-8 items-center justify-center rounded-full border border-accent bg-accent/10 text-accent">
                                1
                            </button>
                            <button className="rounded-b bg-accent-strong/90 px-2 py-1 text-xs font-bold text-white">
                                Card overlay
                            </button>
                            <button className="rounded bg-white/10 px-2 py-1 text-xs text-white/70 hover:bg-white/20">
                                Debug
                            </button>
                            <button className="text-xs text-text-muted hover:underline">
                                text-link
                            </button>
                        </Row>
                        <Where>
                            attack-mana-tax, payment, library-order,
                            companion-summon, debug, lobby-footer
                        </Where>
                    </Specimen>
                </div>
            </Sub>

            <Sub
                title="Proposed — one Button, plate tones"
                note="ui/Button variant → tone; sizes xs/sm/default/lg/icon"
            >
                <Specimen
                    label="Unified matrix"
                    tone="next"
                    note="colour = btn-tone plates; chrome = cva sizes + base-ui behaviour"
                >
                    <div className="flex flex-col gap-3">
                        <Row>
                            <button className="btn-base btn-tone-primary px-4 py-2 text-sm">
                                Confirm
                            </button>
                            <button className="btn-base btn-tone-secondary px-4 py-2 text-sm">
                                Cancel
                            </button>
                            <button className="btn-base btn-tone-destructive px-4 py-2 text-sm">
                                Concede
                            </button>
                            <button className="btn-base btn-tone-ghost px-3 py-2 text-sm">
                                Skip
                            </button>
                            <button className="btn-base btn-disabled px-4 py-2 text-sm">
                                Disabled
                            </button>
                        </Row>
                        <Row>
                            <button className="btn-base btn-tone-primary px-2.5 py-1 text-[0.8rem]">
                                Small
                            </button>
                            <button className="btn-base btn-tone-secondary px-2.5 py-1 text-[0.8rem]">
                                Small
                            </button>
                            <button className="btn-base btn-tone-destructive px-2 py-0.5 text-xs">
                                xs
                            </button>
                            <button className="text-xs text-text-muted underline-offset-4 hover:text-parchment hover:underline">
                                Link tone
                            </button>
                        </Row>
                    </div>
                    <p className="mt-3 text-xs text-text-muted">
                        Migration: <code>variant=&quot;default&quot;</code> →
                        primary, <code>outline</code> → secondary, destructive/
                        ghost keep names, bespoke display plates →
                        primary/danger sm, circle pickers stay bespoke (card
                        numerals), card-overlay buttons keep their recipe
                        (fixed: bg-surface-muted → surface-elevated), debug
                        buttons stay debug.
                    </p>
                </Specimen>
            </Sub>
        </Section>
    );
}
