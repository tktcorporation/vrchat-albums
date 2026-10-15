#!/usr/bin/env bun
/**
 * git の author 情報 (user.name / user.email) をコンテナへ設定する。
 *
 * ~/.gitconfig は named volume の外にあり rebuild のたびに失われるため、
 * postCreateCommand から毎回設定し直す。
 */
import { $ } from 'bun';

async function globalConfig(key: string) {
  const r = await $`git config --global ${key}`.quiet().nothrow();
  return r.exitCode === 0 ? r.text().trim() : '';
}

/**
 * gh の認証済みアカウントから author を組み立てる。
 *
 * GH_TOKEN さえコンテナへ渡っていれば、.env.devcontainer に GIT_USER_* を
 * 書かなくても git がコミットできる状態になる。
 *
 * email には GitHub がアカウントごとに用意する noreply アドレスを使う。
 * public email を公開していないアカウントでは API から実アドレスを取れないのに対し、
 * noreply アドレスなら push したコミットが GitHub 上で本人に紐づく。
 */
async function ghIdentity(): Promise<{ name: string; email: string }> {
  const r = await $`gh api user --jq '[.login, (.id|tostring), (.name // "")] | @tsv'`
    .quiet()
    .nothrow();
  if (r.exitCode !== 0) return { name: '', email: '' };

  const [login = '', id = '', displayName = ''] = r.text().trim().split('\t');
  if (!login || !id) return { name: '', email: '' };

  return { name: displayName || login, email: `${id}+${login}@users.noreply.github.com` };
}

// 明示指定 (.env.devcontainer) と、既に入っている ~/.gitconfig を先に見る
const givenName = process.env.GIT_USER_NAME || (await globalConfig('user.name'));
const givenEmail = process.env.GIT_USER_EMAIL || (await globalConfig('user.email'));

// どちらか一方でも欠けているときだけ gh を引き、両方揃っているなら API 往復を省く
const fallback = givenName && givenEmail ? { name: '', email: '' } : await ghIdentity();

const name = givenName || fallback.name;
const email = givenEmail || fallback.email;

if (name && email) {
  await $`git config --global user.name ${name}`;
  await $`git config --global user.email ${email}`;
  console.log(`Git user configured: ${name} <${email}>`);
} else {
  console.warn(
    'Warning: git user not configured. Set GIT_USER_NAME / GIT_USER_EMAIL in .devcontainer/.env.devcontainer, or provide GH_TOKEN so that gh can supply them.',
  );
}
