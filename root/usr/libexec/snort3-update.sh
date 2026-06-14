#!/bin/sh
#
# snort3-update.sh - background rule downloader for luci-app-snort3
#
# Detached by the rpcd method `startUpdate`. Writes progress to a JSON status
# file that the UI polls via `getUpdateStatus`.
#
# Rule sources (per snort.org):
#   community (no oinkcode):
#     https://www.snort.org/downloads/community/snort3-community-rules.tar.gz
#   subscription / registered (oinkcode):
#     https://www.snort.org/rules/<file_name>?oinkcode=<oinkcode>
#   ...where <file_name> matches the installed Snort version, e.g.
#     snortrules-snapshot-31470.tar.gz
#
# If an oinkcode is present we use the subscription URL (an inactive
# subscription still returns the free package). With no oinkcode we always
# fall back to the community ruleset.
#

STATUS=/tmp/snort3-update.json
WORKDIR=/tmp/snort3-update.work
COMMUNITY_URL="https://www.snort.org/downloads/community/snort3-community-rules.tar.gz"
SNORT_BIN="$(command -v snort 2>/dev/null || echo /usr/bin/snort)"

RULES_DIR="$(uci -q get snort.snort.rules_dir)"
[ -z "$RULES_DIR" ] && RULES_DIR=/etc/snort/rules
OINKCODE="$(uci -q get snort.snort.oinkcode)"

LOG=""

# ---- downloader abstraction -----------------------------------------------
# OpenWrt images ship different HTTP clients: full curl, uclient-fetch (the
# default, HTTPS-capable), or BusyBox wget. Detect whichever is present so the
# update works without forcing a curl install.
DL_TOOL=""
for _c in curl uclient-fetch wget; do
	if command -v "$_c" >/dev/null 2>&1; then DL_TOOL="$_c"; break; fi
done

# fetch_to URL OUTFILE -> download URL to OUTFILE; return the client exit code
# (127 = no usable client found).
fetch_to() {
	local url="$1" out="$2"
	case "$DL_TOOL" in
		curl)          curl -sL --fail --max-time 600 -o "$out" "$url" ;;
		uclient-fetch) uclient-fetch -q --timeout=600 -O "$out" "$url" ;;
		wget)          wget -q --timeout=600 -O "$out" "$url" ;;
		*)             return 127 ;;
	esac
}

# remote_size URL -> echo the Content-Length in bytes, or nothing. Best effort:
# only curl gives us a clean HEAD; for the others we let the progress bar run
# without a known total.
remote_size() {
	local url="$1"
	[ "$DL_TOOL" = curl ] || return 0
	curl -sIL --max-time 30 "$url" 2>/dev/null | tr -d '\r' \
		| sed -n 's/^[Cc]ontent-[Ll]ength: \([0-9]*\)/\1/p' | tail -n1
}

# Escape a string for safe inclusion in JSON.
json_escape() {
	printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' \
		-e ':a;N;$!ba;s/\n/\\n/g' -e 's/\r//g' -e 's/\t/\\t/g'
}

# write_status running phase percent success message
write_status() {
	local running="$1" phase="$2" percent="$3" success="$4" message="$5"
	cat > "$STATUS" <<-EOF
		{"running":$running,"phase":"$(json_escape "$phase")","percent":$percent,"success":$success,"message":"$(json_escape "$message")","log":"$(json_escape "$LOG")"}
	EOF
}

logline() {
	LOG="${LOG}$1
"
}

fail() {
	logline "ERROR: $1"
	write_status false error 0 false "$1"
	rm -rf "$WORKDIR"
	exit 1
}

snapshot_name() {
	local v a b c d
	v="$("$SNORT_BIN" -V 2>&1 | sed -n 's/.*Version \([0-9][0-9.]*\).*/\1/p' | head -n1)"
	[ -z "$v" ] && return 1
	IFS=. read -r a b c d <<-EOF
		$v
	EOF
	: "${a:=0}"; : "${b:=0}"; : "${c:=0}"; : "${d:=0}"
	printf 'snortrules-snapshot-%s%s%02d%s.tar.gz' "$a" "$b" "$c" "$d"
}

# ---- 1. resolve source ----------------------------------------------------

rm -rf "$WORKDIR"
mkdir -p "$WORKDIR"
TARBALL="$WORKDIR/rules.tar.gz"

if [ -n "$OINKCODE" ]; then
	SNAP="$(snapshot_name)"
	if [ -z "$SNAP" ]; then
		logline "Could not detect Snort version; using community rules instead."
		URL="$COMMUNITY_URL"
		SOURCE=community
	else
		URL="https://www.snort.org/rules/${SNAP}?oinkcode=${OINKCODE}"
		SOURCE="subscription ($SNAP)"
	fi
