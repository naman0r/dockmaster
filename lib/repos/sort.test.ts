import { describe, expect, it } from "vitest";
import { isRepoSort, sortRepos } from "./sort";
import { parseChanges } from "./status";

const repos = [
  { name: 'Old', path: '/old', lastCommitIso: '2025-01-01', ahead: 5, behind: 0, changes: { ...parseChanges(''), untrackedFiles: 1247 } },
  { name: 'Recent', path: '/recent', lastCommitIso: '2026-09-01', ahead: 0, behind: 3, changes: { ...parseChanges(''), modified: 2 } },
  { name: 'Undated', path: '/undated', lastCommitIso: '', ahead: 0, behind: 0, changes: parseChanges('') },
];
const names = (rows: typeof repos) => rows.map((r) => r.name);
describe('repository sorting', () => {
  it('defaults to commit recency rather than large untracked counts', () => {
    expect(names(sortRepos(repos, 'recent'))).toEqual(['Recent', 'Old', 'Undated']);
    expect(names(repos)).toEqual(['Old', 'Recent', 'Undated']);
  });
  it('keeps unknown commit dates last in either date direction', () => {
    expect(names(sortRepos(repos, 'oldest'))).toEqual(['Old', 'Recent', 'Undated']);
  });
  it('separates tracked and untracked sorting and supports commit counts', () => {
    expect(sortRepos(repos, 'tracked')[0].name).toBe('Recent');
    expect(sortRepos(repos, 'untracked')[0].name).toBe('Old');
    expect(sortRepos(repos, 'ahead')[0].name).toBe('Old');
    expect(sortRepos(repos, 'behind')[0].name).toBe('Recent');
  });
  it('sorts names in both directions and breaks equal names by path', () => {
    expect(names(sortRepos(repos, 'name'))).toEqual(['Old', 'Recent', 'Undated']);
    expect(names(sortRepos(repos, 'nameDesc'))).toEqual(['Undated', 'Recent', 'Old']);
    expect(sortRepos([{...repos[0],path:'/b'}, {...repos[0],path:'/a'}], 'recent')[0].path).toBe('/a');
  });
  it('rejects unknown saved preferences', () => {
    expect(isRepoSort('recent')).toBe(true);
    expect(isRepoSort('toString')).toBe(false);
    expect(isRepoSort(null)).toBe(false);
  });
});
