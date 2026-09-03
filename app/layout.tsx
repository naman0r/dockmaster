import type { Metadata, Viewport } from "next";
import "./globals.css";
import { getToken } from "@/lib/token";
import { Nav } from "@/components/nav";
import { Boot } from "@/components/boot";
import { ToastProvider } from "@/components/ui";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Dockmaster",
  description: "Local dev dashboard for everything running on this Mac",
};

export const viewport: Viewport = {
  themeColor: "#070b14",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Boot token={getToken()} />
        <ToastProvider>
          <div className="shell">
            <Nav />
            <main className="content">{children}</main>
          </div>
        </ToastProvider>
      </body>
    </html>
  );
}
