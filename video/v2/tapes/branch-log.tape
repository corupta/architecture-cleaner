# B8: the branch you get: the ladder's 63 commits, oldest first, one line each, paced so they can be seen going by.
Output ../../out/v2/cli/branch-log.mp4
Source v2.tape
Hide
Type "source ../../tapes/setup.sh && cd $IMMICH && clear"
Enter
Show
Type `git log --oneline --reverse 02063972e8..ac/s6-ladder | while read -r line; do echo "$line"; sleep 0.025; done`
Sleep 300ms
Enter
Sleep 6s
