/// <reference types="bun" />
/**
 * AST-backed analysis for the ordinary Bash forms understood by repository hooks.
 *
 * This is deliberately not a shell interpreter or a security boundary. Direct commands, `env`,
 * `cd`, control flow, and subshell cwd are modeled. Aliases, dynamic executable names, function
 * bodies, external scripts, and code produced by pipelines remain opaque deliberate bypasses.
 */
import { basename, resolve } from 'node:path';
import { ensureBashParserDeps } from './ensure-bash-parser-deps.ts';
import type { SgNode } from '@ast-grep/napi';

await ensureBashParserDeps(import.meta.dir);
const bash = (await import('@ast-grep/lang-bash')).default;
const { parse, registerDynamicLanguage } = await import('@ast-grep/napi');
registerDynamicLanguage({ bash });

export type ShellWord =
  | { kind: 'literal'; value: string; quoted: boolean; source: string }
  | { kind: 'dynamic'; source: string; reason: string };

export type DirectoryState = { kind: 'known'; path: string } | { kind: 'unknown'; reason: string };

export interface SimpleCommand {
  name: string;
  argv: ShellWord[];
  env: ReadonlyMap<string, ShellWord>;
  cwd: DirectoryState;
  source: string;
  /** False for commands nested in substitutions. Git policy intentionally ignores those. */
  direct: boolean;
}

export type CommandParseResult =
  | { kind: 'parsed'; commands: SimpleCommand[] }
  | { kind: 'parse-error'; errors: { line: number; column: number; source: string }[] };

const OPAQUE_NODES = new Set(['function_definition', 'heredoc_body']);
const EXPANSION_NODES = new Set([
  'arithmetic_expansion',
  'brace_expression',
  'command_substitution',
  'expansion',
  'process_substitution',
  'simple_expansion',
]);

function dynamic(node: SgNode, reason: string): ShellWord {
  return { kind: 'dynamic', source: node.text(), reason };
}

function hasExpansion(node: SgNode): boolean {
  if (EXPANSION_NODES.has(String(node.kind()))) return true;
  return node.namedChildren().some(hasExpansion);
}

function decodeBareLiteral(text: string): string {
  let result = '';
  for (let index = 0; index < text.length; index++) {
    if (text[index] !== '\\') {
      result += text[index];
      continue;
    }
    const next = text[++index];
    if (next !== undefined && next !== '\n') result += next;
  }
  return result;
}

function decodeDoubleQuotedLiteral(text: string): string {
  let result = '';
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char !== '\\') {
      result += char;
      continue;
    }
    const next = text[index + 1];
    if (next === '\n') index++;
    else if (next === '$' || next === '`' || next === '"' || next === '\\') {
      result += next;
      index++;
    } else result += '\\';
  }
  return result;
}

