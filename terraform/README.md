# Optional AWS infrastructure

> **Warning: `terraform apply` creates AWS resources that incur charges.** This configuration creates an EKS cluster, EC2 managed nodes, a VPC and subnets, and a NAT gateway. A single NAT gateway limits (but does not eliminate) networking cost. Review the AWS pricing for your selected region and instance type before applying.

This configuration creates a VPC across two Availability Zones, with private subnets for EKS control-plane ENIs and managed worker nodes, public subnets for outbound NAT, a single NAT gateway, and one EKS managed node group.

## Prerequisites

- Terraform 1.5 or newer
- AWS CLI credentials with permissions to create and manage the required VPC, IAM, EKS, and EC2 resources
- An AWS region with two available Availability Zones

Credentials must be supplied by the normal AWS credential chain or environment. Do not put access keys, account IDs, or passwords in Terraform files or variable files.

## Plan, apply, and destroy

Run these commands from this directory. Copy the example variable file and adjust the region and Kubernetes version for your environment:

```powershell
Copy-Item terraform.tfvars.example terraform.tfvars
terraform init
terraform fmt -check
terraform validate
terraform plan -out tfplan
terraform apply tfplan
```

Applying creates paid AWS resources. Review the plan carefully before applying. Destroy only when you have confirmed the resources and data can be removed:

```powershell
terraform destroy
```

The `terraform.tfvars` file, Terraform state, and saved plans can contain sensitive infrastructure metadata; do not commit them. The repository ignores Terraform state files.

Terraform was not installed in the authoring environment, so `terraform fmt`, `terraform init`, `terraform validate`, `terraform plan`, and `terraform apply` have not been run for this project.
