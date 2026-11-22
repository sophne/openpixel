import Image, { type StaticImageData } from "next/image";
import WindowVideo from "./WindowVideo";

/**
 * A window showing the editor, as it looks on a Mac (the screenshots were taken there; on Windows and Linux the
 * app is the same inside its own window frame). The app's tab bar is its title bar, so the screenshot already has it:
 * the frame only adds the window buttons macOS draws there (the app's --screenshot picture is of the page alone). Pass a static
 * import of a 1440×855 window shot (1× or 2×) so its size comes with it; the buttons are placed in proportion to it.
 * With `video`, a recording of the same window plays over the shot (which should be the recording's last frame).
 */
export default function AppWindow({
  src,
  alt,
  title,
  priority = false,
  video,
}: {
  src: StaticImageData;
  alt: string;
  title: string;
  priority?: boolean;
  video?: { mp4: string; webm?: string; label: string };
}) {
  return (
    <div className="window" role="group" aria-label={`OpenPixel: ${title}`}>
      <div className="window-body">
        <Image src={src} alt={alt} priority={priority} sizes="(max-width: 1240px) 100vw, 1200px" />
        {video && <WindowVideo {...video} />}
        <span className="lights" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
      </div>
    </div>
  );
}
