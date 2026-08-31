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

echo
echo "${PASS_COUNT} passed, ${FAIL_COUNT} failed"

EXIT_CODE=0
if [[ ${FAIL_COUNT} -gt 0 ]]; then
  echo "failed: ${FAILED_NAMES[*]}"
  EXIT_CODE=1
fi

exit ${EXIT_CODE}
