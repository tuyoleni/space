#!/usr/bin/env node
/**
 * Issues a Developer ID Application certificate through the App Store Connect
 * API, so no certificate has to be created by hand in a browser.
 *
 * The certificate belongs to whichever team the API key was issued by — which
 * is the point: Space is distributed under the company team, not a personal
 * one, and the key is the only thing that decides that.
 *
 *   node scripts/apple-cert.mjs list
 *   node scripts/apple-cert.mjs create
 *
 * Credentials come from the environment:
 *   ASC_KEY_PATH   path to the AuthKey_XXXXXXXXXX.p8   (required)
 *   ASC_KEY_ID     the key id shown in App Store Connect (required)
 *   ASC_ISSUER_ID  the issuer UUID — team keys only
 *
 * App Store Connect issues two kinds of key and authenticates them
 * differently. A *team* key carries an issuer UUID and identifies itself with
 * an `iss` claim. An *individual* key has no issuer at all and instead sets
 * `sub: "user"`, acting as the person who created it. Leaving ASC_ISSUER_ID
 * unset selects the individual form.
 *
 * The private key is generated locally and never leaves this machine; only a
 * certificate signing request is sent to Apple.
 */
import { createSign, createPrivateKey, generateKeyPairSync } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const WORKDIR = process.env.SPACE_SIGNING_WORKDIR ?? path.join(os.homedir(), '.space-signing');
const KEY_PATH = path.join(WORKDIR, 'developer-id.key');
const CER_PATH = path.join(WORKDIR, 'developer-id.cer');

const API = 'https://api.appstoreconnect.apple.com/v1';

function credentials() {
  const keyPath = process.env.ASC_KEY_PATH;
  const keyId = process.env.ASC_KEY_ID;
  const issuerId = process.env.ASC_ISSUER_ID;

  const missing = [
    ['ASC_KEY_PATH', keyPath],
    ['ASC_KEY_ID', keyId],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);

  if (missing.length > 0) {
    fail(`missing environment variable(s): ${missing.join(', ')}\n\nSee the header of this file for where each one comes from.`);
  }
  if (!fs.existsSync(keyPath)) fail(`no .p8 key at ${keyPath}`);

  console.log(issuerId ? 'Authenticating with a team key.' : 'Authenticating with an individual key (no issuer id set).');

  return { privateKey: fs.readFileSync(keyPath, 'utf8'), keyId, issuerId };
}

/**
 * App Store Connect authenticates with a short-lived ES256 JWT rather than a
 * bearer token, so one is minted per run. Apple rejects anything longer than
 * 20 minutes; 10 is plenty for a single request.
 */
function mintToken({ privateKey, keyId, issuerId }) {
  const header = { alg: 'ES256', kid: keyId, typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const payload = { iss: issuerId, iat: now, exp: now + 600, aud: 'appstoreconnect-v1' };

  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const signingInput = `${encode(header)}.${encode(payload)}`;

  const signer = createSign('SHA256');
  signer.update(signingInput);
  // ES256 means a JOSE-format (r||s) signature, not the DER encoding
  // Node emits by default.
  const signature = signer.sign({ key: createPrivateKey(privateKey), dsaEncoding: 'ieee-p1363' });

  return `${signingInput}.${signature.toString('base64url')}`;
}

async function callApi(token, method, endpoint, body) {
  const response = await fetch(`${API}${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};

  if (!response.ok) {
    const detail = (payload.errors ?? [])
      .map((error) => `  ${error.title}: ${error.detail ?? ''}`)
      .join('\n');
    fail(`Apple returned ${response.status}\n${detail || text}`);
  }
  return payload;
}

/**
 * Generates the local key pair and CSR.
 *
 * Uses openssl rather than doing it in Node, because Node's crypto module
 * can't produce a PKCS#10 certificate signing request — and the same key file
 * has to be readable by openssl later to build the .p12 anyway.
 */
function buildCsr() {
  fs.mkdirSync(WORKDIR, { recursive: true, mode: 0o700 });

  if (fs.existsSync(KEY_PATH)) {
    console.log(`Reusing the existing private key at ${KEY_PATH}`);
  } else {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    fs.writeFileSync(KEY_PATH, privateKey.export({ type: 'pkcs1', format: 'pem' }), { mode: 0o600 });
    console.log(`Generated a new 2048-bit private key at ${KEY_PATH}`);
  }

  const csrPath = path.join(WORKDIR, 'developer-id.csr');
  execFileSync('openssl', [
    'req', '-new', '-key', KEY_PATH, '-out', csrPath,
    // Apple ignores the subject on Developer ID requests and substitutes the
    // team's own details, so these values only need to be well-formed.
    '-subj', '/CN=Space Developer ID/C=US',
  ]);
  return fs.readFileSync(csrPath, 'utf8');
}

async function commandList() {
  const token = mintToken(credentials());
  const { data } = await callApi(token, 'GET', '/certificates?limit=200');

  if (data.length === 0) {
    console.log('This team has no certificates.');
    return;
  }

  console.log('Certificates on this team:\n');
  for (const cert of data) {
    const { certificateType, displayName, expirationDate, serialNumber } = cert.attributes;
    console.log(`  ${certificateType}`);
    console.log(`    name:    ${displayName}`);
    console.log(`    serial:  ${serialNumber}`);
    console.log(`    expires: ${expirationDate}`);
    console.log(`    id:      ${cert.id}\n`);
  }

  const developerId = data.filter((cert) => cert.attributes.certificateType.startsWith('DEVELOPER_ID_APPLICATION'));
  console.log(
    developerId.length > 0
      ? `${developerId.length} Developer ID Application certificate(s) already exist — 'create' would add another.`
      : 'No Developer ID Application certificate yet. Run: node scripts/apple-cert.mjs create',
  );
}

async function commandCreate() {
  const token = mintToken(credentials());
  const csrContent = buildCsr();

  // G2 is what Apple issues for new Developer ID certificates; older teams
  // may still only be permitted the original type.
  let certificate;
  for (const certificateType of ['DEVELOPER_ID_APPLICATION_G2', 'DEVELOPER_ID_APPLICATION']) {
    try {
      console.log(`Requesting a ${certificateType} certificate...`);
      const { data } = await callApi(token, 'POST', '/certificates', {
        data: { type: 'certificates', attributes: { certificateType, csrContent } },
      });
      certificate = data;
      break;
    } catch (error) {
      if (certificateType === 'DEVELOPER_ID_APPLICATION') throw error;
      console.log('  not accepted for this team, trying the older certificate type...');
    }
  }

  fs.writeFileSync(CER_PATH, Buffer.from(certificate.attributes.certificateContent, 'base64'));

  console.log(`\nIssued: ${certificate.attributes.displayName}`);
  console.log(`Expires: ${certificate.attributes.expirationDate}`);
  console.log(`Written to: ${CER_PATH}`);
  console.log('\nNext: ./scripts/setup-macos-signing.sh import');
}

function fail(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}

const command = process.argv[2];
try {
  if (command === 'list') await commandList();
  else if (command === 'create') await commandCreate();
  else {
    console.error('usage: node scripts/apple-cert.mjs <list|create>');
    process.exit(1);
  }
} catch (error) {
  fail(error.message);
}
