// scripts/appcast.mjs: the bridge appcast for the old Mac app, and its Ed25519 signature.
import assert from 'node:assert/strict';
import { createPublicKey, generateKeyPairSync, randomBytes, verify } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { MINIMUM_MACOS, SPARKLE_PUBLIC_KEY, appcastXml, signUpdate, sparkleKey, verifyUpdate, writeAppcast } from '../../scripts/appcast.mjs';

const desktop = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const script = path.join(desktop, 'scripts', 'appcast.mjs');
const hex = (s) => Buffer.from(s.replace(/\s/g, ''), 'hex');
const SPKI_HEAD = hex('302a300506032b6570032100');

// RFC 8032, section 7.1, TEST 1 and TEST 3: a seed, its public key, a message and its signature.
const RFC = [
  { seed: '9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60', public: 'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a', message: '',
    signature: 'e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b' },
  { seed: 'c5aa8df43f9f837bedb7442f31dcb7b166d38535076f094b85ce3a2e0b4458f7', public: 'fc51cd8e6218a1a38da47ed00230f0580816ed13ba3303ac5deb911548908025', message: 'af82',
    signature: '6291d657deec24024827e69c3abe01a30ce548a284743a445e3680d7db5ac3ac18ff9b538d16f290ae67f760984dc6594a7c15e9716ed28dc027beceea1ec40a' },
];

test('the signature is Ed25519 over the file\'s bytes, from the 32-byte seed (RFC 8032 vectors)', () => {
  for (const v of RFC) {
    const key = sparkleKey(hex(v.seed).toString('base64'));
    assert.equal(key.publicKey, hex(v.public).toString('base64'), 'the public key derived from the seed');
    const signed = signUpdate(hex(v.message), key);
    assert.equal(Buffer.from(signed.edSignature, 'base64').toString('hex'), v.signature);
    assert.equal(signed.length, hex(v.message).length);
    assert.equal(verifyUpdate(hex(v.message), signed.edSignature, key.publicKey), true);
  }
});

test('a fresh key: what is signed verifies with the public half, and only the same bytes do', () => {
  // The seed is all there is to a Sparkle key; the public half is derived by another route here (Node's own
  // key pair generation), so the two derivations check each other.
  const pair = generateKeyPairSync('ed25519');
  const seed = pair.privateKey.export({ format: 'der', type: 'pkcs8' }).subarray(-32);
  const publicRaw = pair.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
  const key = sparkleKey(seed.toString('base64'));
  assert.equal(key.publicKey, publicRaw.toString('base64'));

  const dmg = randomBytes(300_000);
  const { edSignature, length } = signUpdate(dmg, key);
  assert.equal(length, 300_000);
  assert.equal(Buffer.from(edSignature, 'base64').length, 64);
  // As a Sparkle client checks it: the public key alone, the raw bytes, the base64 signature.
  const publicKey = createPublicKey({ key: Buffer.concat([SPKI_HEAD, publicRaw]), format: 'der', type: 'spki' });
  assert.equal(verify(null, dmg, publicKey, Buffer.from(edSignature, 'base64')), true);
  const changed = Buffer.from(dmg);
  changed[1000] ^= 1;
  assert.equal(verify(null, changed, publicKey, Buffer.from(edSignature, 'base64')), false);
  assert.equal(verifyUpdate(dmg, edSignature, key.publicKey), true);
  assert.equal(verifyUpdate(changed, edSignature, key.publicKey), false);
  assert.equal(verifyUpdate(dmg, edSignature, SPARKLE_PUBLIC_KEY), false, 'another key\'s signature is not OpenPixel\'s');
});

test('keys that are not a 32-byte seed in base64 are refused, without showing them', () => {
  const secret = randomBytes(32).toString('base64');
  for (const [bad, why] of [['', /empty/], ['   \n', /empty/], ['not base64!', /not base64/], [randomBytes(31).toString('base64'), /32 bytes/],
    [randomBytes(64).toString('base64'), /32 bytes/], [randomBytes(96).toString('base64'), /96-byte/], [`${secret} ${secret}`, /not base64/]]) {
    assert.throws(() => sparkleKey(bad), (e) => why.test(e.message) && !e.message.includes(bad.trim() || '\0'), bad.slice(0, 8));
  }
  assert.equal(sparkleKey(`${secret}\n`).publicKey.length, 44, 'a trailing newline (from a file) is fine');
});

test('the public key the old app trusts is a 32-byte Ed25519 key', () => {
  const raw = Buffer.from(SPARKLE_PUBLIC_KEY, 'base64');
  assert.equal(raw.length, 32);
  assert.doesNotThrow(() => createPublicKey({ key: Buffer.concat([SPKI_HEAD, raw]), format: 'der', type: 'spki' }));
});

