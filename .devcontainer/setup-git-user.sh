#!/bin/bash
# devcontainer 起動時に git user.name / user.email を確実に設定する。
#
# 優先順位:
#   1. 環境変数 GIT_USER_NAME / GIT_USER_EMAIL（.env.devcontainer で指定可能）
#   2. 既存の git config --global（VS Code がホストからコピーした場合）
#   3. Codespaces の GITHUB_USER 環境変数（Codespaces が自動設定）
#
# jj は git config または ~/.jjconfig.toml を参照するため、
# git config が正しく設定されていれば jj 側の追加設定は不要。

set -euo pipefail

current_name=$(git config --global user.name 2>/dev/null || true)
current_email=$(git config --global user.email 2>/dev/null || true)

# 環境変数が設定されていればそれを優先、次に既存の git config、
# 最後に Codespaces が提供する GITHUB_USER をフォールバックに使う
name="${GIT_USER_NAME:-${current_name:-${GITHUB_USER:-}}}"
email="${GIT_USER_EMAIL:-${current_email:-${GITHUB_USER:+${GITHUB_USER}@users.noreply.github.com}}}"

if [ -n "$name" ] && [ -n "$email" ]; then
  git config --global user.name "$name"
  git config --global user.email "$email"
  echo "Git user configured: $name <$email>"
else
  # コンテナ起動を止めない。ユーザーに警告だけ出して続行する
  echo "Warning: git user not configured. Set GIT_USER_NAME and GIT_USER_EMAIL in .devcontainer/.env.devcontainer"
fi
