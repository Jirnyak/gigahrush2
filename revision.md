# Revision Plan (Anti-Regression Protocol)

> **Role:** Mandatory instruction for agents performing code reviews and auditing history to prevent and detect silent regressions.

## Background
Due to the size of the GIGAHRUSH repository, agents performing heavy refactoring (e.g. economy redesign, RNG standardization) have occasionally deleted functional code (such as procedural mesh splatters, visual logic, or niche mechanics) by accident or "collateral damage" without explicitly mentioning it to the user.

## Objective
Your task is to scan recent commits step by step to identify functional code blocks that were removed or heavily altered, and verify if their removal was intentional (documented and justified) or accidental.

## Execution Steps

1. **Get Commit History**
   - Run `git log --oneline -n 15` (or however deep the user specifies) to get the recent history.
   
2. **Commit-by-Commit Diffing**
   - For each commit, run `git show <commit>` or `git diff <commit>~1 <commit>` to see exactly what changed.
   - Do NOT just look at the commit messages. You must read the actual diffs.

3. **Identify Suspicious Deletions**
   - Look for blocks of logic (especially `if` conditions, `emitParticle` calls, visual slot additions, AI behaviors, or interaction handlers) that appear in the `-` lines but have no equivalent `+` lines replacing them.
   - **Example 1:** A `Math.random()` block was deleted instead of being rewritten to use `SeedRng`.
   - **Example 2:** Hardcoded `if/else` checks for specific items were removed during an "economy refactor", but their unique side-effects were not transferred to the new data-driven system.

4. **Document Findings**
   - Create a list of "Potential Regressions".
   - For each potential regression, list the file, the line, the deleted code snippet, and the commit hash.
   
5. **Propose Restorations**
   - For every confirmed accidental deletion, propose a restoration plan.
   - Ensure the restored code complies with the *current* architecture (e.g., use `SeedRng`, use the new registries, etc.) rather than just blindly reverting.

## Validation
- Do NOT run a blanket `git revert`.
- Always verify that restoring the code does not break the `npm run check:readonly` pipeline.
