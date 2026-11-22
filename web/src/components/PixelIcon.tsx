import type { Paths } from "@/lib/pixel-icon-render";

/**
 * One pixel icon as inline SVG. Its colours come from CSS variables (--pi-stroke, --pi-outline, --pi-shadow) and
 * the outline and shadow hide with --pi-border and --pi-drop, so recolouring hundreds of icons is a single style
 * change on their container, with no redraw.
 */
export default function PixelIcon({ paths, size, label }: { paths: Paths; size?: number; label?: string }) {
  return (
    <svg
      className="pi"
      viewBox="0 0 32 32"
      width={size}
      height={size}
      shapeRendering="crispEdges"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {paths.shadow ? <path className="pi-shadow" d={paths.shadow} /> : null}
      {paths.outline ? <path className="pi-outline" d={paths.outline} /> : null}
      <path className="pi-stroke" d={paths.stroke} />
    </svg>
  );
}
