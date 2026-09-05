"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS: Array<{ href: string; glyph: string; label: string }> = [
  { href: "/", glyph: "HB", label: "Harbor" },
  { href: "/ports", glyph: "PT", label: "Ports" },
  { href: "/repos", glyph: "RP", label: "Repos" },
  { href: "/worktrees", glyph: "WT", label: "Worktrees" },
  { href: "/health", glyph: "HL", label: "Health" },
  { href: "/hosts", glyph: "HS", label: "Hosts" },
  { href: "/processes", glyph: "PC", label: "Processes" },
  { href: "/secrets", glyph: "SC", label: "Secrets" },
  { href: "/logbook", glyph: "LB", label: "Logbook" },
  { href: "/notepad", glyph: "NP", label: "Notepad" },
];

const LINK =
  "group flex items-center gap-[11px] rounded-lg px-2.5 py-2 font-mono text-xs font-medium uppercase tracking-[0.09em] no-underline transition-colors hover:bg-accent/5 hover:text-ink";
const LINK_ACTIVE = `${LINK} bg-accent/10 text-ink shadow-[inset_2px_0_0_var(--color-accent)]`;
const GLYPH = "w-[22px] text-center font-mono text-[10px] font-semibold text-quiet transition-colors group-hover:text-accent";

export function Nav() {
  const pathname = usePathname();
  return (
    <aside className="sticky top-0 flex h-screen flex-col gap-[26px] border-r border-line bg-[#070b14]/60 px-[18px] pb-5 pt-[26px] backdrop-blur-md max-[900px]:static max-[900px]:h-auto max-[900px]:flex-row max-[900px]:flex-wrap max-[900px]:items-center max-[900px]:gap-4 max-[900px]:border-b max-[900px]:border-r-0 max-[900px]:px-4 max-[900px]:py-4">
      <Link
        href="/"
        className="group flex items-center gap-3 rounded-lg px-1.5 py-1 no-underline transition-colors hover:bg-accent/5"
      >
        <img
          src="/icon.svg"
          alt=""
          width={42}
          height={42}
          className="mark-glow flex-none rounded-[11px] ring-1 ring-line-bright transition-[box-shadow] group-hover:ring-accent/45"
        />
        <span>
          <span className="eyebrow block mb-[3px]">Local dev console</span>
          <span className="block text-[17px] font-[650] tracking-[-0.03em] text-ink">Dockmaster</span>
        </span>
      </Link>
      <nav className="flex flex-col gap-[3px] max-[900px]:flex-row max-[900px]:flex-wrap" aria-label="Modules">
        {ITEMS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={pathname === item.href ? LINK_ACTIVE : LINK}
          >
            <span className={pathname === item.href ? `${GLYPH} text-accent` : GLYPH} aria-hidden="true">
              {item.glyph}
            </span>
            {item.label}
          </Link>
        ))}
      </nav>
      <p className="mt-auto font-mono text-[9px] font-medium uppercase leading-[1.5] tracking-[0.12em] text-quiet max-[900px]:hidden">
        127.0.0.1 / secure local
      </p>
    </aside>
  );
}
