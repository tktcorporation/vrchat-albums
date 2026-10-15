import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

const script = resolve(import.meta.dir, 'docflow.ts');
const temporaryDirectories: string[] = [];

function temporaryProject(): string {
  const project = mkdtempSync(resolve(tmpdir(), 'docflow-test-'));
  temporaryDirectories.push(project);
  return project;
}

async function run(
  ...args: string[]
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const process = Bun.spawn(['bun', script, ...args], { stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  return { exitCode, stdout, stderr };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('docflow', () => {
  test('initializes durable intermediate artifacts', async () => {
    const project = temporaryProject();
    const result = await run('init', project, '--title', '振り返り');

    expect(result.exitCode).toBe(0);
    for (const file of [
      'brief.md',
      'evidence.md',
      'outline.md',
      'review.md',
      '.docflow/state.json',
    ]) {
      expect(existsSync(resolve(project, file))).toBe(true);
    }
    expect(readFileSync(resolve(project, 'brief.md'), 'utf8')).toContain('# 振り返り：目的定義');
    const outline = readFileSync(resolve(project, 'outline.md'), 'utf8');
    expect(outline).toContain('情報の序列：');
    expect(outline).toContain('表示方法：');
    const review = readFileSync(resolve(project, 'review.md'), 'utf8');
    expect(review).toContain('情報の強弱とつながり');
    expect(review).toContain('段落・箇条書き・表の使い分け');
  });

  test.each(['brief.md', 'draft.md', 'final.md'])(
    'preflights %s before creating state',
    async (file) => {
      const project = temporaryProject();
      writeFileSync(resolve(project, file), '既存の文書\n');

      const result = await run('init', project);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('refusing to overwrite');
      expect(existsSync(resolve(project, '.docflow/state.json'))).toBe(false);
    },
  );

  test('blocks approval while placeholders remain', async () => {
    const project = temporaryProject();
    await run('init', project);

    const result = await run('approve', project, 'brief');

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('still contains [未記入]');
  });

  test('rejects malformed persisted state', async () => {
    const project = temporaryProject();
    await run('init', project);
    writeFileSync(resolve(project, '.docflow/state.json'), '{"version":1}');

    const result = await run('status', project);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('invalid docflow state');
  });

  test('blocks sections until the outline is approved', async () => {
    const project = temporaryProject();
    await run('init', project);

    const result = await run('add-section', project, 'result', '--title', '結果');

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('outline must be approved in its current form');
  });

  test('requires hierarchy and format decisions in an outline', async () => {
    const project = temporaryProject();
    await run('init', project);
    const brief = resolve(project, 'brief.md');
    writeFileSync(brief, readFileSync(brief, 'utf8').replaceAll('[未記入]', '確認済みの内容'));
    expect((await run('approve', project, 'brief')).exitCode).toBe(0);
    const evidence = resolve(project, 'evidence.md');
    writeFileSync(
      evidence,
      readFileSync(evidence, 'utf8').replaceAll('[未記入]', '確認済みの内容'),
    );
    expect((await run('approve', project, 'evidence')).exitCode).toBe(0);
    const outline = resolve(project, 'outline.md');
    writeFileSync(
      outline,
      readFileSync(outline, 'utf8')
        .replaceAll('[未記入]', '確認済みの内容')
        .replace('情報の序列：', '削除した欄：')
        .replace('表示方法：', '削除した形式：'),
    );

    const result = await run('approve', project, 'outline');

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('must define information hierarchy and presentation format');
  });

  test('assembles approved, ordered sections', async () => {
    const project = temporaryProject();
    await run('init', project, '--title', '振り返り');

    for (const name of ['brief', 'evidence', 'outline'] as const) {
      const path = resolve(project, `${name}.md`);
      writeFileSync(path, readFileSync(path, 'utf8').replaceAll('[未記入]', '確認済みの内容'));
      const approval = await run('approve', project, name);
      expect(approval.exitCode).toBe(0);
    }

    await run('add-section', project, 'result', '--title', '結果');
    await run('add-section', project, 'reason', '--title', '要因');
    writeFileSync(resolve(project, 'sections/result.md'), '## 結果\n\n必達ラインを達成した。\n');
    writeFileSync(resolve(project, 'sections/reason.md'), '## 要因\n\n対象人数が増えた。\n');

    const result = await run('assemble', project);
    const draft = readFileSync(resolve(project, 'draft.md'), 'utf8');

    expect(result.exitCode).toBe(0);
    expect(draft.indexOf('## 結果')).toBeLessThan(draft.indexOf('## 要因'));
  });

  test('blocks finalization until the workflow is approved', async () => {
    const project = temporaryProject();
    await run('init', project);

    const result = await run('finalize', project);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('brief must be approved in its current form');
  });

  test('treats an edited artifact as no longer approved', async () => {
    const project = temporaryProject();
    await run('init', project);
    const brief = resolve(project, 'brief.md');
    writeFileSync(brief, readFileSync(brief, 'utf8').replaceAll('[未記入]', '確認済みの内容'));
    expect((await run('approve', project, 'brief')).exitCode).toBe(0);

    writeFileSync(brief, `${readFileSync(brief, 'utf8')}\n追記\n`);
    const status = await run('status', project);
    const evidence = await run('approve', project, 'evidence');

    expect(status.stdout).toContain('changed   brief');
    expect(evidence.stderr).toContain('brief must be approved in its current form');
  });

  test('requires every approved artifact to remain current before finalizing', async () => {
    const project = temporaryProject();
    await run('init', project);

    for (const name of ['brief', 'evidence', 'outline'] as const) {
      const path = resolve(project, `${name}.md`);
      writeFileSync(path, readFileSync(path, 'utf8').replaceAll('[未記入]', '確認済みの内容'));
      expect((await run('approve', project, name)).exitCode).toBe(0);
    }
    expect((await run('add-section', project, 'result', '--title', '結果')).exitCode).toBe(0);
    writeFileSync(
      resolve(project, 'sections/result.md'),
      '## 結果\n\n必達ラインを達成し、関係者全員が予定どおり次の施策へ進める状態になった。\n',
    );
    expect((await run('assemble', project)).exitCode).toBe(0);
    expect((await run('approve', project, 'draft')).exitCode).toBe(0);
    const review = resolve(project, 'review.md');
    writeFileSync(review, readFileSync(review, 'utf8').replaceAll('[未記入]', '確認済みの内容'));
    expect((await run('approve', project, 'review')).exitCode).toBe(0);

    const brief = resolve(project, 'brief.md');
    writeFileSync(brief, `${readFileSync(brief, 'utf8')}\n追記\n`);
    const result = await run('finalize', project);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('brief must be approved in its current form');
    expect(existsSync(resolve(project, 'final.md'))).toBe(false);
  });
});
