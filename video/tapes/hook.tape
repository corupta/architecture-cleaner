# Beat 1, the hook: immich's maintainers restructured server/ by hand in March 2024: the 17 PRs from #8080 to #8204
# (Mar 20–22), read from immich's own history by commit range (a date range depends on the time of day git fills in),
# without the one fix: commit in between. IMMICH is any immich clone with full history.
# (The same history shows their direction: from feature folders under domain/ to type folders, the opposite of ac.
# The video doesn't show it; docs/gates.md has the details.)
Output ../out/cli/hook.mp4
Source settings.tape
Set FontSize 22

Hide
Type "source setup.sh && cd $IMMICH && clear"
Enter
Type "git log --format='%ad  %s' --date=format:'%b %d %H:%M' --invert-grep --grep='^fix' e6f2bb9f89..6e93ddf2f1 -- server/src"
Show
Sleep 500ms
Enter
Sleep 14s
