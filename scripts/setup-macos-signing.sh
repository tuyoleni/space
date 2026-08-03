#!/usr/bin/env bash
#
# Provisions macOS signing + notarization for Space's release workflow.
#
# Apple's certificate issuance and App Store Connect key creation have no CLI,
# so this can't be fully unattended: two steps happen in a browser and the
# script waits for them. Everything else — key material, keychain import, .p12
# export, base64, GitHub secrets — is handled here so no private key is ever
# hand-copied through a UI.
#
# Run the steps in order:
#
#   ./scripts/setup-macos-signing.sh csr        # 1. make a CSR to upload to Apple
#   ./scripts/setup-macos-signing.sh import     # 2. after downloading the .cer
#   ./scripts/setup-macos-signing.sh secrets    # 3. push everything to GitHub
#   ./scripts/setup-macos-signing.sh verify     # 4. check the result
#
set -euo pipefail

WORKDIR="${SPACE_SIGNING_WORKDIR:-$HOME/.space-signing}"
KEY="$WORKDIR/developer-id.key"
CSR="$WORKDIR/developer-id.csr"
CER="$WORKDIR/developer-id.cer"
P12="$WORKDIR/developer-id.p12"

# Reads a value without echoing it, so passwords and app-specific passwords
# never land in shell history or the terminal scrollback.
read_secret() {
  local prompt="$1" var="$2" value
  read -r -s -p "$prompt" value
  echo
  printf -v "$var" '%s' "$value"
}

require() {
  command -v "$1" >/dev/null 2>&1 || { echo "error: $1 is not installed." >&2; exit 1; }
}

cmd_csr() {
  require openssl
  mkdir -p "$WORKDIR"
  chmod 700 "$WORKDIR"

  if [[ -f "$KEY" ]]; then
    echo "Reusing the existing private key at $KEY."
  else
    # Apple requires 2048-bit RSA for Developer ID certificates.
    openssl genrsa -out "$KEY" 2048
    chmod 600 "$KEY"
    echo "Wrote a new private key to $KEY."
  fi

  read -r -p "Email on your Apple Developer account: " email
  read -r -p "Name (or company name) for the certificate: " common_name

  openssl req -new -key "$KEY" -out "$CSR" \
    -subj "/emailAddress=$email/CN=$common_name/C=US"

  cat <<EOF

CSR written to $CSR

Next, in a browser:
  1. https://developer.apple.com/account/resources/certificates/add
  2. Choose "Developer ID Application" (under Software).
     Not listed? Your account isn't in the paid Apple Developer Program yet —
     enroll at https://developer.apple.com/programs/ first (\$99/yr).
  3. Upload $CSR
  4. Download the resulting .cer to $CER

Then run: $0 import
EOF
}

cmd_import() {
  require openssl
  require security

  [[ -f "$KEY" ]] || { echo "error: no private key at $KEY — run '$0 csr' first." >&2; exit 1; }
  [[ -f "$CER" ]] || { echo "error: expected Apple's certificate at $CER" >&2; exit 1; }

  # Apple hands back DER; the .p12 bundle needs PEM.
  openssl x509 -inform DER -in "$CER" -out "$WORKDIR/developer-id.pem"

  echo "Choose a password for the .p12 export (you'll store it as a GitHub secret)."
  read_secret "p12 password: " p12_password
  read_secret "confirm: " p12_confirm
  [[ "$p12_password" == "$p12_confirm" ]] || { echo "error: passwords differ." >&2; exit 1; }

  openssl pkcs12 -export \
    -inkey "$KEY" \
    -in "$WORKDIR/developer-id.pem" \
    -out "$P12" \
    -passout "pass:$p12_password"
  chmod 600 "$P12"

  # Import into the login keychain too, so local `npm run make` can sign
  # without going through CI.
  security import "$P12" -k "$HOME/Library/Keychains/login.keychain-db" \
    -P "$p12_password" -T /usr/bin/codesign

  echo
  echo "Imported. Signing identities now available:"
  security find-identity -v -p codesigning

  cat <<EOF

Store the .p12 password somewhere safe — '$0 secrets' will ask for it again.
Next, create the notarization credential, then run: $0 secrets
EOF
}

