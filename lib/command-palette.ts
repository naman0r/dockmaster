import { MODULE_LINKS } from "@/lib/navigation";

export type Command = {
  id: string;
  label: string;
  detail: string;
  group: "Modules" | "Projects" | "Ports" | "Notes";
  glyph: string;
  href: string;
  keywords?: string;
};

export const MODULE_COMMANDS: Command[] = MODULE_LINKS.map((m) => ({
  id: m.href, label: m.label, detail: m.description,
  group: "Modules", glyph: m.glyph, href: m.href,
}));

export function targetId(kind: string, identity: string): string {
  return `${kind}-${encodeURIComponent(identity)}`;
}

export function targetHref(page: string, kind: string, identity: string): string {
  return `${page}#${encodeURIComponent(targetId(kind, identity))}`;
}

// Every word must match. Prefer exact labels and prefixes over detail matches.
export function searchCommands(commands: Command[], query: string): Command[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return commands.filter((c) => c.group === "Modules");
  const words = normalized.split(/\s+/);
  return commands
    .filter((c) => words.every((word) =>
      `${c.label} ${c.detail} ${c.group} ${c.keywords ?? ""}`.toLowerCase().includes(word)))
    .map((c) => ({ command: c, score: c.label.toLowerCase() === normalized ? 0
      : c.label.toLowerCase().startsWith(normalized) ? 1 : 2 }))
    .sort((a, b) => a.score - b.score)
    .slice(0, 40)
    .map((c) => c.command);
}
