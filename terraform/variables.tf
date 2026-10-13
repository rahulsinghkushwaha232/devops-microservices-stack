variable "name" {
  description = "Name prefix used for the EKS cluster and VPC."
  type        = string
  default     = "devops-demo"
}

variable "aws_region" {
  description = "AWS region with at least two available Availability Zones."
  type        = string
}

variable "kubernetes_version" {
  description = "Supported Kubernetes version for the EKS control plane."
  type        = string
}

variable "vpc_cidr" {
  description = "CIDR block for the VPC."
  type        = string
  default     = "10.40.0.0/16"
}

variable "private_subnet_cidrs" {
  description = "CIDR blocks for private EKS node subnets, one per Availability Zone."
  type        = list(string)
  default     = ["10.40.1.0/24", "10.40.2.0/24"]
}

variable "public_subnet_cidrs" {
  description = "CIDR blocks for public NAT gateway subnets, one per Availability Zone."
  type        = list(string)
  default     = ["10.40.101.0/24", "10.40.102.0/24"]
}

variable "database_subnet_cidrs" {
  description = "CIDR blocks reserved for database subnets."
  type        = list(string)
  default     = ["10.40.201.0/24", "10.40.202.0/24"]
}

variable "node_instance_type" {
  description = "EC2 instance type for the managed node group."
  type        = string
  default     = "t3.small"
}

variable "node_min_size" {
  description = "Minimum node count for the managed node group."
  type        = number
  default     = 1
}

variable "node_max_size" {
  description = "Maximum node count for the managed node group."
  type        = number
  default     = 2
}

variable "node_desired_size" {
  description = "Initial node count for the managed node group."
  type        = number
  default     = 1
}

variable "tags" {
  description = "Tags to apply to created AWS resources."
  type        = map(string)
  default = {
    Project   = "devops-demo"
    ManagedBy = "Terraform"
  }
}
