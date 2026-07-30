// `/admin` index: one card per admin page, off the shared `ADMIN_NAV` list the
// header's Admin menu also renders — a new admin page is declared once and
// shows up in both.
import { Link } from "@tanstack/react-router";
import AmbientPageGround from "@/components/ui/ambient-page-ground";
import { Panel, PanelHeader, PanelBody } from "@/components/ui/panel";
import { ADMIN_NAV } from "@/lib/adminNav";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";

export default function AdminIndexRoute() {
    useDocumentTitle("Admin");
    return (
        <div className="relative">
            <AmbientPageGround />
            <div className="relative z-10 mx-auto max-w-6xl px-6 py-8">
                <header>
                    <p className="text-label">restricted</p>
                    <h1 className="heading-panel mt-1 text-left text-3xl">
                        Admin
                    </h1>
                    <span className="panel-rule mt-3 block h-px w-full" />
                    <p className="mt-3 max-w-3xl text-sm text-text-muted">
                        Curation and developer surfaces. Everything here writes
                        through an <code>assertIsAdmin</code>-gated mutation —
                        the pages are the convenient face of that boundary, not
                        the boundary itself.
                    </p>
                </header>

                <div className="mt-8 grid grid-cols-1 gap-6 md:grid-cols-2">
                    {ADMIN_NAV.map((entry) => (
                        <Link key={entry.to} to={entry.to} className="block">
                            <Panel className="h-full transition-colors hover:border-border-accent">
                                <PanelHeader title={entry.label} />
                                <PanelBody>
                                    <p className="text-sm text-text-muted">
                                        {entry.description}
                                    </p>
                                </PanelBody>
                            </Panel>
                        </Link>
                    ))}
                </div>
            </div>
        </div>
    );
}
