# Beat 2: immich's own unit suite on opencode's single-shot branch (G3). The cases all pass; the summary also shows the
# copied spec files that fail to load. Switches the G3 checkout to g3/opencode-super (a scratch checkout of the gate).
Output ../out/cli/g3-vitest.mp4
Source settings.tape
Set FontSize 20
Hide
Type "source setup.sh && cd $G3 && git switch -q g3/opencode-super && cd server && export PATH=$TARGET_NODE:$PATH TZ=UTC && clear"
Enter
Show
Type "git log --oneline -1"
Sleep 300ms
Enter
Sleep 1.5s
Type "npx vitest run --config test/vitest.config.mjs 2>&1 | tail -n 7"
Sleep 300ms
Enter
Wait@900s
Sleep 4s