/** Convert one grammar word node without reparsing command text. */
function shellWord(node: SgNode): ShellWord {
  const kind = String(node.kind());
  if (kind === 'command_name') {
    const child = node.namedChildren()[0];
    return child ? shellWord(child) : dynamic(node, 'empty command name');
  }
  if (kind === 'raw_string') {
    const text = node.text();
    return { kind: 'literal', value: text.slice(1, -1), quoted: true, source: text };
  }
  if (kind === 'string') {
    if (hasExpansion(node)) return dynamic(node, 'expansion in double-quoted word');
    const text = node.text();
    return {
      kind: 'literal',
      value: decodeDoubleQuotedLiteral(text.slice(1, -1)),
      quoted: true,
      source: text,
    };
  }
  if (kind === 'concatenation') {
    const children = node.namedChildren();
    const hasUnquotedBracePair =
      children.some((child) => child.kind() === 'word' && child.text() === '{') &&
      children.some((child) => child.kind() === 'word' && child.text() === '}');
    if (hasUnquotedBracePair) return dynamic(node, 'brace expansion');
    const parts = children.map(shellWord);
    if (parts.some((part) => part.kind === 'dynamic'))
      return dynamic(node, 'dynamic concatenation');
    return {
      kind: 'literal',
      value: parts.map((part) => (part.kind === 'literal' ? part.value : '')).join(''),
      quoted: parts.some((part) => part.kind === 'literal' && part.quoted),
      source: node.text(),
    };
  }
  if (EXPANSION_NODES.has(kind) || hasExpansion(node)) return dynamic(node, 'shell expansion');
  if (kind !== 'word' && kind !== 'number' && kind !== 'string_content')
    return dynamic(node, `unsupported word node: ${kind}`);

  const value = decodeBareLiteral(node.text());
  if (value === '~') {
    const home = process.env.HOME;
    return home
      ? { kind: 'literal', value: home, quoted: false, source: node.text() }
      : dynamic(node, 'HOME is unavailable');
  }
  if (value.startsWith('~/')) {
    const home = process.env.HOME;
    return home
      ? {
          kind: 'literal',
          value: resolve(home, value.slice(2)),
          quoted: false,
          source: node.text(),
        }
      : dynamic(node, 'HOME is unavailable');
  }
  // Do not query the host account database for ~user paths.
  if (value.startsWith('~') && value !== '~' && !value.startsWith('~/'))
    return dynamic(node, 'named-user tilde');
  return { kind: 'literal', value, quoted: false, source: node.text() };
}

function literal(word: ShellWord | undefined): string | undefined {
  return word?.kind === 'literal' ? word.value : undefined;
}

function slicedLiteral(word: ShellWord, value: string): ShellWord {
  return word.kind === 'literal'
    ? { kind: 'literal', value, quoted: word.quoted, source: word.source }
    : word;
}

function joinDirectories(states: DirectoryState[], reason: string): DirectoryState {
  const first = states[0];
  if (
    first?.kind === 'known' &&
    states.every((state) => state.kind === 'known' && state.path === first.path)
  )
    return first;
  return { kind: 'unknown', reason };
}

function resolveDirectory(base: DirectoryState, word: ShellWord, reason: string): DirectoryState {
  if (base.kind === 'unknown') return base;
  if (word.kind === 'dynamic') return { kind: 'unknown', reason };
  return { kind: 'known', path: resolve(base.path, word.value) };
}

interface NormalizedCommand {
  argv: ShellWord[];
  env: Map<string, ShellWord>;
  chdir?: ShellWord;
  wrapped?: boolean;
  opaqueReason?: string;
}

function assignment(node: SgNode): [string, ShellWord] | null {
  const name = node.field('name')?.text();
  const value = node.field('value');
  return name && value ? [name, shellWord(value)] : null;
}

function envAssignment(word: ShellWord): [string, ShellWord] | null {
  if (word.kind !== 'literal') return null;
  const equal = word.value.indexOf('=');
  if (equal <= 0) return null;
  const name = word.value.slice(0, equal);
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return null;
  return [
    name,
    { ...word, value: word.value.slice(equal + 1), source: word.source.slice(equal + 1) },
  ];
}

/** Interpret only the documented finite `env` prefix subset. */
function normalizeEnv(argv: ShellWord[], inherited: Map<string, ShellWord>): NormalizedCommand {
  const env = new Map(inherited);
  let chdir: ShellWord | undefined;
  let index = 1;
  for (; index < argv.length; index++) {
    const word = argv[index];
    const value = literal(word);
    if (!word || value === undefined) return { argv: [], env, opaqueReason: 'dynamic env option' };
    const assigned = envAssignment(word);
    if (assigned) {
      env.set(...assigned);
      continue;
    }
    if (value === '--') {
      index++;
      break;
    }
    if (value === '-i' || value === '--ignore-environment' || value === '-0' || value === '--null')
      continue;
    if (value === '-u' || value === '--unset') {
      const target = literal(argv[++index]);
      if (target === undefined) return { argv: [], env, opaqueReason: 'invalid env --unset' };
      env.delete(target);
      continue;
    }
    if (value.startsWith('--unset=')) {
      env.delete(value.slice('--unset='.length));
      continue;
    }
    if (value === '-C' || value === '--chdir') {
      chdir = argv[++index];
      if (!chdir) return { argv: [], env, opaqueReason: 'invalid env --chdir' };
      continue;
    }
    if (value.startsWith('--chdir=')) {
      chdir = slicedLiteral(word, value.slice('--chdir='.length));
      continue;
    }
    if (value.startsWith('-C') && value.length > 2) {
      chdir = slicedLiteral(word, value.slice(2));
      continue;
    }
    if (value.startsWith('-'))
      return { argv: [], env, opaqueReason: `unsupported env option ${value}` };
    break;
  }
  return { argv: argv.slice(index), env, chdir, wrapped: true };
}

