#!/usr/bin/env bash

set -euo pipefail

LABEL="com.x-post2image.wechat-listener"
DEFAULT_CONFIG="${HOME}/.weclaw/x-post2image-delivery.json"
COMMAND="${1:-help}"
if [[ $# -gt 0 ]]; then
  shift
fi

CONFIG="$DEFAULT_CONFIG"
HISTORY=""
DRY_RUN=0

usage() {
  cat <<'EOF'
Usage:
  wechat_ilink_listener_service.sh install --history /absolute/path/history.jsonl [--config FILE] [--dry-run]
  wechat_ilink_listener_service.sh status
  wechat_ilink_listener_service.sh uninstall

The install command is macOS-only. It creates a per-user launchd service that
starts at login and stays running without opening WeChat Desktop.
EOF
}

fail() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 1
}

expand_path() {
  local value="$1"
  if [[ "$value" == "~" ]]; then
    value="$HOME"
  elif [[ "$value" == "~/"* ]]; then
    value="${HOME}/${value:2}"
  fi
  if [[ "$value" != /* ]]; then
    value="${PWD}/${value}"
  fi
  printf '%s\n' "$value"
}

xml_escape() {
  printf '%s' "$1" |
    sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g' \
      -e 's/"/\&quot;/g' -e "s/'/\&apos;/g"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --config)
      [[ $# -ge 2 ]] || fail "missing value for --config"
      CONFIG="$2"
      shift 2
      ;;
    --history)
      [[ $# -ge 2 ]] || fail "missing value for --history"
      HISTORY="$2"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      fail "unknown argument: $1"
      ;;
  esac
done

if [[ "$COMMAND" == "help" || "$COMMAND" == "-h" || "$COMMAND" == "--help" ]]; then
  usage
  exit 0
fi

[[ "$(uname -s)" == "Darwin" ]] || fail "the launchd service helper requires macOS"

USER_ID="$(id -u)"
DOMAIN="gui/${USER_ID}"
PLIST_DIR="${HOME}/Library/LaunchAgents"
PLIST_PATH="${PLIST_DIR}/${LABEL}.plist"

if [[ "$COMMAND" == "status" ]]; then
  launchctl print "${DOMAIN}/${LABEL}"
  exit $?
fi

if [[ "$COMMAND" == "uninstall" ]]; then
  launchctl bootout "${DOMAIN}" "$PLIST_PATH" >/dev/null 2>&1 || true
  if [[ -f "$PLIST_PATH" ]]; then
    rm "$PLIST_PATH"
  fi
  printf 'Removed %s. Private logs and credentials were kept.\n' "$LABEL"
  exit 0
fi

[[ "$COMMAND" == "install" ]] || fail "unknown command: $COMMAND"
[[ -n "$HISTORY" ]] || fail "install requires --history"

CONFIG="$(expand_path "$CONFIG")"
HISTORY="$(expand_path "$HISTORY")"
[[ -f "$CONFIG" ]] || fail "delivery config not found: $CONFIG"
[[ -d "$(dirname "$HISTORY")" ]] || fail "history parent directory not found: $(dirname "$HISTORY")"
[[ "$(stat -f '%Lp' "$CONFIG")" == "600" ]] ||
  fail "delivery config must have mode 600"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd -P)"
LISTENER_SCRIPT="${SCRIPT_DIR}/wechat_ilink_listener.mjs"
DELIVERY_SCRIPT="${SCRIPT_DIR}/wechat_ilink_delivery.mjs"
[[ -f "$LISTENER_SCRIPT" ]] || fail "listener script is missing"
[[ -f "$DELIVERY_SCRIPT" ]] || fail "delivery script is missing"

NODE_BIN="${NODE:-}"
if [[ -z "$NODE_BIN" ]]; then
  NODE_BIN="$(command -v node || true)"
fi
[[ -n "$NODE_BIN" && -x "$NODE_BIN" ]] || fail "Node.js is required"
if [[ "$NODE_BIN" != /* ]]; then
  NODE_BIN="$(command -v "$NODE_BIN")"
fi

PRIVATE_ROOT="${HOME}/.weclaw/x-post2image-delivery"
LOG_DIR="${PRIVATE_ROOT}/logs"
STDOUT_LOG="${LOG_DIR}/listener.out.log"
STDERR_LOG="${LOG_DIR}/listener.err.log"

render_plist() {
  local node_xml script_xml config_xml history_xml home_xml stdout_xml stderr_xml
  node_xml="$(xml_escape "$NODE_BIN")"
  script_xml="$(xml_escape "$LISTENER_SCRIPT")"
  config_xml="$(xml_escape "$CONFIG")"
  history_xml="$(xml_escape "$HISTORY")"
  home_xml="$(xml_escape "$HOME")"
  stdout_xml="$(xml_escape "$STDOUT_LOG")"
  stderr_xml="$(xml_escape "$STDERR_LOG")"
  cat <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${node_xml}</string>
    <string>${script_xml}</string>
    <string>--config</string>
    <string>${config_xml}</string>
    <string>--history</string>
    <string>${history_xml}</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HOME</key>
    <string>${home_xml}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ProcessType</key>
  <string>Background</string>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>Umask</key>
  <integer>63</integer>
  <key>StandardOutPath</key>
  <string>${stdout_xml}</string>
  <key>StandardErrorPath</key>
  <string>${stderr_xml}</string>
</dict>
</plist>
EOF
}

if [[ "$DRY_RUN" -eq 1 ]]; then
  render_plist
  exit 0
fi

"$NODE_BIN" "$DELIVERY_SCRIPT" preflight --config "$CONFIG" >/dev/null

mkdir -p "$PLIST_DIR" "$LOG_DIR"
chmod 700 "$PRIVATE_ROOT" "$LOG_DIR"
TEMP_PLIST="$(mktemp "${PLIST_DIR}/.${LABEL}.XXXXXX")"
trap 'rm -f "$TEMP_PLIST"' EXIT
render_plist >"$TEMP_PLIST"
chmod 600 "$TEMP_PLIST"
plutil -lint "$TEMP_PLIST" >/dev/null

launchctl bootout "$DOMAIN" "$PLIST_PATH" >/dev/null 2>&1 || true
mv "$TEMP_PLIST" "$PLIST_PATH"
trap - EXIT
launchctl bootstrap "$DOMAIN" "$PLIST_PATH"
launchctl enable "${DOMAIN}/${LABEL}"
launchctl kickstart -k "${DOMAIN}/${LABEL}"

printf 'Installed and started %s\n' "$LABEL"
printf 'Status: %s status\n' "$0"
printf 'Logs: %s\n' "$LOG_DIR"
