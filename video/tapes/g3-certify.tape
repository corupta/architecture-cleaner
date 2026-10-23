# Beat 2: `ac certify` with the oracles on opencode's single-shot branch (G3). The verdict lines turn red one by one.
Output ../out/cli/g3-certify.mp4
Source settings.tape
Set FontSize 20
Hide
Type "source setup.sh && cd $AC && clear"
Enter
Show
Type "npx ac certify $G3 02063972e8..g3/opencode-super --profile immich --env $G3 --oracles | grep --line-buffered -E '^(ac certify|PASS|FAIL|verdict)' | cut -c1-120 | paint"
Sleep 300ms
Enter
Wait@2400s
Sleep 4s
