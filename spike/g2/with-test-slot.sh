#!/bin/bash
# Runs "$@" while holding one of 3 machine-wide test slots, so concurrent G2 agents
# don't time each other's suites on a contended CPU. Prints the wait time to stderr.
slots=${AC_TEST_SLOTS:-3}
lock_dir="$HOME/ac-targets/.locks"
mkdir -p "$lock_dir"
waited=0
while true; do
  for slot in $(seq 1 "$slots"); do
    exec {fd}>"$lock_dir/test-slot-$slot"
    if flock -n "$fd"; then
      echo "[with-test-slot] slot $slot after ${waited}s wait" >&2
      "$@"
      status=$?
      flock -u "$fd"
      exit $status
    fi
    exec {fd}>&-
  done
  sleep 5
  waited=$((waited + 5))
done
