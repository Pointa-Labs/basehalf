#!/usr/bin/env bash

set -euo pipefail

resolve_key() {
	local key_id="$1"
	local trusted="${BASEHALF_CATALOG_TRUSTED_KMS_KEYS_JSON:-}"
	if [ -n "$trusted" ]; then
		jq -er --arg key "$key_id" '
			type == "object"
			and all(to_entries[]; (.key | type == "string" and length > 0) and (.value | type == "string" and length > 0))
			and has($key)
			| select(.)
			| . as $valid
			| $trusted[$key]
		' --argjson trusted "$trusted" <<< "$trusted"
		return
	fi
	if [ "$key_id" != "${BASEHALF_CATALOG_SIGNING_KEY_ID:-}" ] || [ -z "${BASEHALF_CATALOG_SIGNING_KMS_KEY_ID:-}" ]; then
		echo "Catalog signature key '$key_id' is not trusted." >&2
		return 1
	fi
	printf '%s\n' "$BASEHALF_CATALOG_SIGNING_KMS_KEY_ID"
}

assert_key_is_usable() {
	local key_id="$1"
	local metadata
	metadata="$(aws kms describe-key --key-id "$key_id" --output json)"
	if ! jq -e '
		.KeyMetadata
		| .Enabled == true
		and .KeyState == "Enabled"
		and .KeyUsage == "SIGN_VERIFY"
		and (.KeySpec // .CustomerMasterKeySpec) == "ECC_NIST_P256"
	' <<< "$metadata" > /dev/null; then
		echo "Catalog KMS key '$key_id' must be enabled and use SIGN_VERIFY with ECC_NIST_P256." >&2
		return 1
	fi
}

preflight_keys() {
	local trusted="${BASEHALF_CATALOG_TRUSTED_KMS_KEYS_JSON:-}"
	local current_key_id="${BASEHALF_CATALOG_SIGNING_KEY_ID:-}"
	local current_kms_key_id="${BASEHALF_CATALOG_SIGNING_KMS_KEY_ID:-}"
	local mapped_current_key
	local key_id

	test -n "$trusted"
	test -n "$current_key_id"
	test -n "$current_kms_key_id"
	jq -e '
		type == "object"
		and length > 0
		and all(to_entries[];
			(.key | type == "string" and length > 0)
			and (.value | type == "string" and length > 0))
	' <<< "$trusted" > /dev/null
	mapped_current_key="$(resolve_key "$current_key_id")"
	if [ "$mapped_current_key" != "$current_kms_key_id" ]; then
		echo "The trusted KMS mapping for '$current_key_id' does not match the current signer." >&2
		return 1
	fi

	while IFS= read -r -d '' key_id; do
		assert_key_is_usable "$key_id"
	done < <(jq -j 'to_entries | sort_by(.key) | .[] | .value, "\u0000"' <<< "$trusted")
}

verify_catalog() {
	local catalog_path="$1"
	local signature_path="$2"
	local key_id
	local kms_key_id
	local temporary
	local status

	test "$(jq -r .algorithm "$signature_path")" = ECDSA_P256_SHA256_DER
	key_id="$(jq -er '.keyId | select(type == "string" and length > 0)' "$signature_path")"
	kms_key_id="$(resolve_key "$key_id")"
	temporary="$(mktemp -d)"
	jq -er '.signature | select(type == "string" and length > 0)' "$signature_path" | base64 --decode > "$temporary/signature.der"
	openssl dgst -sha256 -binary "$catalog_path" > "$temporary/catalog.sha256"
	if aws kms verify \
		--key-id "$kms_key_id" \
		--message-type DIGEST \
		--signing-algorithm ECDSA_SHA_256 \
		--message "fileb://$temporary/catalog.sha256" \
		--signature "fileb://$temporary/signature.der" \
		--query SignatureValid --output text | grep -qx True; then
		status=0
	else
		status=$?
	fi
	rm -rf "$temporary"
	return "$status"
}

verify_current_catalog() {
	local catalog_path="$1"
	local signature_path="$2"
	local signature_key_id
	local trusted_kms_key_id

	test -n "${BASEHALF_CATALOG_TRUSTED_KMS_KEYS_JSON:-}"
	test -n "${BASEHALF_CATALOG_SIGNING_KEY_ID:-}"
	test -n "${BASEHALF_CATALOG_SIGNING_KMS_KEY_ID:-}"
	signature_key_id="$(jq -er '.keyId | select(type == "string" and length > 0)' "$signature_path")"
	if [ "$signature_key_id" != "$BASEHALF_CATALOG_SIGNING_KEY_ID" ]; then
		echo "Generated catalog signature key '$signature_key_id' does not match the current signing key '$BASEHALF_CATALOG_SIGNING_KEY_ID'." >&2
		return 1
	fi
	trusted_kms_key_id="$(resolve_key "$signature_key_id")"
	if [ "$trusted_kms_key_id" != "$BASEHALF_CATALOG_SIGNING_KMS_KEY_ID" ]; then
		echo "The trusted KMS mapping for '$signature_key_id' does not match the current signer." >&2
		return 1
	fi
	verify_catalog "$catalog_path" "$signature_path"
}

verify_trusted_catalog() {
	test -n "${BASEHALF_CATALOG_TRUSTED_KMS_KEYS_JSON:-}"
	verify_catalog "$1" "$2"
}

case "${1:-}" in
	preflight)
		test "$#" -eq 1
		preflight_keys
		;;
	resolve)
		test "$#" -eq 2
		resolve_key "$2"
		;;
	verify)
		test "$#" -eq 3
		verify_catalog "$2" "$3"
		;;
	verify-current)
		test "$#" -eq 3
		verify_current_catalog "$2" "$3"
		;;
	verify-trusted)
		test "$#" -eq 3
		verify_trusted_catalog "$2" "$3"
		;;
	*)
		echo 'Usage: basehalf-catalog-kms.sh preflight | resolve <key-id> | verify <catalog> <signature> | verify-current <catalog> <signature> | verify-trusted <catalog> <signature>' >&2
		exit 2
		;;
esac
