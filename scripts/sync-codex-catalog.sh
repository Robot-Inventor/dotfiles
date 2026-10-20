#!/usr/bin/env bash
set -eu

if [ "$(uname -s)" != "Linux" ] || [ -z "${WSL_DISTRO_NAME:-}" ]; then
    echo "Skipping Codex catalog copy outside WSL."
    exit 0
fi

windows_profile="$(
    powershell.exe -NoProfile -NonInteractive -Command \
        '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); $env:USERPROFILE'
)"
windows_home="$(wslpath -u "${windows_profile%$'\r'}")"
source="$windows_home/.codex/opencodex-catalog.json"
destination="$HOME/.codex/opencodex-catalog.json"

mkdir -p "$(dirname "$destination")"
temporary="$(mktemp "${destination}.XXXXXX")"
trap 'rm -f -- "$temporary"' EXIT

cp -- "$source" "$temporary"
mv -f -- "$temporary" "$destination"

echo "Copied Windows Codex catalog to $destination"
