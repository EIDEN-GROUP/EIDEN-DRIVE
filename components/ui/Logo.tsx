// Eiden Drive logo. The mark (stacked sheets forming an "E") is a traced vector of the official artwork.
// Light and dark versions are both rendered and swapped by CSS (`[data-theme="dark"]`, see globals.css), so there
// is no flash and no client JS. `full` = the official lockup (mark + "Eiden Drive" lettering); it is only used on
// the light art panel of the sign-in page, so it has a single colour version.
const MARK_RATIO = 1220 / 1320;   // viewBox of public/logo.svg
const FULL_RATIO = 1524 / 2340;   // viewBox of public/logo-full.svg

export default function Logo({ size = 28, full = false, className = "" }: { size?: number; full?: boolean; className?: string }) {
  const w = Math.round(size * (full ? FULL_RATIO : MARK_RATIO));
  if (full) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src="/logo-full.svg" alt="Eiden Drive logo" width={w} height={size} className={className} draggable={false} />;
  }
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo.svg" alt="Eiden Drive logo" width={w} height={size} className={`logo-l ${className}`} draggable={false} />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo-dark.svg" alt="" aria-hidden="true" width={w} height={size} className={`logo-d ${className}`} draggable={false} />
    </>
  );
}
