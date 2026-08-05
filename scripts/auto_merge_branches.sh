#!/bin/bash
set -e

cd "$(dirname "$0")/.."

echo "Starting automated merge process..."

git fetch origin
git checkout main
git pull origin main
git branch -D auto-merged-improvements 2>/dev/null || true
git checkout -b auto-merged-improvements

# Get all remote branches for jules and marko1olo
BRANCHES=$(git for-each-ref --sort=-committerdate --format='%(refname:short)' refs/remotes/jules/ refs/remotes/marko1olo/)

SUCCESS=0
CONFLICTS=0
TEST_FAILURES=0
BAD_KEYWORDS=0

echo "Found $(echo "$BRANCHES" | wc -l | tr -d ' ') branches to evaluate."

for branch in $BRANCHES; do
    echo "------------------------------------------------"
    echo "Evaluating branch: $branch"
    
    if echo "$branch" | grep -qEi 'eslint|prettier|jest|playwright|ecs|github-actions|vite-config|vite-plugins'; then
        echo "Branch name contains forbidden keywords. Skipping."
        BAD_KEYWORDS=$((BAD_KEYWORDS+1))
        continue
    fi
    
    HEAD_BEFORE=$(git rev-parse HEAD)
    if ! git merge --no-edit "$branch" > /dev/null 2>&1; then
        echo "Merge conflict detected. Aborting merge."
        git merge --abort
        CONFLICTS=$((CONFLICTS+1))
        continue
    fi
    
    HEAD_AFTER=$(git rev-parse HEAD)
    if [ "$HEAD_BEFORE" = "$HEAD_AFTER" ]; then
        echo "Already up to date."
        continue
    fi
    
    echo "Merged cleanly. Running tests..."
    
    if ! npm run check:readonly > /dev/null 2>&1; then
        echo "Tests failed. Reverting merge."
        git reset --hard $HEAD_BEFORE
        TEST_FAILURES=$((TEST_FAILURES+1))
        continue
    fi
    
    echo "✅ Successfully merged and validated: $branch"
    SUCCESS=$((SUCCESS+1))
done

echo "================================================"
echo "Merge Process Complete."
echo "Successfully merged: $SUCCESS"
echo "Skipped (Conflicts): $CONFLICTS"
echo "Skipped (Test Failures): $TEST_FAILURES"
echo "Skipped (Forbidden Keywords): $BAD_KEYWORDS"
echo "================================================"
