import { isRecord } from './hook-utils.ts';

/** GitHub コネクタの PR 作成ツールの入力から読み取った、PR の対象。 */
export interface PrCreateTarget {
  owner: string;
  repo: string;
  head: string;
  /** head が "<owner>:<branch>" 形式ならその owner、省略されていればベースの owner。 */
  headOwner: string;
  headBranch: string;
  /** PR の base ブランチ。省略されていれば undefined。 */
  base?: string;
}

/**
 * コネクタごとの別名（owner/repo・repository_full_name・repo_full_name、head・head_branch、
 * base・base_branch）を 1 つにまとめる。別名どうしが食い違うときは、どちらかを黙って選ばずに
 * エラーにする。
 */
export function prCreateTarget(input: unknown): PrCreateTarget {
  if (!isRecord(input)) throw new Error('ツールの引数を読み取れません');
  const names: unknown[] = [input.repository_full_name, input.repo_full_name].filter(
    (value) => value !== undefined,
  );
  if (input.owner !== undefined || input.repo !== undefined) {
    if (typeof input.owner !== 'string' || typeof input.repo !== 'string')
      throw new Error('owner と repo は両方必要です');
    names.push(`${input.owner}/${input.repo}`);
  }
  const fullNames = names.filter(
    (value): value is string => typeof value === 'string' && /^[\w.-]+\/[\w.-]+$/u.test(value),
  );
  const [name] = fullNames;
  if (name === undefined || fullNames.length !== names.length)
    throw new Error('有効な owner/repo か repository_full_name が必要です');
  if (fullNames.some((value) => value.toLowerCase() !== name.toLowerCase()))
    throw new Error('リポジトリの指定が食い違っています');
  const heads = [input.head, input.head_branch].filter((value) => value !== undefined);
  const [head] = heads;
  if (typeof head !== 'string' || head === '' || heads.some((value) => value !== head))
    throw new Error('head の指定が無いか、食い違っています');
  const bases = [input.base, input.base_branch].filter((value) => value !== undefined);
  const [base] = bases;
  if (
    base !== undefined &&
    (typeof base !== 'string' || base === '' || bases.some((value) => value !== base))
  )
    throw new Error('base の指定を読み取れないか、食い違っています');
  const [owner = '', repo = ''] = name.split('/');
  const colon = head.indexOf(':');
  return {
    ...(typeof base === 'string' ? { base } : {}),
    owner,
    repo,
    head,
    headOwner: colon === -1 ? owner : head.slice(0, colon),
    headBranch: colon === -1 ? head : head.slice(colon + 1),
  };
}
