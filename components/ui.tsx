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
  return (
    <header className="mb-[26px] flex items-end justify-between gap-6 max-[560px]:flex-col max-[560px]:items-start">
      <div>
        <p className={`${EYEBROW} mb-[7px]`}>{eyebrow}</p>
        <h1 className="text-[clamp(24px,3.4vw,33px)] font-[650]">{title}</h1>
        {description ? (
          <p className="mt-2 max-w-[60ch] text-[13px] leading-relaxed text-muted">{description}</p>
        ) : null}
      </div>
      {right ? <div className="flex flex-none items-center gap-2.5 pb-1">{right}</div> : null}
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
    <section className={`card-surface rounded-[14px] border border-line${className ? ` ${className}` : ""}`}>
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
      className={`inline-block whitespace-nowrap rounded-[5px] border px-[7px] pb-1 pt-[5px] font-mono text-[8px] font-[650] uppercase tracking-[0.09em] ${
        BADGE_VARIANTS[variant ?? "accent"]
      }`}
    >
      {children}
    </span>
  );
}

const BUTTON_VARIANTS = {
  default: "border-line-bright text-muted hover:border-muted hover:text-ink",
  stop: "border-accent/30 text-accent hover:border-accent hover:bg-accent/10",
  force: "border-alarm/40 text-alarm hover:border-alarm hover:bg-alarm/10",
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
      className={`inline-flex min-h-9 min-w-[88px] items-center justify-center rounded-lg border px-4 font-mono text-[10px] font-[650] uppercase tracking-[0.1em] no-underline outline-none transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:border-line disabled:opacity-60 disabled:text-quiet ${
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
        className="relative h-[19px] w-[34px] flex-none rounded-full border border-line-bright bg-[#080e19] transition-colors after:absolute after:left-[3px] after:top-[3px] after:h-[11px] after:w-[11px] after:rounded-full after:bg-quiet after:transition-all peer-checked:border-accent peer-checked:bg-accent/10 peer-checked:after:translate-x-[15px] peer-checked:after:bg-accent peer-focus-visible:outline-2 peer-focus-visible:outline-offset-[3px] peer-focus-visible:outline-accent"
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
  return (
    <input
      className="search-icon w-full rounded-[9px] border border-line-bright bg-[#080e19] py-[9px] pl-[30px] pr-3 font-mono text-[13px] text-ink caret-accent outline-none transition-colors placeholder:text-quiet focus:border-accent"
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
    <div className="grid min-h-[210px] place-items-center rounded-[14px] border border-dashed border-line-bright bg-surface/55 p-[30px] text-center">
      <div>
        {glyph ? (
          <div className="mb-3.5 font-mono text-[28px] tracking-[-0.12em] text-accent opacity-80">
            {glyph}
          </div>
        ) : null}
        <h2 className="mb-[7px] text-base">{title}</h2>
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
      className="my-3.5 rounded-[10px] border border-alarm/30 bg-alarm/10 px-[15px] py-3 font-mono text-xs leading-relaxed text-[#ffc3c3]"
      role="alert"
    >
      {message}
    </div>
  );
}

export function Stat({ value, label }: { value: ReactNode; label: string }) {
  return (
    <div className="flex items-baseline gap-2.5">
      <strong className="font-mono text-[32px] leading-none tracking-[-0.06em] text-accent">
        {value}
      </strong>
      <span className={MONO_LABEL}>{label}</span>
    </div>
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
        className={`fixed bottom-6 right-6 z-10 max-w-[min(400px,calc(100vw-48px))] rounded-[9px] border bg-[#111c2b] px-4 py-3 font-mono text-[11px] font-medium shadow-[0_20px_60px_rgba(0,0,0,0.48)] transition-all ${
          toast?.alarm ? "border-alarm/35 text-[#ffc1c1]" : "border-line-bright text-ink"
        } ${toast ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-2 opacity-0"}`}
        role="status"
        aria-live="polite"
      >
        {toast?.message}
      </div>
    </ToastContext.Provider>
  );
}
