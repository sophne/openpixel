#!/usr/bin/env node
// The bridge for people who still run the old Mac app (Swift, updated by Sparkle): writes the `appcast.xml` that
// app reads, offering the new universal OpenPixel.dmg, signed with OpenPixel's Sparkle key. The new app does not
// read this file (it has electron-builder's latest-mac.yml); it exists so the old one is not stranded.
//
//   node scripts/appcast.mjs --dmg release/upload/OpenPixel.dmg --version 1.2.0 --build 412 --out release/upload/appcast.xml
//   node scripts/appcast.mjs --check-key          only checks that the key is the one installed apps trust
//
// The key comes from the environment (SPARKLE_PRIVATE_KEY) or from --key-file <file>: what Sparkle's
// `generate_keys -x` exported, i.e. base64 of the 32-byte Ed25519 seed. Nothing secret is printed or written.
//
// The file is written the way app/scripts/release.sh wrote it (one item: the version being released), and the
// signature is what Sparkle's `sign_update` printed: Ed25519 over the bytes of the dmg, in base64, plus its length.
// NOT YET TRIED AGAINST A REAL SPARKLE CLIENT: see RELEASING.md before relying on it.
import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** `SUPublicEDKey` of the old app's Info.plist: the only key its updater accepts. */
export const SPARKLE_PUBLIC_KEY = '0ZMX6aWYd1gU6FG/581KjJha7kM3taUsl2nZoyGym3U=';
/** The new app's oldest macOS (electron-builder.yml: mac.minimumSystemVersion). */
export const MINIMUM_MACOS = '12.0';

// An Ed25519 seed as a PKCS #8 key and a public key as SubjectPublicKeyInfo (RFC 8410): fixed headers + 32 bytes.
const PKCS8_HEAD = Buffer.from('302e020100300506032b657004220420', 'hex');
const SPKI_HEAD = Buffer.from('302a300506032b6570032100', 'hex');

/** The key from what `generate_keys -x` exported. Throws Error(text) (never showing the key) when it is not one. */
export function sparkleKey(exported) {
  const text = String(exported ?? '').trim();
  if (!text) throw new Error('the Sparkle key is empty');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(text)) throw new Error('the Sparkle key is not base64 text');
  const raw = Buffer.from(text, 'base64');
  if (raw.length === 96) {
    throw new Error('this is a Sparkle key in the old 96-byte form (before Sparkle 2); this script signs with the 32-byte seed that `generate_keys -x` of Sparkle 2 exports');
  }
  if (raw.length !== 32) throw new Error(`the Sparkle key must be 32 bytes in base64 (got ${raw.length} bytes)`);
  const privateKey = createPrivateKey({ key: Buffer.concat([PKCS8_HEAD, raw]), format: 'der', type: 'pkcs8' });
  const publicKey = createPublicKey(privateKey).export({ format: 'der', type: 'spki' }).subarray(SPKI_HEAD.length).toString('base64');
  return { privateKey, publicKey };
}

/** What `sign_update` gives: the Ed25519 signature of the file's bytes in base64, and the file's length. */
export function signUpdate(data, key) {
  return { edSignature: sign(null, data, key.privateKey).toString('base64'), length: data.length };
}

/** Whether `signature` (base64) is `publicKey`'s (base64, 32 bytes) signature of `data`: what the old app checks. */
export function verifyUpdate(data, signature, publicKey = SPARKLE_PUBLIC_KEY) {
  const key = createPublicKey({ key: Buffer.concat([SPKI_HEAD, Buffer.from(publicKey, 'base64')]), format: 'der', type: 'spki' });
  return verify(null, data, key, Buffer.from(signature, 'base64'));
}

const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The appcast, as app/scripts/release.sh wrote it. `build` is the commit count: Sparkle only offers a build number
    higher than the installed app's, and the old app's releases were numbered that way. */
