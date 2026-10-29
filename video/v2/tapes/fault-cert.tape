# B6: the seeded run's failed certificate (step 2, attempt 1): the three lines that name the broken import, one per
# resolver (TypeScript, the test runner, Node), and the verdict. A filter of the certificate file, wrapped.
Output ../../out/v2/cli/fault-cert.mp4
Source v2.tape
Hide
Type "source ../../tapes/setup.sh && cd $AC && clear"
Enter
Show
Type "grep -h 'workflow-execution\|^verdict' runs/immich-fault/certificates/failed/002-R1-module-album-attempt1.txt | fold -s -w 80 | paint"
Sleep 300ms
Enter
Sleep 7s
