#!/usr/bin/env bun
/**
 * Stop: 現在のブランチの PR に未解決のレビュースレッドが残っていたら、完了を止めて対応させる。
 *
 * PR 作成後の自動レビュー（bot）や人のコメントは数分〜数十分遅れて届く。届いた後に
 * エージェントが「完了」と報告して止まると、対応はユーザーが次に気づいて指示するまで残る。
 * ターンの終わりごとに未解決スレッドを見て、まだ知らせていないものがあれば 1 度だけ止める。
 * 同じスレッドで何度も止めない（知らせたスレッドの id をセッション状態に記録する）。
 *
 * GitHub への問い合わせは Port（github-port.ts）を通し、PR の検索・ログイン名・指摘の取得は
 * REST だけで行う。未解決スレッドは GraphQL でしか取れないので、取れない環境ではレビュー済みの
 * 基準線より後に届いたインラインコメントを代わりに知らせる。
 *
 * gh が使えない・PR が無い・PR を確認できない場合は何もしない。Stop は毎ターン動くので、
 * 確認できない状態を毎回止めて知らせると作業が進まない。push のゲートは同じ状態を理由付きで警告する。
 *
 * ボットコメントの到着は分単位で遅れるため、直近のチェックから間もない Stop では gh を
 * 呼ばずスキップする（THROTTLE_MS 未満）。これが無いと、PR に紐づく間は連続する Stop の
 * 度に PR の検索・ログイン名・スレッド・コメント・レビューの取得が毎回走り、無関係な
 * セッションを含めてレート制限とレイテンシを消費する。
 */
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createGitHubPort } from './github-port.ts';
import type { ReviewThread } from './github-port.ts';
import { hookCommand, isRecord, readInput, resolveTarget, sessionStateDir } from './hook-utils.ts';
import { refreshFeedback } from './pr-feedback-observation.ts';

const THROTTLE_MS = 45_000;

const input = await readInput();
if (input?.stop_hook_active) process.exit(0);
// Stop の入力にはコマンドが無いので、対象はセッションの現在地（入力の cwd）のチェックアウトになる。
// `cd <submodule> && ...` のようにコマンドごとに移動して作業していると、現在地はルートのままで、
// サブモジュール側の PR は見ない（ゲートは push・PR 作成の時点で対象を解くので、見逃しは
// Stop での通知に限られる）。
const target = await resolveTarget(input);
const tree = target.cwd;

const directory = await sessionStateDir();
const throttlePath = directory
  ? join(directory, `${input?.session_id ?? 'unknown'}.pr-check-throttle`)
  : null;
if (throttlePath) {
  const last = Number.parseInt(
    await Bun.file(throttlePath)
      .text()
      .catch(() => '0'),
    10,
  );
  const now = performance.timeOrigin + performance.now();
  if (Number.isFinite(last) && now - last < THROTTLE_MS) process.exit(0);
  await mkdir(dirname(throttlePath), { recursive: true }).catch(() => undefined);
  await Bun.write(throttlePath, String(now)).catch(() => undefined);
}

const port = createGitHubPort(tree);
const lookup = await port.findOpenPullRequest();
if (lookup.kind !== 'found') process.exit(0);
const { number, url, repository } = lookup.pullRequest;

// 未解決スレッドは GraphQL でしか取れない。取れない環境では null にし、REST で取れる
// インラインコメントの観測へ切り替える。
const threadResult = await port.reviewThreads(number);
const loginResult = await port.viewerLogin();
const threads: ReviewThread[] | null =
  threadResult.kind === 'ok' && loginResult.kind === 'ok' ? threadResult.value : null;
const login = loginResult.kind === 'ok' ? loginResult.value : '';
// 未解決で、最後の発言が自分ではないスレッドだけが対応待ち
const waiting = (threads ?? []).filter(
  (thread) => !thread.isResolved && thread.comments.nodes[0]?.author?.login !== login,
);

const naggedPath = directory
  ? join(directory, `${input?.session_id ?? 'unknown'}.pr-nagged`)
  : null;
const nagged = new Set(
  naggedPath && (await Bun.file(naggedPath).exists())
    ? (
        await Bun.file(naggedPath)
          .text()
          .catch(() => '')
      )
        .split('\n')
        .filter(Boolean)
    : [],
);
// 知らせた状態は「スレッド id + 最後のコメント id」で覚える。同じスレッドでも新しい返信が
// 付けば再び知らせる
const stateOf = (thread: ReviewThread) =>
  `${thread.id}:${thread.comments.nodes[0]?.databaseId ?? ''}`;
