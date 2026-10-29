# B9: the judges' path: `npx ac demo --replay` in a fresh clone (AC=<clone>, npm ci done), no key, $0. Its long lines
# wrapped, not cut. Needs a quiet machine; the whole replay takes about 11 minutes, and the cut keeps its steps going by.
Output ../../out/v2/cli/replay.mp4
Source v2.tape
# Played about 40 times faster in the cut: a blinking caret would flicker, so it stays still.
Set CursorBlink false
Hide
Type "source ../../tapes/setup.sh && cd $AC && rm -rf /tmp/ac-demo && clear"
Enter
Show
Type `npx ac demo --replay 2>&1 | fold -s -w 80; echo "exit ${PIPESTATUS[0]}"`
Sleep 300ms
Enter
Wait@1800s
Sleep 5s
