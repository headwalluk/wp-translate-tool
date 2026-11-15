#!/usr/bin/env bash
#
# wp-translate-tool test harness.
#
# Two checks per fixture in tests/fixtures/:
#
#   parse     — tests/driver.ts dumps the parse result; compared against the
#               golden file in tests/expected/<name>.txt
#   roundtrip — parsePo() then writePo() must reproduce the fixture byte for
#               byte. This is the safety property that matters most: the parser
#               preserves raw lines, so any change that breaks losslessness is a
#               data-loss bug.
#
# Plus one unit check: tests/units.ts output against tests/expected/units.txt.
#
# Regenerate golden files after an intentional behaviour change:
#   UPDATE_EXPECTED=1 ./tests/run-tests.sh
# Always read the resulting diff before committing it.

set -uo pipefail

TESTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "${TESTS_DIR}")"
FIXTURES_DIR="${TESTS_DIR}/fixtures"
EXPECTED_DIR="${TESTS_DIR}/expected"
BUILD_DIR="${TESTS_DIR}/.build"
DRIVER_BUNDLE="${BUILD_DIR}/driver.mjs"
UPDATE_EXPECTED="${UPDATE_EXPECTED:-0}"

PASS_COUNT=0
FAIL_COUNT=0
FAILED_NAMES=()

mkdir -p "${BUILD_DIR}" "${EXPECTED_DIR}"

# Bundle the driver together with src/ so the tests exercise the real modules.
npx esbuild "${TESTS_DIR}/driver.ts" \
  --bundle --platform=node --format=esm \
  --outfile="${DRIVER_BUNDLE}" --log-level=error
if [[ $? -ne 0 ]]; then
  echo "BUILD FAILED — cannot run tests"
  exit 1
fi

report() {
  local OUTCOME="$1"
  local CHECK_NAME="$2"
  local FIXTURE_NAME="$3"
  printf '%-5s %-10s %s\n' "${OUTCOME}" "${CHECK_NAME}" "${FIXTURE_NAME}"
  if [[ "${OUTCOME}" == "PASS" ]]; then
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    FAIL_COUNT=$((FAIL_COUNT + 1))
    FAILED_NAMES+=("${CHECK_NAME}/${FIXTURE_NAME}")
  fi
}