function normalizeCommand(node: SgNode): NormalizedCommand {
  const env = new Map<string, ShellWord>();
  for (const child of node.namedChildren()) {
    if (child.kind() !== 'variable_assignment') continue;
    const entry = assignment(child);
    if (entry) env.set(...entry);
  }
  const nameNode = node.field('name');
  if (!nameNode) return { argv: [], env, opaqueReason: 'missing command name' };
  const argv = [shellWord(nameNode), ...node.fieldChildren('argument').map(shellWord)];
  const name = literal(argv[0]);
  if (name === undefined) return { argv: [], env, opaqueReason: 'dynamic executable name' };
  return basename(name) === 'env' ? normalizeEnv(argv, env) : { argv, env };
}

function cdResult(command: NormalizedCommand, cwd: DirectoryState): DirectoryState {
  const name = literal(command.argv[0]);
  if (name === undefined || basename(name) !== 'cd') return cwd;
  let target: ShellWord | undefined;
  for (const word of command.argv.slice(1)) {
    const value = literal(word);
    if (value === undefined) return { kind: 'unknown', reason: 'dynamic cd target' };
    if (value === '-' || !value.startsWith('-')) {
      target = word;
      break;
    }
  }
  if (!target) {
    const home = process.env.HOME;
    return home ? { kind: 'known', path: home } : { kind: 'unknown', reason: 'HOME unavailable' };
  }
  if (literal(target) === '-') return { kind: 'unknown', reason: 'cd - uses OLDPWD' };
  return resolveDirectory(cwd, target, 'dynamic cd target');
}

interface WalkContext {
  commands: SimpleCommand[];
  direct: boolean;
}

function walkSequence(nodes: SgNode[], cwd: DirectoryState, context: WalkContext): DirectoryState {
  let current = cwd;
  for (const node of nodes) current = walk(node, current, context);
  return current;
}

interface FlowOutcome {
  success: DirectoryState;
  failure: DirectoryState;
}

function walkOutcome(node: SgNode, cwd: DirectoryState, context: WalkContext): FlowOutcome {
  if (node.kind() !== 'list') return { success: walk(node, cwd, context), failure: cwd };
  const statements = node.namedChildren();
  if (statements.length !== 2) {
    const state = walkSequence(statements, cwd, context);
    const joined = joinDirectories([cwd, state], 'compound list has multiple cwd outcomes');
    return { success: joined, failure: joined };
  }
  const left = walkOutcome(statements[0] ?? node, cwd, context);
  const operator = node
    .children()
    .find((child) => child.kind() === '&&' || child.kind() === '||')
    ?.kind();
  if (operator === '&&') {
    const right = walkOutcome(statements[1] ?? node, left.success, context);
    return {
      success: right.success,
      failure: joinDirectories(
        [left.failure, right.failure],
        '&& failure paths have different cwd',
      ),
    };
  }
  if (operator === '||') {
    const right = walkOutcome(statements[1] ?? node, left.failure, context);
    return {
      success: joinDirectories(
        [left.success, right.success],
        '|| success paths have different cwd',
      ),
      failure: right.failure,
    };
  }
  const state = walkSequence(statements, cwd, context);
  return { success: state, failure: cwd };
}

