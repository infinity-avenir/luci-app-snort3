#
# Copyright (C) 2024 luci-app-snort3 contributors
#
# This is free software, licensed under the Apache License, Version 2.0
#

include $(TOPDIR)/rules.mk

LUCI_TITLE:=LuCI support for Snort3 IDS/IPS
LUCI_DESCRIPTION:=Configure, monitor and manage the Snort3 intrusion \
	detection / prevention engine from LuCI.
LUCI_DEPENDS:=+luci-base +snort3 +curl +tar +gzip
LUCI_PKGARCH:=all

PKG_NAME:=luci-app-snort3
PKG_VERSION:=1.0.0
PKG_RELEASE:=1
PKG_LICENSE:=Apache-2.0
PKG_MAINTAINER:=luci-app-snort3 contributors

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage - OpenWrt buildroot signature