for FIXTURE_PATH in "${FIXTURES_DIR}"/*.po; do
  FIXTURE_NAME="$(basename "${FIXTURE_PATH}" .po)"
  EXPECTED_PATH="${EXPECTED_DIR}/${FIXTURE_NAME}.txt"
  ACTUAL_PATH="${BUILD_DIR}/${FIXTURE_NAME}.txt"
  ROUNDTRIP_PATH="${BUILD_DIR}/${FIXTURE_NAME}.roundtrip.po"

  node "${DRIVER_BUNDLE}" "${FIXTURE_PATH}" "${ROUNDTRIP_PATH}" > "${ACTUAL_PATH}"
  DRIVER_STATUS=$?

  if [[ ${DRIVER_STATUS} -ne 0 ]]; then
    report "FAIL" "parse" "${FIXTURE_NAME} (driver exited ${DRIVER_STATUS})"
    report "FAIL" "roundtrip" "${FIXTURE_NAME} (not run)"
    continue
  fi

  # parse check
  if [[ "${UPDATE_EXPECTED}" == "1" ]]; then
    cp "${ACTUAL_PATH}" "${EXPECTED_PATH}"
    report "PASS" "parse" "${FIXTURE_NAME} (golden updated)"
  elif [[ ! -f "${EXPECTED_PATH}" ]]; then
    report "FAIL" "parse" "${FIXTURE_NAME} (no golden file; run with UPDATE_EXPECTED=1)"
  elif diff -u "${EXPECTED_PATH}" "${ACTUAL_PATH}" > "${ACTUAL_PATH}.diff"; then
    report "PASS" "parse" "${FIXTURE_NAME}"
  else
    report "FAIL" "parse" "${FIXTURE_NAME}"
    sed 's/^/      /' "${ACTUAL_PATH}.diff"
  fi

  # roundtrip check
  if diff -u "${FIXTURE_PATH}" "${ROUNDTRIP_PATH}" > "${ROUNDTRIP_PATH}.diff"; then
    report "PASS" "roundtrip" "${FIXTURE_NAME}"
  else
    report "FAIL" "roundtrip" "${FIXTURE_NAME}"
    sed 's/^/      /' "${ROUNDTRIP_PATH}.diff"
  fi
done

# Unit checks: tests/units.ts prints decisions, compared against a golden file.
UNITS_BUNDLE="${BUILD_DIR}/units.mjs"
UNITS_EXPECTED="${EXPECTED_DIR}/units.txt"
UNITS_ACTUAL="${BUILD_DIR}/units.txt"
npx esbuild "${TESTS_DIR}/units.ts" \
  --bundle --platform=node --format=esm \
  --outfile="${UNITS_BUNDLE}" --log-level=error
if [[ $? -ne 0 ]] || ! node "${UNITS_BUNDLE}" > "${UNITS_ACTUAL}"; then
  report "FAIL" "units" "units (build or run failed)"
elif [[ "${UPDATE_EXPECTED}" == "1" ]]; then
  cp "${UNITS_ACTUAL}" "${UNITS_EXPECTED}"
  report "PASS" "units" "units (golden updated)"
elif diff -u "${UNITS_EXPECTED}" "${UNITS_ACTUAL}" > "${UNITS_ACTUAL}.diff"; then
  report "PASS" "units" "units"
else
  report "FAIL" "units" "units"
  sed 's/^/      /' "${UNITS_ACTUAL}.diff"
fi

# Instructions checks: run the real CLI against temporary plugin layouts.
CLI_BUNDLE="${BUILD_DIR}/wp-translate.mjs"
STALE_BLOCK=$'<!-- wp-translate:begin v=0.0.0 hash=0 -->\n<!-- wp-translate:end -->'
npx esbuild "${PROJECT_DIR}/src/index.ts" \
  --bundle --platform=node --format=esm --define:__VERSION__='"test"' \
  --outfile="${CLI_BUNDLE}" --log-level=error
if [[ $? -ne 0 ]]; then
  report "FAIL" "instr" "cli (build failed)"
else
  # Make a plugin dir holding AGENTS.md (no block) and CLAUDE.md with the given content.
  make_instructions_plugin() {
    local CLAUDE_CONTENT="$1"
    local PLUGIN_DIR
    PLUGIN_DIR="$(mktemp -d "${BUILD_DIR}/plugin-XXXXXX")"
    printf '# Shared brief\n' > "${PLUGIN_DIR}/AGENTS.md"
    printf '# Plugin\n%s\n' "${CLAUDE_CONTENT}" > "${PLUGIN_DIR}/CLAUDE.md"
    cp "${PLUGIN_DIR}/AGENTS.md" "${PLUGIN_DIR}/AGENTS.md.orig"
    echo "${PLUGIN_DIR}"
  }

  # Sync then check; pass when CLAUDE.md gets a current block and AGENTS.md is untouched.
  check_instructions_case() {
    local CASE_NAME="$1"
    local PLUGIN_DIR="$2"
    shift 2
    local EXTRA_ARGS=("$@")
    if node "${CLI_BUNDLE}" "${PLUGIN_DIR}" --sync-instructions --yes "${EXTRA_ARGS[@]}" > "${PLUGIN_DIR}/sync.log" \
      && node "${CLI_BUNDLE}" "${PLUGIN_DIR}" --check-instructions "${EXTRA_ARGS[@]}" > "${PLUGIN_DIR}/check.log" \
      && grep -q '^CLAUDE.md (text domain: .*): up to date\.$' "${PLUGIN_DIR}/check.log" \
      && cmp -s "${PLUGIN_DIR}/AGENTS.md" "${PLUGIN_DIR}/AGENTS.md.orig"; then
      report "PASS" "instr" "${CASE_NAME}"
    else
      report "FAIL" "instr" "${CASE_NAME}"
      sed 's/^/      /' "${PLUGIN_DIR}/sync.log" "${PLUGIN_DIR}/check.log" 2>/dev/null
    fi
  }

  check_instructions_case "block-in-claude" "$(make_instructions_plugin "${STALE_BLOCK}")"
  check_instructions_case "forced-claude" "$(make_instructions_plugin "")" --instructions-file CLAUDE.md

  MISSING_PLUGIN_DIR="$(make_instructions_plugin "")"
  node "${CLI_BUNDLE}" "${MISSING_PLUGIN_DIR}" --check-instructions --instructions-file missing.md > /dev/null 2>&1
  if [[ $? -eq 1 ]]; then
    report "PASS" "instr" "forced-missing"
  else
    report "FAIL" "instr" "forced-missing (expected exit 1)"
  fi
  rm -rf "${BUILD_DIR}"/plugin-*
fi

echo
echo "${PASS_COUNT} passed, ${FAIL_COUNT} failed"

EXIT_CODE=0
if [[ ${FAIL_COUNT} -gt 0 ]]; then
  echo "failed: ${FAILED_NAMES[*]}"
  EXIT_CODE=1
fi

exit ${EXIT_CODE}
