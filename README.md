# luci-app-snort3
A LuCI web interface for managing the **Snort3** IDS/IPS on OpenWrt. Configure, monitor and update Snort directly from the router's web UI. 

## Features

* **Real-time status dashboard** — service running/stopped, PID and per-process
  memory, total system memory, alert counter, and monitored-interface link state.
  Auto-refreshes every 5 s.
* **Configuration** — interface selection, operating mode (IDS / IPS), DAQ method
  (afpacket / nfq / pcap / dump), `$HOME_NET` / `$EXTERNAL_NET`, file/dir paths,
  and a free-form custom Lua block. Stored in UCI (`/etc/config/snort`).
* **Alerts & logs** — last 50 fast-alerts, recent Snort syslog lines, and
  priority statistics (P1/P2/other). Auto-refreshes every 5 s.
* **Rule update management**
  * Downloads the free community ruleset from
    `https://www.snort.org/downloads/community/snort3-community-rules.tar.gz`
    when no oinkcode is set.
  * With an oinkcode, fetches the version-matched subscription package from
    `https://www.snort.org/rules/<file_name>?oinkcode=<oinkcode>`, where
    `<file_name>` is derived from the installed Snort version
    (e.g. Snort 3.1.20.0 → `snortrules-snapshot-31200.tar.gz`). An inactive
    subscription transparently returns the free package.
  * "Check for updates" performs a lightweight HEAD request to show remote size
    and last-modified before committing to a download.
  * Live download/extract **progress bar** with a streaming log.
* **Service controls** — start / stop / restart, enable / disable auto-start, and
  **symlink management**: point `active.rules` at any installed ruleset so your
  `snort.lua` include never has to change.

See <https://www.snort.org/oinkcodes> for how to obtain an oinkcode.

## Architecture

The UI is plain LuCI client-side JS (`htdocs/.../view/snort3/*.js`). All
privileged work happens in an rpcd backend (`/usr/libexec/rpcd/luci.snort3`)
exposed over ubus as the `luci.snort3` object. The rule download runs as a
detached worker (`/usr/libexec/snort3-update.sh`) that writes JSON progress to
`/tmp/snort3-update.json`, so progress survives page reloads. The ACL grants the
web session only ubus (`luci.snort3`) and UCI (`snort`) access — no direct
filesystem grants.

## Requirements

* OpenWrt with LuCI (client-side / JS rendering — `luci-base`)
* `snort3`
* `curl`, `tar`, `gzip` (pulled in as dependencies)

## Install

### Option A — build an `.ipk` in the OpenWrt SDK / buildroot

1. Copy this directory into your feeds, e.g.
   `package/feeds/luci/luci-app-snort3` (or a custom feed).
2. `make menuconfig` → enable **LuCI → Applications → luci-app-snort3**.
3. `make package/luci-app-snort3/compile`.
4. Install the resulting `.ipk` with `opkg install`.

### Option B — manual install on a running router

Copy the trees to the device and refresh rpcd + LuCI:

```sh
# from this directory, on the router:
cp -a root/*        /
cp -a htdocs/*      /www/luci-static/../..   # i.e. into /www/luci-static/resources/...
# (simpler: rsync the htdocs/luci-static tree to /www/luci-static)

chmod 0755 /usr/libexec/rpcd/luci.snort3 /usr/libexec/snort3-update.sh
sh /etc/uci-defaults/40_luci-app-snort3      # seeds UCI + fixes perms + reloads
/etc/init.d/rpcd reload
```

Then reload the LuCI page. The app appears under **Services → Snort3**.

## Files

```
Makefile                                   OpenWrt package definition
root/etc/config/snort                      default UCI configuration
root/etc/uci-defaults/40_luci-app-snort3   first-boot install script
root/usr/share/luci/menu.d/…json           menu entries (Services → Snort3)
root/usr/share/rpcd/acl.d/…json            ubus/uci ACL
root/usr/libexec/rpcd/luci.snort3          rpcd backend (ubus object luci.snort3)
root/usr/libexec/snort3-update.sh          detached rule-download worker
htdocs/luci-static/resources/view/snort3/  overview/config/alerts/rules views + CSS
```

## Notes

* The oinkcode is stored in UCI (`snort.snort.oinkcode`). It is a rule-download
  token, not a system credential.
* `active.rules` is created/updated as a symlink inside the rules directory.
  Include it from your `snort.lua` (e.g. via the `ips.rules` / `include`
  mechanism) so switching the active ruleset needs no further config edits.
* Switching to IPS mode requires an inline DAQ (typically `nfq`) plus the
  matching netfilter setup; afpacket/pcap are passive (IDS).

## License

Apache-2.0.
