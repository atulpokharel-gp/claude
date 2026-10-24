"use client";

export function PrintButton() {
  return (
    <button className="btn primary" type="button" onClick={() => window.print()}>
      Print or save as PDF
    </button>
  );
}
