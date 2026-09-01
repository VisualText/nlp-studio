#!/usr/bin/env bash
#
# Install the GitHub Actions self-hosted runner that deploys studio.visualtext.org.
#
# The runner dials out to GitHub over HTTPS and waits for work, so this needs no
# inbound firewall rule, no SSH key at GitHub, and no change to CSF. It runs as
# the invoking user (visualtext), which is already in the `docker` group.
#
# Get a registration token first -- they expire after an hour:
#   https://github.com/VisualText/nlp-studio/settings/actions/runners/new
#   (pick Linux / x64; you only need the value after `--token`)
#
# Usage:
#   ./install-runner.sh <registration-token>
#
# Afterwards ONE root step is needed, so the runner survives logout and reboot:
#   loginctl enable-linger visualtext
#
# Without it, systemd stops the user's services the moment the last login session
# ends -- the runner would work until you disconnected and then quietly stop.
#
set -euo pipefail

# Resolved before anything cds elsewhere -- BASH_SOURCE is relative when the
# script is invoked as ./install-runner.sh, so reading it after "cd $RUNNER_DIR"
# would look for the unit template inside the runner directory.
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# id(1) rather than the environment: the usual login variables are set by login
# shells and are absent under `su` or `sudo su`, where set -u then aborts.
ME="$(id -un)"
MY_GROUP="$(id -gn)"
# Same reasoning for HOME, which systemd and `su` set but a bare env does not.
HOME="${HOME:-$(getent passwd "$ME" | cut -d: -f6)}"
export HOME

# This must run as the account that owns the site, not root. A root install
# registers the runner as root, writes root-owned state into the runner
# directory, and puts the systemd user unit in root's home -- where the enabled
# service would never start for this account.
if [ "$(id -u)" -eq 0 ]; then
    cat >&2 <<EOF
install-runner: do not run this as root.

  The runner must run as the account that owns the site and is in the docker
  group. Run it as that user:

      su - visualtext
      cd $HERE
      RUNNER_DIR=/opt/actions-runner-nlp-studio ./install-runner.sh <token>

  Root is needed only to create the runner directory and enable lingering:

      mkdir -p /opt/actions-runner-nlp-studio
      chown visualtext:visualtext /opt/actions-runner-nlp-studio
      loginctl enable-linger visualtext
EOF
    exit 1
fi

TOKEN="${1:-}"
REPO_URL="https://github.com/VisualText/nlp-studio"
RUNNER_DIR="${RUNNER_DIR:-$HOME/actions-runner-nlp-studio}"
LABELS="nlp-studio"
UNIT="github-runner-nlp-studio.service"

if [ -z "$TOKEN" ] && [ ! -f "$RUNNER_DIR/.runner" ]; then
    sed -n '2,22p' "$0" | sed 's/^# \?//' >&2
    exit 1
fi

command -v docker >/dev/null || { echo "install-runner: docker not on PATH" >&2; exit 1; }
id -nG | tr ' ' '\n' | grep -qx docker || {
    echo "install-runner: $ME is not in the docker group; the runner could not build" >&2
    exit 1
}

# --- where the runner may live ---------------------------------------------------
# The runner reads every ancestor directory of its own path, not just traverses
# them. On cPanel hosts /home is drwx--x--x root:root -- deliberate hardening so
# accounts cannot enumerate each other -- so ANY path under /home fails with:
#
#   An error occurred: Permission to read the directory contents is required for
#   '<dir>' and each directory up the hierarchy. Access to the path '/home' is denied.
#
# That is not fixable from this account: /home is root-owned, and opening it to
# 755 would undo the hardening for every account on the box. The runner has to
# live outside /home, in a directory root creates for us once.
unreadable=""
d="$RUNNER_DIR"
while :; do
    d="$(dirname "$d")"
    [ -r "$d" ] || unreadable="$d${unreadable:+ }$unreadable"
    [ "$d" = / ] && break
done
if [ -n "$unreadable" ]; then
    cat >&2 <<EOF
install-runner: cannot use $RUNNER_DIR

  The runner must be able to READ every directory above its own. These are not
  readable by $ME: $unreadable

  Ask root to create a home for it outside /home, once:

      mkdir -p /opt/actions-runner-nlp-studio
      chown $ME:$MY_GROUP /opt/actions-runner-nlp-studio

  then re-run this script pointed at it:

      RUNNER_DIR=/opt/actions-runner-nlp-studio $0 <token>
EOF
    exit 1
fi

mkdir -p "$RUNNER_DIR"
cd "$RUNNER_DIR"

# --- fetch ---------------------------------------------------------------------
if [ ! -x ./config.sh ]; then
    version="$(curl -fsSL https://api.github.com/repos/actions/runner/releases/latest \
        | python3 -c 'import json,sys; print(json.load(sys.stdin)["tag_name"].lstrip("v"))')"
    tarball="actions-runner-linux-x64-${version}.tar.gz"
    echo "install-runner: fetching runner $version"
    curl -fsSL --retry 3 -o "$tarball" \
        "https://github.com/actions/runner/releases/download/v${version}/${tarball}"
    tar xzf "$tarball"
    rm -f "$tarball"
else
    echo "install-runner: runner already unpacked in $RUNNER_DIR"
fi

# --- register ------------------------------------------------------------------
# --replace so re-running this after a token expiry or a hostname change adopts
# the existing registration instead of creating a duplicate runner.
if [ -f .runner ]; then
    echo "install-runner: already registered as $(python3 -c 'import json;print(json.load(open(".runner"))["agentName"])' 2>/dev/null || echo '?')"
    echo "install-runner: re-registering would need a fresh token; skipping"
elif [ -z "$TOKEN" ]; then
    echo "install-runner: not registered and no token given" >&2
    exit 1
else
echo "install-runner: registering with $REPO_URL"
./config.sh \
    --url "$REPO_URL" \
    --token "$TOKEN" \
    --name "$(hostname -s)-nlp-studio" \
    --labels "$LABELS" \
    --work _work \
    --unattended \
    --replace
fi

# --- supervise -----------------------------------------------------------------
# The runner ships svc.sh, which installs a SYSTEM systemd unit and needs root.
# This account has no passwordless sudo, so use a user unit instead -- same
# result, no root, at the cost of needing linger enabled (see the header).
mkdir -p "$HOME/.config/systemd/user"
sed "s|@RUNNER_DIR@|$RUNNER_DIR|g" "$HERE/$UNIT.in" \
    > "$HOME/.config/systemd/user/$UNIT"

systemctl --user daemon-reload
systemctl --user enable --now "$UNIT"

echo
systemctl --user --no-pager status "$UNIT" | head -n 12 || true
echo
echo "install-runner: done."
echo
if [ "$(loginctl show-user "$ME" -p Linger --value 2>/dev/null)" != yes ]; then
    cat >&2 <<'WARN'
==> STILL TO DO, as root:

        loginctl enable-linger visualtext

    Until this is run the runner stops when your last session ends, and the
    site will silently stop updating. Verify with:

        loginctl show-user visualtext -p Linger      # want Linger=yes
WARN
fi
echo "Check it appears here: $REPO_URL/settings/actions/runners"
