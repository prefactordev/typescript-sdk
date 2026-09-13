# One Ctrl+C stops this script and all child processes (bun, node, tsc, etc.).
#
# Source after set -e (and usually set -uo pipefail), from a script under bin/:
#   # shellcheck source=lib/interrupt.sh
#   source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/interrupt.sh"

[[ -n "${PREFACTOR_BIN_INTERRUPT_SH:-}" ]] && return 0
PREFACTOR_BIN_INTERRUPT_SH=1

_prefactor_interrupt() {
  local sig=$1

  trap - INT TERM
  kill -"$sig" -$$ 2>/dev/null || true

  case "$sig" in
    INT) exit 130 ;;
    TERM) exit 143 ;;
    *) exit 1 ;;
  esac
}

trap '_prefactor_interrupt INT' INT
trap '_prefactor_interrupt TERM' TERM