cmd_secrets() {
  require gh
  require base64

  gh auth status >/dev/null 2>&1 || {
    echo "error: gh is not authenticated. Run 'gh auth login' first." >&2
    exit 1
  }

  [[ -f "$P12" ]] || { echo "error: no .p12 at $P12 — run '$0 import' first." >&2; exit 1; }

  echo "Signing identity string (exactly as printed by 'security find-identity'):"
  security find-identity -v -p codesigning | sed 's/^/    /'
  read -r -p 'Identity ("Developer ID Application: NAME (TEAMID)"): ' identity
  read_secret "The .p12 password you chose earlier: " p12_password

  gh secret set APPLE_SIGNING_IDENTITY --body "$identity"
  gh secret set APPLE_CERTIFICATE_P12_BASE64 --body "$(base64 -i "$P12")"
  gh secret set APPLE_CERTIFICATE_PASSWORD --body "$p12_password"

  # forge.config.ts parses the Team ID out of the identity string; set it
  # explicitly only when that fails.
  if [[ "$identity" =~ \(([A-Z0-9]+)\)[[:space:]]*$ ]]; then
    gh secret set APPLE_TEAM_ID --body "${BASH_REMATCH[1]}"
  else
    read -r -p "Team ID (10 chars, from developer.apple.com > Membership): " team_id
    gh secret set APPLE_TEAM_ID --body "$team_id"
  fi

  cat <<EOF

Now the notarization credential. Two options:
  1) App Store Connect API key — scoped to notarization, revocable on its own.
  2) Apple ID + app-specific password — faster to get, tied to your account.
EOF
  read -r -p "Which? [1/2]: " choice

  if [[ "$choice" == "1" ]]; then
    cat <<EOF

Create one at https://appstoreconnect.apple.com/access/integrations/api
(role: Developer). The .p8 downloads exactly once.
EOF
    read -r -p "Path to the downloaded .p8: " p8_path
    p8_path="${p8_path/#\~/$HOME}"
    [[ -f "$p8_path" ]] || { echo "error: no file at $p8_path" >&2; exit 1; }

    read -r -p "Key ID (10 chars, in the filename): " key_id
    read -r -p "Issuer ID (UUID at the top of that page): " issuer

    gh secret set APPLE_API_KEY_P8_BASE64 --body "$(base64 -i "$p8_path")"
    gh secret set APPLE_API_KEY_ID --body "$key_id"
    gh secret set APPLE_API_ISSUER --body "$issuer"
  else
    cat <<EOF

Generate one at https://account.apple.com > Sign-In and Security >
App-Specific Passwords. Format: abcd-efgh-ijkl-mnop
EOF
    read -r -p "Apple ID email: " apple_id
    read_secret "App-specific password: " app_password

    gh secret set APPLE_ID --body "$apple_id"
    gh secret set APPLE_APP_PASSWORD --body "$app_password"
  fi

  echo
  echo "Secrets configured:"
  gh secret list
  echo
  echo "Next: $0 verify"
}

cmd_verify() {
  local failed=0

  echo "== Local signing identity =="
  if security find-identity -v -p codesigning | grep -q "Developer ID Application"; then
    security find-identity -v -p codesigning | grep "Developer ID Application" | sed 's/^/  ok  /'
  else
    echo "  MISSING  no Developer ID Application certificate in the keychain"
    failed=1
  fi

  echo
  echo "== GitHub secrets =="
  if gh auth status >/dev/null 2>&1; then
    local present
    present="$(gh secret list --json name --jq '.[].name' 2>/dev/null || true)"
    for name in APPLE_SIGNING_IDENTITY APPLE_CERTIFICATE_P12_BASE64 APPLE_CERTIFICATE_PASSWORD; do
      if grep -qx "$name" <<<"$present"; then echo "  ok       $name"; else echo "  MISSING  $name"; failed=1; fi
    done

    if grep -qx "APPLE_API_KEY_P8_BASE64" <<<"$present"; then
      echo "  ok       notarization via App Store Connect API key"
    elif grep -qx "APPLE_APP_PASSWORD" <<<"$present"; then
      echo "  ok       notarization via app-specific password"
    else
      echo "  MISSING  no notarization credential — builds will be signed but not notarized"
      failed=1
    fi
  else
    echo "  SKIPPED  gh is not authenticated"
    failed=1
  fi

  echo
  if [[ "$failed" == "0" ]]; then
    echo "Ready. Tag a release to build and publish:"
    echo "  npm version patch && git push --follow-tags"
  else
    echo "Setup is incomplete — see the entries above."
    exit 1
  fi
}

case "${1:-}" in
  csr) cmd_csr ;;
  import) cmd_import ;;
  secrets) cmd_secrets ;;
  verify) cmd_verify ;;
  *)
    sed -n '/^# Provisions/,/^#   .*verify/p' "$0" | sed 's/^# \{0,1\}//'
    exit 1
    ;;
esac
