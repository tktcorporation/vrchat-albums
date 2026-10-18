import { isRecord } from './hook-utils.ts';

/** Normalize supported GitHub connector aliases without silently choosing a conflicting target. */
export function prCreateTarget(input: unknown): { owner: string; repo: string; head: string } {
  if (!isRecord(input)) throw new Error('Tool input must be an object');
  const value = input;
  const names = [value.repository_full_name, value.repo_full_name].filter((v) => v !== undefined);
  if (value.owner !== undefined || value.repo !== undefined) {
    if (typeof value.owner !== 'string' || typeof value.repo !== 'string') {
      throw new Error('Both owner and repo are required');
    }
    names.push(`${value.owner}/${value.repo}`);
  }
  const validNames = names.filter(
    (v): v is string => typeof v === 'string' && /^[\w.-]+\/[\w.-]+$/.test(v),
  );
  if (!names.length || validNames.length !== names.length) {
    throw new Error('A valid owner/repo or repository_full_name is required');
  }
  const name = validNames[0];
  if (validNames.some((v) => v.toLowerCase() !== name.toLowerCase())) {
    throw new Error('Conflicting repository aliases');
  }
  const heads = [value.head, value.head_branch].filter((v) => v !== undefined);
  const head = heads[0];
  if (typeof head !== 'string' || !head || heads.some((v) => v !== head)) {
    throw new Error('Missing or conflicting head aliases');
  }
  const [owner, repo] = name.split('/');
  return { owner, repo, head };
}
