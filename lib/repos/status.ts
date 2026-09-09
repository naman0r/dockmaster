export const CHANGE_LABELS = {
  modified: "modified", added: "added", deleted: "deleted", renamed: "renamed",
  copied: "copied", conflicted: "conflicted", untrackedFiles: "untracked files",
  untrackedFolders: "untracked folders",
} as const;

export type ChangeCounts = Record<keyof typeof CHANGE_LABELS, number>;

// Porcelain v1 quotes filenames containing newlines, so each entry is one line.
// Classify each path once, even when both index and working tree changed it.
export function parseChanges(output: string): ChangeCounts {
  const counts: ChangeCounts = { modified: 0, added: 0, deleted: 0, renamed: 0, copied: 0, conflicted: 0, untrackedFiles: 0, untrackedFolders: 0 };
  for (const line of output.split("\n")) {
    if (line.length < 4 || line.startsWith("## ")) continue;
    const status = line.slice(0, 2);
    if (status === "!!" || status === "  ") continue;
    if (status === "??") counts[/\/"?$/.test(line) ? "untrackedFolders" : "untrackedFiles"]++;
    else if (["DD", "AU", "UD", "UA", "DU", "AA", "UU"].includes(status)) counts.conflicted++;
    else if (status.includes("D")) counts.deleted++;
    else if (status.includes("R")) counts.renamed++;
    else if (status.includes("C")) counts.copied++;
    else if (status.includes("A")) counts.added++;
    else if (/[MT]/.test(status)) counts.modified++;
  }
  return counts;
}
