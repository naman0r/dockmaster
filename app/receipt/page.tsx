"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { apiGet } from "@/lib/client/api";
import { usePoll } from "@/components/hooks";
import { Button, EmptyState, ErrorNote, PageHeader, Toggle, useToast } from "@/components/ui";
import type { Receipt } from "@/lib/receipt";

type Snapshot = { enabled: boolean; cachedAt: string | null; data: Receipt | null };

type Line = { l: string; r?: string; kind?: "title" | "center" | "rule" | "total" | "sub" | "note" };

const PAPER = "#f3efe4";
const INK = "#1b1b1b";
const FADED = "#6b675c";

const count = (n: number) => n.toLocaleString("en-US");
const tokens = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n));
const usd = (n: number) => `$${n.toFixed(2)}`;
const size = (kb: number) => (kb >= 1024 * 1024 ? `${(kb / 1024 / 1024).toFixed(1)} GB` : `${Math.round(kb / 1024)} MB`);
const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

function receiptLines(r: Receipt, names: boolean): Line[] {
  const rule: Line = { l: "", kind: "rule" };
  return [
    { l: "DOCKMASTER", kind: "title" },
    { l: "WEEKLY AGENT RECEIPT", kind: "center" },
    { l: `${day(r.from)} to ${day(r.to)}, ${new Date(r.to).getFullYear()}`, kind: "center" },
    rule,
    { l: "SESSIONS", r: count(r.sessions) },
    ...r.agents.map((a): Line => ({ l: a.name, r: count(a.sessions), kind: "sub" })),
    { l: "PROMPTS", r: count(r.prompts) },
    { l: "TOOL CALLS", r: count(r.toolCalls) },
    { l: "TOKENS IN", r: tokens(r.tokensIn) },
    { l: "reread from cache", r: tokens(r.tokensCached), kind: "sub" },
    { l: "TOKENS OUT", r: tokens(r.tokensOut) },
    { l: "LINES", r: `+${count(r.linesAdded)} / -${count(r.linesRemoved)}` },
    rule,
    { l: "TOP PROJECTS" },
    ...r.projects.map(
      (p, i): Line => ({
        l: names ? p.name : `project ${i + 1}`,
        r: p.costUsd ? usd(p.costUsd) : `${count(p.sessions)} ${p.sessions === 1 ? "session" : "sessions"}`,
        kind: "sub",
      }),
    ),
    rule,
    { l: "CLEANED UP" },
    { l: "orphan servers stopped", r: count(r.serversStopped), kind: "sub" },
    { l: "worktrees removed", r: count(r.worktreesRemoved), kind: "sub" },
    { l: "disk reclaimed", r: size(r.freedKb), kind: "sub" },
    rule,
    { l: "TOTAL", r: usd(r.costUsd), kind: "total" },
    ...(r.uncosted.length ? [{ l: `no cost recorded by some ${r.uncosted.join(", ")}`, kind: "note" } as Line] : []),
    rule,
    { l: "trydockmaster.vercel.app", kind: "center" },
  ];
}

const WIDTH = 400;
const PAD = 28;
const MARGIN = 36;
const TOOTH = 12;
const HEIGHTS = { title: 34, center: 20, rule: 18, total: 30, sub: 20, note: 18, plain: 22 } as const;

// Mirrors the DOM receipt line for line, so the shared image matches the page.
function drawReceipt(lines: Line[]): HTMLCanvasElement {
  const mono = getComputedStyle(document.documentElement).getPropertyValue("--font-mono") || "monospace";
  const paperHeight = PAD * 2 + lines.reduce((h, line) => h + HEIGHTS[line.kind ?? "plain"], 0);
  const scale = 2;
  const canvas = document.createElement("canvas");
  canvas.width = (WIDTH + MARGIN * 2) * scale;
  canvas.height = (paperHeight + TOOTH + MARGIN * 2) * scale;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(scale, scale);
  ctx.fillStyle = "#070b14";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = PAPER;
  ctx.beginPath();
  ctx.moveTo(MARGIN, MARGIN);
  ctx.lineTo(MARGIN + WIDTH, MARGIN);
  ctx.lineTo(MARGIN + WIDTH, MARGIN + paperHeight);
  for (let x = WIDTH; x > 0; x -= TOOTH) {
    ctx.lineTo(MARGIN + x - TOOTH / 2, MARGIN + paperHeight + TOOTH / 2);
    ctx.lineTo(MARGIN + Math.max(0, x - TOOTH), MARGIN + paperHeight);
  }
  ctx.closePath();
  ctx.fill();

  let y = MARGIN + PAD;
  const left = MARGIN + PAD;
  const right = MARGIN + WIDTH - PAD;
  for (const line of lines) {
    const kind = line.kind ?? "plain";
    const h = HEIGHTS[kind];
    const mid = y + h / 2;
    ctx.textBaseline = "middle";
    if (kind === "rule") {
      ctx.strokeStyle = FADED;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(left, mid);
      ctx.lineTo(right, mid);
      ctx.stroke();
    } else {
      ctx.fillStyle = kind === "sub" || kind === "note" || kind === "center" ? FADED : INK;
      ctx.font =
        kind === "title" ? `700 22px ${mono}` : kind === "total" ? `700 17px ${mono}` : kind === "note" ? `11px ${mono}` : `13px ${mono}`;
      if (kind === "title" || kind === "center") {
        ctx.textAlign = "center";
        ctx.fillText(line.l, MARGIN + WIDTH / 2, mid);
      } else {
        ctx.textAlign = "left";
        ctx.fillText(line.l, left + (kind === "sub" ? 14 : 0), mid);
        if (line.r) {
          ctx.fillStyle = INK;
          ctx.textAlign = "right";
          ctx.fillText(line.r, right, mid);
        }
      }
    }
    y += h;
  }
  return canvas;
}

