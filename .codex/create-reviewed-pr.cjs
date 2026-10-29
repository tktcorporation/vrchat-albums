/**
 * Runs inside functions.exec with injected tool callbacks. No filesystem or network globals.
 * The preflight and connector invocation belong to one operation; denial never calls create.
 * This is a guard for this entry point, not a restriction on other GitHub clients.
 */
// Must match REQUEST_KEYS in .claude/hooks/check-cloud-pr.ts: both sides hash the request
// serialized with exactly these keys in this order.
const REQUEST_KEYS = ['repository_full_name', 'head', 'base', 'title', 'body', 'draft'];

/** UTF-8 SHA-256 in hex. functions.exec does not guarantee a crypto global, so it is computed here. */
function sha256Hex(text) {
  const bytes = [];
  for (const char of text) {
    const code = char.codePointAt(0);
    if (code < 0x80) bytes.push(code);
    else if (code < 0x800) bytes.push(0xc0 | (code >> 6), 0x80 | (code & 63));
    else if (code < 0x10000)
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
    else
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 63),
        0x80 | ((code >> 6) & 63),
        0x80 | (code & 63),
      );
  }
  const bitLength = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  for (let shift = 56; shift >= 0; shift -= 8)
    bytes.push(
      shift >= 32 ? Math.floor(bitLength / 2 ** shift) & 255 : (bitLength >>> shift) & 255,
    );
  const k = [];
  for (let n = 2; k.length < 64; n++) {
    if ([...Array(n).keys()].slice(2).some((d) => n % d === 0)) continue;
    k.push(Math.floor((Math.cbrt(n) % 1) * 2 ** 32) >>> 0);
  }
  const h = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];
  const rotr = (x, n) => (x >>> n) | (x << (32 - n));
  const w = Array.from({ length: 64 }, () => 0);
  for (let offset = 0; offset < bytes.length; offset += 64) {
    for (let i = 0; i < 16; i++) {
      const j = offset + i * 4;
      w[i] = ((bytes[j] << 24) | (bytes[j + 1] << 16) | (bytes[j + 2] << 8) | bytes[j + 3]) >>> 0;
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const t1 =
        (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + k[i] + w[i]) >>> 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      [hh, g, f, e, d, c, b, a] = [g, f, e, (d + t1) >>> 0, c, b, a, (t1 + t2) >>> 0];
    }
    [a, b, c, d, e, f, g, hh].forEach((value, i) => {
      h[i] = (h[i] + value) >>> 0;
    });
  }
  return h.map((value) => value.toString(16).padStart(8, '0')).join('');
}

/** Digest of the request exactly as it will be sent; the preflight returns the same for its parse. */
const requestDigest = (request) =>
  sha256Hex(JSON.stringify(Object.fromEntries(REQUEST_KEYS.map((key) => [key, request[key]]))));

// A value is embedded in sh single quotes by quote(); only NUL (cannot be passed in an argument)
// and line breaks (which split the tool's command line) cannot be carried that way.
const quotable = (value) => typeof value === 'string' && value !== '' && !/[\0\n\r]/.test(value);

module.exports = async function createReviewedPr({ exec, poll, create }, options) {
  const { cwd, bun = 'bun', expectedHead, expectedBase } = options;
  if (!quotable(cwd) || !cwd.startsWith('/') || !quotable(bun)) {
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
  // (REMOTE_FETCH_TIMEOUT_MS in .claude/hooks/pr-review-gate.ts), so keep polling past that budget.
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
  // The preflight returns a digest instead of echoing the request: a long body would push the
  // echo past the output cap and truncate it. Extra keys are rejected by the preflight itself.
  const sameRequest =
    Object.keys(request).every((key) => REQUEST_KEYS.includes(key)) &&
    typeof verdict.requestDigest === 'string' &&
    verdict.requestDigest === requestDigest(request);
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
