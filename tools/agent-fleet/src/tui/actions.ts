import { match } from 'ts-pattern';
import { runCommand } from '../collect/exec';
import type { FleetRow } from '../model/row';

// Herdr のジョブ id が実際に持ちうる文字集合（英数字・`.`・`_`・`-`）に絞る。
const JOB_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

// Enter で「そのセッションのいる場所」へ行く。
// Herdr に pane があれば focus、無い背景セッションは tab を 1 つ作って claude attach を開く。
// Herdr の外（HERDR_ENV が無い）では pane を作れないのでコマンドを案内するだけにする。
export async function openRow(
  row: FleetRow,
  run: typeof runCommand = runCommand,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string | null> {
  return match(row.attach)
    .with({ type: 'focus' }, async ({ paneId }) => {
      const r = await run(['herdr', 'agent', 'focus', paneId], 3000);
      return r.ok ? `${paneId} へ移動した` : `移動できない: ${r.error.detail}`;
    })
    .with({ type: 'claude-attach' }, async ({ jobId }) => {
      const workspace = env.HERDR_WORKSPACE_ID;
      if (env.HERDR_ENV !== '1' || !workspace) return `Herdr の外なので自動では開けない。別の端末で: claude attach ${jobId}`;
      // jobId はシェルコマンド文字列 `claude attach ${jobId}` へそのまま埋め込む。
      // 空白や `;` を許すとコマンドインジェクションになるため、実行前に安全な文字集合へ絞る。
      if (!JOB_ID_PATTERN.test(jobId)) return `不正なセッション id なので開けない: ${jobId}`;
      const created = await run(['herdr', 'tab', 'create', '--workspace', workspace, '--no-focus'], 5000);
      if (!created.ok) return `tab を作れない: ${created.error.detail}`;
      const paneId = paneIdFromTabCreate(created.value);
      if (!paneId) return 'tab は作れたが pane id が読めない';
      const ran = await run(['herdr', 'pane', 'run', paneId, `claude attach ${jobId}`], 5000);
      return ran.ok ? `${paneId} で claude attach ${jobId} を開いた` : `開けない: ${ran.error.detail}`;
    })
    .with({ type: 'hint' }, async ({ text }) => text)
    .exhaustive();
}

function paneIdFromTabCreate(json: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null; // 応答が JSON でなければ pane を特定できないので案内に落とす
  }
  // JSON.parse は `null` や配列も例外なく通すため、プロパティアクセス前に
  // 「非 null なオブジェクトか」をここで確定させる（配列はオブジェクトガードから除外する規約）。
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  const result = (parsed as Record<string, unknown>).result;
  if (typeof result !== 'object' || result === null || Array.isArray(result)) return null;
  const rootPane = (result as Record<string, unknown>).root_pane;
  if (typeof rootPane !== 'object' || rootPane === null || Array.isArray(rootPane)) return null;
  const id = (rootPane as Record<string, unknown>).pane_id;
  return typeof id === 'string' ? id : null;
}
