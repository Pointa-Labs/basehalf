output "bucket_name" { value = aws_s3_bucket.plugins.id }
output "cloudfront_distribution_id" { value = aws_cloudfront_distribution.plugins.id }
output "cloudfront_domain_name" { value = aws_cloudfront_distribution.plugins.domain_name }
output "catalog_kms_key_id" { value = aws_kms_key.catalog.key_id }
output "catalog_kms_key_arn" { value = aws_kms_key.catalog.arn }
output "github_publisher_role_arn" { value = aws_iam_role.publisher.arn }
