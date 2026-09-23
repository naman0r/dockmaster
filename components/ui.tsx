"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";

import { MODULE_LINKS } from "@/lib/navigation";

const EYEBROW = "eyebrow";
const MONO_LABEL = "font-mono text-[9px] font-semibold uppercase tracking-[0.12em]";

export function PageHeader({
  eyebrow,
  title,
  description,
  right,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  right?: ReactNode;
}) {
  const pathname = usePathname();
  const glyph = MODULE_LINKS.find((m) => m.href === pathname)?.glyph ?? "DM";

  useEffect(() => {
    document.title = pathname === "/" ? "Dockmaster" : `${title} · Dockmaster`;
  }, [pathname, title]);

  return (
    <header className="mb-[26px]">
      <div className="flex items-end justify-between gap-6 max-[560px]:flex-col max-[560px]:items-start">
        <svg
          viewBox="0 0 64 64"
          aria-hidden="true"
          className="h-16 w-16 flex-none self-center fill-none max-[560px]:hidden"
        >
          <circle cx="32" cy="32" r="30" pathLength={360} strokeDasharray="1 5" strokeWidth="3" className="stroke-line-bright" />
          <circle cx="32" cy="32" r="25" pathLength={360} strokeDasharray="70 20 30 60" strokeWidth="1.5" className="origin-center animate-orbit stroke-amber/70 [transform-box:view-box]" />
          <circle cx="32" cy="32" r="20" strokeWidth="1" className="stroke-accent/60" />
          <text x="32" y="36" textAnchor="middle" className="glow fill-accent font-mono text-[11px] font-semibold tracking-[0.08em]">
            {glyph}
          </text>
        </svg>
        <div className="mr-auto">
          <p className={`${EYEBROW} mb-[9px]`}>{eyebrow}</p>
          <h1 className="glow text-[clamp(22px,3vw,30px)] font-light uppercase tracking-[0.14em]">{title}</h1>
          {description ? (
            <p className="mt-2.5 max-w-[60ch] text-[13px] leading-relaxed text-muted">{description}</p>
          ) : null}
        </div>
        {right ? <div className="flex flex-none items-center gap-2.5 pb-1">{right}</div> : null}
      </div>
      <div aria-hidden="true" className="ruler mt-4" />
    </header>
  );
}

export function Card({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`card-surface rounded-[2px] border border-line${className ? ` ${className}` : ""}`}>
      {children}
    </section>
  );
}

const BADGE_VARIANTS = {
  accent: "border-accent/25 bg-accent/10 text-accent",
  scope: "border-line-bright bg-white/[0.018] text-muted",
  exposed: "border-alarm/30 bg-alarm/10 text-alarm",
  alarm: "border-alarm/30 bg-alarm/10 text-alarm",
  quiet: "border-line bg-transparent text-quiet",
} as const;

export function Badge({
  children,
  variant,
}: {
  children: ReactNode;
  variant?: keyof typeof BADGE_VARIANTS;
}) {
  return (
    <span
      className={`inline-block whitespace-nowrap rounded-[2px] border px-[7px] pb-1 pt-[5px] font-mono text-[8px] font-medium uppercase tracking-[0.09em] ${
        BADGE_VARIANTS[variant ?? "accent"]
      }`}
    >
      {children}
    </span>
  );
}

const BUTTON_VARIANTS = {
  default: "border-line-bright text-muted hover:border-accent/60 hover:text-ink",
  stop: "border-accent/40 bg-accent/5 text-accent hover:border-accent hover:bg-accent/15 hover:shadow-[0_0_16px_rgba(79,216,255,0.25)]",
  force: "border-alarm/50 bg-alarm/5 text-alarm hover:border-alarm hover:bg-alarm/15 hover:shadow-[0_0_16px_rgba(255,95,82,0.25)]",
  ghost: "border-transparent text-muted hover:text-ink",
} as const;

