// src/app/layout.tsx
import "./globals.css";
import type { ReactNode } from "react";
import Image from "next/image";
import Navigation from "@/components/Navigation";

export const metadata = {
  title: "Project Planner",
  description: "Multi-project planning & quoting",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-background text-foreground antialiased">
        {/* Top navigation */}
        <header className="sticky top-0 z-40 border-b bg-card/80 backdrop-blur-xl supports-[backdrop-filter]:bg-card/80">
          <nav className="mx-auto max-w-7xl px-4 sm:px-6 py-4 flex items-center gap-8">
            <Navigation />
            <div className="ml-auto">
              <Image
                src="/BIP-logo.png"
                alt="Company Logo"
                width={140}
                height={40}
                priority
                className="h-8 w-auto"
              />
            </div>
          </nav>
        </header>

        {/* Page content container */}
        <main className="mx-auto max-w-7xl px-4 sm:px-6 py-6 sm:py-8">{children}</main>
      </body>
    </html>
  );
}
