---
name: safe-git-workflow
description: Safely inspect Git state, synchronize with remote branches, stage intended files, create commits, and prepare pushes or pull requests without losing unrelated work. Use for GitHub commits, branch changes, merges, rebases, or repository synchronization.
---

# Safe Git Workflow

1. Inspect `git status --short --branch`, `git diff`, `git diff --cached`, `git log -5 --oneline --decorate`, and remotes before changing Git state.
2. Fetch the intended remote and compare the current branch to its upstream. Do not assume `origin/main` is the repository's authoritative remote until remotes are checked.
3. Preserve untracked and modified user files. Never use `git reset --hard`, `git clean -fd`, force-push, or destructive checkout commands to resolve ambiguity.
4. Create a task-specific branch from the current intended base. If the branch already exists, inspect it before reuse.
5. Stage explicit paths, not `git add .`, unless the full working tree has been reviewed and every change belongs to the task.
6. Inspect the staged diff and run `git diff --cached --check`. Confirm no secrets, local state, build artifacts, or unrelated edits are included.
7. Commit with a clear imperative message scoped to the change. A successful commit proves only that Git recorded a snapshot, not that the code is correct.
8. Push only the intended branch after checks pass. Prefer a pull request; never rewrite shared history without explicit authorization.
9. If remote and local history diverge, inspect both histories and explain the safest resolution before rewriting or discarding anything.
10. Report branch, commit SHA, files changed, checks performed, and anything not verified.
