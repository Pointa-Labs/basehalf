variable "aws_region" {
  type = string
}

variable "bucket_name" {
  type = string
}

variable "submission_bucket_name" {
  description = "Private quarantine bucket for community VSIX uploads. Must differ from bucket_name."
  type        = string
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
  default     = ["https://basehalf.com", "http://localhost:4000"]
}

variable "control_plane_role_name" {
  description = "Optional existing EC2/ECS IAM role used by Core API. It receives quarantine-only S3 access."
  type        = string
  default     = null
  nullable    = true
}

variable "domain_name" {
  type    = string
  default = "plugins.basehalf.com"
}

variable "acm_certificate_arn" {
  description = "ACM certificate in us-east-1 valid for domain_name."
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
