provider "aws" {
  region = var.aws_region
}

data "aws_caller_identity" "current" {}

resource "aws_s3_bucket" "plugins" {
  bucket = var.bucket_name
}

resource "aws_s3_bucket_public_access_block" "plugins" {
  bucket                  = aws_s3_bucket.plugins.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "plugins" {
  bucket = aws_s3_bucket.plugins.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_versioning" "plugins" {
  bucket = aws_s3_bucket.plugins.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "plugins" {
  bucket = aws_s3_bucket.plugins.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# Submission artifacts are untrusted until validation and review complete.
# This bucket is intentionally not a CloudFront origin and has a short
# retention policy. The web control plane can access only this bucket; it has
# no access to the public distribution bucket or the catalog signing key.
resource "aws_s3_bucket" "submissions" {
  bucket = var.submission_bucket_name
}

resource "aws_s3_bucket_public_access_block" "submissions" {
  bucket                  = aws_s3_bucket.submissions.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "submissions" {
  bucket = aws_s3_bucket.submissions.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_versioning" "submissions" {
  bucket = aws_s3_bucket.submissions.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "submissions" {
  bucket = aws_s3_bucket.submissions.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "submissions" {
  bucket = aws_s3_bucket.submissions.id
  rule {
    id     = "expire-quarantined-artifacts"
    status = "Enabled"
    filter {}
    expiration {
      days = var.submission_retention_days
    }
    noncurrent_version_expiration {
      noncurrent_days = var.submission_retention_days
    }
    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }
}

resource "aws_s3_bucket_cors_configuration" "submissions" {
  bucket = aws_s3_bucket.submissions.id
  cors_rule {
    allowed_headers = ["content-type", "x-amz-content-sha256", "x-amz-meta-sha256", "x-amz-meta-submission"]
    allowed_methods = ["PUT"]
    allowed_origins = var.submission_allowed_origins
    expose_headers  = ["ETag"]
    max_age_seconds = 300
  }
}

resource "aws_kms_key" "catalog" {
  description              = "BaseHalf plugin catalog signing"
  key_usage                = "SIGN_VERIFY"
  customer_master_key_spec = "ECC_NIST_P256"
  enable_key_rotation      = false
  deletion_window_in_days  = 30

  lifecycle {
    prevent_destroy = true
  }
}

locals {
  catalog_signing_key_arn = coalesce(var.current_catalog_signing_key_arn, aws_kms_key.catalog.arn)
  catalog_verification_key_arns = distinct(concat(
    [local.catalog_signing_key_arn, aws_kms_key.catalog.arn],
    var.trusted_catalog_verification_key_arns
  ))
  externally_managed_catalog_key_arns = toset(concat(
    var.current_catalog_signing_key_arn == null ? [] : [var.current_catalog_signing_key_arn],
    var.trusted_catalog_verification_key_arns
  ))
}

data "aws_kms_key" "externally_managed_catalog" {
  for_each = local.externally_managed_catalog_key_arns
  key_id   = each.value
}

check "externally_managed_catalog_keys_are_usable" {
  assert {
    condition = alltrue([
      for key in data.aws_kms_key.externally_managed_catalog :
      key.enabled &&
      key.key_state == "Enabled" &&
      key.key_usage == "SIGN_VERIFY" &&
      key.key_spec == "ECC_NIST_P256"
    ])
    error_message = "Every current or trusted external catalog KMS key must be Enabled and use SIGN_VERIFY with ECC_NIST_P256."
  }
}

resource "aws_kms_alias" "catalog" {
  name          = "alias/basehalf-plugin-catalog"
  target_key_id = local.catalog_signing_key_arn
}

resource "aws_cloudfront_origin_access_control" "plugins" {
  name                              = "basehalf-plugins"
  description                       = "Private S3 access for BaseHalf plugin distribution"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_cache_policy" "catalog" {
  name        = "basehalf-plugin-catalog-short"
  default_ttl = 60
  min_ttl     = 0
  max_ttl     = 300
  parameters_in_cache_key_and_forwarded_to_origin {
    enable_accept_encoding_brotli = true
    enable_accept_encoding_gzip   = true
    cookies_config {
      cookie_behavior = "none"
    }
    headers_config {
      header_behavior = "none"
    }
    query_strings_config {
      query_string_behavior = "none"
    }
  }
}

resource "aws_cloudfront_cache_policy" "immutable" {
  name        = "basehalf-plugin-assets-immutable"
  default_ttl = 31536000
  min_ttl     = 31536000
  max_ttl     = 31536000
  parameters_in_cache_key_and_forwarded_to_origin {
    enable_accept_encoding_brotli = true
    enable_accept_encoding_gzip   = true
    cookies_config {
      cookie_behavior = "none"
    }
    headers_config {
      header_behavior = "none"
    }
    query_strings_config {
      query_string_behavior = "none"
    }
  }
}

data "aws_cloudfront_response_headers_policy" "public_registry" {
  name = "Managed-CORS-with-preflight-and-SecurityHeadersPolicy"
}

resource "aws_cloudfront_distribution" "plugins" {
  enabled         = true
  is_ipv6_enabled = true
  aliases         = concat([var.domain_name], var.legacy_domain_names)
  price_class     = "PriceClass_200"

  origin {
    domain_name              = aws_s3_bucket.plugins.bucket_regional_domain_name
    origin_id                = "basehalf-plugins-s3"
    origin_access_control_id = aws_cloudfront_origin_access_control.plugins.id
  }

  default_cache_behavior {
    target_origin_id           = "basehalf-plugins-s3"
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD", "OPTIONS"]
    cached_methods             = ["GET", "HEAD", "OPTIONS"]
    cache_policy_id            = aws_cloudfront_cache_policy.catalog.id
    response_headers_policy_id = data.aws_cloudfront_response_headers_policy.public_registry.id
    compress                   = true
  }

  ordered_cache_behavior {
    path_pattern               = "*.vsix"
    target_origin_id           = "basehalf-plugins-s3"
    viewer_protocol_policy     = "https-only"
    allowed_methods            = ["GET", "HEAD", "OPTIONS"]
    cached_methods             = ["GET", "HEAD", "OPTIONS"]
    cache_policy_id            = aws_cloudfront_cache_policy.immutable.id
    response_headers_policy_id = data.aws_cloudfront_response_headers_policy.public_registry.id
    compress                   = false
  }

  ordered_cache_behavior {
    path_pattern               = "catalogs/*"
    target_origin_id           = "basehalf-plugins-s3"
    viewer_protocol_policy     = "https-only"
    allowed_methods            = ["GET", "HEAD", "OPTIONS"]
    cached_methods             = ["GET", "HEAD", "OPTIONS"]
    cache_policy_id            = aws_cloudfront_cache_policy.immutable.id
    response_headers_policy_id = data.aws_cloudfront_response_headers_policy.public_registry.id
    compress                   = true
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }
  viewer_certificate {
    acm_certificate_arn      = var.acm_certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }
}

data "aws_iam_policy_document" "bucket" {
  statement {
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.plugins.arn}/*"]
    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.plugins.arn]
    }
  }
}

resource "aws_s3_bucket_policy" "plugins" {
  bucket = aws_s3_bucket.plugins.id
  policy = data.aws_iam_policy_document.bucket.json
}

data "aws_iam_policy_document" "github_assume" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [var.github_oidc_provider_arn]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:${var.github_repository}:environment:plugins-production"]
    }
  }
}

resource "aws_iam_role" "publisher" {
  name               = "basehalf-plugin-publisher"
  assume_role_policy = data.aws_iam_policy_document.github_assume.json
}

data "aws_iam_policy_document" "publisher" {
  statement {
    actions   = ["s3:GetObject", "s3:PutObject"]
    resources = ["${aws_s3_bucket.plugins.arn}/*"]
  }
  statement {
    actions   = ["s3:ListBucket", "s3:ListBucketVersions"]
    resources = [aws_s3_bucket.plugins.arn]
  }
  statement {
    actions   = ["kms:Sign"]
    resources = [local.catalog_signing_key_arn]
  }
  statement {
    actions   = ["kms:DescribeKey", "kms:GetPublicKey", "kms:Verify"]
    resources = local.catalog_verification_key_arns
  }
  statement {
    actions   = ["cloudfront:CreateInvalidation"]
    resources = [aws_cloudfront_distribution.plugins.arn]
  }
}

resource "aws_iam_role_policy" "publisher" {
  role   = aws_iam_role.publisher.id
  policy = data.aws_iam_policy_document.publisher.json
}

data "aws_iam_policy_document" "control_plane_submissions" {
  statement {
    actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
    resources = ["${aws_s3_bucket.submissions.arn}/*"]
  }
  statement {
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.submissions.arn]
  }
}

resource "aws_iam_role_policy" "control_plane_submissions" {
  count  = var.control_plane_role_name == null ? 0 : 1
  name   = "basehalf-plugin-submission-quarantine"
  role   = var.control_plane_role_name
  policy = data.aws_iam_policy_document.control_plane_submissions.json
}

resource "aws_route53_record" "plugins_a" {
  count   = var.route53_hosted_zone_id == null ? 0 : 1
  zone_id = var.route53_hosted_zone_id
  name    = var.domain_name
  type    = "A"
  alias {
    name                   = aws_cloudfront_distribution.plugins.domain_name
    zone_id                = aws_cloudfront_distribution.plugins.hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "plugins_aaaa" {
  count   = var.route53_hosted_zone_id == null ? 0 : 1
  zone_id = var.route53_hosted_zone_id
  name    = var.domain_name
  type    = "AAAA"
  alias {
    name                   = aws_cloudfront_distribution.plugins.domain_name
    zone_id                = aws_cloudfront_distribution.plugins.hosted_zone_id
    evaluate_target_health = false
  }
}
