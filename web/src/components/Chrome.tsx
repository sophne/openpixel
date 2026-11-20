import Image from "next/image";
import Link from "next/link";
import { CookieSettingsLink } from "@/components/CookieBanner";
import ScrollState from "@/components/ScrollState";
import { REPO_URL, X_URL } from "@/lib/github";

function GitHubIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 16 16" aria-hidden="true">
      <path
        fill="currentColor"
        d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"
      />
    </svg>
  );
}

function XIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"
      />
    </svg>
  );
}

function Wordmark() {
  return (
    <Link href="/" className="brand" aria-label="OpenPixel home">
      <Image src="/app-icon.svg" alt="" width={30} height={30} priority />
      <span>OpenPixel</span>
    </Link>
  );
}

export function Header() {
  return (
    <header className="site-header">
      <ScrollState />
      <div className="wrap header-row">
        <Wordmark />
        <nav aria-label="Main">
          <a
            className="icon-link"
            href={REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="OpenPixel on GitHub"
          >
            <GitHubIcon />
          </a>
          <a className="icon-link" href={X_URL} target="_blank" rel="noopener noreferrer" aria-label="OpenPixel on X">
            <XIcon />
          </a>
          <a className="button small primary" href="/downloads/mac" data-download="header" aria-label="Download OpenPixel for macOS">
            Download<span className="for-mac">for macOS</span>
          </a>
        </nav>
      </div>
    </header>
  );
}

export function Footer() {
  return (
    <footer className="site-footer">
      <div className="footer-inner">
        <div className="footer-top">
          <p className="footer-tagline">
            Free forever.
            <br />
            Open by design.
          </p>
          <Link href="/" className="footer-mark" aria-label="OpenPixel home">
            <Image src="/app-icon.svg" alt="" width={44} height={44} />
          </Link>
        </div>

        <div className="footer-links">
          <nav aria-label="Social" className="footer-social">
            <a href={X_URL} target="_blank" rel="noopener noreferrer" aria-label="OpenPixel on X">
              <XIcon />
            </a>
            <a href={REPO_URL} target="_blank" rel="noopener noreferrer" aria-label="OpenPixel on GitHub">
              <GitHubIcon />
            </a>
          </nav>
          <nav aria-label="Product">
            <Link href="/downloads">Downloads</Link>
            <Link href="/explore">Explore Pixelart</Link>
            <Link href="/downloads#agents">Connect an agent</Link>
            <Link href="/compare">Compare</Link>
          </nav>
          <nav aria-label="Project">
            <Link href="/changelog">Changelog</Link>
            <a href={REPO_URL} target="_blank" rel="noopener noreferrer">
              Source code
            </a>
            <a href={`${REPO_URL}/security/policy`} target="_blank" rel="noopener noreferrer">
              Security
            </a>
          </nav>
          <nav aria-label="Legal">
            <Link href="/legal/terms">Terms of use</Link>
            <Link href="/legal/privacy">Privacy policy</Link>
            <Link href="/legal/licenses">Licences</Link>
            <CookieSettingsLink />
          </nav>
        </div>

        <p className="footer-copy">© {new Date().getFullYear()} OpenPixel contributors. MIT licence.</p>
      </div>
    </footer>
  );
}

/** A two-tone heading: the statement, then its continuation in a quieter grey. */
export function Headline({
  as: Tag = "h2",
  lead,
  rest,
  className,
}: {
  as?: "h1" | "h2";
  lead: string;
  rest: string;
  className?: string;
}) {
  return (
    <Tag className={`headline${className ? ` ${className}` : ""}`}>
      {lead}
      <br />
      <span>{rest}</span>
    </Tag>
  );
}
