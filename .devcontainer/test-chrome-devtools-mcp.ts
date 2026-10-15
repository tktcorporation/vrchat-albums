#!/usr/bin/env bun
export {};
const requests = [
  {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'test-client', version: '1.0.0' },
    },
  },
  {
    jsonrpc: '2.0',
    method: 'notifications/initialized',
    params: {},
  },
  { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
];
console.log('🧪 Chrome DevTools MCP の動作テストを開始します...');
const child = Bun.spawn(
  [
    'chrome-devtools-mcp',
    '--headless=true',
    '--isolated=true',
    '--executablePath=/usr/bin/chromium',
  ],
  { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' },
);
await child.stdin.write(`${JSON.stringify(requests[0])}\n`);
await Bun.sleep(1000);
await child.stdin.write(`${JSON.stringify(requests[1])}\n`);
await child.stdin.write(`${JSON.stringify(requests[2])}\n`);
await Bun.sleep(2000);
await child.stdin.end();

// MCP stdio の graceful shutdown は stdin close が起点。応答後も終了しない実装に対しては
// client 側の責務として SIGTERM → SIGKILL へ進み、devcontainer の検証をハングさせない。
const exitedGracefully = await Promise.race([
  child.exited.then(() => true),
  Bun.sleep(2000).then(() => false),
]);
if (!exitedGracefully) {
  child.kill('SIGTERM');
  const terminated = await Promise.race([
    child.exited.then(() => true),
    Bun.sleep(2000).then(() => false),
  ]);
  if (!terminated) child.kill('SIGKILL');
}

console.log('✅ MCP サーバーからの応答:');
const response = await new Response(child.stdout).text();
const errors = await new Response(child.stderr).text();
const messages: unknown[] = [];
for (const line of response.split('\n').filter(Boolean)) {
  try {
    const message: unknown = JSON.parse(line);
    messages.push(message);
    console.log(JSON.stringify(message, null, 2));
  } catch {
    console.log(line);
  }
}
await child.exited;
const responseIds = new Set(
  messages.flatMap((message) =>
    typeof message === 'object' && message !== null && 'id' in message ? [message.id] : [],
  ),
);
if (!responseIds.has(1) || !responseIds.has(2)) {
  if (errors.trim()) console.error(errors.trim());
  console.error('❌ initialize または tools/list の応答を確認できませんでした');
  process.exit(1);
}
console.log('✨ テスト完了！ Claude Codeを再起動してbrowser_*コマンドを確認してください。');
