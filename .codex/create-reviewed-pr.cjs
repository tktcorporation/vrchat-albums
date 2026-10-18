/**
 * Runs inside functions.exec with injected tool callbacks. No filesystem or network globals.
 * The preflight and connector invocation belong to one operation; denial never calls create.
 * This is a guard for this entry point, not a restriction on other GitHub clients.
 */
module.exports = async function createReviewedPr({ exec, poll, create }, options) {
  const { cwd, bun = 'bun', expectedHead, expectedBase } = options;
  if (typeof cwd !== 'string' || !cwd.startsWith('/') || typeof bun !== 'string' || !bun) {
    throw new Error('An absolute worktree cwd and Bun executable are required');
  }
  // Snapshot before awaiting a tool so callers cannot change what is submitted after validation.
  const request = JSON.parse(JSON.stringify(options.request));
  const payload = { request, expectedHead, expectedBase };
  const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
  const checked = await exec({
    cmd: `printf '%s' ${quote(JSON.stringify(payload))} | ${quote(bun)} .claude/hooks/check-cloud-pr.ts`,
    workdir: cwd,
    yield_time_ms: 1000,
    max_output_tokens: 12000,
  });
  // exec may return an unfinished session. Never treat a launched check as a passed check.
  let result = checked;
  let output = result.output ?? '';
  // The preflight may wait on up to three `git ls-remote` calls of up to 15 s each
  // (REMOTE_FETCH_TIMEOUT_MS in require-pr-self-review-mcp.ts), so keep polling past that budget.
  for (let attempt = 0; result.session_id !== undefined && poll && attempt < 60; attempt++) {
    result = await poll({
      session_id: result.session_id,
      chars: '',
      yield_time_ms: 1000,
      max_output_tokens: 12000,
    });
    output += result.output ?? '';
  }
  if (result.session_id !== undefined) {
    throw new Error(
      `Preflight is still running in session ${result.session_id}; no PR was created. Poll that session for diagnostics, then retry.`,
    );
  }
  if (result.exit_code !== 0) throw new Error(`PR preflight failed: ${output}`);
  let verdict;
  try {
    verdict = JSON.parse(output);
  } catch {
    throw new Error('PR preflight returned invalid or truncated JSON; no PR was created');
  }
  // The preflight schema may reorder keys. Requests contain scalar fields, so
  // compare the exact own-key set and values without relying on serialization order.
  const sameRequest =
    verdict.request !== null &&
    typeof verdict.request === 'object' &&
    !Array.isArray(verdict.request) &&
    Object.keys(verdict.request).length === Object.keys(request).length &&
    Object.keys(request).every(
      (key) => Object.hasOwn(verdict.request, key) && verdict.request[key] === request[key],
    );
  if (
    verdict.schemaVersion !== 1 ||
    verdict.decision !== 'allow' ||
    typeof verdict.headBranch !== 'string' ||
    !verdict.headBranch ||
    verdict.expectedHead !== expectedHead ||
    verdict.expectedBase !== expectedBase ||
    !sameRequest
  ) {
    throw new Error('PR preflight did not authorize this exact request');
  }
  let created;
  try {
    created = await create(request);
  } catch (cause) {
    // Once creation was attempted, even a transport failure cannot prove no PR exists.
    return {
      status: 'creation-unverified',
      expectedHead,
      expectedBase,
      cause,
      diagnostic:
        cause instanceof Error
          ? cause.message
          : typeof cause === 'string'
            ? cause
            : 'Connector threw a non-Error value; inspect cause.',
      reason: `The connector threw after creation was attempted. Inspect GitHub repository ${request.repository_full_name} for head ${request.head} and base ${request.base} before reporting success or retrying. Do not retry creation blindly.`,
    };
  }
  const pr = created?.structuredContent;
  const verified =
    created?.isError !== true &&
    pr?.head_sha === expectedHead &&
    pr?.base_sha === expectedBase &&
    pr?.draft === true &&
    pr?.state === 'open' &&
    pr?.head === verdict.headBranch &&
    pr?.base === request.base &&
    typeof pr?.head_repo_full_name === 'string' &&
    pr.head_repo_full_name.toLowerCase() === request.repository_full_name.toLowerCase();
  return {
    status: verified ? 'created-verified' : 'creation-unverified',
    expectedHead,
    expectedBase,
    result: created,
    ...(verified
      ? {}
      : {
          reason:
            'Inspect the returned PR before reporting success; the connector failed or its target changed after preflight. Do not retry creation blindly.',
        }),
  };
};
