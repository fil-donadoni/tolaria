// PROTOTYPE — throwaway (branch prototype/identity-v4). Gallery of every
// dialog SHAPE the board + lobby use (census 2026-08-23: modal/GameDialog ~26,
// prompt-bar ~9, banner ~9, picker ~14, overlay ~8, context-menu ~9,
// action-sheet, bottom-sheet, side-panel, HUD), one stage per shape with real
// content, all in the v4 skin. The implementation maps the primitives
// (GameDialog, Panel, Banner, ActionSheet, BottomSheet, ContextMenu) once.
import { getImageUrl } from "~/lib/images";
import { Mana } from "./identity-atoms";
import { HAND, ID } from "./identity-fixture";

function Stage({
    shape,
    covers,
    children,
    tall,
}: {
    shape: string;
    covers: string;
    children: React.ReactNode;
    tall?: boolean;
}) {
    return (
        <section className="px-stagebox">
            <div className="px-stagehead">
                <span className="p-eyebrow strong">{shape}</span>
                <span className="p-faint" style={{ fontSize: 11 }}>
                    {covers}
                </span>
            </div>
            <div className={`px-stagebody ${tall ? "tall" : ""}`}>
                {children}
            </div>
        </section>
    );
}

function DialogFrame({
    title,
    sub,
    wide,
    children,
    footer,
}: {
    title: string;
    sub?: string;
    wide?: boolean;
    children: React.ReactNode;
    footer?: React.ReactNode;
}) {
    return (
        <div className={`pp px-dialog ${wide ? "wide" : ""}`} role="dialog">
            <div className="px-dialog-head">
                <div>
                    <div className="px-title">{title}</div>
                    {sub ? (
                        <div className="p-muted" style={{ fontSize: 12.5 }}>
                            {sub}
                        </div>
                    ) : null}
                </div>
                <button type="button" className="px-close" aria-label="Close">
                    ×
                </button>
            </div>
            <div className="p-rule" style={{ margin: "0" }} />
            <div className="px-dialog-body">{children}</div>
            {footer ? <div className="px-dialog-foot">{footer}</div> : null}
        </div>
    );
}

const PILE = [
    ID.bolt,
    ID.incinerate,
    ID.jackalPup,
    ID.moggFanatic,
    ID.fireblast,
    ID.mountain,
    ID.kird,
    ID.ftk,
    ID.cursedScroll,
    ID.wasteland,
];

