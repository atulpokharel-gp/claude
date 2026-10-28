import type { Metadata } from "next";
import { DownloadCenter } from "@/components/DownloadCenter.tsx";
import "../../(console)/console-shell.css";
export const metadata:Metadata={title:"Download Zinloop · Windows, Mac and Linux",description:"Download the privacy-first Zinloop MCP security scanner for Windows, macOS and Linux."};
export default function PublicDownload(){return <section className="section">
  <div className="wrap">
    <div className="page-head"><p className="eyebrow">Open-source MCP security scanner</p><h1 className="disp h2">Know what your AI agents can access.</h1>
    <p className="lead">Download Zinloop for Windows, macOS or Linux. Scan locally, review exposed secrets and unsafe MCP configurations, and choose when to share a redacted report.</p></div>
    <DownloadCenter publicPage/>
  </div>
</section>;}
