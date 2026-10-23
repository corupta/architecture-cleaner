# The close: the judges' path from a clone of this repository, no key, $0. The whole replay (~11 min on a quiet
# machine); the cut keeps the start and the summary. Run it in a fresh clone: AC=<clone> (npm ci done).
Output ../out/cli/replay.mp4
Source settings.tape
Set FontSize 18
Hide
Type "source setup.sh && cd $AC && rm -rf /tmp/ac-demo && clear"
Enter
Show
Type `npx ac demo --replay 2>&1 | cut -c1-170; echo "exit ${PIPESTATUS[0]}"`
Sleep 300ms
Enter
Wait@1800s
Sleep 5s
