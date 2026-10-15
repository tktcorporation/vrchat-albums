import { fail, ok, type SourceResult } from './types';

// 失敗は投げずに分類して返す。呼び出し元は源ごとに独立して失敗を扱うため。
export async function runCommand(cmd: string[], timeoutMs: number): Promise<SourceResult<string>> {
  let proc: ReturnType<typeof Bun.spawn>;
  try {
    proc = Bun.spawn(cmd, { stdout: 'pipe', stderr: 'pipe', stdin: 'ignore' });
  } catch (e) {
    // バイナリが無い（ENOENT）は「その源が動いていない」と同じ扱いにする
    return fail('not_running', `${cmd[0]}: ${(e as Error).message}`);
  }

  let timer: ReturnType<typeof setTimeout>;
  // kill() は直接の子プロセスにしか効かない。孫プロセスが標準出力の書き込み側を
  // 握ったまま生き残ると stream の読み取りが終わらないため、締め切りを Promise.race
  // で確定させて呼び出し元を待たせない（proc.kill() 自体は直接の子の後始末として呼ぶ）。
  const deadline = new Promise<SourceResult<string>>((resolve) => {
    timer = setTimeout(() => {
      proc.kill();
      resolve(fail('timeout', `${cmd.join(' ')} が ${timeoutMs}ms で応答しなかった`));
    }, timeoutMs);
  });

  const collect = (async (): Promise<SourceResult<string>> => {
    try {
      const [stdout, stderr, code] = await Promise.all([
        new Response(proc.stdout as ReadableStream).text(),
        new Response(proc.stderr as ReadableStream).text(),
        proc.exited,
      ]);
      if (code !== 0) return fail('not_running', `${cmd.join(' ')}: ${stderr.trim() || `exit ${code}`}`);
      return ok(stdout);
    } catch (e) {
      // ストリーム読み取り自体の失敗（プロセス強制終了によるパイプ破棄など）も
      // 「その源が動いていない」として分類する
      return fail('not_running', `${cmd.join(' ')}: ${(e as Error).message}`);
    }
  })();

  try {
    return await Promise.race([deadline, collect]);
  } finally {
    clearTimeout(timer!);
  }
}
