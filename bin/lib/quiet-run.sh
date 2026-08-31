# shellcheck shell=bash
# Run a command, printing "<label>: OK" on success. On failure, print
# "<label> failed:" and the command's stdout/stderr, then return the
# original exit code.
#
# Source from a script under bin/:
#   # shellcheck source=lib/quiet-run.sh
#   source "$ROOT/bin/lib/quiet-run.sh"
#   quiet_run "lint" bun run lint

[[ -n "${PREFACTOR_BIN_QUIET_RUN_SH:-}" ]] && return 0
PREFACTOR_BIN_QUIET_RUN_SH=1

quiet_run() {
  local label=$1
  shift
  local tmp status=0
  tmp=$(mktemp)
  "$@" >"$tmp" 2>&1 || status=$?
  if [ "$status" -ne 0 ]; then
    printf '%s failed:\n' "$label"
    cat "$tmp"
    rm -f "$tmp"
    return "$status"
  fi
  rm -f "$tmp"
  printf '%s: OK\n' "$label"
  return 0
}
