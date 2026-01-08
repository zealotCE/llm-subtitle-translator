#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if ! command -v docker >/dev/null 2>&1; then
  echo "docker 未安装，跳过 E2E。"
  exit 0
fi

if ! command -v docker compose >/dev/null 2>&1; then
  echo "docker compose 未安装，跳过 E2E。"
  exit 0
fi

SAMPLE_BASENAME="e2e_sample"
WATCH_DIR="${ROOT_DIR}/watch"
OUT_DIR="${ROOT_DIR}/output"

mkdir -p "$WATCH_DIR" "$OUT_DIR"

docker compose up -d watcher >/dev/null

docker compose exec -T watcher sh -lc "
  rm -f /watch/${SAMPLE_BASENAME}.* /watch/${SAMPLE_BASENAME}.done /output/${SAMPLE_BASENAME}.*;
  ffmpeg -hide_banner -y \
    -f lavfi -i color=c=black:s=320x240:d=2 \
    -f lavfi -i sine=frequency=1000:duration=2 \
    -shortest -c:v libx264 -c:a aac \
    /watch/${SAMPLE_BASENAME}.mp4 >/dev/null 2>&1;
  cat > /watch/${SAMPLE_BASENAME}.zh.srt <<'SRT'
1
00:00:00,000 --> 00:00:01,500
测试字幕
SRT
  touch /watch/.scan_now
"

deadline=$((SECONDS + 120))
while [ $SECONDS -lt $deadline ]; do
  if [ -f "${WATCH_DIR}/${SAMPLE_BASENAME}.done" ] && [ -f "${WATCH_DIR}/${SAMPLE_BASENAME}.srt" ]; then
    echo "E2E 完成：${WATCH_DIR}/${SAMPLE_BASENAME}.done"
    exit 0
  fi
  sleep 2
done

echo "E2E 超时：未生成 .done 或 .srt"
exit 1
