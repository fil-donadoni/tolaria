// Shared chrome for one admin page: the section breadcrumb back to `/admin`,
// the page title and its one-line purpose, then the page's own body. Every
// admin page uses it so the section reads as one place instead of six panels
// that happen to share a URL prefix.
//
// It also owns the admin pages' `document.title`: the frame already receives
// the page's name, so a new admin page gets a correct tab title by using the
// frame, with nothing extra to remember.
import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import AmbientPageGround from "@/components/ui/ambient-page-ground";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";

// Two widths. Reading pages keep `max-w-6xl` (72rem). A TOOL page — a table
// that must take the screen, the Card Profiles / Pick Ratings review passes
// (PRD #8772, issue #8903; prototype verdict 2026-11-07) — opts into `wide`,
// 1680px (`max-w-420`): rail + a table of five sortable columns do not fit in
// 72rem, and a wider frame beats a horizontally scrolling table. Decided
// here, once: a page that merely has a long list stays on the narrow frame.
const FRAME_WIDTH = {
    reading: "max-w-6xl",
    wide: "max-w-420",
} as const;

export default function AdminPageFrame({
    title,
    description,
    wide = false,
    children,
}: {
    title: string;
    description?: string;
    /** A tool page on the 1680px frame (see `FRAME_WIDTH`). */
    wide?: boolean;
    children: ReactNode;
}) {
    useDocumentTitle(title);

    return (
        <div className="relative">
            <AmbientPageGround />
            <div
                className={`relative z-10 mx-auto px-6 py-8 ${FRAME_WIDTH[wide ? "wide" : "reading"]}`}
            >
                <header>
                    <Link
                        to="/admin"
                        className="text-label text-text-muted transition-colors hover:text-parchment"
                    >
                        ← Admin
                    </Link>
                    <h1 className="heading-panel mt-2 text-left text-3xl">
                        {title}
                    </h1>
                    <span className="panel-rule mt-3 block h-px w-full" />
                    {description && (
                        <p className="mt-3 max-w-3xl text-sm text-text-muted">
                            {description}
                        </p>
                    )}
                </header>
                <div className="mt-8 flex flex-col gap-6">{children}</div>
            </div>
        </div>
    );
}