else
	URL="$COMMUNITY_URL"
	SOURCE=community
fi
logline "Source: $SOURCE"
write_status true resolving 2 false "Resolving rule source"

# ---- 2. determine size (best effort, for the progress bar) ----------------

TOTAL="$(remote_size "$URL")"
[ -z "$TOTAL" ] && TOTAL=0
[ "$TOTAL" -gt 0 ] 2>/dev/null && logline "Remote size: $TOTAL bytes"
logline "Downloader: ${DL_TOOL:-none found}"

# ---- 3. download with progress --------------------------------------------

write_status true downloading 5 false "Downloading rules"
fetch_to "$URL" "$TARBALL" &
DL_PID=$!

elapsed=0
while kill -0 "$DL_PID" 2>/dev/null; do
	got=0
	[ -f "$TARBALL" ] && got="$(stat -c%s "$TARBALL" 2>/dev/null || echo 0)"
	if [ "$TOTAL" -gt 0 ] 2>/dev/null; then
		pct=$(( got * 90 / TOTAL + 5 ))
		[ "$pct" -gt 95 ] && pct=95
	else
		# Unknown total: creep forward so the bar doesn't look frozen.
		pct=$(( 10 + elapsed * 2 ))
		[ "$pct" -gt 90 ] && pct=90
	fi
	write_status true downloading "$pct" false "Downloading rules ($((got/1024)) KiB)"
	elapsed=$((elapsed + 1))
	sleep 1
done

wait "$DL_PID"
RC=$?
[ "$RC" -eq 127 ] && fail "No HTTP download tool found. Install curl (opkg install curl) or uclient-fetch."
[ "$RC" -ne 0 ] && fail "Download failed (downloader exit $RC). Check connectivity and oinkcode."
# uclient-fetch / wget don't fail the process on HTTP errors, so confirm we
# actually received data before trusting it.
[ -s "$TARBALL" ] || fail "Downloaded file is empty (server returned no data)."

# ---- 4. verify the archive -------------------------------------------------

write_status true verifying 96 false "Verifying archive"
if ! gzip -t "$TARBALL" 2>/dev/null; then
	# snort.org returns an HTML error page (not gzip) for bad oinkcodes.
	if head -c 64 "$TARBALL" | grep -qi '<html\|<!doctype'; then
		fail "Server returned an error page, not a ruleset. The oinkcode is likely invalid."
	fi
	fail "Downloaded file is not a valid gzip archive."
fi
SIZE="$(stat -c%s "$TARBALL" 2>/dev/null)"
logline "Downloaded $SIZE bytes, archive OK."

# ---- 5. extract ------------------------------------------------------------

write_status true extracting 97 false "Extracting rules"
EXDIR="$WORKDIR/extract"
mkdir -p "$EXDIR"
tar -xzf "$TARBALL" -C "$EXDIR" 2>/dev/null || fail "Extraction failed."

# ---- 6. install .rules files ----------------------------------------------

write_status true installing 98 false "Installing rules"
mkdir -p "$RULES_DIR"

# Back up any existing rules once.
if [ -z "$(find "$RULES_DIR.bak" -maxdepth 0 2>/dev/null)" ] && \
   [ -n "$(find "$RULES_DIR" -name '*.rules' 2>/dev/null | head -n1)" ]; then
	cp -a "$RULES_DIR" "$RULES_DIR.bak" 2>/dev/null
	logline "Previous rules backed up to $RULES_DIR.bak"
fi

count=0
primary=""
# Copy every .rules file found in the archive into the flat rules dir.
for f in $(find "$EXDIR" -name '*.rules' 2>/dev/null); do
	base="$(basename "$f")"
	cp -f "$f" "$RULES_DIR/$base"
	count=$((count + 1))
	case "$base" in
		snort3-community.rules|snort.rules) primary="$base" ;;
	esac
done
[ "$count" -eq 0 ] && fail "No .rules files were found in the archive."

# Copy bundled support files (so/builtin lists, sid maps) if present.
for extra in $(find "$EXDIR" -name '*.map' -o -name '*.conf' 2>/dev/null); do
	cp -f "$extra" "$RULES_DIR/" 2>/dev/null
done

# ---- 7. maintain the active.rules symlink ----------------------------------

if [ -z "$primary" ]; then
	# fall back to the largest ruleset
	primary="$(find "$RULES_DIR" -name '*.rules' -printf '%s %f\n' 2>/dev/null \
		| sort -nr | head -n1 | cut -d' ' -f2)"
fi
if [ -n "$primary" ]; then
	ln -sf "$primary" "$RULES_DIR/active.rules"
	logline "active.rules -> $primary"
fi

logline "Installed $count rule file(s)."
rm -rf "$WORKDIR"

write_status false done 100 true "Updated $count rule file(s) from $SOURCE"
exit 0
