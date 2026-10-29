# B3: immich's unit suite on opencode's single-shot branch (G3): all its test cases still pass while 66 test files
# never load. Needs a quiet machine (immich's vitest under load reports short runs).
Output ../../out/v2/cli/g3-vitest.mp4
Source v2.tape
Hide
Type "source ../../tapes/setup.sh && cd $G3 && git switch -q g3/opencode-super && cd server && export PATH=$TARGET_NODE:$PATH TZ=UTC && clear"
Enter
Show
Type "git log --oneline -1 | fold -s -w 80"
Sleep 300ms
Enter
Sleep 1.5s
Type "npx vitest run --config test/vitest.config.mjs 2>&1 | tail -n 7 | fold -s -w 80"
Sleep 300ms
Enter
# The summary doesn't fill the screen at this font, so wait for its last field anywhere on it, not for the prompt.
Wait+Screen@900s /Duration/
Sleep 4s
