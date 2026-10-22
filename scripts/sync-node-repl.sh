#!/usr/bin/env bash
set -euo pipefail

if [ "$(uname -s)" != "Linux" ]; then
    echo "Skipping node_repl extraction outside Linux."
    exit 0
fi

case "$(uname -m)" in
    x86_64) architecture="amd64" ;;
    aarch64 | arm64) architecture="arm64" ;;
    *) echo "Unsupported node_repl architecture: $(uname -m)" >&2; exit 1 ;;
esac

codex_path="$(command -v codex)"
node_path="$(command -v node)"
destination="${XDG_DATA_HOME:-$HOME/.local/share}/codex-node-repl"
binary="$destination/node_repl"
etag="$destination/app-$architecture.etag"
url="https://persistent.oaistatic.com/codex-app-prod/linux/deb/latest/chatgpt_$architecture.deb"

mkdir -p "$destination"
temporary="$(mktemp -d "$destination/.sync.XXXXXX")"
trap 'rm -rf -- "$temporary"' EXIT

conditional=()
if [ -x "$binary" ] && [ -s "$etag" ]; then
    conditional=(--etag-compare "$etag")
fi

echo "Checking the official Linux app for node_repl updates."
status="$(curl -fsSL --connect-timeout 15 --max-time 300 \
    "${conditional[@]}" --etag-save "$temporary/app.etag" \
    --output "$temporary/app.deb" --write-out '%{http_code}' "$url")"

if [ "$status" != "304" ]; then
    DPKG_DEB_THREADS_MAX=1 dpkg-deb --fsys-tarfile "$temporary/app.deb" \
        | tar -xOf - ./usr/lib/chatgpt/resources/cua_node/bin/node_repl \
        > "$temporary/node_repl"
    chmod 755 "$temporary/node_repl"
    "$temporary/node_repl" --help >/dev/null

    mv -f -- "$temporary/node_repl" "$binary"
    mv -f -- "$temporary/app.etag" "$etag"
    echo "Installed node_repl at $binary"
else
    echo "node_repl is already up to date."
fi

"$codex_path" mcp add node_repl \
    --env "CODEX_CLI_PATH=$codex_path" \
    --env "NODE_REPL_NODE_PATH=$node_path" \
    -- "$binary"