export function appcastXml({ version, build, repo = 'sophne/openpixel', signature, length, notes, date = new Date() }) {
  if (!/^[0-9]+$/.test(String(build))) throw new Error(`the build number must be a whole number (got ${build})`);
  const page = `https://github.com/${repo}/releases/tag/v${version}`;
  // Keep the notes from breaking out of their CDATA block.
  const text = (notes && notes.trim() ? notes.trim() : `OpenPixel ${version}. Release notes: ${page}`).replace(/]]>/g, ']] >');
  return `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle">
  <channel>
    <title>OpenPixel</title>
    <link>https://github.com/${xml(repo)}</link>
    <item>
      <title>OpenPixel ${xml(version)}</title>
      <pubDate>${date.toUTCString().replace('GMT', '+0000')}</pubDate>
      <sparkle:version>${build}</sparkle:version>
      <sparkle:shortVersionString>${xml(version)}</sparkle:shortVersionString>
      <sparkle:minimumSystemVersion>${MINIMUM_MACOS}</sparkle:minimumSystemVersion>
      <sparkle:fullReleaseNotesLink>${xml(page)}</sparkle:fullReleaseNotesLink>
      <description sparkle:format="plain-text"><![CDATA[${text}]]></description>
      <enclosure url="https://github.com/${xml(repo)}/releases/download/v${xml(version)}/OpenPixel.dmg" sparkle:edSignature="${signature}" length="${length}" type="application/octet-stream"/>
    </item>
  </channel>
</rss>
`;
}

/** Signs `dmg` and returns the appcast's text. Refuses a key that is not the one installed apps trust, and checks
    its own signature the way the old app will. */
export function writeAppcast({ dmg, version, build, repo, notes, key, trusted = SPARKLE_PUBLIC_KEY, date }) {
  const k = sparkleKey(key);
  if (k.publicKey !== trusted) {
    throw new Error(`this Sparkle key is not the one installed apps trust (its public half is ${k.publicKey}, the app has ${trusted})`);
  }
  const data = readFileSync(dmg);
  const { edSignature, length } = signUpdate(data, k);
  if (!verifyUpdate(data, edSignature, trusted)) throw new Error('the signature does not verify against the public key');
  return appcastXml({ version, build, repo, signature: edSignature, length, notes, date });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const value = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
  try {
    const keyFile = value('--key-file');
    const key = keyFile ? readFileSync(keyFile, 'utf8') : process.env.SPARKLE_PRIVATE_KEY;
    if (!key || !key.trim()) throw new Error('no Sparkle key: set SPARKLE_PRIVATE_KEY or pass --key-file <file>');
    if (args.includes('--check-key')) {
      const k = sparkleKey(key);
      if (k.publicKey !== SPARKLE_PUBLIC_KEY) throw new Error(`this Sparkle key is not the one installed apps trust (its public half is ${k.publicKey}, the app has ${SPARKLE_PUBLIC_KEY})`);
      console.log(`The Sparkle key matches the public key in the old app (${SPARKLE_PUBLIC_KEY}).`);
    } else {
      const [dmg, version, build, out] = [value('--dmg'), value('--version'), value('--build'), value('--out')];
      if (!dmg || !version || !build || !out) throw new Error('usage: node scripts/appcast.mjs --dmg <OpenPixel.dmg> --version <1.2.0> --build <commit count> --out <appcast.xml> [--notes-file <text>] [--repo owner/name] [--key-file <file>]');
      const notesFile = value('--notes-file');
      const text = writeAppcast({ dmg, version: version.replace(/^v/, ''), build, repo: value('--repo') || process.env.REPO || 'sophne/openpixel',
        notes: notesFile ? readFileSync(notesFile, 'utf8') : process.env.RELEASE_NOTES, key });
      writeFileSync(out, text);
      console.log(`Wrote ${out}: OpenPixel ${version.replace(/^v/, '')} (build ${build}) for the old Mac app's updater.`);
    }
  } catch (e) {
    console.error(`error: ${e.message}`);
    process.exit(1);
  }
}
