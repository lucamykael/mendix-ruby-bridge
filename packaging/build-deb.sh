#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

VERSION=$(ruby -r "$ROOT_DIR/lib/mendix_bridge/version" -e "puts MendixBridge::VERSION")
PKG_NAME="mendix-ruby-bridge"
BUILD_DIR="$SCRIPT_DIR/deb-build"

if ! command -v fpm &>/dev/null; then
  echo "fpm is required. Install with: gem install fpm"
  exit 1
fi

echo "Building .deb for $PKG_NAME $VERSION..."

rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR/usr/share/applications"
mkdir -p "$BUILD_DIR/usr/share/icons"

# Desktop entry
cp "$ROOT_DIR/share/applications/mendix-ruby-bridge.desktop" \
   "$BUILD_DIR/usr/share/applications/"

# Icons
cp -r "$ROOT_DIR/share/icons/hicolor" "$BUILD_DIR/usr/share/icons/"

# Build the gem first
cd "$ROOT_DIR"
gem build mendix-ruby-bridge.gemspec -o "$SCRIPT_DIR/${PKG_NAME}-${VERSION}.gem"

fpm \
  --input-type gem \
  --output-type deb \
  --name "$PKG_NAME" \
  --version "$VERSION" \
  --maintainer "Mykael <myklpm@gmail.com>" \
  --description "Read, model, validate, and change Mendix projects with Ruby" \
  --url "https://github.com/lucamykael/mendix-ruby-bridge" \
  --depends "ruby >= 3.2" \
  --depends "ruby-gtk3" \
  --depends "gir1.2-webkit2-4.0 | gir1.2-webkit2-4.1" \
  --after-install "$SCRIPT_DIR/debian/postinst" \
  --before-remove "$SCRIPT_DIR/debian/prerm" \
  --deb-no-default-config-files \
  --package "$SCRIPT_DIR/${PKG_NAME}_${VERSION}_all.deb" \
  "$SCRIPT_DIR/${PKG_NAME}-${VERSION}.gem"

# Copy extra files into the deb (desktop entry + icons)
# fpm handles the gem install; we add the share/ files via a second pass
fpm \
  --input-type dir \
  --output-type deb \
  --name "${PKG_NAME}-desktop" \
  --version "$VERSION" \
  --maintainer "Mykael <myklpm@gmail.com>" \
  --description "Desktop integration files for mendix-ruby-bridge" \
  --url "https://github.com/lucamykael/mendix-ruby-bridge" \
  --depends "$PKG_NAME = $VERSION" \
  --after-install "$SCRIPT_DIR/debian/postinst" \
  --deb-no-default-config-files \
  --package "$SCRIPT_DIR/${PKG_NAME}-desktop_${VERSION}_all.deb" \
  --chdir "$BUILD_DIR" \
  usr/share/applications usr/share/icons

echo ""
echo "Built:"
echo "  $SCRIPT_DIR/${PKG_NAME}_${VERSION}_all.deb       (CLI + gem)"
echo "  $SCRIPT_DIR/${PKG_NAME}-desktop_${VERSION}_all.deb (desktop entry + icons)"
