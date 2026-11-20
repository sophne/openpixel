import type { Metadata } from "next";
import JsonLd from "@/components/JsonLd";
import { breadcrumbJsonLd, pageMeta } from "@/lib/seo";
import { Footer, Header, Headline } from "@/components/Chrome";
import { REPO_URL } from "@/lib/github";

export const metadata: Metadata = pageMeta({
  path: "/legal/privacy",
  title: "Privacy",
  description: "What the OpenPixel app and this website collect, and how we use Google Analytics only if you allow it.",
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
          <p className="updated">Last updated 19 November 2026</p>
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
            <li>Your sprites and models stay on your Mac, in the files and folders you choose.</li>
            <li>
              <strong>Update checks.</strong> Once a day the app downloads a small file (appcast.xml) from GitHub to see
              whether a new version exists, and downloads the update from GitHub if you install it. GitHub receives your
              IP address and the app&apos;s version, as with any download. The app sends no other information about your
              Mac. To turn automatic checks off, run{" "}
              <code>defaults write com.sophne.openpixel SUEnableAutomaticChecks -bool false</code>.
            </li>
            <li>
              <strong>AI agents.</strong> The MCP server runs on your Mac. What an agent sees and sends to its provider
              (for example Anthropic, OpenAI or Cursor) is decided by that agent and covered by its provider&apos;s
              terms and privacy policy, not ours.
            </li>
            <li>
              <strong>Agents page.</strong> To show which agents are set up, the app reads their settings files on your
              Mac. It never changes them and never sends them anywhere.
            </li>
            <li>
              <strong>HTTP mode.</strong> <code>--mcp-http</code> listens on your Mac only. It becomes reachable from
              elsewhere only if you start a tunnel yourself; that tunnel provider&apos;s terms then apply.
            </li>
          </ul>

          <h2>This website</h2>
          <ul>
            <li>
              Fonts and images are served from this site. The only outside service is Google Analytics, and only if you
              allow it (see below).
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

          <h2 id="analytics">Google Analytics and cookies</h2>
          <p>
            We&apos;d like to know which pages people find useful, so this website can use Google Analytics through
            Google Tag Manager. Both are provided by Google Ireland Limited, Gordon House, Barrow Street, Dublin 4,
            Ireland. The app never uses them.
          </p>
          <ul>
            <li>
              <strong>Only with your consent.</strong> Until you press Allow in the cookie banner, no Google script is
              loaded and no cookie is set. Declining is as easy as allowing, and the site works the same either way.
            </li>
            <li>
              <strong>What is collected.</strong> The pages you visit, the page you came from, how long you stay, which
              download button you click (if any), and
              your browser, device type, screen size, language and approximate location (country and city, worked out
              from your IP address). Google Analytics doesn&apos;t store IP addresses. We don&apos;t use advertising
              features, Google Signals or remarketing, and we don&apos;t combine this with anything else.
            </li>
            <li>
              <strong>Cookies.</strong> Google Analytics sets <code>_ga</code> and <code>_ga_&lt;id&gt;</code> to tell
              visits apart; they last up to 2 years. To remember your choice, this site stores{" "}
              <code>openpixel-consent</code> in your browser&apos;s local storage; it never leaves your browser.
            </li>
            <li>
              <strong>Legal basis.</strong> Your consent (Article 6(1)(a) GDPR, and for cookies Section 25(1) of the
              German TDDDG and similar laws elsewhere). The cookie banner&apos;s choice and the server logs above rely
              on our legitimate interest in running a working, secure site (Article 6(1)(f) GDPR).
            </li>
            <li>
              <strong>Where the data goes.</strong> Google may process it in the United States. Google is certified
              under the EU-US Data Privacy Framework, and its{" "}
              <a href="https://business.safety.google/adsprocessorterms/" target="_blank" rel="noopener noreferrer">
                data processing terms
              </a>{" "}
              include the EU Standard Contractual Clauses. Analytics data is kept for at most 14 months, then deleted.
              See also{" "}
              <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer">
                Google&apos;s privacy policy
              </a>
              .
            </li>
            <li>
              <strong>Changing your mind.</strong> Choose <em>Cookie settings</em> at the bottom of any page to allow or
              decline again. Declining after allowing stops Google Analytics and deletes its cookies from this site. You
              can also clear cookies in your browser or block Google Analytics with an extension.
            </li>
          </ul>

          <h2>Your rights</h2>
          <p>
            Depending on where you live (for example under the GDPR), you can ask what personal data we hold about you,
            and have it corrected, deleted or restricted, object to its use, or withdraw your consent at any time
            without affecting what happened before. We hold only short-lived server logs ourselves; Google Analytics
            data is pseudonymous and tied to the cookie in your browser, so deleting that cookie cuts the link. You can
            also complain to your data protection authority.
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
