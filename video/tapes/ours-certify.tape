# Beat 3: `ac certify` on step 1 of the recorded ladder with the checks its step certificate ran (K0–K7; `ac run`
# leaves K8 to the rung certificates, so a plain `ac certify` would list K8 as skipped and give another digest). The
# digest it prints is the one in the commit's trailer: the certificate is reproduced, not just the verdict. ~4 min on
# a quiet machine; the cut speeds up the wait.
Output ../out/cli/ours-certify.mp4
Source settings.tape
Set FontSize 20
Hide
Type "source setup.sh && cd $AC && clear"
Enter
Show
Type "npx ac certify $IMMICH 02063972e8..cf670ebc57 --profile immich --env $IMMICH --only K0,K1,K2,K3a,K3b,K3c,K4,K6,K7 | grep --line-buffered -E '^(ac certify|PASS|FAIL|verdict|digest)' | cut -c1-120 | paint"
Sleep 300ms
Enter
Wait@600s
Sleep 4s
