import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import NavBar from "./components/NavBar";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://insidetrader.app"),
  title: "InsideTrader",
  description: "Money in Congress",
  alternates: {
    canonical: "/",
  },
  icons: {
    icon: "/favicon.ico",
    apple: "/favicon.ico",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <NavBar />
        <div style={{ background: '#fefce8', borderBottom: '1px solid #fde68a', padding: '8px 16px' }}>
          <p className="mx-auto max-w-5xl text-center text-xs text-yellow-800 font-medium">
            ⚠️ Senate disclosure data is currently incomplete — the Senate&apos;s eFD system has been experiencing intermittent outages affecting data retrieval. House data is fully up to date.
          </p>
        </div>
        <main>{children}</main>
        <footer style={{ background: 'rgba(15,23,42,0.97)', borderTop: '1px solid rgba(255,255,255,0.07)', padding: '28px 24px' }}>
          <div className="mx-auto max-w-5xl flex flex-col sm:flex-row items-center justify-between gap-4 text-center sm:text-left">
            <div>
              <p className="text-white font-black text-lg tracking-tight">InsideTrader</p>
              <p className="text-white/40 text-xs mt-1 max-w-sm">
                All data sourced from official congressional financial disclosures. Not financial advice.
              </p>
            </div>
            <div className="flex flex-col items-center sm:items-end gap-1">
              <p className="text-white/30 text-xs">Built for transparency.</p>
              <p className="text-white/20 text-xs">&copy; {new Date().getFullYear()} InsideTrader</p>
            </div>
          </div>
        </footer>
        <Analytics />
      </body>
    </html>
  );
}
