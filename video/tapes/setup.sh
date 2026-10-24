# Sourced, hidden, at the start of every tape: a plain prompt, no pager, and the paths the tapes use.
# AC is a clone of architecture-cleaner with `npm ci` done; IMMICH an immich clone that has the recorded branches
# (ac/s6-ladder, ac/s7-fault) and, for --env, its node_modules; G3 the gate's opencode checkout (docs/gates.md, G3).
export PS1='$ ' PAGER=cat GIT_PAGER=cat
export AC=${AC:-/workspace/architecture-cleaner} IMMICH=${IMMICH:-$HOME/ac-targets/immich} G3=${G3:-$HOME/ac-targets/g3/immich}
export TARGET_NODE=${TARGET_NODE:-$HOME/ac-targets/.node/node-v24.21.0-linux-$(uname -m | sed 's/x86_64/x64/;s/aarch64/arm64/')/bin}
# PASS green, FAIL red, the replay's verdicts green: only the colors change, never the text.
paint() { sed -u -e $'s/^PASS/\e[1;32mPASS\e[0m/' -e $'s/^FAIL/\e[1;31mFAIL\e[0m/' -e $'s/^verdict: PASS/verdict: \e[1;32mPASS\e[0m/' -e $'s/^verdict: FAIL/verdict: \e[1;31mFAIL\e[0m/' \
  -e $'s/^Everything compared matches the recorded run/\e[1;32m&\e[0m/' -e $'s/62 of 62 trees equal the recorded run\x27s\./\e[1;32m&\e[0m/'; }
clear
