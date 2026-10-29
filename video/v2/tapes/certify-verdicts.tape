# B8: the same checker on two diffs: opencode's single-shot branch (S4's certificate, runs/g3/) and ac's whole PR on
# immich (S6's, runs/immich-ladder/): each certificate's range and verdict line, from the saved certificate files.
Output ../../out/v2/cli/certify-verdicts.mp4
Source v2.tape
Hide
Type "source ../../tapes/setup.sh && cd $AC && clear"
Enter
Show
Type "grep -h '^ac certify\|^verdict' runs/g3/g3-immich-opencode-super.full.txt | paint"
Sleep 300ms
Enter
Sleep 2.5s
Type "grep -h '^ac certify\|^verdict' runs/immich-ladder/certificate.txt | paint"
Sleep 300ms
Enter
Sleep 4s