const fresh = waiting.filter((thread) => !nagged.has(stateOf(thread)));
// レビュー本文だけの CHANGES_REQUESTED にも未解決スレッドは存在しない。
// スレッドの有無に関係なく GitHub のレビューを観測してから通知を判定する。
const observed = await refreshFeedback(target, port);
if (observed.kind !== 'found') {
  if (fresh.length === 0) process.exit(0);
  console.log(
    JSON.stringify({
      decision: 'block',
      reason: `PR #${number} の指摘を履歴に記録できませんでした。${hookCommand('observe-pr-feedback.ts')} を ${tree} で再実行し、成功を確認してからレビューを始めてください。`,
    }),
  );
  process.exit(0);
}
const unreviewed = observed.history.seenComments
  .slice(observed.history.reviewedCommentCount)
  .filter((id) => !nagged.has(id));
const freshReviews = unreviewed.filter((id) => id.startsWith('review:'));
// スレッドを取れたときは、解決済みを除けるスレッドで知らせる。取れないときは、レビュー済みの
// 基準線より後に届いたインラインコメントを知らせる（解決済みかどうかは REST では分からない）。
const freshComments = threads === null ? unreviewed.filter((id) => id.startsWith('comment:')) : [];
if (fresh.length === 0 && freshReviews.length === 0 && freshComments.length === 0) process.exit(0);
if (naggedPath) {
  await mkdir(dirname(naggedPath), { recursive: true }).catch(() => undefined);
  await Bun.write(
    naggedPath,
    `${[...nagged, ...fresh.map(stateOf), ...freshReviews, ...freshComments].join('\n')}\n`,
  ).catch(() => undefined);
}

const summary = fresh
  .map((thread) => {
    const first = thread.firstComment.nodes[0];
    const head = (first?.body ?? '').replace(/\s+/g, ' ').slice(0, 120);
    return `- ${thread.path}:${thread.line ?? '-'} (${first?.author?.login ?? '?'}): ${head}`;
  })
  .join('\n');
const commentRows = freshComments.length > 0 ? await port.reviewComments(number) : null;
const commentSummary = freshComments
  .map((id) => {
    const row =
      commentRows?.kind === 'ok'
        ? commentRows.value.find((item) => isRecord(item) && `comment:${item.id}` === id)
        : undefined;
    if (!isRecord(row)) return `- ${id}`;
    const path = typeof row.path === 'string' ? row.path : '?';
    const line = typeof row.line === 'number' ? row.line : '-';
    const author = isRecord(row.user) && typeof row.user.login === 'string' ? row.user.login : '?';
    const body = (typeof row.body === 'string' ? row.body : '').replace(/\s+/g, ' ').slice(0, 120);
    return `- ${path}:${line} (${author}): ${body}`;
  })
  .join('\n');
const reviewSummary =
  freshReviews.length > 0
    ? `\n- 変更要求レビュー本文 ${freshReviews.length} 件。gh api repos/${repository}/pulls/${number}/reviews で本文を確認してください。`
    : '';
const counts =
  threads === null
    ? `未確認のインラインコメントが ${freshComments.length} 件（未解決スレッドを取得できないため、解決済みのものを含みうる）`
    : `未対応のレビュースレッドが ${fresh.length} 件`;
const guidance = `指摘を読み始めるときは ${tree} で ${hookCommand('observe-pr-feedback.ts')} を実行して観測を記録してください。個別の指摘だけを直して push せず、.claude/skills/pr-review-loop/SKILL.md の手順で差分全体を再レビューし、収束させてから push してください。外部指摘が異なる HEAD に 3 回続いた場合は .claude/rules/ci-workflow.md の診断と方針相談を行ってください。`;
console.log(
  JSON.stringify({
    decision: 'block',
    reason: `🛑 Stop hook: PR #${number}（${url}）に${counts}、未確認の変更要求レビュー本文が ${freshReviews.length} 件あります。${guidance} コメントごとに「修正 / 直さない理由 / 回答」を判断し、対応したスレッドを resolve してください。\n${[summary, commentSummary].filter(Boolean).join('\n')}${reviewSummary}`,
  }),
);
