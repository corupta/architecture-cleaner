# The close's payoff, readable: the verdict lines of the summary the replay wrote (/tmp/ac-demo/demo.md), at the
# shots' usual font. replay.tape's own last screen is 32 lines at 18 px, too dense for its 2.5 s. Run it right after
# replay.tape, so the summary is that run's.
Output ../out/cli/replay-end.mp4
Source settings.tape
Hide
Type "source setup.sh && clear"
Enter
Show
Type `grep -E 'matches the recorded run|trees equal|tree equals' /tmp/ac-demo/demo.md | tr -d '*' | fold -s -w 104 | paint`
Sleep 300ms
Enter
Sleep 6s
