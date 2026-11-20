import Image, { type StaticImageData } from "next/image";

/**
 * A Mac window showing the editor. The app's tab bar is its title bar, so the screenshot already has it: the frame
 * only adds the window buttons macOS draws there (the app's --screenshot picture is of the page alone). Pass a static
 * import of a 1440×855 window shot (1× or 2×) so its size comes with it; the buttons are placed in proportion to it.
 */
export default function AppWindow({
  src,
  alt,
  title,
  priority = false,
}: {
  src: StaticImageData;
  alt: string;
  title: string;
  priority?: boolean;
}) {
  return (
    <div className="window" role="group" aria-label={`OpenPixel: ${title}`}>
      <div className="window-body">
        <Image src={src} alt={alt} priority={priority} sizes="(max-width: 1240px) 100vw, 1200px" />
        <span className="lights" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
      </div>
    </div>
  );
}
