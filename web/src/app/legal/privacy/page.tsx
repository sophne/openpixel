import type { Metadata } from "next";
import JsonLd from "@/components/JsonLd";
import { breadcrumbJsonLd, pageMeta } from "@/lib/seo";
import { Footer, Header, Headline } from "@/components/Chrome";
import { REPO_URL } from "@/lib/github";

export const metadata: Metadata = pageMeta({
  path: "/legal/privacy",
  title: "Privacy",
  description:
    "What the OpenPixel app and this website collect: anonymous visit counts with PostHog, and cookies and session recordings only if you allow them.",
});

export default function Privacy() {
  return (
    <>
      <Header />
      <JsonLd data={breadcrumbJsonLd([["Privacy", "/legal/privacy"]])} />
      <main>
        <section className="page-head wrap">
          <Headline as="h1" lead="Privacy." rest="Short, because there is little to say." />
        </section>
        <article className="prose wrap">
          <p className="updated">Last updated 22 November 2026</p>
          <p>
            OpenPixel is free, open-source software made by the OpenPixel maintainers (
            <a href="https://github.com/sophne" target="_blank" rel="noopener noreferrer">
              sophne on GitHub
            </a>
            ). We don&apos;t sell anything, don&apos;t run ads and don&apos;t want your data. This page explains exactly
            what the app and this website do.
          </p>

          <h2>The OpenPixel app</h2>
          <ul>
            <li>No account, no sign-in, no analytics, no crash reporting, no tracking.</li>
            <li>Your sprites and models stay on your computer, in the files and folders you choose.</li>
            <li>
              <strong>Update checks.</strong> Each time it starts, and when you click <em>Check for Updates…</em> or the
              Update button, the app downloads a small file from OpenPixel&apos;s releases on GitHub
              (<code>latest-mac.yml</code> on macOS, <code>latest.yml</code> on Windows, <code>latest-linux.yml</code>{" "}
              on Linux); an AI agent can ask for the same check. If you install an update, the app downloads it from
              GitHub too and compares its checksum before installing; nothing is installed until you choose{" "}
              <em>Restart to Update</em>. GitHub receives your IP address, as with any download, and the app&apos;s
              version (<code>User-Agent: OpenPixel/&lt;version&gt;</code>). The app sends no ID of you or your
              installation, no language, and nothing about your files or how you use it. To skip the check at start, run
              the app with the environment variable <code>OPENPIXEL_NO_UPDATE_CHECK=1</code>.
            </li>
            <li>
              <strong>GitHub stars.</strong> The star count in the app&apos;s tab bar is read from GitHub&apos;s public API
              at most once an hour, with no information about you.
            </li>
            <li>
              <strong>AI agents.</strong> The MCP server runs on your computer. What an agent sees and sends to its provider
              (for example Anthropic, OpenAI or Cursor) is decided by that agent and covered by its provider&apos;s
              terms and privacy policy, not ours.
            </li>
            <li>
              <strong>Agents page.</strong> To show which agents are set up, the app reads their settings files on your
              computer. It never changes them and never sends them anywhere.
            </li>
            <li>
              <strong>HTTP mode.</strong> <code>--mcp-http</code> listens on your own computer only. It becomes reachable from
              elsewhere only if you start a tunnel yourself; that tunnel provider&apos;s terms then apply.
            </li>
          </ul>

          <h2>This website</h2>
          <ul>
            <li>
              Fonts and images are served from this site. The only outside service is PostHog, for visit statistics
              (see below).
            </li>
            <li>
              To offer the download for your system (Mac, Windows or Linux), the page reads which system your browser
              says it runs on. That happens in your browser; we don&apos;t store it.
            </li>
            <li>
              Like every web server, ours briefly keeps standard request logs (IP address, time, page, browser) to keep
              the site running and secure. They are not used for anything else and are deleted regularly.
            </li>
            <li>
              Release details shown here are fetched by our server from GitHub, so your browser doesn&apos;t contact
              GitHub until you click a download or GitHub link. Downloads are served by GitHub under the{" "}
              <a
                href="https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement"
                target="_blank"
                rel="noopener noreferrer"
              >
                GitHub Privacy Statement
              </a>
              .
            </li>
          </ul>

          <h2 id="analytics">Visit statistics, session recordings and cookies</h2>
          <p>
            We&apos;d like to know which pages and tools people find useful, so this website uses PostHog, provided by
            PostHog Inc. Its data is stored in PostHog&apos;s EU cloud. The app never uses it.
          </p>
          <ul>
            <li>
              <strong>Without your consent: anonymous counting only.</strong> Before you answer the cookie banner, and
              after you press Decline, the site counts visits without cookies and without storing anything in your
              browser. PostHog tells visits apart only by a hash its servers make from the date, your IP address, your
              browser and this site, then strips the IP address, so the same visitor can&apos;t be recognised from one
              day to the next. There are no session recordings and no location in this mode.
            </li>
            <li>
              <strong>With your consent: cookies and session recordings.</strong> If you press Allow, PostHog sets a
              cookie so it can recognise your visits over time, and records anonymised replays of your sessions: how
              you scroll, click and move through the pages, and errors the page reports. Everything typed into forms
              and search boxes is masked in recordings. Declining is as easy as allowing, and the site works the same
              either way.
            </li>
            <li>
              <strong>What is collected.</strong> The pages you visit, the page you came from, how long you stay, which
              links and buttons you click, how fast pages load, which download you click and for which system (if any), on the pixel icon pages what you search for and which
              icons, categories, colours and sizes you choose, copy or download, and your browser, device type, screen
              size and language. Only if you allow cookies, also your approximate location (worked out from your IP
              address). We have set PostHog to discard IP addresses rather than store them. We don&apos;t use advertising, don&apos;t sell data and
              don&apos;t combine it with anything else.
            </li>
            <li>
              <strong>Cookies and storage.</strong> Only after you allow it: PostHog&apos;s cookies, whose names start
              with <code>ph_&lt;project&gt;_posthog</code>, and matching local storage, which last up to a year. To
              remember your answer, PostHog stores <code>__ph_opt_in_out_&lt;project&gt;</code> in your browser&apos;s
              local storage, whichever way you choose.
            </li>
            <li>
              <strong>Legal basis.</strong> Anonymous counting without cookies relies on our legitimate interest in
              understanding how the site is used (Article 6(1)(f) GDPR); it reads and stores nothing on your device.
              Cookies and session recordings rely on your consent (Article 6(1)(a) GDPR, and for cookies Section 25(1)
              of the German TDDDG and similar laws elsewhere). Remembering your answer and the server logs above rely on
              our legitimate interest in running a working, secure site (Article 6(1)(f) GDPR).
            </li>
            <li>
              <strong>Where the data goes.</strong> PostHog stores it in its EU cloud and processes it for us under its{" "}
              <a href="https://posthog.com/dpa" target="_blank" rel="noopener noreferrer">
                data processing agreement
              </a>
              , which includes the EU Standard Contractual Clauses for any transfer outside the EU. Session recordings
              are deleted after 30 days. See also{" "}
              <a href="https://posthog.com/privacy" target="_blank" rel="noopener noreferrer">
                PostHog&apos;s privacy policy
              </a>
              .
            </li>
            <li>
              <strong>Changing your mind.</strong> Choose <em>Cookie settings</em> at the bottom of any page to allow or
              decline again. Declining after allowing stops the recordings, removes PostHog&apos;s cookie and goes back
              to anonymous counting. You can also clear cookies in your browser or block PostHog with an extension.
            </li>
          </ul>

          <h2>Your rights</h2>
          <p>
            Depending on where you live (for example under the GDPR), you can ask what personal data we hold about you,
            and have it corrected, deleted or restricted, object to its use, or withdraw your consent at any time
            without affecting what happened before. We hold only short-lived server logs ourselves. Anonymous counts
            can&apos;t be linked to you; data collected with your consent is pseudonymous and tied to the cookie in your
            browser, so deleting that cookie cuts the link. You can also complain to your data protection authority.
          </p>

          <h2>Contact</h2>
          <p>
            Questions about privacy: open an issue on{" "}
            <a href={`${REPO_URL}/issues`} target="_blank" rel="noopener noreferrer">
              GitHub
            </a>
            , or report something sensitive privately through{" "}
            <a href={`${REPO_URL}/security/advisories/new`} target="_blank" rel="noopener noreferrer">
              GitHub&apos;s private reporting
            </a>
            .
          </p>

          <h2>Changes</h2>
          <p>If this changes, we&apos;ll update this page and its date. The history is public in the repository.</p>
        </article>
      </main>
      <Footer />
    </>
  );
}