export function Button({
  children,
  onClick,
  variant,
  disabled,
  busy,
  title,
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: keyof typeof BUTTON_VARIANTS;
  disabled?: boolean;
  busy?: boolean;
  title?: string;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      className={`inline-flex min-h-9 min-w-[88px] items-center justify-center rounded-lg border px-4 font-mono text-[10px] font-medium uppercase tracking-[0.16em] no-underline outline-none transition-[color,background-color,border-color,box-shadow] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:border-line disabled:opacity-60 disabled:text-quiet ${
        BUTTON_VARIANTS[variant ?? "default"]
      }${busy ? " cursor-wait animate-breathe" : ""}`}
      onClick={onClick}
      disabled={disabled || busy}
      title={title}
    >
      {children}
    </button>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2.5 font-mono text-xs font-medium text-muted">
      <input
        type="checkbox"
        className="peer sr-only"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span
        aria-hidden="true"
        className="relative h-[19px] w-[34px] flex-none rounded-full border border-line-bright bg-surface transition-colors after:absolute after:left-[3px] after:top-[3px] after:h-[11px] after:w-[11px] after:rounded-full after:bg-quiet after:transition-all peer-checked:border-accent peer-checked:bg-accent/10 peer-checked:after:translate-x-[15px] peer-checked:after:bg-accent peer-focus-visible:outline-2 peer-focus-visible:outline-offset-[3px] peer-focus-visible:outline-accent"
      />
      <span>{label}</span>
    </label>
  );
}

export function SearchInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
}) {
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement).closest("input, textarea, select, [contenteditable]");
      if (e.key !== "/" || typing || e.metaKey || e.ctrlKey || e.altKey) return;
      e.preventDefault();
      input.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <input
      ref={input}
      title="Press / to focus"
      className="w-full rounded-[2px] border border-line-bright bg-surface py-[9px] px-3 font-mono text-[13px] text-ink caret-accent outline-none transition-colors placeholder:text-quiet focus:border-accent"
      type="search"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      autoComplete="off"
      spellCheck={false}
    />
  );
}

export function EmptyState({
  glyph,
  title,
  hint,
}: {
  glyph?: string;
  title: string;
  hint?: string;
}) {
  return (
    <div className="grid min-h-[210px] place-items-center rounded-[2px] border border-dashed border-line-bright bg-accent/[0.02] p-[30px] text-center">
      <div>
        {glyph ? (
          <div className="mb-3.5 font-mono text-[28px] tracking-[-0.12em] text-accent opacity-80">
            {glyph}
          </div>
        ) : null}
        <h2 className="mb-[7px] text-sm font-normal uppercase tracking-[0.14em]">{title}</h2>
        {hint ? (
          <p className="font-mono text-[11px] leading-relaxed text-muted">{hint}</p>
        ) : null}
      </div>
    </div>
  );
}

export function ErrorNote({ message }: { message: string }) {
  if (!message) return null;
  return (
    <div
      className="my-3.5 rounded-[2px] border border-alarm/30 bg-alarm/10 px-[15px] py-3 font-mono text-xs leading-relaxed text-alarm"
      role="alert"
    >
      {message}
    </div>
  );
}

export function Stat({ value, label }: { value: ReactNode; label: string }) {
  return (
    <div className="flex items-baseline gap-2.5">
      <strong className="glow font-mono text-[32px] font-light leading-none tracking-[-0.04em] text-accent">
        {value}
      </strong>
      <span className={MONO_LABEL}>{label}</span>
    </div>
  );
}

// Length encodes magnitude; the number beside it is the label, so the bar is
// decorative to assistive tech. Scale pct against the largest value in view.
export function Bar({ pct, alarm }: { pct: number; alarm?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className="block h-1.5 w-full bg-line [mask-image:repeating-linear-gradient(90deg,#000_0_3px,transparent_3px_5px)]"
    >
      <span
        className={`block h-full ${alarm ? "bg-alarm shadow-[0_0_8px_var(--color-alarm)]" : "bg-accent shadow-[0_0_8px_var(--color-accent)]"}`}
        style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
      />
    </span>
  );
}

type ToastFn = (message: string, alarm?: boolean) => void;

const ToastContext = createContext<ToastFn>(() => {});

export function useToast(): ToastFn {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ message: string; alarm: boolean } | null>(null);
  const timer = useRef<number | null>(null);

  const show = useCallback<ToastFn>((message, alarm = false) => {
    if (timer.current) window.clearTimeout(timer.current);
    setToast({ message, alarm });
    timer.current = window.setTimeout(() => setToast(null), 3600);
  }, []);

  useEffect(() => {
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div
        className={`fixed bottom-6 right-6 z-10 max-w-[min(400px,calc(100vw-48px))] rounded-[2px] border border-l-2 bg-surface/95 px-4 py-3 font-mono text-[11px] font-medium shadow-[0_0_30px_rgba(79,216,255,0.12)] backdrop-blur transition-all ${
          toast?.alarm ? "border-alarm/50 text-alarm" : "border-accent/50 text-ink"
        } ${toast ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-2 opacity-0"}`}
        role="status"
        aria-live="polite"
      >
        {toast?.message}
      </div>
    </ToastContext.Provider>
  );
}
