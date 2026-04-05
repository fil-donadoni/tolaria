import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { JSONTree } from "react-json-tree";

const theme = {
    scheme: "tolaria",
    base00: "transparent",
    base01: "#383830",
    base02: "#49483e",
    base03: "#75715e",
    base04: "#a59f85",
    base05: "#f8f8f2",
    base06: "#f5f4f1",
    base07: "#f9f8f5",
    base08: "#f92672",
    base09: "#fd971f",
    base0A: "#f4bf75",
    base0B: "#a6e22e",
    base0C: "#a1efe4",
    base0D: "#66d9ef",
    base0E: "#ae81ff",
    base0F: "#cc6633",
};

export default function DebugPanel({ gameId }: { gameId: Id<"games"> }) {
    const [isOpen, setIsOpen] = useState(true);
    const state = useQuery(api.game.getFullState, { gameId });

    return (
        <div className="fixed top-4 right-4 z-50 font-mono text-xs">
            <div className="rounded-lg border border-white/10 bg-black/90 shadow-2xl backdrop-blur">
                <button
                    onClick={() => setIsOpen(!isOpen)}
                    className="flex w-full items-center justify-between px-3 py-2 text-white/70 hover:text-white"
                >
                    <span className="font-semibold">Debug</span>
                    <span>{isOpen ? "\u25B2" : "\u25BC"}</span>
                </button>

                {isOpen && (
                    <div className="max-h-[70vh] w-[400px] overflow-auto border-t border-white/10 px-2 py-1">
                        {state ? (
                            <JSONTree
                                data={state}
                                theme={theme}
                                invertTheme={false}
                                shouldExpandNodeInitially={(
                                    _keyPath,
                                    _data,
                                    level
                                ) => level < 2}
                            />
                        ) : (
                            <span className="text-white/40">Loading...</span>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
