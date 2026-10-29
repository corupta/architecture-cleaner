# B8: the plan you can edit: plan.yaml's own first lines (how to edit it) and the album feature's entry.
Output ../../out/v2/cli/plan-entry.mp4
Source v2.tape
Hide
Type "source ../../tapes/setup.sh && cd $AC && clear"
Enter
Show
Type "sed -n '1,2p;/^  module\/album:/,/^  module\/api-key:/p' runs/immich-ladder/plan/plan.yaml | fold -s -w 80"
Sleep 300ms
Enter
Sleep 6s
