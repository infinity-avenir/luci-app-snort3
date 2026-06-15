# luci-app-snort3

A LuCI web interface for managing the **Snort3** IDS/IPS on OpenWrt. Configure,
monitor and update Snort directly from the router's web UI. The interface uses a
clean, white/light theme.

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
  * **Automatic update schedule** — configure updates to run monthly (day 1–30),
    weekly (Sun–Sat) or daily, at a chosen hour and minute (00/15/30/45). The
    schedule is stored in UCI and backed by a cron job managed from the UI.
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
* `tar`, `gzip`
* An HTTPS download client: `curl`, **or** `uclient-fetch` (the OpenWrt
  default), **or** BusyBox `wget` with SSL. The rule downloader auto-detects
  whichever is installed; `curl` additionally enables the remote size /
  last-modified readout on "Check for updates".

## Install

### Option A — build an `.ipk` in the OpenWrt SDK / buildroot

1. Copy this directory into your feeds, e.g.
   `package/feeds/luci/luci-app-snort3` (or a custom feed).
2. `make menuconfig` → enable **LuCI → Applications → luci-app-snort3**.
3. `make package/luci-app-snort3/compile`.
4. Install the resulting `.ipk` with `opkg install`.

### Option B — manual install on a running router

Copy the trees to the device and refresh rpcd. **Static assets must go under
`/www`** (LuCI serves `/luci-static/...` from `/www/luci-static/...`); the rpcd
backend, config, menu and ACL go under `/`.

```sh
# On the router, from the unpacked luci-app-snort3/ directory:

# 1. LuCI view files (4 .js) + CSS -> the path LuCI requests
mkdir -p /www/luci-static/resources/view/snort3
cp htdocs/luci-static/resources/view/snort3/* /www/luci-static/resources/view/snort3/

# 2. rpcd backend, default config, menu and ACL -> /   ('/.' merges into existing dirs)
cp -a root/. /

# 3. Fix perms, seed UCI, reload rpcd
chmod 0755 /usr/libexec/rpcd/luci.snort3 /usr/libexec/snort3-update.sh
sh /etc/uci-defaults/40_luci-app-snort3      # seeds UCI + fixes perms + clears luci cache
/etc/init.d/rpcd reload
```

Verify the assets landed correctly, then reload the LuCI page:

```sh
ls -l /www/luci-static/resources/view/snort3/   # expect overview.js, config.js, alerts.js, rules.js, snort3.css
```

The app appears under **Services → Snort3**. (The `?v=…` query string LuCI adds
to resource URLs is a cache-buster, so no browser-cache clearing is needed.)

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

## Troubleshooting

* **"HTTP 0" / "downloader exit 127" on update** — no HTTP client is installed.
  Exit 127 means the download command was not found. Install one:
  `opkg update && opkg install curl` (or `opkg install uclient-fetch`).
* **404 loading a view (`/luci-static/resources/view/snort3/*.js`)** — the JS
  assets are not under `/www`. See the manual-install steps above; they must
  land in `/www/luci-static/resources/view/snort3/`.
* **Empty Overview / RPC errors** — confirm the backend is registered:
  `ubus list | grep luci.snort3` and `ubus call luci.snort3 getStatus`. If
  missing, ensure `/usr/libexec/rpcd/luci.snort3` is present and `0755`, then
  `/etc/init.d/rpcd reload`.
* **Bad oinkcode** — snort.org returns an HTML error page instead of a gzip
  archive; the updater detects this and reports that the oinkcode is likely
  invalid. Clear it with "Use community rules" to fall back to the free set.

## License

Apache-2.0.


=====================================


Screenshot :

<img width="1501" height="560" alt="image" src="https://github.com/user-attachments/assets/3023e590-b9de-4da8-81cd-3d3daaf99927" />

<img width="1507" height="643" alt="image" src="https://github.com/user-attachments/assets/7178f60c-e836-48e8-8c62-8dc1d44c1c0b" />

<img width="1502" height="466" alt="image" src="https://github.com/user-attachments/assets/79902240-953a-4886-8d58-6bc11d277b34" />

<img width="1498" height="642" alt="image" src="https://github.com/user-attachments/assets/c3b1420e-1cf5-46c7-9c2e-fc7af526de59" />

<img width="1493" height="677" alt="image" src="https://github.com/user-attachments/assets/cc59c5ff-078c-4028-9504-f73697b8189d" />

<img width="1501" height="1017" alt="image" src="https://github.com/user-attachments/assets/33935df8-c1c4-40d4-8ab3-538354ce0215" />

<img width="1528" height="765" alt="image" src="https://github.com/user-attachments/assets/b207cee4-a0d1-4f39-b70d-d35c3da544b8" />

