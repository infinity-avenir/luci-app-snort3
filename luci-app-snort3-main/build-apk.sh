#!/bin/sh
# Builds dist/luci-app-snort3_<version>_noarch.apk (APK v3, OpenWrt 25.x).
exec python3 "$(cd "$(dirname "$0")" && pwd)/build_apk.py" "$@"
