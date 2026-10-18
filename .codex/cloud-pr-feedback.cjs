/**
 * Cloud connector entrypoint for observing external PR comments and guarding a push.
 * Load this file from the reviewed tooling tree inside functions.exec, then inject tools.
 */
module.exports = async function cloudPrFeedback(tools, options) {
  const {
    cwd,
    sourceTree,
    repository,
    branch,
    prNumber,
    mode,
    consultationNote,
    bun = 'bun',
  } = options;
  if (
    !['observe', 'push', 'consult'].includes(mode) ||
    !Number.isSafeInteger(prNumber) ||
    prNumber <= 0 ||
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) ||
    typeof branch !== 'string' ||
    branch.length === 0 ||
    !/^\/[A-Za-z0-9/_.-]+$/.test(sourceTree) ||
    !/^[A-Za-z0-9/_.-]+$/.test(bun)
  )
    throw new Error('Invalid connector observation arguments');
  if (mode === 'consult' && (typeof consultationNote !== 'string' || !consultationNote.trim()))
    throw new Error('Consultation requires the actual user decision note');

  const root = `https://api.github.com/repos/${repository}/pulls/${prNumber}`;
  const raw = (result) => {
    if (result?.isError || typeof result?.structuredContent?.content !== 'string')
      throw new Error('GitHub connector read failed');
    return JSON.parse(result.structuredContent.content);
  };
  const profile = await tools.getUserLogin({});
  if (profile?.isError || typeof profile?.structuredContent?.login !== 'string')
    throw new Error('GitHub connector viewer is unavailable');
  const viewerLogin = profile.structuredContent.login;
  const pr = raw(await tools.fetch({ url: root }));
  const pages = async (suffix) => {
    const items = [];
    for (let page = 1; page <= 50; page++) {
      const chunk = raw(await tools.fetch({ url: `${root}/${suffix}?per_page=100&page=${page}` }));
      if (!Array.isArray(chunk) || chunk.length > 100) throw new Error(`Invalid ${suffix} page`);
      items.push(...chunk);
      if (chunk.length < 100) return items;
    }
    throw new Error(`${suffix} pagination limit reached`);
  };
  const comments = await pages('comments');
  const reviews = await pages('reviews');
  const moment = await tools.now({});
  if (!/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d UTC$/.test(moment?.current_time ?? ''))
    throw new Error('Observation clock is unavailable');
  const evidence = {
    repository,
    branch,
    prNumber,
    observedAt: moment.current_time.replace(' ', 'T').replace(' UTC', '.000Z'),
    viewerLogin,
    pr: {
      number: pr.number,
      state: pr.state,
      html_url: pr.html_url,
      head: { ref: pr.head?.ref, sha: pr.head?.sha, repo: { full_name: pr.head?.repo?.full_name } },
      base: { repo: { full_name: pr.base?.repo?.full_name } },
    },
    comments: comments.map((comment) => ({
      id: comment?.id,
      commit_id: comment?.commit_id,
      created_at: comment?.created_at,
      pull_request_review_id: comment?.pull_request_review_id,
      in_reply_to_id: comment?.in_reply_to_id,
      user: comment?.user === null ? null : { login: comment?.user?.login },
    })),
    reviews: reviews.map((review) => ({
      id: review?.id,
      commit_id: review?.commit_id,
      submitted_at: review?.submitted_at,
      state: review?.state,
      body: typeof review?.body === 'string' ? '' : review?.body,
      user: review?.user === null ? null : { login: review?.user?.login },
    })),
    ...(mode === 'consult' ? { consultationNote } : {}),
  };
  const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
  const matchesGitHubRemote = (remote) => {
    const match =
      /^(?:https:\/\/github\.com(?::443)?\/|ssh:\/\/git@github\.com(?::22)?\/|git@github\.com:)([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\/?$/i.exec(
        remote,
      );
    if (!match || match[0] !== remote) return false;
    const path = match[1].toLowerCase();
    const target = repository.toLowerCase();
    return path === target || path === `${target}.git`;
  };
  // polls は 1 秒ごとの完了確認の回数。待ち切れないと失敗を返すが、コマンド自体は走り続けるため、
  // 待たれる側の上限時間より長く取る。ゲートのリモート確認は 15 秒で打ち切られる
  // （.claude/hooks/require-pr-self-review-mcp.ts の REMOTE_FETCH_TIMEOUT_MS）。
  const run = async (cmd, maxOutputTokens, polls = 30) => {
    let result = await tools.exec({
      cmd,
      workdir: cwd,
      yield_time_ms: 1000,
      max_output_tokens: maxOutputTokens,
    });
    let output = result.output ?? '';
    for (let attempt = 0; result.session_id !== undefined && attempt < polls; attempt++) {
      if (!tools.poll)
        throw new Error(
          `Command still running in session ${result.session_id}; do not retry before reconciliation`,
        );
      result = await tools.poll({
        session_id: result.session_id,
        chars: '',
        yield_time_ms: 1000,
        max_output_tokens: maxOutputTokens,
      });
      output += result.output ?? '';
    }
    if (result.session_id !== undefined)
      throw new Error(
        `Command still running in session ${result.session_id}; do not retry before reconciliation`,
      );
    return { ...result, output };
  };
  const script = `${sourceTree}/.claude/hooks/cloud-pr-feedback.ts`;
  const created = await run('mktemp -d /tmp/codex-pr-feedback.XXXXXX', 100);
  const directory = created.output.trim();
  if (created.exit_code !== 0 || !/^\/tmp\/codex-pr-feedback\.[A-Za-z0-9]+$/.test(directory))
    throw new Error('Could not create a private evidence directory');
  const snapshotPath = `${directory}/evidence.json`;
  let check;
  let cleanupFailed = false;
  try {
    const saved = await tools.patch(
      `*** Begin Patch\n*** Add File: ${snapshotPath}\n+${JSON.stringify(evidence)}\n*** End Patch`,
    );
    if (saved?.isError) throw new Error('Could not save connector evidence');
    const command = `${quote(bun)} ${quote(script)} ${mode === 'push' ? 'prepush' : mode} < ${quote(snapshotPath)}`;
    check = await run(command, 1000, 60);
  } finally {
    const removed = await run(`rm -rf -- ${quote(directory)}`, 100);
    cleanupFailed = removed.exit_code !== 0;
  }
  if (cleanupFailed) throw new Error('Could not remove private connector evidence');
  if (check.exit_code !== 0) throw new Error(`Feedback ${mode} gate failed: ${check.output}`);
  const record = JSON.parse(check.output.trim());
  if (
    record.pr !== prNumber ||
    record.repository !== repository ||
    record.branch !== branch ||
    record.head !== pr.head?.sha ||
    !/^[0-9a-f]{40}$/.test(record.localHead ?? '') ||
    !Number.isSafeInteger(record.commentCount) ||
    record.commentCount < 0 ||
    record.comments?.length > 8 ||
    !Array.isArray(record.comments)
  )
    throw new Error('Feedback gate returned inconsistent evidence');
  if (mode !== 'push') {
    if (record.verdict !== (mode === 'consult' ? 'consulted' : 'observed'))
      throw new Error('Feedback gate returned the wrong decision');
    return { kind: mode === 'consult' ? 'consulted' : 'observed', ...record };
  }
  if (record.verdict !== 'allow') throw new Error('Feedback push gate did not allow');
  const before = await run('git rev-parse HEAD', 100);
  if (before.exit_code !== 0 || before.output.trim() !== record.localHead)
    throw new Error('Local HEAD changed after feedback gate; no push was started');
  const destination = await run('git remote get-url --push --all origin', 100);
  if (destination.exit_code !== 0 || !matchesGitHubRemote(destination.output.trim()))
    throw new Error('Origin push destination differs from the observed repository');
  const pushed = await run(
    `git push origin ${quote(`${record.localHead}:refs/heads/${branch}`)}`,
    1000,
    // git push 自体には上限時間が無い。大きな push でも結果を見届けられるよう長めに待つ。
    300,
  );
  if (pushed.exit_code !== 0) throw new Error(`Push failed: ${pushed.output}`);
  // ゲート側の remoteHeadSha と同じく、15 秒で打ち切り、認証プロンプトを出さず、ref 名の
  // 完全一致で読む（先頭行を読むと `a/refs/heads/<branch>` のような別ブランチを拾う）。
  const remote = await run('GIT_TERMINAL_PROMPT=0 timeout 15 git ls-remote --heads origin', 12000);
  const finalHead = remote.output
    .split('\n')
    .map((line) => line.trim().split(/\s+/))
    .find(([, ref]) => ref === `refs/heads/${branch}`)?.[0];
  if (remote.exit_code !== 0 || finalHead !== record.localHead)
    throw new Error('Push completed but final remote head could not be verified');
  return { kind: 'pushed-verified', ...record, finalHead: record.localHead };
};
