// Shared chrome for one admin page: the section breadcrumb back to `/admin`,
// the page title and its one-line purpose, then the page's own body. Every
// admin page uses it so the section reads as one place instead of six panels
// that happen to share a URL prefix.
import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import AmbientPageGround from "@/components/ui/ambient-page-ground";

export default function AdminPageFrame({
    title,
    description,
    children,
}: {
    title: string;
    description?: string;
    children: ReactNode;
}) {
    return (
        <div className="relative">
            <AmbientPageGround />
            <div className="relative z-10 mx-auto max-w-6xl px-6 py-8">
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
