// PROTOTYPE — throwaway route (branch prototype/identity-v4; delete with
// `src/components/prototype/identity/`). Second identity explorer: the Card
// Preview Overlay + engine view, every dialog shape, and the board elements
// (permanent stacks, glare/tilt, adaptive zones) in the v4 skin. Shares the
// knobs (ground/frame/accent/font) with /prototype/identity.
import { useEffect } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import IdentityDialogs from "~/components/prototype/identity/identity-dialogs";
import IdentityElements from "~/components/prototype/identity/identity-elements";
import IdentityPreview from "~/components/prototype/identity/identity-preview";
import IdentitySwitcher from "~/components/prototype/identity/identity-switcher";
import {
    DEFAULTS,
    DISPLAY_FONT_HREF,
    type IdentitySearch,
    VIEWS,
    themeStyle,
} from "~/components/prototype/identity/identity-theme";
import "~/components/prototype/identity/identity.css";

export default function PrototypeDialogsRoute() {
    const search = useSearch({ strict: false }) as IdentitySearch;
    const navigate = useNavigate();
    const value: Required<IdentitySearch> = { ...DEFAULTS, ...search };

    useEffect(() => {
        if (document.getElementById("proto-identity-font")) return;
        const link = document.createElement("link");
        link.id = "proto-identity-font";
        link.rel = "stylesheet";
        link.href = DISPLAY_FONT_HREF;
        document.head.appendChild(link);
    }, []);

    const onChange = (patch: IdentitySearch) => {
        void navigate({
            to: "/prototype/dialogs",
            search: (prev: Record<string, unknown>) => ({ ...prev, ...patch }),
            replace: true,
        });
    };

    return (
        <div
            className={`proto-id frame-${value.frame}`}
            style={themeStyle(value.ground, value.accent, value.font)}
            data-font={value.font}
        >
            <div className="px-root">
                <div className="px-tabs">
                    <span className="pseg">
                        {VIEWS.map((v) => (
                            <button
                                key={v}
                                type="button"
                                aria-pressed={value.view === v}
                                onClick={() => onChange({ view: v })}
                            >
                                {v}
                            </button>
                        ))}
                    </span>
                    <span className="p-faint" style={{ fontSize: 11 }}>
                        preview = Card Preview Overlay + engine view · dialogs =
                        one stage per shape (census 2026-08-23) · elements =
                        stacks, glare/tilt, adaptive zones
                    </span>
                </div>
                {value.view === "preview" ? <IdentityPreview /> : null}
                {value.view === "dialogs" ? <IdentityDialogs /> : null}
                {value.view === "elements" ? <IdentityElements /> : null}
            </div>
            <IdentitySwitcher value={value} onChange={onChange} hideSurface />
        </div>
    );
}
