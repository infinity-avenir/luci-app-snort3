#!/bin/sh
set -e

PKG_NAME="luci-app-snort3"
PKG_VER="1.0.0-1"
PKG_DESC="LuCI web interface for Snort3 IDS/IPS"

SRC="$(cd "$(dirname "$0")" && pwd)"
WORK="$(mktemp -d)"
trap "rm -rf '$WORK'" EXIT

echo "==> Building $PKG_NAME $PKG_VER"

# ---- data tree ----
D="$WORK/data"
mkdir -p \
  "$D/www/luci-static/resources/view/snort3" \
  "$D/usr/libexec/rpcd" \
  "$D/etc/config" \
  "$D/etc/uci-defaults" \
  "$D/usr/share/luci/menu.d" \
  "$D/usr/share/rpcd/acl.d"

cp "$SRC"/htdocs/luci-static/resources/view/snort3/* "$D/www/luci-static/resources/view/snort3/"
cp "$SRC/root/usr/libexec/rpcd/luci.snort3"          "$D/usr/libexec/rpcd/"; chmod 0755 "$D/usr/libexec/rpcd/luci.snort3"
cp "$SRC/root/usr/libexec/snort3-update.sh"           "$D/usr/libexec/";     chmod 0755 "$D/usr/libexec/snort3-update.sh"
cp "$SRC/root/etc/config/snort"                       "$D/etc/config/"
cp "$SRC/root/etc/uci-defaults/"*                     "$D/etc/uci-defaults/"; chmod 0755 "$D/etc/uci-defaults/"*
cp "$SRC/root/usr/share/luci/menu.d/"*.json           "$D/usr/share/luci/menu.d/"
cp "$SRC/root/usr/share/rpcd/acl.d/"*.json            "$D/usr/share/rpcd/acl.d/"

SIZE=$(du -sb "$D" | awk '{print $1}')

# ---- control ----
cat > "$WORK/.PKGINFO" << EOF
pkgname = ${PKG_NAME}
pkgver = ${PKG_VER}
pkgdesc = ${PKG_DESC}
arch = all
size = ${SIZE}
license = Apache-2.0
depend = luci-base
depend = rpcd
depend = curl
provides = ${PKG_NAME}=${PKG_VER}
EOF

cat > "$WORK/.post-install" << 'POSTINST'
#!/bin/sh
[ -x /etc/uci-defaults/40_luci-app-snort3 ] && {
  /etc/uci-defaults/40_luci-app-snort3
  rm -f /etc/uci-defaults/40_luci-app-snort3
}
rm -f /tmp/luci-indexcache /tmp/luci-modulecache/* 2>/dev/null
/etc/init.d/rpcd reload 2>/dev/null
exit 0
POSTINST
chmod 0755 "$WORK/.post-install"

# ---- pack APKv2 ----
# Control: paths WITHOUT leading ./
cd "$WORK"
tar cf - --format=posix .PKGINFO .post-install | gzip > "$WORK/control.tar.gz"

# Data: paths WITHOUT leading ./ (use --transform or -C)
cd "$D"
tar cf - --format=posix etc usr www | gzip > "$WORK/data.tar.gz"

# Concatenate
OUT="${SRC}/${PKG_NAME}_${PKG_VER}_all.apk"
cat "$WORK/control.tar.gz" "$WORK/data.tar.gz" > "$OUT"

echo "==> Done: $OUT ($(du -h "$OUT" | cut -f1))"
echo ""
echo "Install:"
echo "  scp $(basename "$OUT") root@<router>:/tmp/"
echo "  ssh root@<router> apk add --allow-untrusted /tmp/$(basename "$OUT")"
