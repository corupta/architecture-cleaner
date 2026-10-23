# Beat 4: R4's boundary rules on the head of the recorded ladder. One new import that the module order forbids, and
# `ac boundaries --check` fails with it; the 161 violations frozen in the baseline stay known. Uses a scratch worktree.
Output ../out/cli/boundaries.mp4
Source settings.tape
Hide
Type "source setup.sh && rm -rf /tmp/ac-video-boundaries && git -C $IMMICH worktree prune && git -C $IMMICH worktree add -q --detach /tmp/ac-video-boundaries c4be040b57 && cd /tmp/ac-video-boundaries/server && clear"
Enter
Sleep 3s
Show
Type `echo "import { TrashService } from 'src/modules/trash/trash.service.js';" >> src/modules/album/album.service.ts`
Sleep 300ms
Enter
Sleep 1s
Type `npx --prefix $AC ac boundaries .. --profile immich --check; echo "exit $?"`
Sleep 300ms
Enter
Wait@120s
Sleep 4s
Hide
Type "cd / && git -C $IMMICH worktree remove --force /tmp/ac-video-boundaries"
Enter
Sleep 2s
