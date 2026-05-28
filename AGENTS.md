# anproto-git Agent Notes

- After committing completed work, push the GitHub default branch and the
  local forge remote before handing off. Today the GitHub default branch is
  `main`, so the normal publish pair is:
  - `git push origin main`
  - `git push anproto main`
- If the GitHub repository is later renamed back to `master`, use `master`
  in both commands instead of `main`.
- Do not leave changes only on one remote unless the user explicitly asks
  for that.
