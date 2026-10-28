import type { Metadata } from "next";
import { DownloadCenter } from "@/components/DownloadCenter.tsx";
export const metadata:Metadata={title:"Download scanner · Zinloop Security"};
export default function DownloadsPage(){return <>
  <div className="page-head"><p className="download-eyebrow">Endpoint scanner / deployment center</p><h1>Install Zinloop on any laptop</h1>
  <p className="muted">Choose a verified published Windows, macOS or Linux build, scan locally, or deploy across customers with your RMM.</p></div>
  <DownloadCenter/>
</>;}
