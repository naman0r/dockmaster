"use client";

import { MachineSelector, useMachine } from "./machines";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { MODULE_LINKS } from "@/lib/navigation";
import { useModuleSettings } from "@/components/hooks";
import type { ModuleId } from "@/lib/config.client";
import { CommandPalette } from "@/components/command-palette";

const LINK =
  "group flex items-center gap-[11px] rounded-lg px-2.5 py-2 font-mono text-xs font-medium uppercase tracking-[0.09em] no-underline transition-colors hover:bg-accent/5 hover:text-ink";
const LINK_ACTIVE = `${LINK} bg-accent/10 text-ink shadow-[inset_2px_0_0_var(--color-accent)]`;
const GLYPH =
  "w-[22px] text-center font-mono text-[10px] font-semibold text-quiet transition-colors group-hover:text-accent";

export function Nav() {
  const pathname = usePathname();
  const { machine } = useMachine();
  const modules = useModuleSettings();
  const links = MODULE_LINKS.filter(
    (item) => modules?.[item.href.slice(1) as ModuleId] !== false,
  );
  return (
    <aside className="sticky top-0 flex h-screen flex-col gap-[26px] border-r border-line bg-[#070b14]/60 px-[18px] pb-5 pt-[26px] backdrop-blur-md max-[900px]:static max-[900px]:h-auto max-[900px]:flex-row max-[900px]:flex-wrap max-[900px]:items-center max-[900px]:gap-4 max-[900px]:border-b max-[900px]:border-r-0 max-[900px]:px-4 max-[900px]:py-4">
      <Link
        href="/"
        className="group flex items-center gap-3 rounded-lg px-1.5 py-1 no-underline transition-colors hover:bg-accent/5"
      >
        <img
          src="/icon.png"
          alt=""
          width={42}
          height={42}
          className="h-[42px] w-[42px] flex-none object-contain"
        />
        <span>
          <span className="eyebrow block mb-[3px]">Local console</span>
          <span className="block text-[17px] font-[650] tracking-[-0.03em] text-ink">
            Dockmaster
          </span>
        </span>
      </Link>
      <MachineSelector />
      <CommandPalette key={machine.id} />
      <nav
        className="flex flex-col gap-[3px] max-[900px]:flex-row max-[900px]:flex-wrap"
        aria-label="Modules"
      >
        {links.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={pathname === item.href ? LINK_ACTIVE : LINK}
          >
            <span
              className={
                pathname === item.href ? `${GLYPH} text-accent` : GLYPH
              }
              aria-hidden="true"
            >
              {item.glyph}
            </span>
            {item.label}
          </Link>
        ))}
        <Link
          href="/settings"
          className={pathname === "/settings" ? LINK_ACTIVE : LINK}
        >
          Settings
        </Link>
      </nav>
      <p className="mt-auto font-mono text-[9px] font-medium uppercase leading-[1.5] tracking-[0.12em] text-quiet max-[900px]:hidden">
        127.0.0.1 / secure local
      </p>
    </aside>
  );
}
