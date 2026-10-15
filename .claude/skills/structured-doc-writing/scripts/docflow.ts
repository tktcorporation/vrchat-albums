#!/usr/bin/env bun

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

type Approval = 'brief' | 'evidence' | 'outline' | 'draft' | 'review';

type Section = {
  id: string;
  title: string;
};

type State = {
  version: 1;
  title: string;
  approvals: Record<Approval, boolean>;
  approvalHashes: Partial<Record<Approval, string>>;
  sections: Section[];
  finalized: boolean;
};

const APPROVALS: Approval[] = ['brief', 'evidence', 'outline', 'draft', 'review'];
const PLACEHOLDER = '[未記入]';

function fail(message: string): never {
  console.error(`error: ${message}`);
  process.exit(1);
}

function parseArgs(args: string[]): { positional: string[]; options: Map<string, string> } {
  const positional: string[] = [];
  const options = new Map<string, string>();

  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (!value.startsWith('--')) {
      positional.push(value);
      continue;
    }

    const optionValue = args[index + 1];
    if (!optionValue || optionValue.startsWith('--')) {
      fail(`${value} requires a value`);
    }
    options.set(value.slice(2), optionValue);
    index += 1;
  }

  return { positional, options };
}

function projectPath(input: string | undefined): string {
  if (!input) fail('project directory is required');
  return resolve(input);
}

function statePath(project: string): string {
  return resolve(project, '.docflow', 'state.json');
}