export default function IdentityDialogs() {
    return (
        <div className="px-gallery">
            <Stage
                shape="Modal · GameDialog (wide)"
                covers="CardsPile browse · GraveyardTargetDialog · CastExileCost · Convoke · DiscardCost · Sideboarding · Banlist"
                tall
            >
                <DialogFrame
                    title="Graveyard"
                    sub="You · 10 cards · newest first"
                    wide
                    footer={
                        <>
                            <span className="pseg">
                                <button type="button" aria-pressed>
                                    All
                                </button>
                                <button type="button">Creatures</button>
                                <button type="button">Instants</button>
                                <button type="button">Lands</button>
                            </span>
                            <span style={{ flex: 1 }} />
                            <button type="button" className="pb">
                                Close
                            </button>
                        </>
                    }
                >
                    <div className="px-grid">
                        {PILE.map((id, i) => (
                            <div
                                key={i}
                                className={`px-gridcard ${i < 4 ? "cand" : ""}`}
                            >
                                <img src={getImageUrl(id)} alt="" />
                            </div>
                        ))}
                    </div>
                </DialogFrame>
            </Stage>

            <Stage
                shape="Modal · GameDialog (narrow)"
                covers="PauseMenu · Concede confirm · Delete deck? · Leave seat? · JoinByCode · VsAiSetup"
            >
                <DialogFrame
                    title="Concede the game?"
                    sub="Your opponent wins game 1 of 3. The match continues."
                >
                    <p
                        className="p-muted"
                        style={{ margin: "4px 0 16px", fontSize: 13 }}
                    >
                        This cannot be undone. Sideboarding opens next.
                    </p>
                    <div
                        style={{
                            display: "flex",
                            gap: 8,
                            justifyContent: "flex-end",
                        }}
                    >
                        <button type="button" className="pb">
                            Back
                        </button>
                        <button type="button" className="pb danger">
                            Concede
                        </button>
                    </div>
                </DialogFrame>
            </Stage>

            <Stage
                shape="Modal · Game over (TitleTreatment)"
                covers="GameOverDialog · ManualGameOverDialog"
            >
                <div className="pp px-dialog px-gameover">
                    <div className="px-go-art">
                        <img src={getImageUrl(ID.juzam)} alt="" />
                    </div>
                    <div className="px-go-body">
                        <div className="p-eyebrow">Game 1 of 3</div>
                        <div
                            className="px-title"
                            style={{ fontSize: 52, lineHeight: 0.95 }}
                        >
                            Victory
                        </div>
                        <div className="p-muted" style={{ marginTop: 6 }}>
                            Jace conceded at 3 life · turn 9 · 11:42
                        </div>
                        <div className="p-orn" style={{ margin: "14px 0" }}>
                            <i />
                        </div>
                        <div className="px-stats">
                            <div>
                                <b>14</b>
                                <span>damage dealt</span>
                            </div>
                            <div>
                                <b>3</b>
                                <span>spells countered</span>
                            </div>
                            <div>
                                <b>7</b>
                                <span>cards drawn</span>
                            </div>
                        </div>
                        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
                            <button type="button" className="pb primary">
                                Sideboard → game 2
                            </button>
                            <button type="button" className="pb">
                                Back to lobby
                            </button>
                        </div>
                    </div>
                </div>
            </Stage>

            <Stage
                shape="Modal · Pregame"
                covers="PregameDialog (coin toss + play/draw) · RandomRevealOverlay (coin/dice)"
            >
                <DialogFrame
                    title="You won the toss"
                    sub="Play first, or draw first and keep the extra card?"
                >
                    <div className="px-coin">
                        <div className="px-coinface">H</div>
                    </div>
                    <div
                        style={{
                            display: "grid",
                            gridTemplateColumns: "1fr 1fr",
                            gap: 8,
                        }}
                    >
                        <button type="button" className="pb primary lg">
                            Play
                        </button>
                        <button type="button" className="pb lg">
                            Draw
                        </button>
                    </div>
                </DialogFrame>
            </Stage>

            <Stage
                shape="Inputs · text fields"
                covers="CardNameInput (autocomplete) · JoinByCode · DeckImport textarea · search fields"
            >
                <DialogFrame
                    title="Name a card"
                    sub="Cursed Scroll · the named card is revealed at random from your hand"
                >
                    <label className="px-field">
                        <span className="p-eyebrow">Card name</span>
                        <input
                            className="px-input"
                            defaultValue="Fireb"
                            placeholder="Start typing…"
                        />
                    </label>
                    <div className="pp elevated px-suggest">
                        <button type="button" className="px-popitem on">
                            <span>Fireblast</span>
                            <span className="pchip">in hand ×2</span>
                        </button>
                        <button type="button" className="px-popitem">
                            <span>Fireball</span>
                        </button>
                        <button type="button" className="px-popitem">
                            <span>Firebolt</span>
                        </button>
                    </div>
                    <div className="px-two" style={{ marginTop: 12, gap: 12 }}>
                        <label className="px-field">
                            <span className="p-eyebrow">Join code</span>
                            <input
                                className="px-input code"
                                defaultValue="K7F-2QD"
                            />
                        </label>
                        <label className="px-field">
                            <span className="p-eyebrow">Decklist</span>
                            <textarea
                                className="px-input"
                                rows={3}
                                defaultValue={
                                    "4 Jackal Pup\n4 Lightning Bolt\n20 Mountain"
                                }
                            />
                        </label>
                    </div>
                    <div
                        style={{
                            display: "flex",
                            gap: 8,
                            justifyContent: "flex-end",
                            marginTop: 10,
                        }}
                    >
                        <button type="button" className="pb">
                            Cancel
                        </button>
                        <button type="button" className="pb primary">
                            Name Fireblast
                        </button>
                    </div>
                </DialogFrame>
            </Stage>

            <Stage
                shape="Modal · CastCostDialog"
                covers="X cost stepper · kicker legs · ManaSpendChoice"
            >
                <DialogFrame title="Fireblast" sub="Choose how to pay">
                    <div className="px-row">
                        <span>X</span>
                        <span className="px-stepper">
                            <button type="button">−</button>
                            <b>3</b>
                            <button type="button">+</button>
                        </span>
                        <Mana symbols={["3", "R", "R"]} />
                    </div>
                    <div className="px-row">
                        <label className="px-check">
                            <input type="checkbox" defaultChecked /> Kicker —
                            sacrifice two Mountains
                        </label>
                    </div>
                    <div className="px-row">
                        <span className="p-muted" style={{ fontSize: 12 }}>
                            Pay generic with
                        </span>
                        <span className="pseg">
                            <button type="button" aria-pressed>
                                Auto
                            </button>
                            <button type="button">
                                <img
                                    src="/img/symbols/R.svg"
                                    alt="R"
                                    width={14}
                                />
                            </button>
                            <button type="button">
                                <img
                                    src="/img/symbols/C.svg"
                                    alt="C"
                                    width={14}
                                />
                            </button>
                        </span>
                    </div>
                    <div
                        style={{
                            display: "flex",
                            gap: 8,
                            justifyContent: "flex-end",
                            marginTop: 8,
                        }}
                    >
                        <button type="button" className="pb">
                            Cancel
                        </button>
                        <button type="button" className="pb primary">
                            Cast
                        </button>
                    </div>
                </DialogFrame>
            </Stage>

            <Stage
                shape="Prompt-bar · pinned Panel"
                covers="PendingChoicePrompt (option-pick) · TargetSelectionBanner · PaymentBanner · MulliganPrompt · SacrificeBanner · AttackManaTax · ManaTapOther"
                tall
            >
                <div className="px-bars">
                    <div className="pp px-bar-prompt">
                        <div>
                            <div className="px-title" style={{ fontSize: 18 }}>
                                Fact or Fiction
                            </div>
                            <div className="p-muted" style={{ fontSize: 12 }}>
                                Choose one —
                            </div>
                        </div>
                        <div className="px-options">
                            <button type="button" className="pb">
                                Pile A · 3 cards
                            </button>
                            <button type="button" className="pb">
                                Pile B · 2 cards
                            </button>
                        </div>
                        <button
                            type="button"
                            className="px-min"
                            aria-label="Minimize"
                        >
                            −
                        </button>
                    </div>
                    <div className="pp px-bar-prompt">
                        <div>
                            <div className="px-title" style={{ fontSize: 18 }}>
                                Incinerate
                            </div>
                            <div className="p-muted" style={{ fontSize: 12 }}>
                                Pay <Mana symbols={["1", "R"]} /> · 1 of 2 paid
                            </div>
                        </div>
                        <div className="px-progress">
                            <i style={{ width: "50%" }} />
                        </div>
                        <div className="px-options">
                            <button type="button" className="pb ghost">
                                Cancel
                            </button>
                            <button type="button" className="pb primary">
                                Auto-pay
                            </button>
                        </div>
                    </div>
                    <div className="pp px-bar-prompt">
                        <div>
                            <div className="px-title" style={{ fontSize: 18 }}>
                                Opening hand
                            </div>
                            <div className="p-muted" style={{ fontSize: 12 }}>
                                London mulligan · keep 7, or go to 6 and bottom
                                1
                            </div>
                        </div>
                        <div className="px-options">
                            <button type="button" className="pb">
                                Mulligan to 6
                            </button>
                            <button type="button" className="pb primary">
                                Keep
                            </button>
                        </div>
                    </div>
                </div>
            </Stage>

            <Stage
                shape="Banner · toast"
                covers="AttackDirectionBanner (info) · ErrorToast (danger) · BotStuckNotice · OfflineBanner · IncompletenessNotice · WinnerBanner (success)"
            >
                <div className="px-banners">
                    <div className="px-banner info">
                        <span className="dot" />
                        Select creatures to attack, then a planeswalker or
                        player to direct them.
                    </div>
                    <div className="px-banner danger">
                        <span className="dot" />
                        Mutation failed: priority changed while you were
                        casting.{" "}
                        <button
                            type="button"
                            className="pb ghost"
                            style={{ height: 26, padding: "0 8px" }}
                        >
                            Copy report
                        </button>
                    </div>
                    <div className="px-banner pending">
                        <span className="dot" />
                        The AI is thinking for 14s in Declare Blockers.{" "}
                        <button
                            type="button"
                            className="pb ghost"
                            style={{ height: 26, padding: "0 8px" }}
                        >
                            Advance manually
                        </button>
                    </div>
                    <div className="px-banner success">
                        <span className="dot" />
                        Connection restored.
                    </div>
                </div>
            </Stage>

            <Stage
                shape="Picker · anchored Panel popover"
                covers="ManaChoicePicker · AltCostPicker · PhyrexianPicker · AdditionalCostPicker · ModePicker (anchored variant)"
            >
                <div className="px-anchored-demo">
                    <div className="px-anchor-card">
                        <img src={getImageUrl(ID.fow)} alt="" />
                    </div>
                    <div className="pp px-popover">
                        <div
                            className="p-eyebrow"
                            style={{ padding: "8px 10px 2px" }}
                        >
                            Cast Force of Will
                        </div>
                        <button type="button" className="px-popitem on">
                            <span>
                                Pay <Mana symbols={["3", "U", "U"]} />
                            </span>
                            <span className="pchip">mana</span>
                        </button>
                        <button type="button" className="px-popitem">
                            <span>Exile a blue card · pay 1 life</span>
                            <span className="pchip pending">alt cost</span>
                        </button>
                        <div className="p-rule" style={{ margin: "4px 0" }} />
                        <button type="button" className="px-popitem ghost">
                            Cancel
                        </button>
                    </div>
                </div>
            </Stage>

            <Stage
                shape="Overlay · fullscreen strip"
                covers="LibraryOrderPicker (scry/surveil/ponder) · PutBackPicker · TriggerOrderPrompt · PileDivisionPicker"
                tall
            >
                <div className="px-fullscreen">
                    <div className="px-fs-head">
                        <div>
                            <div className="px-title" style={{ fontSize: 22 }}>
                                Scry 3
                            </div>
                            <div className="p-muted" style={{ fontSize: 12.5 }}>
                                Drag to reorder · drop below to put on the
                                bottom
                            </div>
                        </div>
                        <button type="button" className="pb primary">
                            Done
                        </button>
                    </div>
                    <div className="px-fs-strip">
                        {[ID.bolt, ID.mountain, ID.ftk].map((id, i) => (
                            <div key={i} className="px-fs-card">
                                <img src={getImageUrl(id)} alt="" />
                                <span className="px-ord">{i + 1}</span>
                            </div>
                        ))}
                    </div>
                    <div className="px-fs-drop">Bottom of library</div>
                    <p className="p-faint" style={{ fontSize: 11, margin: 0 }}>
                        Behaviour stays exactly today's LibraryOrderPicker /
                        PileDivisionPicker / TriggerOrderPrompt (drag strip,
                        second-zone drop, ordering numerals) — only the skin
                        changes: graphite stage, hairline drop zone, ivory
                        ordinal badges, display-font title.
                    </p>
                </div>
            </Stage>

            <Stage
                shape="Context menu (desktop) · ActionSheet (touch)"
                covers="ActivatableAbilityMenu · HandCardActionMenu · pile browse menu · nameplate verbs · selectable-card"
            >
                <div className="px-two">
                    <div className="pp px-menu">
                        <div className="px-menu-head">Cursed Scroll</div>
                        <button type="button" className="px-popitem on">
                            <span>Name a card, then 3 damage</span>
                            <span className="pchip">
                                <Mana symbols={["3"]} />, T
                            </span>
                        </button>
                        <button type="button" className="px-popitem">
                            <span>Browse graveyard…</span>
                        </button>
                        <button type="button" className="px-popitem">
                            <span>Inspect</span>
                            <span className="pchip">Space</span>
                        </button>
                    </div>
                    <div className="pp px-sheet">
                        <div className="px-sheet-grip" />
                        <div className="px-sheet-card">
                            <img src={getImageUrl(ID.cursedScroll)} alt="" />
                            <div>
                                <div
                                    className="px-name"
                                    style={{ fontSize: 18 }}
                                >
                                    Cursed Scroll
                                </div>
                                <div
                                    className="p-muted"
                                    style={{ fontSize: 12 }}
                                >
                                    Artifact
                                </div>
                            </div>
                        </div>
                        <button
                            type="button"
                            className="pb primary"
                            style={{ width: "100%", height: 44 }}
                        >
                            Activate — <Mana symbols={["3"]} /> , T
                        </button>
                        <button
                            type="button"
                            className="pb"
                            style={{ width: "100%", height: 44 }}
                        >
                            Inspect
                        </button>
                        <button
                            type="button"
                            className="pb ghost"
                            style={{ width: "100%", height: 44 }}
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            </Stage>

            <Stage
                shape="Bottom sheet (phone) · HUD badges"
                covers="ControllerPhaseSheet · DeckBasicsSheet · DeckFilters · MinimizedChoiceIndicator · BotThinkingIndicator"
            >
                <div className="px-two">
                    <div className="pp px-sheet" style={{ maxWidth: 360 }}>
                        <div className="px-sheet-grip" />
                        <div
                            className="p-eyebrow strong"
                            style={{ marginBottom: 8 }}
                        >
                            Turn 6 · phases
                        </div>
                        {[
                            "Untap",
                            "Upkeep",
                            "Draw",
                            "Main 1",
                            "Begin combat",
                            "Declare attackers",
                            "Declare blockers",
                            "Damage",
                            "End combat",
                            "Main 2",
                            "End",
                        ].map((p, i) => (
                            <div
                                key={p}
                                className={`px-phase-row ${i === 5 ? "now" : i < 5 ? "done" : ""}`}
                            >
                                <i />
                                <span>{p}</span>
                                {i === 5 ? (
                                    <span className="pchip self">now</span>
                                ) : (
                                    <span className="pchip">stop</span>
                                )}
                            </div>
                        ))}
                    </div>
                    <div
                        style={{
                            display: "grid",
                            gap: 12,
                            alignContent: "start",
                        }}
                    >
                        <button type="button" className="pp px-hud pulse">
                            <span className="dot" />1 choice waiting · Fact or
                            Fiction
                        </button>
                        <div className="pp px-hud">
                            <span className="dot think" />
                            Jace is thinking…
                        </div>
                        <div className="pp px-hud">
                            <span className="p-eyebrow">Hand</span>
                            <b>7</b>
                        </div>
                    </div>
                </div>
            </Stage>

            <Stage
                shape="Hand choice · selectable cards"
                covers="DiscardCost · CastAlternativeHandCost · PutBack · selectable-card"
                tall
            >
                <DialogFrame
                    title="Discard a card"
                    sub="Cursed Scroll · choose 1"
                    wide
                    footer={
                        <>
                            <span className="p-muted" style={{ fontSize: 12 }}>
                                1 of 1 selected
                            </span>
                            <span style={{ flex: 1 }} />
                            <button type="button" className="pb">
                                Cancel
                            </button>
                            <button type="button" className="pb primary">
                                Discard
                            </button>
                        </>
                    }
                >
                    <div className="px-grid">
                        {HAND.map((c, i) => (
                            <div
                                key={i}
                                className={`px-gridcard ${i === 3 ? "sel" : c.color === "L" || i > 4 ? "" : "cand"}`}
                            >
                                <img src={getImageUrl(c.id)} alt={c.name} />
                                {i === 3 ? (
                                    <span className="px-selmark">✓</span>
                                ) : null}
                            </div>
                        ))}
                    </div>
                </DialogFrame>
            </Stage>
        </div>
    );
}
