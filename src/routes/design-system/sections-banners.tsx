// Banners: the 13 copy-pasted notice recipes + the floating-board-banner
// family, then the proposed single Banner component.
import { Section, Specimen, Sub, Where } from "./lib";
import { TriangleAlert, Info, Swords } from "lucide-react";

/** Replica of the 4 inline corner L-brackets (60 copies in 15 files). */
function InlineBrackets({ danger = false }: { danger?: boolean }) {
    const c = danger ? "border-danger/45" : "border-border-accent/40";
    return (
        <>
            <div
                className={`absolute top-1.5 left-1.5 h-3 w-3 border-t border-l ${c}`}
            />
            <div
                className={`absolute top-1.5 right-1.5 h-3 w-3 border-t border-r ${c}`}
            />
            <div
                className={`absolute bottom-1.5 left-1.5 h-3 w-3 border-b border-l ${c}`}
            />
            <div
                className={`absolute right-1.5 bottom-1.5 h-3 w-3 border-r border-b ${c}`}
            />
        </>
    );
}

export function BannersSection() {
    return (
        <Section
            id="banners"
            index="06"
            title="Banners & notices"
            blurb={
                <>
                    13 notice recipes copy-pasted across lobby/board/limited —
                    including one error banner duplicated verbatim 6 times —
                    plus a family of floating board prompts that re-implement
                    "floating panel + 4 corner brackets" 15 times (60 bracket
                    divs). Proposal: <code>ui/Banner</code> (tones:
                    danger/info/prominent/success) for inline notices, and a{" "}
                    <code>BoardBanner</code> shell (Panel frame + title +
                    actions) for the floating prompts.
                </>
            }
        >
            <Sub title="Inline notices — current recipes">
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                    <Specimen
                        label="Error banner — VERBATIM ×6"
                        tone="now"
                        note="join, draft, event detail, events page, play box, lobby"
                    >
                        <div className="rounded-sm border border-danger/50 bg-danger/10 px-4 py-3 text-sm text-danger">
                            Something went wrong. Please try again.
                        </div>
                        <Where>
                            join-game:166 · limited-draft-table:227 ·
                            limited-event-detail:92 · limited-events-page:89 ·
                            dashboard-play-box:116 · lobby:406 (+1 /40 variant
                            in deck-import-dialog:98)
                        </Where>
                    </Specimen>
                    <Specimen
                        label="Info note ×2 · prominent strip ×1"
                        tone="now"
                        note="incompleteness, cube availability, active game"
                    >
                        <div className="rounded-sm border border-accent/40 bg-accent-soft/40 px-2 py-1.5 text-xs text-text">
                            <span className="font-semibold tracking-wide text-accent-strong uppercase">
                                Incompleteness Notice
                            </span>{" "}
                            — this set is missing 23 cards.
                        </div>
                        <div className="mt-2 rounded-sm border-2 border-accent bg-accent/20 px-4 py-3 text-sm font-medium text-text shadow-[0_0_0_1px] shadow-accent/30">
                            You have an active game — Resume or Leave.
                        </div>
                        <Where>
                            incompleteness-notice:26 · cube-availability-note:24
                            · active-game-notice:73
                        </Where>
                    </Specimen>
                    <Specimen
                        label="Timer chip (2 states) + turn pill ×2"
                        tone="now"
                    >
                        <div className="flex flex-wrap items-center gap-3">
                            <span className="rounded-sm border border-border-accent/30 bg-surface-elevated/30 px-2 py-0.5 text-xs font-semibold text-text-muted tabular-nums">
                                0:42
                            </span>
                            <span className="rounded-sm border border-danger/50 bg-danger/10 px-2 py-0.5 text-xs font-semibold text-danger tabular-nums">
                                0:07
                            </span>
                            <span className="rounded-lg bg-emerald-500/20 px-2 py-1 text-[11px] font-bold tracking-wider text-emerald-300 uppercase">
                                Your turn
                            </span>
                            <span className="rounded-lg bg-rose-500/20 px-2 py-1 text-[11px] font-bold tracking-wider text-rose-300 uppercase">
                                Opponent&apos;s turn
                            </span>
                        </div>
                        <Where>
                            limited-draft-timer:44 · controller-pod:48 ·
                            controller-bottom-bar:48
                        </Where>
                    </Specimen>
                    <Specimen
                        label="Empty state / legality chips / inline error text"
                        tone="now"
                    >
                        <div className="rounded-sm border border-dashed border-border-subtle/30 px-4 py-3 text-xs text-text-disabled">
                            No decks yet.
                        </div>
                        <div className="mt-2 flex gap-2">
                            <span className="rounded-sm bg-success/20 px-1.5 py-0.5 text-[10px] text-success">
                                Legal
                            </span>
                            <span className="rounded-sm bg-danger/20 px-1.5 py-0.5 text-[10px] text-danger">
                                3 issues
                            </span>
                        </div>
                        <p className="mt-2 text-sm text-danger-strong">
                            Inline error text (auth-form, bug-report)
                        </p>
                        <Where>
                            deck-list:40 · deck-legality-panel:26 ·
                            auth-form:155 · bug-report-dialog:208
                        </Where>
                    </Specimen>
                </div>
            </Sub>

            <Sub
                title="Floating board prompts — current recipe"
                note="centered shell + 4 inline brackets ×15 files"
            >
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
                    <Specimen
                        label="Prompt (payment/target/sacrifice…)"
                        tone="now"
                    >
                        <div className="relative rounded-sm border border-border-subtle bg-surface px-4 py-3 shadow-[0_0_50px_rgba(0,0,0,0.8)]">
                            <InlineBrackets />
                            <p className="text-display text-center text-sm text-parchment">
                                Pay {`{2}{R}`}?
                            </p>
                            <div className="mt-2 flex justify-center gap-2">
                                <button className="rounded-sm border border-success bg-success-soft px-3 py-1 text-xs text-success-strong">
                                    Pay
                                </button>
                                <button className="rounded-sm border border-danger bg-danger-soft px-3 py-1 text-xs text-danger-strong">
                                    Cancel
                                </button>
                            </div>
                        </div>
                        <Where>
                            payment-banner · attack-mana-tax-banner ·
                            target-selection-banner · sacrifice-banner ·
                            mulligan-prompt · pending-choice-prompt ·
                            pile-division-picker
                        </Where>
                    </Specimen>
                    <Specimen label="Error toasts (danger brackets)" tone="now">
                        <div className="relative rounded-sm border border-danger/60 bg-surface px-4 py-2 shadow-[0_0_50px_rgba(0,0,0,0.8)]">
                            <InlineBrackets danger />
                            <p className="text-center text-xs text-danger-strong">
                                Not enough mana.
                            </p>
                        </div>
                        <Where>error-toast</Where>
                    </Specimen>
                    <Specimen label="Black-glass combat panels" tone="now">
                        <div className="rounded-lg border border-white/20 bg-black/90 p-3 text-white">
                            <p className="text-xs">Assign band damage</p>
                        </div>
                        <Where>
                            band-formation-panel:83 ·
                            damage-assignment-panel:123
                        </Where>
                    </Specimen>
                </div>
            </Sub>

            <Sub
                title="Proposed — ui/Banner + BoardBanner"
                note="one inline recipe, one floating shell"
            >
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                    <Specimen
                        label="Banner tones"
                        tone="next"
                        note="icon + tone tokens; danger text uses danger-strong (7.99:1)"
                    >
                        <div className="flex flex-col gap-2">
                            <div className="flex items-center gap-2 rounded-sm border border-danger/60 bg-danger-soft/40 px-3 py-2 text-sm text-danger-strong">
                                <TriangleAlert className="h-4 w-4 shrink-0" />
                                Something went wrong. Please try again.
                            </div>
                            <div className="flex items-center gap-2 rounded-sm border border-accent/40 bg-accent-soft/30 px-3 py-2 text-sm text-text">
                                <Info className="h-4 w-4 shrink-0 text-accent-strong" />
                                This set is missing 23 cards.
                            </div>
                            <div className="flex items-center gap-2 rounded-sm border-2 border-accent bg-accent/15 px-3 py-2 text-sm font-medium text-text">
                                <Swords className="h-4 w-4 shrink-0 text-accent-strong" />
                                You have an active game — Resume or Leave.
                            </div>
                            <div className="flex items-center gap-2 rounded-sm border border-success/50 bg-success-soft/40 px-3 py-2 text-sm text-success-strong">
                                Deck is legal.
                            </div>
                        </div>
                    </Specimen>
                    <Specimen
                        label="BoardBanner shell"
                        tone="next"
                        note="Panel frame (filigree) instead of 4 hand-drawn brackets"
                    >
                        <div className="panel-physical relative rounded-md border border-border-subtle px-4 py-3">
                            <span className="pointer-events-none absolute inset-0">
                                <span className="absolute top-1 left-1 h-3 w-3 rounded-tl-sm border-t-2 border-l-2 border-accent/70" />
                                <span className="absolute top-1 right-1 h-3 w-3 rounded-tr-sm border-t-2 border-r-2 border-accent/70" />
                                <span className="absolute bottom-1 left-1 h-3 w-3 rounded-bl-sm border-b-2 border-l-2 border-accent/70" />
                                <span className="absolute right-1 bottom-1 h-3 w-3 rounded-br-sm border-b-2 border-r-2 border-accent/70" />
                            </span>
                            <p className="text-display text-center text-sm text-parchment">
                                Pay {`{2}{R}`}? — via CornerFiligreeFrame
                            </p>
                            <div className="mt-2 flex justify-center gap-2">
                                <button className="btn-base btn-tone-primary px-3 py-1 text-xs">
                                    Pay
                                </button>
                                <button className="btn-base btn-tone-ghost px-3 py-1 text-xs">
                                    Cancel
                                </button>
                            </div>
                        </div>
                        <p className="mt-2 text-xs text-text-muted">
                            One shell component; the 15 files × 4 brackets → 0
                            inline copies. Toasts = Banner tone=danger in the
                            floating slot.
                        </p>
                    </Specimen>
                </div>
            </Sub>
        </Section>
    );
}