function conditionOutcome(nodes: SgNode[], cwd: DirectoryState, context: WalkContext): FlowOutcome {
  if (nodes.length === 0) return { success: cwd, failure: cwd };
  const prefix = walkSequence(nodes.slice(0, -1), cwd, context);
  return walkOutcome(nodes.at(-1) ?? nodes[0]!, prefix, context);
}

function walkCommand(node: SgNode, cwd: DirectoryState, context: WalkContext): DirectoryState {
  const normalized = normalizeCommand(node);
  if (normalized.opaqueReason || normalized.argv.length === 0) return cwd;
  const rawName = literal(normalized.argv[0]);
  if (rawName === undefined) return cwd;
  const effectiveCwd = normalized.chdir
    ? resolveDirectory(cwd, normalized.chdir, 'dynamic env chdir')
    : cwd;
  context.commands.push({
    name: basename(rawName),
    argv: normalized.argv,
    env: normalized.env,
    cwd: effectiveCwd,
    source: node.text(),
    direct: context.direct,
  });
  for (const argument of node.fieldChildren('argument'))
    walkNestedSubstitutions(argument, effectiveCwd, context);
  return context.direct && !normalized.wrapped ? cdResult(normalized, cwd) : cwd;
}

function walkNestedSubstitutions(node: SgNode, cwd: DirectoryState, context: WalkContext): void {
  if (node.kind() === 'command_substitution') {
    walkSequence(node.namedChildren(), cwd, { ...context, direct: false });
    return;
  }
  for (const child of node.namedChildren()) walkNestedSubstitutions(child, cwd, context);
}

function walkConditional(node: SgNode, cwd: DirectoryState, context: WalkContext): DirectoryState {
  const conditions = node.fieldChildren('condition');
  const outcome = conditionOutcome(conditions, cwd, context);
  const conditionIds = new Set(conditions.map((child) => child.id()));
  const clauses = node
    .namedChildren()
    .filter((child) => child.kind() === 'elif_clause' || child.kind() === 'else_clause');
  const body = node
    .namedChildren()
    .filter((child) => !conditionIds.has(child.id()) && !clauses.includes(child));
  const branches = [walkSequence(body, outcome.success, context)];
  for (const clause of clauses)
    branches.push(walkSequence(clause.namedChildren(), outcome.failure, context));
  if (!clauses.some((clause) => clause.kind() === 'else_clause')) branches.push(outcome.failure);
  return joinDirectories(branches, 'conditional branches have different cwd');
}

function walkLoop(node: SgNode, cwd: DirectoryState, context: WalkContext): DirectoryState {
  const outcome = conditionOutcome(node.fieldChildren('condition'), cwd, context);
  const body = node.field('body');
  if (!body) return joinDirectories([outcome.success, outcome.failure], 'loop condition cwd');
  const afterBody = walk(body, outcome.success, context);
  const joined = joinDirectories([outcome.failure, afterBody], 'loop may change cwd');
  if (joined.kind === 'unknown') walk(body, joined, context);
  return joined;
}

