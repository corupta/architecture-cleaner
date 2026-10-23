# Beat 1, the hook: immich's maintainers restructured server/ by hand in March 2024. Read from immich's own history
# (any immich clone with full history; IMMICH defaults to ~/ac-targets/immich).
Output ../out/cli/hook.mp4
Source settings.tape
Set FontSize 22

Hide
Type "export PS1='$ ' IMMICH=${IMMICH:-$HOME/ac-targets/immich}; cd $IMMICH; git config core.pager cat; clear"
Enter
Show

Type "git log --date=format:'%b %d %H:%M' --format='%ad  %s' --since=2024-03-20 --until=2024-03-23 -- server/src"
Sleep 400ms
Enter
Sleep 4s
Type "git ls-tree -d --name-only 30f499cf2e~1:server/src/domain | column -c 150   # Mar 19: features under domain/"
Sleep 400ms
Enter
Sleep 2.5s
Type "git ls-tree -d --name-only 604b8ff17c:server/src | column -c 150            # Mar 23: type folders"
Sleep 400ms
Enter
Sleep 3s
