import type { Metadata } from "next";
import { Fira_Sans, Fira_Code } from "next/font/google";
import "./globals.css";
import { SessionProvider } from "@/lib/session";
import { AppShell } from "@/components/AppShell";

/**
 * Self-hosted by next/font: the files are served from this origin, so there is no
 * render-blocking request to Google and no third party learning who visits.
 *
 * Fira Sans for the interface and Fira Code for identifiers and figures — a humanist
 * sans with a matching mono, which is the pairing the UI/UX skill recommends for
 * data-dense admin tools. `display: swap` means text is readable before the font lands.
 */
const firaSans = Fira_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
  display: "swap",
});

const firaCode = Fira_Code({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Product Footprint Review",
  description: "Internal review tool for supplier carbon emissions submissions.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${firaSans.variable} ${firaCode.variable}`}>
      <body className="min-h-screen bg-slate-50 font-sans text-slate-900 antialiased">
        <SessionProvider>
          <AppShell>{children}</AppShell>
        </SessionProvider>
      </body>
    </html>
  );
}