function isApproval(value: unknown): value is Approval {
  return (
    value === 'brief' ||
    value === 'evidence' ||
    value === 'outline' ||
    value === 'draft' ||
    value === 'review'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isState(value: unknown): value is State {
  if (!isRecord(value)) return false;
  const state = value;
  if (
    state.version !== 1 ||
    typeof state.title !== 'string' ||
    typeof state.finalized !== 'boolean'
  )
    return false;
  if (!isRecord(state.approvals) || !isRecord(state.approvalHashes)) return false;
  if (!Array.isArray(state.sections)) return false;

  const approvals = state.approvals;
  const hashes = state.approvalHashes;
  return (
    APPROVALS.every((approval) => typeof approvals[approval] === 'boolean') &&
    Object.entries(hashes).every(
      ([approval, hash]) => isApproval(approval) && typeof hash === 'string',
    ) &&
    state.sections.every(
      (section) =>
        Boolean(section) &&
        typeof section === 'object' &&
        typeof section.id === 'string' &&
        typeof section.title === 'string',
    )
  );
}

function loadState(project: string): State {
  const path = statePath(project);
  if (!existsSync(path)) fail(`not a docflow project: ${project}`);
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (!isState(parsed)) fail(`invalid docflow state: ${path}`);
  return parsed;
}

function saveState(project: string, state: State): void {
  writeFileSync(statePath(project), `${JSON.stringify(state, null, 2)}\n`);
}

function writeNew(path: string, content: string): void {
  if (existsSync(path)) fail(`refusing to overwrite ${path}`);
  writeFileSync(path, content);
}

function requiredFile(project: string, approval: Approval): string {
  const names: Record<Approval, string> = {
    brief: 'brief.md',
    evidence: 'evidence.md',
    outline: 'outline.md',
    draft: 'draft.md',
    review: 'review.md',
  };
  return resolve(project, names[approval]);
}

function fileHash(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function approvalIsCurrent(project: string, state: State, approval: Approval): boolean {
  const file = requiredFile(project, approval);
  return (
    state.approvals[approval] &&
    existsSync(file) &&
    state.approvalHashes[approval] === fileHash(file)
  );
}

function requireCurrentApproval(project: string, state: State, approval: Approval): void {
  if (!approvalIsCurrent(project, state, approval)) {
    fail(`${approval} must be approved in its current form`);
  }
}

function assertReadyForApproval(project: string, state: State, approval: Approval): void {
  const position = APPROVALS.indexOf(approval);
  const prerequisite = APPROVALS[position - 1];
  if (prerequisite) requireCurrentApproval(project, state, prerequisite);

  const file = requiredFile(project, approval);
  if (!existsSync(file)) fail(`missing ${file}`);
  const content = readFileSync(file, 'utf8');
  if (content.includes(PLACEHOLDER)) fail(`${file} still contains ${PLACEHOLDER}`);
  if (content.trim().length < 40) fail(`${file} is too short to approve`);
  if (approval === 'outline' && !/^##\s+[^#]/m.test(content)) {
    fail('outline.md must contain at least one level-2 section');
  }
  if (
    approval === 'outline' &&
    (!content.includes('情報の序列：') || !content.includes('表示方法：'))
  ) {
    fail('outline.md must define information hierarchy and presentation format');
  }
  if (
    approval === 'review' &&
    (!content.includes('情報の強弱とつながり') || !content.includes('段落・箇条書き・表の使い分け'))
  ) {
    fail('review.md must check information hierarchy and presentation format');
  }
}

function init(project: string, title: string): void {
  const outputs = [
    statePath(project),
    ...APPROVALS.map((approval) => requiredFile(project, approval)),
    resolve(project, 'final.md'),
  ];
  const existingOutput = outputs.find((output) => existsSync(output));
  if (existingOutput) fail(`refusing to overwrite ${existingOutput}`);
  mkdirSync(resolve(project, '.docflow'), { recursive: true });
  mkdirSync(resolve(project, 'sections'), { recursive: true });

  const state: State = {
    version: 1,
    title,
    approvals: { brief: false, evidence: false, outline: false, draft: false, review: false },
    approvalHashes: {},
    sections: [],
    finalized: false,
  };
  saveState(project, state);

  writeNew(
    resolve(project, 'brief.md'),
    `# ${title}：目的定義\n\n## 読者\n\n${PLACEHOLDER}\n\n## 読後の状態\n\n${PLACEHOLDER}\n\n## 文書の問い\n\n${PLACEHOLDER}\n\n## 対象範囲\n\n${PLACEHOLDER}\n\n## 対象外\n\n${PLACEHOLDER}\n\n## 制約\n\n${PLACEHOLDER}\n`,
  );
  writeNew(
    resolve(project, 'evidence.md'),
    `# ${title}：根拠\n\n| ID | 事実 | 出典 | 確実性 | 備考 |\n|---|---|---|---|---|\n| E-001 | ${PLACEHOLDER} | ${PLACEHOLDER} | ${PLACEHOLDER} | |\n\n## 計算結果\n\n| ID | 結果 | 入力となる根拠 | 式 |\n|---|---|---|---|\n| C-001 | ${PLACEHOLDER} | ${PLACEHOLDER} | ${PLACEHOLDER} |\n`,
  );
  writeNew(
    resolve(project, 'outline.md'),
    `# ${title}：構成\n\n## section-id：章名\n\n読者の問い：${PLACEHOLDER}\n\nこの章の結論：${PLACEHOLDER}\n\n情報の序列：\n- 最重要：${PLACEHOLDER}\n- それを支える情報：${PLACEHOLDER}\n- 補足：${PLACEHOLDER}\n\n表示方法：${PLACEHOLDER}\n\n使用する根拠：\n- ${PLACEHOLDER}\n\nこの章に書かないこと：${PLACEHOLDER}\n\n前後の章との関係：${PLACEHOLDER}\n`,
  );
  writeNew(
    resolve(project, 'review.md'),
    `# ${title}：レビュー\n\n## 構造\n\n${PLACEHOLDER}\n\n### 情報の強弱とつながり\n\n${PLACEHOLDER}\n\n## 根拠\n\n${PLACEHOLDER}\n\n## 可読性\n\n${PLACEHOLDER}\n\n### 段落・箇条書き・表の使い分け\n\n${PLACEHOLDER}\n\n## 指摘の採否\n\n${PLACEHOLDER}\n`,
  );

  console.log(`initialized ${project}`);
}

function status(project: string): void {
  const state = loadState(project);
  console.log(state.title);
  for (const approval of APPROVALS) {
    const label = approvalIsCurrent(project, state, approval)
      ? 'approved'
      : state.approvals[approval]
        ? 'changed '
        : 'pending ';
    console.log(`${label}  ${approval}`);
  }
  console.log(`sections  ${state.sections.length}`);
  console.log(`final     ${state.finalized ? 'created' : 'pending'}`);
}

function approve(project: string, value: string | undefined): void {
  if (!isApproval(value)) {
    fail(`approval must be one of: ${APPROVALS.join(', ')}`);
  }
  const state = loadState(project);
  assertReadyForApproval(project, state, value);
  const position = APPROVALS.indexOf(value);
  for (const downstream of APPROVALS.slice(position + 1)) {
    state.approvals[downstream] = false;
    delete state.approvalHashes[downstream];
  }
  state.approvals[value] = true;
  state.approvalHashes[value] = fileHash(requiredFile(project, value));
  state.finalized = false;
  saveState(project, state);
  console.log(`approved ${value}`);
}

function addSection(project: string, id: string | undefined, title: string): void {
  if (!id || !/^[a-z0-9][a-z0-9-]*$/.test(id)) {
    fail('section id must contain lowercase letters, digits, and hyphens');
  }
  const state = loadState(project);
  requireCurrentApproval(project, state, 'outline');
  if (state.sections.some((section) => section.id === id)) fail(`duplicate section id: ${id}`);

  writeNew(resolve(project, 'sections', `${id}.md`), `## ${title}\n\n${PLACEHOLDER}\n`);
  state.sections.push({ id, title });
  state.approvals.draft = false;
  state.approvals.review = false;
  delete state.approvalHashes.draft;
  delete state.approvalHashes.review;
  state.finalized = false;
  saveState(project, state);
  console.log(`added section ${id}`);
}

function assemble(project: string): void {
  const state = loadState(project);
  requireCurrentApproval(project, state, 'outline');
  if (state.sections.length === 0) fail('no sections have been added');

  const contents = state.sections.map((section) => {
    const path = resolve(project, 'sections', `${section.id}.md`);
    if (!existsSync(path)) fail(`missing ${path}`);
    const content = readFileSync(path, 'utf8').trim();
    if (content.includes(PLACEHOLDER)) fail(`${path} still contains ${PLACEHOLDER}`);
    return content;
  });

  writeFileSync(resolve(project, 'draft.md'), `# ${state.title}\n\n${contents.join('\n\n')}\n`);
  state.approvals.draft = false;
  state.approvals.review = false;
  delete state.approvalHashes.draft;
  delete state.approvalHashes.review;
  state.finalized = false;
  saveState(project, state);
  console.log(`assembled ${resolve(project, 'draft.md')}`);
}

function finalize(project: string): void {
  const state = loadState(project);
  for (const approval of APPROVALS) {
    requireCurrentApproval(project, state, approval);
  }
  const draft = resolve(project, 'draft.md');
  if (!existsSync(draft)) fail(`missing ${draft}`);
  writeFileSync(resolve(project, 'final.md'), readFileSync(draft, 'utf8'));
  state.finalized = true;
  saveState(project, state);
  console.log(`finalized ${resolve(project, 'final.md')}`);
}

function validate(project: string): void {
  const state = loadState(project);
  const errors: string[] = [];

  for (const approval of APPROVALS) {
    if (state.approvals[approval] && !existsSync(requiredFile(project, approval))) {
      errors.push(`${approval} is approved but its file is missing`);
    } else if (state.approvals[approval] && !approvalIsCurrent(project, state, approval)) {
      errors.push(`${approval} changed after approval`);
    }
  }
  for (let index = 1; index < APPROVALS.length; index += 1) {
    if (state.approvals[APPROVALS[index]] && !state.approvals[APPROVALS[index - 1]]) {
      errors.push(`${APPROVALS[index]} is approved before ${APPROVALS[index - 1]}`);
    }
  }
  const ids = state.sections.map((section) => section.id);
  if (new Set(ids).size !== ids.length) errors.push('section ids are not unique');
  for (const id of ids) {
    if (!existsSync(resolve(project, 'sections', `${id}.md`)))
      errors.push(`missing section file: ${id}.md`);
  }
  if (state.finalized && !existsSync(resolve(project, 'final.md'))) {
    errors.push('project is finalized but final.md is missing');
  }

  if (errors.length > 0) fail(errors.join('\n'));
  console.log('docflow state is valid');
}

function usage(): never {
  console.error(
    'usage: docflow <init|status|approve|add-section|assemble|finalize|validate> <project-dir> [args]',
  );
  process.exit(1);
}

const { positional, options } = parseArgs(process.argv.slice(2));
const [command, projectInput, argument] = positional;
if (!command) usage();
const project = projectPath(projectInput);

switch (command) {
  case 'init':
    init(project, options.get('title') ?? '文書');
    break;
  case 'status':
    status(project);
    break;
  case 'approve':
    approve(project, argument);
    break;
  case 'add-section':
    addSection(project, argument, options.get('title') ?? argument ?? '章');
    break;
  case 'assemble':
    assemble(project);
    break;
  case 'finalize':
    finalize(project);
    break;
  case 'validate':
    validate(project);
    break;
  default:
    usage();
}
