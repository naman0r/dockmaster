import { MachineProvider, MachineBoundary } from "@/components/machines";
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
  themeColor: "#02070b",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <Boot token={getToken()} />
        <ToastProvider>
          <MachineProvider>
            <div className="grid min-h-screen grid-cols-[216px_minmax(0,1fr)] max-[900px]:grid-cols-1">
              <Nav />
              <main className="mx-auto w-[min(1180px,calc(100%-56px))] pt-6 pb-12 max-[900px]:w-[min(100%-32px,760px)] max-[900px]:pt-[26px] max-[560px]:w-[calc(100%-18px)]">
                <MachineBoundary>{children}</MachineBoundary>
              </main>
            </div>
          </MachineProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
