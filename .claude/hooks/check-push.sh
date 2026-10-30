#!/usr/bin/env bash
# Hook: check-push.sh
# Event: PreToolUse (Bash)
# Purpose: Block accidental git push, merge, deploy, or CI-triggering commands.
#
# Exit 2 = blocked; exit 0 = allowed.
# Limitations: cannot intercept all possible push paths; human review remains required.

INPUT=$(cat)
CMD=$(echo "$INPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('command',''))" 2>/dev/null)

# Block git push to remote
if echo "$CMD" | grep -qE "git\s+push"; then
  echo "BLOCKED: git push is not permitted without explicit user approval. Push only after human review." >&2
  exit 2
fi

# Block git merge to main/master
if echo "$CMD" | grep -qE "git\s+merge"; then
  echo "BLOCKED: git merge is not permitted without explicit user approval." >&2
  exit 2
fi

# Block npm publish / gh pr merge / deploy commands
if echo "$CMD" | grep -qE "(npm\s+publish|gh\s+pr\s+merge|vercel\s+deploy|gh\s+release\s+create)"; then
  echo "BLOCKED: Publish/deploy commands are not permitted without explicit user approval." >&2
  exit 2
fi

exit 0
