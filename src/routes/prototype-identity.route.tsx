// PROTOTYPE — throwaway route (branch prototype/identity-v4; delete with
// `src/components/prototype/identity/`). UI identity v4 explorer: lobby +
// board under a quiet-chrome skin, with the open decisions exposed as knobs.
import { useEffect } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import IdentityBoard from "~/components/prototype/identity/identity-board";
import IdentityLobby from "~/components/prototype/identity/identity-lobby";
import IdentitySwitcher from "~/components/prototype/identity/identity-switcher";
import {
    DEFAULTS,
    DISPLAY_FONT_HREF,
    type IdentitySearch,
    themeStyle,
} from "~/components/prototype/identity/identity-theme";
import "~/components/prototype/identity/identity.css";

export default function PrototypeIdentityRoute() {
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
            to: "/prototype/identity",
            search: (prev: Record<string, unknown>) => ({ ...prev, ...patch }),
            replace: true,
        });
    };

    return (
        <div
            className={`proto-id frame-${value.frame}`}
            style={themeStyle(value.ground, value.accent)}
            data-surface={value.surface}
        >
            {value.surface === "board" ? (
                <IdentityBoard perm={value.perm} />
            ) : (
                <IdentityLobby density={value.density} />
            )}
            <IdentitySwitcher value={value} onChange={onChange} />
        </div>
    );
}