test('the new Mac app names that key in its Info.plist, or the old app\'s Sparkle refuses the update', () => {
  // Sparkle 2 rejects an update whose app drops the old app's public key ("only supports rotation, but not removal
  // of (Ed)DSA keys"), however well it is signed: electron-builder.yml puts it there through mac.extendInfo.
  const yml = readFileSync(path.join(desktop, 'electron-builder.yml'), 'utf8');
  const mac = yml.slice(yml.search(/^mac:/m), yml.search(/^dmg:/m));
  assert.match(mac, /^  extendInfo:\n    SUPublicEDKey: (\S+)$/m, 'mac.extendInfo.SUPublicEDKey in electron-builder.yml');
  assert.equal(mac.match(/^    SUPublicEDKey: (\S+)$/m)[1], SPARKLE_PUBLIC_KEY);
});

test('the appcast is written as the old release script wrote it', () => {
  const text = appcastXml({ version: '1.2.0', build: 412, signature: 'c2ln', length: 123456, date: new Date(Date.UTC(2026, 10, 22, 11, 24, 0)) });
  assert.equal(text, `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle">
  <channel>
    <title>OpenPixel</title>
    <link>https://github.com/sophne/openpixel</link>
    <item>
      <title>OpenPixel 1.2.0</title>
      <pubDate>Sun, 22 Nov 2026 11:24:00 +0000</pubDate>
      <sparkle:version>412</sparkle:version>
      <sparkle:shortVersionString>1.2.0</sparkle:shortVersionString>
      <sparkle:minimumSystemVersion>${MINIMUM_MACOS}</sparkle:minimumSystemVersion>
      <sparkle:fullReleaseNotesLink>https://github.com/sophne/openpixel/releases/tag/v1.2.0</sparkle:fullReleaseNotesLink>
      <description sparkle:format="plain-text"><![CDATA[OpenPixel 1.2.0. Release notes: https://github.com/sophne/openpixel/releases/tag/v1.2.0]]></description>
      <enclosure url="https://github.com/sophne/openpixel/releases/download/v1.2.0/OpenPixel.dmg" sparkle:edSignature="c2ln" length="123456" type="application/octet-stream"/>
    </item>
  </channel>
</rss>
`);
  // Notes cannot break out of their block, and the build number is a number.
  const withNotes = appcastXml({ version: '1.2.0', build: '7', signature: 's', length: 1, notes: 'New\n]]><evil/>' });
  assert.ok(withNotes.includes('<![CDATA[New\n]] ><evil/>]]>'));
  assert.equal(withNotes.split(']]>').length - 1, 1);
  assert.throws(() => appcastXml({ version: '1.2.0', build: '1.2.0', signature: 's', length: 1 }), /whole number/);
  assert.throws(() => appcastXml({ version: '1.2.0', build: '', signature: 's', length: 1 }), /whole number/);
});

test('writing the appcast: only the key installed apps trust may sign, and the signature is checked before it is written', (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'openpixel-appcast-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const dmg = path.join(dir, 'OpenPixel.dmg');
  writeFileSync(dmg, randomBytes(50_000));
  const seed = randomBytes(32).toString('base64');
  const mine = sparkleKey(seed).publicKey;

  // Not the app's key: refused (the old apps would reject the update anyway).
  assert.throws(() => writeAppcast({ dmg, version: '1.2.0', build: 5, key: seed }), /not the one installed apps trust/);
  // With `trusted` set to this test key's public half, the same path writes a file whose signature verifies.
  const text = writeAppcast({ dmg, version: '1.2.0', build: 5, key: seed, trusted: mine });
  const m = /sparkle:edSignature="([^"]+)" length="(\d+)"/.exec(text);
  assert.ok(m);
  assert.equal(Number(m[2]), 50_000);
  assert.equal(verifyUpdate(readFileSync(dmg), m[1], mine), true);
  assert.ok(text.includes('<sparkle:version>5</sparkle:version>') && text.includes('/releases/download/v1.2.0/OpenPixel.dmg'));

  // From the command line the key comes from the environment or a file, and is never echoed.
  const run = (args, env = {}) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', env: { ...process.env, SPARKLE_PRIVATE_KEY: '', ...env } });
  const none = run(['--check-key']);
  assert.equal(none.status, 1);
  assert.match(none.stderr, /no Sparkle key/);
  const wrong = run(['--check-key'], { SPARKLE_PRIVATE_KEY: seed });
  assert.equal(wrong.status, 1);
  assert.match(wrong.stderr, /not the one installed apps trust/);
  assert.equal((wrong.stdout + wrong.stderr).includes(seed), false, 'the key is not printed');
  const out = path.join(dir, 'appcast.xml');
  const refused = run(['--dmg', dmg, '--version', 'v1.2.0', '--build', '5', '--out', out], { SPARKLE_PRIVATE_KEY: seed });
  assert.equal(refused.status, 1);
  assert.throws(() => readFileSync(out), /ENOENT/, 'nothing is written when the key is refused');
  assert.equal(run(['--dmg', dmg]).status, 1);
});
