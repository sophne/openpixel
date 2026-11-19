import Image, { type StaticImageData } from "next/image";

/**
 * A Mac window showing the editor. The picture is a placeholder for a screen recording. Pass a static import of
 * the screenshot so its real size comes with it (retakes can differ: 1× or 2×, a taller or shorter window).
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
    <div className="window">
      <div className="window-bar">
        <span className="lights" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span className="window-title">
          <Image src="/logo.svg" alt="" width={14} height={14} />
          <b>OpenPixel</b>
          <span>{title}</span>
          <span className="saved">Saved</span>
        </span>
      </div>
      <div className="window-body">
        <Image src={src} alt={alt} priority={priority} sizes="(max-width: 1240px) 100vw, 1200px" />
      </div>
    </div>
  );
}