function walk(node: SgNode, cwd: DirectoryState, context: WalkContext): DirectoryState {
  const kind = String(node.kind());
  if (kind === 'ERROR' || OPAQUE_NODES.has(kind)) return cwd;
  if (kind === 'command') return walkCommand(node, cwd, context);
  if (kind === 'command_substitution') {
    walkSequence(node.namedChildren(), cwd, { ...context, direct: false });
    return cwd;
  }
  if (kind === 'subshell') {
    walkSequence(node.namedChildren(), cwd, context);
    return cwd;
  }
  if (kind === 'pipeline') {
    for (const child of node.namedChildren()) walk(child, cwd, context);
    return cwd;
  }
  if (kind === 'list') {
    const outcome = walkOutcome(node, cwd, context);
    return joinDirectories([outcome.success, outcome.failure], 'short-circuit list may change cwd');
  }
  if (kind === 'if_statement') return walkConditional(node, cwd, context);
  if (kind === 'while_statement' || kind === 'for_statement' || kind === 'c_style_for_statement')
    return walkLoop(node, cwd, context);
  if (kind === 'case_statement') {
    const branches = node
      .namedChildren()
      .filter((child) => child.kind() === 'case_item')
      .map((child) => walkSequence(child.namedChildren(), cwd, context));
    return joinDirectories([cwd, ...branches], 'case branches have different cwd');
  }
  if (kind === 'redirected_statement') {
    const body = node.field('body');
    return body ? walk(body, cwd, context) : cwd;
  }
  if (
    kind === 'program' ||
    kind === 'compound_statement' ||
    kind === 'do_group' ||
    kind === 'else_clause' ||
    kind === 'elif_clause' ||
    kind === 'negated_command'
  )
    return walkSequence(node.namedChildren(), cwd, context);
  return cwd;
}

function parseErrors(root: SgNode): { line: number; column: number; source: string }[] {
  const errors: { line: number; column: number; source: string }[] = [];
  const visit = (node: SgNode) => {
    const range = node.range();
    const missing = range.start.index === range.end.index && node.kind() !== 'program';
    if (node.kind() === 'ERROR' || missing) {
      const start = range.start;
      errors.push({ line: start.line + 1, column: start.column + 1, source: node.text() });
      return;
    }
    for (const child of node.children()) visit(child);
  };
  visit(root);
  return errors;
}

export function parseCommands(source: string, base = process.cwd()): CommandParseResult {
  let root: SgNode;
  try {
    root = parse('bash', source).root();
  } catch {
    return { kind: 'parse-error', errors: [{ line: 1, column: 1, source: '' }] };
  }
  const errors = parseErrors(root);
  if (errors.length > 0) return { kind: 'parse-error', errors };
  const commands: SimpleCommand[] = [];
  walk(root, { kind: 'known', path: base }, { commands, direct: true });
  return { kind: 'parsed', commands };
}

export interface GitTarget {
  directory: DirectoryState;
  subcommand: ShellWord | undefined;
  args: ShellWord[];
}

/** Resolve Git global cwd/work-tree options from normalized AST words. */
export function gitTarget(command: SimpleCommand): GitTarget {
  let cwd = command.cwd;
  let workTree: DirectoryState | undefined;
  let index = 1;
  const configured = command.env.get('GIT_WORK_TREE');
  if (configured) workTree = resolveDirectory(command.cwd, configured, 'dynamic GIT_WORK_TREE');
  for (; index < command.argv.length; index++) {
    const word = command.argv[index];
    const value = literal(word);
    if (value === undefined)
      return {
        directory: { kind: 'unknown', reason: 'dynamic Git option' },
        subcommand: word,
        args: [],
      };
    if (value === '-C')
      cwd = resolveDirectory(
        cwd,
        command.argv[++index] ?? dynamicWord('missing -C'),
        'dynamic git -C',
      );
    else if (value === '--work-tree')
      workTree = resolveDirectory(
        cwd,
        command.argv[++index] ?? dynamicWord('missing work-tree'),
        'dynamic Git work-tree',
      );
    else if (value.startsWith('--work-tree='))
      workTree = resolveDirectory(
        cwd,
        slicedLiteral(word, value.slice('--work-tree='.length)),
        'dynamic Git work-tree',
      );
    else if (value === '-c' || value === '--config-env' || value === '--git-dir') index++;
    else if (value.startsWith('-')) continue;
    else break;
  }
  return {
    directory: workTree ?? cwd,
    subcommand: command.argv[index],
    args: command.argv.slice(index + 1),
  };
}

function dynamicWord(reason: string): ShellWord {
  return { kind: 'dynamic', source: '', reason };
}

export function wordValue(word: ShellWord | undefined): string | undefined {
  return literal(word);
}
