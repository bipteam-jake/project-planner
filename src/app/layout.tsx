// src/app/layout.tsx
import "./globals.css";
import Link from "next/link";
import type { ReactNode } from "react";

export const metadata = {
  title: "Project Planner",
  description: "Multi-project planning & quoting",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-background text-foreground antialiased">
        {/* Top navigation */}
        <header className="border-b bg-card/50 backdrop-blur supports-[backdrop-filter]:bg-card/60">
          <nav className="mx-auto max-w-7xl px-4 py-3 flex items-center gap-6">
            <Link href="/" className="font-semibold">
              Dashboard
            </Link>
            <Link href="/projects" className="text-muted-foreground hover:text-foreground">
              Projects
            </Link>
            <Link href="/personnel" className="text-muted-foreground hover:text-foreground">
              Personnel
            </Link>
            <div className="ml-auto text-xs text-muted-foreground">
              Multi-Project Planner
            </div>
          </nav>
        </header>

        {/* Page content container */}
        <main className="mx-auto max-w-7xl p-4 md:p-6">{children}</main>
      </body>
    </html>
  );
}
