// PROTOTYPE — throwaway (branch prototype/identity-v4). Lobby surface.
// density=menu : game main-menu (mode tiles + loadout + deck shelf), no copy
// density=list : today's structure (Limited / Play / My decks / Presets as
//                stacked panels with rows) wearing the new skin — isolates the
//                skin from the layout so the two can be judged separately.
import { useState } from "react";
import { getArtCropImageUrl } from "~/lib/images";
import { Crop, Ornament, Pips } from "./identity-atoms";
import {
    DECKS,
    type FixtureDeck,
    ID,
    LIMITED_EVENTS,
    PRESETS,
} from "./identity-fixture";
import type { Density } from "./identity-theme";

function Nav() {
    return (
        <header className="pl-nav">
            <span className="pl-wordmark">Tolaria</span>
            <a href="#" aria-current="page">
                Home
            </a>
            <a href="#">Limited</a>
            <a href="#">Decks</a>
            <a href="#">Admin</a>
            <span style={{ flex: 1 }} />
            <span className="p-eyebrow">Test Fil</span>
            <span className="pl-avatar">T</span>
        </header>
    );
}

const MODES = [
    {
        key: "bot",
        title: "Play vs Bot",
        line: "Solo match · pick difficulty",
        chip: "Medium",
        art: ID.shivan,
    },
    {
        key: "solo",
        title: "Solo game",
        line: "Both seats · study lines",
        chip: "Sandbox",
        art: ID.timeWalk,
    },
    {
        key: "table",
        title: "Open a table",
        line: "Host · share a code",
        chip: "2 players",
        art: ID.meddling,
    },
    {
        key: "limited",
        title: "Limited",
        line: "Draft · Sealed · Cube",
        chip: "3 live events",
        art: ID.serra,
    },
] as const;

function MenuLobby() {
    const [sel, setSel] = useState(3);
    const [mode, setMode] = useState<string>("bot");
    const active = DECKS[sel];
    return (
        <div className="pm">
            <div className="pm-ambient" aria-hidden>
                <img src={getArtCropImageUrl(active.featured)} alt="" />
            </div>
            <header className="pm-hud">
                <span className="pl-wordmark">Tolaria</span>
                <span className="pchip">Premodern</span>
                <span style={{ flex: 1 }} />
                <div className="pm-name">
                    <div className="av">
                        <img src={getArtCropImageUrl(ID.fireblast)} alt="" />
                    </div>
                    <div>
                        <div className="p-eyebrow strong">Test Fil</div>
                        <div className="p-faint" style={{ fontSize: 11 }}>
                            12 decks · 41 games
                        </div>
                    </div>
                </div>
                <button
                    type="button"
                    className="pb ghost"
                    style={{ height: 34 }}
                >
                    Settings
                </button>
            </header>

            <main className="pm-main">
                <section className="pm-modes">
                    {MODES.map((m) => (
                        <button
                            key={m.key}
                            type="button"
                            className={`pp pm-mode ${mode === m.key ? "on" : ""}`}
                            onClick={() => setMode(m.key)}
                        >
                            <img src={getArtCropImageUrl(m.art)} alt="" />
                            <div className="veil" />
                            <div className="txt">
                                <span className="pchip solid">{m.chip}</span>
                                <div className="t">{m.title}</div>
                                <div className="l">{m.line}</div>
                            </div>
                        </button>
                    ))}
                </section>

                <aside className="pm-side">
                    <div className="pp pm-loadout">
                        <div className="art">
                            <img
                                src={getArtCropImageUrl(active.featured)}
                                alt=""
                            />
                            <div className="veil" />
                            <div className="cap">
                                <div className="p-eyebrow">Active deck</div>
                                <div className="t">{active.name}</div>
                                <div
                                    style={{
                                        display: "flex",
                                        gap: 8,
                                        alignItems: "center",
                                    }}
                                >
                                    <Pips colors={active.colors} />
                                    <span
                                        className="p-muted"
                                        style={{ fontSize: 12 }}
                                    >
                                        {active.cards} cards · {active.format} ·{" "}
                                        {active.archetype}
                                    </span>
                                </div>
                            </div>
                        </div>
                        <div className="ctl">
                            <div className="pseg">
                                <button type="button" aria-pressed>
                                    Bo1
                                </button>
                                <button type="button">Bo3</button>
                            </div>
                            <span className="pchip self">Legal</span>
                            <span style={{ flex: 1 }} />
                            <button
                                type="button"
                                className="pb ghost"
                                style={{ height: 32 }}
                            >
                                Edit
                            </button>
                        </div>
                        <div className="go">
                            <button
                                type="button"
                                className="pb primary lg"
                                style={{ width: "100%" }}
                            >
                                {MODES.find((m) => m.key === mode)?.title ??
                                    "Play"}{" "}
                                →
                            </button>
                        </div>
                    </div>

                    <div className="pm-shelf-head">
                        <span className="p-eyebrow strong">Your decks</span>
                        <span className="p-faint" style={{ fontSize: 11 }}>
                            {DECKS.length} · all formats
                        </span>
                    </div>
                    <div className="pm-shelf">
                        {DECKS.map((d, i) => (
                            <button
                                key={d.name}
                                type="button"
                                className={`pm-deck ${i === sel ? "on" : ""}`}
                                onClick={() => setSel(i)}
                                title={d.name}
                            >
                                <Crop id={d.featured} />
                                <div className="n">{d.name}</div>
                            </button>
                        ))}
                        <button type="button" className="pm-deck add">
                            <span>+</span>
                            <div className="n">New deck</div>
                        </button>
                    </div>
                    <div className="pm-shelf-head">
                        <span className="p-eyebrow strong">Presets</span>
                        <span className="p-faint" style={{ fontSize: 11 }}>
                            Tier 1 lists
                        </span>
                    </div>
                    <div className="pm-shelf">
                        {PRESETS.map((d) => (
                            <button
                                key={d.name}
                                type="button"
                                className="pm-deck"
                                title={d.name}
                            >
                                <Crop id={d.featured} />
                                <div className="n">{d.name}</div>
                            </button>
                        ))}
                    </div>
                </aside>
            </main>

            <footer className="pm-foot">
                {LIMITED_EVENTS.map((e) => (
                    <div key={e.name} className="pp pm-event">
                        <Crop id={e.featured} shade={false} />
                        <div>
                            <div className="t">{e.name}</div>
                            <div className="p-muted" style={{ fontSize: 11.5 }}>
                                {e.seats} seats · {e.status}
                            </div>
                        </div>
                        <button
                            type="button"
                            className="pb"
                            style={{ height: 30, padding: "0 12px" }}
                        >
                            {e.status === "Open" ? "Join" : "Resume"}
                        </button>
                    </div>
                ))}
                <Ornament className="pm-orn" />
            </footer>
        </div>
    );
}

