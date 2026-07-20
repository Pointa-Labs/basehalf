#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 1 ]; then
	printf 'Usage: %s <response-path>\n' "$0" >&2
	exit 2
fi

: "${CONTROL_PLANE_URL:?CONTROL_PLANE_URL is required}"
: "${RELEASE_TOKEN:?RELEASE_TOKEN is required}"
: "${JOB_ID:?JOB_ID is required}"
: "${WORKER_ID:?WORKER_ID is required}"

case "$CONTROL_PLANE_URL" in
	https://*) ;;
	*)
		printf 'CONTROL_PLANE_URL must use HTTPS\n' >&2
		exit 2
		;;
esac

case "$JOB_ID" in
	''|*[!0-9]*)
		printf 'JOB_ID must contain only decimal digits\n' >&2
		exit 2
		;;
esac

if [ "${#WORKER_ID}" -lt 3 ] || [ "${#WORKER_ID}" -gt 100 ]; then
	printf 'WORKER_ID must contain between 3 and 100 characters\n' >&2
	exit 2
fi

OUTPUT_PATH="$1"
TEMP_PATH="${OUTPUT_PATH}.tmp"
trap 'rm -f "$TEMP_PATH"' EXIT
mkdir -p "$(dirname "$OUTPUT_PATH")"

curl --proto '=https' --tlsv1.2 --fail-with-body --silent --show-error \
	--connect-timeout 10 --max-time 30 --max-filesize 65536 \
	-H 'content-type: application/json' \
	-H "x-basehalf-plugin-release-token: $RELEASE_TOKEN" \
	--data "$(jq -nc --arg worker "$WORKER_ID" '{worker_id:$worker}')" \
	"${CONTROL_PLANE_URL%/}/plugin-service/api/v1/internal/releases/${JOB_ID}/renew" \
	> "$TEMP_PATH"

jq -e '
	.code == "00000"
	and (.data.lease_expires_at | type == "string")
	and (.data.lease_expires_at | sub("\\.[0-9]{3}Z$"; "Z") | fromdateiso8601 > now)
' "$TEMP_PATH" > /dev/null

mv "$TEMP_PATH" "$OUTPUT_PATH"
