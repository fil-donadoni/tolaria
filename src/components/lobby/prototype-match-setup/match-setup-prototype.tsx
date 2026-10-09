// PROTOTYPE — throwaway. "Three variants of the Constructed match-setup
// flow, switchable via ?variant=A|B|C, on the existing /lobby route" (real
// decks, real open tables, real Limited events; mutations stubbed — Start
// renders the payload the real flow would send).

import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { useUserDecks } from "~/hooks/useUserDecks";
import { useMyCurrentLimitedEvents } from "~/hooks/useLimitedEvent";
import {
    tableHostFormat,
    toPresetLobbyDeck,
    type LobbyDeck,
} from "~/lib/deckTypes";
import LoadingScreen from "~/components/ui/loading-screen";
import LobbyBackground from "../lobby-background";
import HomeAHero, { HOME_A_NAME } from "./home-a-hero";
import HomeBDashboard, { HOME_B_NAME } from "./home-b-dashboard";
import HomeCBento, { HOME_C_NAME } from "./home-c-bento";
import { buildHomeData } from "./proto-home-data";
import ProtoImportDialog from "./proto-import-dialog";
import PrototypeSwitcher from "./prototype-switcher";
import VariantCSplit from "./variant-c-split";
import type { ProtoOpenTable } from "./proto-step-body";
import {
    effectiveMatchFormat,
    firstOpenStep,
    loadSetup,
    payloadPreview,
    saveSetup,
    stepsFor,
    withChange,
    type MatchSetup,
} from "./match-setup-logic";

const VARIANTS = [
    { key: "A", name: HOME_A_NAME },
    { key: "B", name: HOME_B_NAME },
    { key: "C", name: HOME_C_NAME },
];

function readVariant(): string {
    const v = new URLSearchParams(window.location.search).get("variant");
    return VARIANTS.some((x) => x.key === v) ? (v as string) : "A";
}

export default function MatchSetupPrototype() {
    const navigate = useNavigate();
    const [variant, setVariant] = useState(readVariant);
    const [view, setView] = useState<"home" | "setup">("home");
    const [setup, setSetup] = useState<MatchSetup>(loadSetup);
    const [imported, setImported] = useState<LobbyDeck[]>([]);
    const [importFor, setImportFor] = useState<"me" | "opp" | null>(null);
    const [sent, setSent] = useState<Record<string, unknown> | null>(null);

    const userDecks = useUserDecks();
    const presetDecks = useQuery(api.decks.list, {});
    const openGames = useQuery(api.gameReads.listOpenGames, {});
    const activeGame = useQuery(api.gameReads.myActiveGame, {});
    const myEvents = useMyCurrentLimitedEvents();

    const decks = useMemo<LobbyDeck[]>(
        () => [
            ...imported,
            ...(userDecks ?? []),
            ...(presetDecks ?? []).map((d) => toPresetLobbyDeck(d)),
        ],
        [imported, userDecks, presetDecks]
    );
    const tables = useMemo<ProtoOpenTable[]>(
        () =>
            (openGames ?? []).map((g) => ({
                id: g._id,
                name: g.name,
                mode: g.mode === "manual" ? "cockatrice" : "arena",
                format: tableHostFormat(g),
                bestOf: g.bestOf,
            })),
        [openGames]
    );

    if (!userDecks || !presetDecks || myEvents === undefined)
        return <LoadingScreen />;

    const update = (patch: Partial<MatchSetup>) => {
        const next = withChange(setup, patch, decks);
        setSetup(next);
        saveSetup(next);
    };
    const steps = stepsFor(setup, decks);
    const ready = firstOpenStep(steps) === steps.length;
    const start = () => setSent(payloadPreview(setup));
    const switchVariant = (key: string) => {
        const url = new URL(window.location.href);
        url.searchParams.set("variant", key);
        window.history.replaceState(null, "", url);
        setVariant(key);
    };

    const variantProps = {
        setup,
        decks,
        tables,
        update,
        steps,
        ready,
        onStart: start,
        onImport: setImportFor,
    };
    const mf = effectiveMatchFormat(setup);

    return (
        <div className="relative min-h-full bg-surface-base text-text">
            <LobbyBackground />
            <div className="relative z-10 mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-4 pb-28">
                <div className="flex items-center justify-between">
                    <button
                        type="button"
                        onClick={() => setView("home")}
                        className="font-display text-lg text-parchment"
                    >
                        {view === "setup" ? "← Home" : "Lobby"}
                    </button>
                    <span className="rounded-sm bg-fuchsia-600/20 px-2 py-0.5 text-[10px] font-semibold uppercase text-fuchsia-300">
                        Prototype — throwaway
                    </span>
                </div>

                {view === "home" ? (
                    (() => {
                        const my = decks.find(
                            (d) => d.presetId === setup.myDeckId
                        );
                        const homeProps = {
                            data: buildHomeData(
                                setup,
                                decks,
                                activeGame
                                    ? {
                                          name: activeGame.name,
                                          phase:
                                              activeGame.status === "waiting"
                                                  ? "Waiting for opponent"
                                                  : "In progress",
                                          art: my?.featuredCardId ?? null,
                                          detail: `Constructed · ${
                                              activeGame.vsAi
                                                  ? "vs Bot"
                                                  : activeGame.solo
                                                    ? "Solo"
                                                    : "vs Human"
                                          }`,
                                      }
                                    : null,
                                myEvents
                            ),
                            onConstructed: () => setView("setup"),
                            onLimited: () => void navigate({ to: "/limited" }),
                            onReplay: start,
                            onEditLast: () => setView("setup"),
                            onOpenDeck: (slug: string) =>
                                void navigate({
                                    to: "/decks/$slug",
                                    params: { slug },
                                }),
                            onNewDeck: () =>
                                void navigate({ to: "/decks/create" }),
                        };
                        return variant === "A" ? (
                            <HomeAHero {...homeProps} />
                        ) : variant === "B" ? (
                            <HomeBDashboard {...homeProps} />
                        ) : (
                            <HomeCBento {...homeProps} />
                        );
                    })()
                ) : (
                    <VariantCSplit {...variantProps} />
                )}

                <details className="rounded-sm border border-dashed border-fuchsia-500/40 p-2 text-xs text-text-muted">
                    <summary className="cursor-pointer text-fuchsia-300">
                        Prototype state {sent && "· START PRESSED"}
                    </summary>
                    <pre className="mt-2 overflow-x-auto whitespace-pre-wrap">
                        {JSON.stringify(
                            { wouldSend: sent ?? payloadPreview(setup), setup },
                            null,
                            2
                        )}
                    </pre>
                </details>
            </div>

            {mf && (
                <ProtoImportDialog
                    open={importFor !== null}
                    onOpenChange={(o) => !o && setImportFor(null)}
                    matchFormat={mf}
                    onImported={(deck) => {
                        setImported((xs) => [deck, ...xs]);
                        const patch =
                            importFor === "opp"
                                ? {
                                      opponentDeckId: deck.presetId,
                                      opponentDeckChosen: true,
                                  }
                                : { myDeckId: deck.presetId };
                        const next = withChange(setup, patch, [deck, ...decks]);
                        setSetup(next);
                        saveSetup(next);
                    }}
                />
            )}
            <PrototypeSwitcher
                variants={VARIANTS}
                current={variant}
                onChange={switchVariant}
            />
        </div>
    );
}
