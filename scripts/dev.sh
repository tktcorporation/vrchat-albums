#!/bin/bash

# X ディスプレイ設定: desktop-lite feature が DISPLAY を提供するが、
# コンテナ未再ビルド時やCI環境でも動くよう Xvfb をフォールバックで起動する
if [ -z "$DISPLAY" ]; then
  export DISPLAY=:1
fi
if ! xdpyinfo -display "$DISPLAY" &>/dev/null 2>&1; then
  Xvfb "$DISPLAY" -screen 0 1920x1080x24 &>/dev/null &
  sleep 0.5
fi

# DBus セッションバス設定（dbus-x11 パッケージ必須）
if command -v dbus-launch &>/dev/null; then
  eval "$(dbus-launch --sh-syntax)"
fi

# 開発環境のための環境変数設定
export NODE_ENV=development

# Viteの開発サーバーをバックグラウンドで起動
pnpm dev:vite &
VITE_PID=$!

# Electronビルドを実行し、完了を待つ
echo "Building Electron..."
pnpm build:electron

# ビルドが成功したら、Electronを起動
if [ $? -eq 0 ]; then
  echo "Starting Electron..."
  electron . --disable-gpu --no-sandbox
else
  echo "Electron build failed"
fi

# 終了時にViteサーバーを停止
kill $VITE_PID