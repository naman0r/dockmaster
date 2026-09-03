"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS: Array<{ href: string; glyph: string; label: string }> = [
  { href: "/", glyph: "DM", label: "Harbor" },
  { href: "/ports", glyph: "PT", label: "Ports" },
  { href: "/repos", glyph: "RP", label: "Repos" },
  { href: "/worktrees", glyph: "WT", label: "Worktrees" },
  { href: "/health", glyph: "HL", label: "Health" },
  { href: "/hosts", glyph: "HS", label: "Hosts" },
  { href: "/processes", glyph: "PC", label: "Processes" },
  { href: "/secrets", glyph: "SC", label: "Secrets" },
  { href: "/logbook", glyph: "LB", label: "Logbook" },
];

export function Nav() {
  const pathname = usePathname();
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="mark" aria-hidden="true">
          DM
        </div>
        <div>
          <p className="eyebrow">Local dev console</p>
          <h1>Dockmaster</h1>
        </div>
      </div>
      <nav className="nav" aria-label="Modules">
        {ITEMS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={pathname === item.href ? "active" : ""}
          >
            <span className="glyph" aria-hidden="true">
              {item.glyph}
            </span>
            {item.label}
          </Link>
        ))}
      </nav>
      <p className="sidebar-foot">127.0.0.1 / secure local</p>
    </aside>
  );
}
