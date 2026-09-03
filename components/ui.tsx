"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

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
    <header className="page-head">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        {description ? <p className="desc">{description}</p> : null}
      </div>
      {right ? <div className="head-right">{right}</div> : null}
    </header>
  );
}

export function Card({
  children,
  className,
  style,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <section className={`card${className ? ` ${className}` : ""}`} style={style}>
      {children}
    </section>
  );
}

export function Badge({
  children,
  variant,
}: {
  children: ReactNode;
  variant?: "accent" | "scope" | "exposed" | "alarm" | "quiet";
}) {
  const cls = variant && variant !== "accent" ? `badge ${variant}` : "badge";
  return <span className={cls}>{children}</span>;
}

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
  variant?: "default" | "stop" | "force" | "ghost";
  disabled?: boolean;
  busy?: boolean;
  title?: string;
  type?: "button" | "submit";
}) {
  const classes = ["btn"];
  if (variant) classes.push(variant);
  if (busy) classes.push("busy");
  return (
    <button
      type={type}
      className={classes.join(" ")}
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
    <label className="toggle">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="switch" aria-hidden="true" />
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
      className="search"
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
    <div className="empty">
      <div>
        {glyph ? <div className="empty-glyph">{glyph}</div> : null}
        <h2>{title}</h2>
        {hint ? <p>{hint}</p> : null}
      </div>
    </div>
  );
}

export function ErrorNote({ message }: { message: string }) {
  if (!message) return null;
  return (
    <div className="error-note" role="alert">
      {message}
    </div>
  );
}

export function Stat({ value, label }: { value: ReactNode; label: string }) {
  return (
    <div className="stat">
      <strong>{value}</strong>
      <span>{label}</span>
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
        className={`toast${toast?.alarm ? " alarm" : ""}${toast ? " visible" : ""}`}
        role="status"
        aria-live="polite"
      >
        {toast?.message}
      </div>
    </ToastContext.Provider>
  );
}
