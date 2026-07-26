#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

VERSION=$(ruby -r "$ROOT_DIR/lib/mendix_bridge/version" -e "puts MendixBridge::VERSION")
PKG_NAME="mendix-ruby-bridge"
STAGING="$SCRIPT_DIR/.staging"
OUTPUT="$SCRIPT_DIR/${PKG_NAME}_${VERSION}_all.deb"

if ! command -v fpm &>/dev/null; then
  echo "fpm is required. Install with: gem install fpm"
  exit 1
fi

echo "Building .deb for $PKG_NAME $VERSION..."

# --- Build gem ---
cd "$ROOT_DIR"
GEM_FILE="$SCRIPT_DIR/${PKG_NAME}-${VERSION}.gem"
gem build mendix-ruby-bridge.gemspec --output "$GEM_FILE"

# --- Staging layout ---
rm -rf "$STAGING"
GEM_HOME="$STAGING/usr/lib/ruby/gems"
mkdir -p "$GEM_HOME"

gem install \
  --local \
  --no-document \
  --ignore-dependencies \
  --install-dir "$GEM_HOME" \
  --bindir "$STAGING/usr/bin" \
  "$GEM_FILE"

# Desktop entry + icons from gem files
GEM_DIR="$GEM_HOME/gems/${PKG_NAME}-${VERSION}"

install -Dm644 "$GEM_DIR/share/applications/mendix-ruby-bridge.desktop" \
  "$STAGING/usr/share/applications/mendix-ruby-bridge.desktop"

for size in 32 48 64 128 256 512; do
  icon="$GEM_DIR/share/icons/hicolor/${size}x${size}/apps/mendix-ruby-bridge.png"
  [[ -f "$icon" ]] && install -Dm644 "$icon" \
    "$STAGING/usr/share/icons/hicolor/${size}x${size}/apps/mendix-ruby-bridge.png"
done

# Wrappers: ensure shebangs work with system ruby
for bin in mendix-ruby mendix-desktop mendix-git git-mendix mendix-apply; do
  wrapper="$STAGING/usr/bin/$bin"
  [[ -f "$wrapper" ]] && sed -i '1s|.*|#!/usr/bin/env ruby|' "$wrapper"
done

# --- Build .deb ---
fpm \
  --input-type dir \
  --output-type deb \
  --name "$PKG_NAME" \
  --version "$VERSION" \
  --maintainer "Mykael <myklpm@gmail.com>" \
  --description "Read, model, validate, and change Mendix projects with Ruby" \
  --url "https://github.com/lucamykael/mendix-ruby-bridge" \
  --license MIT \
  --depends "ruby >= 3.2" \
  --depends "python3" \
  --depends "python3-gi" \
  --depends "gir1.2-webkit2-4.0 | gir1.2-webkit2-4.1" \
  --after-install "$SCRIPT_DIR/debian/postinst" \
  --before-remove "$SCRIPT_DIR/debian/prerm" \
  --deb-no-default-config-files \
  --package "$OUTPUT" \
  --chdir "$STAGING" \
  usr

echo ""
echo "Built: $OUTPUT"
