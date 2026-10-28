import type { Metadata } from "next";
import Script from "next/script";
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
        <Script
          src="https://www.smart365guide.com/sdk/smart365guide.js"
          data-license-key="lk_8o4Qz7XxuRw0nQZmD71N4SocRPO3xuqikaoVakgK9tmVfCSBhW2YhOEEiSBMbDK7AHlq9P4zue8gx4FU1pbprBrN1Z6wzzTHQtKS14axK-57cJHqp-ShBrkytANwHZRHZeL5752myOYKD1hQfIY8Uv8z-8N9P_j684IAF-vmOX0Pb_CYbABQ"
          strategy="afterInteractive"
        />
      </body>
    </html>
  );
}
