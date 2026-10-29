import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Zinloop Security", template: "%s · Zinloop Security" },
  description: "Find the AI tools your clients' staff connected to company systems, and lock down the risky ones.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@100..125,600..900&family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap"
        />
      </head>
      <body>
        {children}
        {/* Smart365Guide SDK removed for now (CORS-failed on localhost). */}
      </body>
    </html>
  );
}
