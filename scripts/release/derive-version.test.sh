#!/usr/bin/env bash
# Plain-bash test harness for derive-version.sh. Runs on macOS bash 3.2.
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
script="$here/derive-version.sh"
fails=0

assert_ok() { # desc input expected_version expected_numeric
  local desc="$1" input="$2" exp_v="$3" exp_n="$4" out v n
  if ! out="$("$script" "$input" 2>/dev/null)"; then
    echo "FAIL: $desc — expected success, got failure"; fails=$((fails+1)); return
  fi
  v="$(printf '%s\n' "$out" | sed -n 's/^version=//p')"
  n="$(printf '%s\n' "$out" | sed -n 's/^numeric_version=//p')"
  if [ "$v" = "$exp_v" ] && [ "$n" = "$exp_n" ]; then
    echo "PASS: $desc"
  else
    echo "FAIL: $desc — got version=$v numeric=$n, expected version=$exp_v numeric=$exp_n"; fails=$((fails+1))
  fi
}

assert_reject() { # desc input
  local desc="$1" input="$2"
  if "$script" "$input" >/dev/null 2>&1; then
    echo "FAIL: $desc — expected rejection, got success"; fails=$((fails+1))
  else
    echo "PASS: $desc"
  fi
}

assert_ok     "final release"      "v1.2.3"             "1.2.3"          "1.2.3"
assert_ok     "refs/tags form"     "refs/tags/v0.9.0"   "0.9.0"          "0.9.0"
assert_ok     "rc pre-release"     "v1.0.0-rc.1"        "1.0.0-rc.1"     "1.0.0"
assert_ok     "pilot pre-release"  "v0.9.0-pilot.2"     "0.9.0-pilot.2"  "0.9.0"
assert_reject "missing v"          "1.2.3"
assert_reject "two-part"           "v1.2"
assert_reject "non-numeric"        "vfoo"
assert_reject "four-part"          "v1.2.3.4"

if [ "$fails" -eq 0 ]; then echo "All tests passed."; else echo "$fails test(s) failed."; exit 1; fi
