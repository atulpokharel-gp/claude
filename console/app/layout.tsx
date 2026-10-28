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
          data-license-key="lk_rUHfScr07wxiyaGTyX-sBWxC4cvRwjydd9MeSYHIHf-490fZQCQ62428Wg0xoSurlmEZfUs38R7yqLwWoxi4DTe8Ijni1kHG21GjRubIn7Ffn8nXfpYQmaLdp5cDzEA7iUQt3lIJVyIDH99uhUVBvBkFAsyINR73haQBvn3EFE0-LPV-6yBQ"
          strategy="afterInteractive"
        />
      </body>
    </html>
  );
}