const toBlob = (canvas: HTMLCanvasElement) =>
  new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not render the image."))), "image/png"));

export default function ReceiptPage() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [error, setError] = useState("");
  const [names, setNames] = useState(false);
  const toast = useToast();

  const refresh = useCallback(async () => {
    try {
      setSnap(await apiGet<Snapshot>("/api/receipt"));
      setError("");
    } catch (err) {
      setError(`Receipt unavailable: ${(err as Error).message}`);
    }
  }, []);

  usePoll(refresh, 30000);

  const lines = useMemo(() => (snap?.data ? receiptLines(snap.data, names) : []), [snap, names]);

  const download = async () => {
    const url = URL.createObjectURL(await toBlob(drawReceipt(lines)));
    const a = document.createElement("a");
    a.href = url;
    a.download = `dockmaster-receipt-${snap!.data!.to.slice(0, 10)}.png`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": toBlob(drawReceipt(lines)) })]);
      toast("Receipt copied as an image.");
    } catch (err) {
      toast(`Copy failed: ${(err as Error).message}`, true);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="Purser's office"
        title="Weekly receipt"
        description="The last seven days of agent sessions on this Mac, plus what Dockmaster stopped, removed, and reclaimed in that time. Cleanup counts start from the day this page shipped, since nothing logged them before."
        right={
          snap?.data ? (
            <>
              <Button onClick={copy}>Copy image</Button>
              <Button variant="stop" onClick={download}>
                Download PNG
              </Button>
            </>
          ) : null
        }
      />
      <p className="-mt-3 mb-5 flex flex-wrap items-center gap-x-6 gap-y-2 font-mono text-[11px] text-quiet">
        <Link href="/agentwatch" className="text-accent no-underline hover:underline">
          Back to Agent Watch
        </Link>
        <Toggle checked={names} onChange={setNames} label="Show project names" />
      </p>
      <ErrorNote message={error} />
      {snap?.enabled === false ? (
        <EmptyState glyph="[x]" title="Agent Watch is off" hint="The receipt is built from agent sessions. Switch Agent Watch on in Settings." />
      ) : !snap?.data ? (
        <EmptyState glyph="[ $ ]" title="Adding it up…" />
      ) : (
        <div className="mx-auto w-full" style={{ maxWidth: WIDTH }}>
          <div className="font-mono text-[13px]" style={{ background: PAPER, color: INK, padding: PAD }}>
            {lines.map((line, i) => {
              const kind = line.kind ?? "plain";
              const style = { height: HEIGHTS[kind] };
              if (kind === "rule")
                return (
                  <div key={i} style={style} className="flex items-center">
                    <div className="w-full border-t border-dashed" style={{ borderColor: FADED }} />
                  </div>
                );
              if (kind === "title" || kind === "center")
                return (
                  <div
                    key={i}
                    style={{ ...style, color: kind === "center" ? FADED : INK }}
                    className={`flex items-center justify-center ${kind === "title" ? "text-[22px] font-bold" : ""}`}
                  >
                    {line.l}
                  </div>
                );
              return (
                <div
                  key={i}
                  style={style}
                  className={`flex items-center justify-between gap-3 ${kind === "total" ? "text-[17px] font-bold" : ""} ${kind === "note" ? "text-[11px]" : ""}`}
                >
                  <span className="truncate" style={{ color: kind === "sub" || kind === "note" ? FADED : INK, paddingLeft: kind === "sub" ? 14 : 0 }}>
                    {line.l}
                  </span>
                  {line.r ? <span className="flex-none">{line.r}</span> : null}
                </div>
              );
            })}
          </div>
          <div
            aria-hidden="true"
            style={{
              height: TOOTH / 2,
              background: `linear-gradient(135deg, ${PAPER} 50%, transparent 50%), linear-gradient(225deg, ${PAPER} 50%, transparent 50%)`,
              backgroundSize: `${TOOTH}px ${TOOTH}px`,
            }}
          />
        </div>
      )}
    </>
  );
}