function Row({ deck }: { deck: FixtureDeck }) {
    return (
        <div className="row">
            <span className="n">
                <Crop id={deck.featured} shade={false} />
                {deck.name}
                <Pips colors={deck.colors} />
            </span>
            <span
                className="p-muted"
                style={{ fontSize: 11.5, letterSpacing: ".04em" }}
            >
                {deck.cards} CARDS · {deck.format.toUpperCase()}
            </span>
            <span style={{ display: "flex", gap: 6 }}>
                <button type="button" className="pb" style={{ height: 32 }}>
                    Select
                </button>
                <button
                    type="button"
                    className="pb ghost"
                    style={{ height: 32 }}
                >
                    Edit
                </button>
            </span>
        </div>
    );
}

function ListLobby() {
    return (
        <>
            <Nav />
            <div className="pl-list">
                <section className="pp">
                    <div className="pp-head">
                        <span className="p-eyebrow strong">Limited</span>
                        <span className="p-muted" style={{ fontSize: 12 }}>
                            Draft or Sealed, vs players or the Bot Drafter
                        </span>
                    </div>
                    <div className="p-rule" />
                    <div className="pp-body">
                        <div
                            style={{
                                display: "flex",
                                gap: 8,
                                margin: "10px 0 14px",
                            }}
                        >
                            <button type="button" className="pb primary">
                                Browse / Create events
                            </button>
                            <button type="button" className="pb">
                                Your events (all)
                            </button>
                        </div>
                        <div className="p-eyebrow" style={{ marginBottom: 8 }}>
                            Your current events
                        </div>
                        {LIMITED_EVENTS.map((e) => (
                            <div className="row" key={e.name}>
                                <span className="n">
                                    <Crop id={e.featured} shade={false} />
                                    {e.name}
                                </span>
                                <span className="pchip pending">
                                    {e.status}
                                </span>
                            </div>
                        ))}
                    </div>
                </section>

                <section className="pp">
                    <div className="pp-head">
                        <span className="p-eyebrow strong">Play</span>
                    </div>
                    <div className="p-rule" />
                    <div className="pp-body">
                        <div
                            className="p-eyebrow"
                            style={{ margin: "10px 0 6px" }}
                        >
                            Game mode
                        </div>
                        <div className="pseg">
                            <button type="button" aria-pressed>
                                Arena mode
                            </button>
                            <button type="button">Cockatrice mode</button>
                        </div>
                        <div
                            className="pp elevated"
                            style={{
                                margin: "14px 0",
                                padding: 12,
                                display: "grid",
                                gridTemplateColumns: "72px 1fr",
                                gap: 12,
                                alignItems: "center",
                            }}
                        >
                            <Crop id={ID.ballLightning} shade={false} />
                            <div>
                                <div className="pd" style={{ fontSize: 22 }}>
                                    Sligh
                                </div>
                                <div
                                    className="p-muted"
                                    style={{ fontSize: 12 }}
                                >
                                    60 cards · Premodern
                                </div>
                            </div>
                        </div>
                        <div
                            style={{
                                display: "grid",
                                gridTemplateColumns: "1fr 1fr",
                                gap: 8,
                            }}
                        >
                            <button type="button" className="pb primary">
                                Play vs Bot
                            </button>
                            <button type="button" className="pb">
                                Solo game
                            </button>
                            <button type="button" className="pb">
                                Open a table
                            </button>
                            <button type="button" className="pb">
                                Join by code
                            </button>
                        </div>
                    </div>
                </section>

                <div className="pl-two">
                    <section className="pp">
                        <div className="pp-head">
                            <span className="p-eyebrow strong">My decks</span>
                            <button
                                type="button"
                                className="pb"
                                style={{ height: 32 }}
                            >
                                + New deck
                            </button>
                        </div>
                        <div className="p-rule" />
                        <div className="pp-body">
                            {DECKS.slice(0, 5).map((d) => (
                                <Row key={d.name} deck={d} />
                            ))}
                        </div>
                    </section>
                    <section className="pp">
                        <div className="pp-head">
                            <span className="p-eyebrow strong">
                                Preset decks
                            </span>
                            <button
                                type="button"
                                className="pb"
                                style={{ height: 32 }}
                            >
                                + New preset
                            </button>
                        </div>
                        <div className="p-rule" />
                        <div className="pp-body">
                            {PRESETS.map((d) => (
                                <Row key={d.name} deck={d} />
                            ))}
                        </div>
                    </section>
                </div>
            </div>
        </>
    );
}

export default function IdentityLobby({ density }: { density: Density }) {
    return density === "menu" ? <MenuLobby /> : <ListLobby />;
}
