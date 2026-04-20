import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./styles.css";
import { Shell } from "@/components/Shell";
import { QueryProvider } from "@/components/QueryProvider";

export const metadata: Metadata = {
  title: "Cortex — Personal AI Executive Assistant",
  description: "Your structured productivity command center.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-theme="dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <QueryProvider>
          <Shell>{children}</Shell>
        </QueryProvider>
      </body>
    </html>
  );
}
