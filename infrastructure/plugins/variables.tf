variable "aws_region" {
  type = string
}

variable "bucket_name" {
  type = string
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
