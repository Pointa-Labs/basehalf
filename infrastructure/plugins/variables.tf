variable "aws_region" {
  type = string
}

variable "bucket_name" {
  type = string
}

variable "submission_bucket_name" {
  description = "Private quarantine bucket for community VSIX uploads. Must differ from bucket_name."
  type        = string
  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$", var.submission_bucket_name))
    error_message = "submission_bucket_name must be a 3-63 character lowercase DNS bucket name using letters, digits, and hyphens only."
  }
}

variable "submission_retention_days" {
  description = "Days to retain quarantined submission artifacts and non-current versions."
  type        = number
  default     = 30
  validation {
    condition     = var.submission_retention_days >= 7 && var.submission_retention_days <= 180
    error_message = "submission_retention_days must be between 7 and 180."
  }
}

variable "submission_allowed_origins" {
  description = "Browser origins allowed to upload with Core API presigned PUT URLs."
  type        = list(string)
  default     = ["https://plugins.basehalf.com", "https://basehalf.com", "http://localhost:4100"]
}

variable "control_plane_role_name" {
  description = "Optional existing EC2/ECS IAM role used by Core API. It receives quarantine-only S3 access."
  type        = string
  default     = null
  nullable    = true
}

variable "domain_name" {
  type    = string
  default = "registry.basehalf.com"
}

variable "legacy_domain_names" {
  description = "Former registry hostnames retained on CloudFront during client migration."
  type        = list(string)
  default     = ["plugins.basehalf.com"]
}

variable "acm_certificate_arn" {
  description = "ACM certificate in us-east-1 valid for domain_name and legacy_domain_names."
  type        = string
}

variable "route53_hosted_zone_id" {
  description = "Optional Route53 zone; omit to manage DNS elsewhere."
  type        = string
  default     = null
  nullable    = true
}

variable "github_oidc_provider_arn" {
  description = "Existing GitHub Actions OIDC provider ARN in this AWS account."
  type        = string
}

variable "github_repository" {
  type    = string
  default = "Pointa-Labs/basehalf"
}

variable "current_catalog_signing_key_arn" {
  description = "Optional externally managed current ECC P-256 signing key ARN. When omitted, the module-managed retained key is current."
  type        = string
  default     = null
  nullable    = true
  validation {
    condition     = var.current_catalog_signing_key_arn == null || can(regex("^arn:(aws|aws-us-gov|aws-cn):kms:[^:]+:[0-9]{12}:key/[0-9A-Fa-f-]+$", var.current_catalog_signing_key_arn))
    error_message = "current_catalog_signing_key_arn must be a KMS key ARN, not an alias ARN or bare key ID."
  }
}

variable "trusted_catalog_verification_key_arns" {
  description = "Retained old ECC signing key ARNs that the publisher may use only for Verify and GetPublicKey during rotation and recovery."
  type        = list(string)
  default     = []
  validation {
    condition = length(var.trusted_catalog_verification_key_arns) == length(distinct(var.trusted_catalog_verification_key_arns)) && alltrue([
      for arn in var.trusted_catalog_verification_key_arns : can(regex("^arn:(aws|aws-us-gov|aws-cn):kms:[^:]+:[0-9]{12}:key/[0-9A-Fa-f-]+$", arn))
    ])
    error_message = "trusted_catalog_verification_key_arns must contain unique KMS key ARNs."
  }
}
