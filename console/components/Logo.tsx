/** The Zinloop mark: a shield with a check, ink body and amber tick. */
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" aria-hidden="true" className="logo">
      <path d="M14 2 L25 6.5 V14 C25 20 20.5 24.5 14 26 C7.5 24.5 3 20 3 14 V6.5 Z" fill="currentColor" />
      <path d="M9 14 L12.5 17.5 L19 10.5" fill="none" stroke="#F2A93B" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
