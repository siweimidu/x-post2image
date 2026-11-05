#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "wechat_main_window_delivery requires macOS" >&2
  exit 1
fi

if ! command -v swiftc >/dev/null 2>&1; then
  echo "swiftc is required to build the verified WeChat delivery helper" >&2
  exit 1
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source_file="${script_dir}/wechat_main_window_delivery.swift"
build_dir="$(mktemp -d "${TMPDIR:-/tmp}/x-post2image-wechat.XXXXXX")"
binary="${build_dir}/wechat-main-window-delivery"

cleanup() {
  rm -rf "${build_dir}"
}
trap cleanup EXIT INT TERM

swiftc -parse-as-library "${source_file}" \
  -o "${binary}" \
  -framework AppKit \
  -framework AVFoundation \
  -framework CoreImage \
  -framework CoreMedia \
  -framework Vision

"${binary}" "$@"
