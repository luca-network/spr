#!/usr/bin/env bash
# Hook: check-spr-core.sh
# Event: PreToolUse (Edit, Write)
# Purpose: Warn when editing SPR core files whose changes would invalidate existing signatures.
#
# Core files whose canonicalization, seal, or vector logic MUST NOT change without
# a corresponding spec change and full vector regeneration.

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('file_path',''))" 2>/dev/null)

CORE_PATTERNS=(
  "packages/spr/index.mjs"
  "packages/spr/vectors/vectors.json"
  "python/spr/format.py"
)

for PATTERN in "${CORE_PATTERNS[@]}"; do
  if echo "$FILE_PATH" | grep -q "$PATTERN"; then
    echo "WARNING: Editing SPR core file: $FILE_PATH" >&2
    echo "Changes to canonicalization, seal/verify logic, or test vectors will break all existing signatures." >&2
    echo "Ensure you have a matching SPEC.md change and regenerate vectors with: npm run vectors" >&2
    # Advisory only (exit 0); enforcement is via code review, not this hook
    break
  fi
done

exit 0
