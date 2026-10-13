# DevOps Demo

**Author:** [Rahul Singh Kushwaha](https://github.com/rahulsinghkushwaha232)

A small Node.js demo stack for managing users and orders. An Express gateway serves a web UI and forwards API requests to separate user and order services. Both services use MongoDB, and an order records the name of its existing user.

## Architecture

```text
Developer push to main
        |
        v
GitHub Actions
  |-- test app, user-service, order-service
  |-- validate Kubernetes manifests
  |-- build images --> Trivy scan --> GHCR (commit SHA and latest)
                                      |
                                      v
                              Kubernetes (kind / EKS)
                                NGINX Ingress
                                      |
                                     app
                                   /     \
                          user-service  order-service
                                \         /
                                  MongoDB
                                     |
                                   PVC
```

Pull requests run tests, manifest validation, image builds, and vulnerability scans. Images are published to GHCR only by pushes to `main` after tests and scans pass. EKS deployment is a separate, manually dispatched workflow and is disabled unless explicitly enabled.

## Technology stack

| Technology | Use |
| --- | --- |
| Node.js 20 | JavaScript runtime |
| Express | Gateway, user API, and order API |
| Mongoose | MongoDB models and connection |
| MongoDB | User and order data in separate databases |
| Docker | Multi-stage application images and local Compose stack |
| Kubernetes | Deployments, Services, storage, scaling, ingress, and network policies |
| kind | Local Kubernetes cluster |
| Prometheus | Optional Kubernetes metrics collection and alert evaluation |
| Grafana | Optional dashboards for application requests and pod resources |
| GitHub Actions | Tests, manifest validation, image delivery, optional deployment |
| Trivy | Container vulnerability scanning |
| NGINX Ingress | HTTP entry point into Kubernetes |
| GHCR | Container image registry |
| Terraform | Optional AWS VPC and EKS infrastructure definition |

## Project structure

```text
.
├── .github/
│   └── workflows/
│       ├── ci-cd.yml
│       └── deploy.yml
├── app/
│   ├── public/
│   │   ├── index.html
│   │   ├── script.js
│   │   └── style.css
│   ├── tests/
│   │   └── index.test.js
│   ├── .dockerignore
│   ├── Dockerfile
│   ├── index.js
│   ├── package.json
│   ├── package-lock.json
│   └── test.js
├── services/
│   ├── order-service/
│   │   ├── tests/index.test.js
│   │   ├── .dockerignore
│   │   ├── Dockerfile
│   │   ├── index.js
│   │   ├── package.json
│   │   └── package-lock.json
│   └── user-service/
│       ├── tests/index.test.js
│       ├── .dockerignore
│       ├── Dockerfile
│       ├── index.js
│       ├── package.json
│       └── package-lock.json
├── k8s/
│   ├── secrets/secrets.example.yaml
│   ├── scripts/
│   │   ├── local-down.ps1
│   │   └── local-up.ps1
│   ├── app-deployment.yaml
│   ├── app-service.yaml
│   ├── configmap.yaml
│   ├── hpa.yaml
│   ├── ingress.yaml
│   ├── kind-config.yaml
│   ├── kustomization.yaml
│   ├── mongo-deployment.yaml
│   ├── mongo-pvc.yaml
│   ├── mongo-service.yaml
│   ├── namespace.yaml
│   ├── networkpolicy.yaml
│   ├── order-deployment.yaml
│   ├── order-service.yaml
│   ├── user-deployment.yaml
│   └── user-service.yaml
├── monitoring/
│   ├── scripts/
│   │   ├── monitoring-down.ps1
│   │   └── monitoring-up.ps1
│   ├── app-servicemonitor.yaml
│   ├── grafana-dashboard.yaml
│   ├── order-service-servicemonitor.yaml
│   ├── prometheus-rules.yaml
│   ├── user-service-servicemonitor.yaml
│   └── values-kube-prometheus-stack.yaml
├── terraform/
│   ├── main.tf
│   ├── outputs.tf
│   ├── terraform.tfvars.example
│   ├── variables.tf
│   ├── versions.tf
│   └── README.md
├── .env.example
├── .gitignore
├── README.md
└── docker-compose.yml
```

## Prerequisites

- Node.js 20 and npm
- Docker with Compose
- For the local cluster: kind, kubectl, Helm, and a running Docker daemon
- For CI: GitHub Actions access and permission to publish packages to GHCR
- For optional EKS deployment: an EKS cluster, an AWS IAM role configured for GitHub OIDC, and GitHub repository configuration described below

## Run with Docker Compose

From the repository root in PowerShell:

```powershell
Copy-Item .env.example .env
```

Set local MongoDB credentials in `.env`, then start the stack:

```powershell
docker compose up --build
```

Open `http://localhost:3000`. The app exposes the web UI and gateway; the user and order services and MongoDB are also available on the ports in `.env`. To stop the stack:

```powershell
docker compose down
```

The Jest suites mock the database and service calls, so they do not require MongoDB or a running sibling service:

```powershell
Set-Location app
npm ci
npm test

Set-Location ..\services\user-service
npm ci
npm test

Set-Location ..\order-service
npm ci
npm test
```

## Run on kind

Ensure Docker, kind, kubectl, and Helm are installed and available in PowerShell's `PATH`. From the repository root:

```powershell
.\k8s\scripts\local-up.ps1
kubectl get pods,svc,ingress,hpa -n devops-demo
```

The script builds and loads the three `:local` images, installs ingress-nginx and metrics-server, creates a MongoDB Secret from `MONGO_ROOT_USERNAME` and `MONGO_ROOT_PASSWORD` environment variables, and deploys the Kustomize resources. If `MONGO_ROOT_PASSWORD` is unset, the script generates and prints one for the local cluster. Open `http://localhost` when the rollouts complete.

Stop and remove the local cluster with:

```powershell
.\k8s\scripts\local-down.ps1
```

The `k8s/secrets/secrets.example.yaml` file contains placeholders only and is not applied by Kustomize. Never commit a real Secret manifest or `.env` file.

## Monitoring

Monitoring is optional and is installed separately from the application stack. From the repository root, run `.\monitoring\scripts\monitoring-up.ps1` to install kube-prometheus-stack in the `monitoring` namespace and apply ServiceMonitors for the app and both services, alert rules, and a Grafana dashboard. The Helm values request modest resources for a local cluster. The alerts cover elevated 5xx rates, p95 latency, pods that stay not ready, and container restarts.

Forward Grafana to localhost:

```powershell
kubectl port-forward -n monitoring svc/kube-prometheus-stack-grafana 3000:80
```

Open `http://localhost:3000`. The default Grafana username is `admin`; retrieve the chart-generated password from the Kubernetes Secret rather than storing it in a file:

```powershell
$encoded = kubectl get secret kube-prometheus-stack-grafana -n monitoring -o "jsonpath={.data.admin-password}"
[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($encoded))
```

Remove the monitoring resources and namespace with `.\monitoring\scripts\monitoring-down.ps1`. The chart and dashboards have not been installed or runtime-verified in this environment.

## Infrastructure as Code (Terraform, optional)

The optional [Terraform configuration](terraform/README.md) defines an AWS VPC across two Availability Zones, private EKS node subnets, one NAT gateway, and one managed node group. Review its paid-resource warning, copy `terraform/terraform.tfvars.example` to `terraform/terraform.tfvars`, and follow the documented `terraform init`, `plan`, `apply`, and `destroy` commands only when you intend to create or remove AWS resources. No Terraform apply was run. Terraform is not installed in the verification environment, so formatting, initialization, and validation were not run.

## CI/CD pipeline

The [CI workflow](.github/workflows/ci-cd.yml) runs on pushes and pull requests targeting `main`:

1. Test the app, user service, and order service independently on Node.js 20 using `npm ci` and `npm test`.
2. Render Kubernetes manifests with `kubectl kustomize` and validate them with kubeconform.
3. Build each container image, report HIGH Trivy findings, save scan reports as artifacts, and fail on fixable CRITICAL findings.
4. On pushes to `main` only, publish scanned images to GHCR with both the commit SHA and `latest` tags.

Concurrency cancels superseded runs for the same ref. Registry write permission is limited to the publish job.

## Optional cluster deployment

The [deploy workflow](.github/workflows/deploy.yml) is manually dispatched and runs the EKS deployment job only when the repository variable `ENABLE_CLUSTER_DEPLOY` is exactly `true`. Configure:

- Repository secret `AWS_ROLE_ARN`: the IAM role ARN trusted for GitHub Actions OIDC.
- Repository variable `AWS_REGION`: the AWS region for the cluster.
- Repository variable `EKS_CLUSTER_NAME`: the EKS cluster name.
- Repository variable `ENABLE_CLUSTER_DEPLOY`: set to `true` to enable deployments.

Provision the `mongo-credentials` Kubernetes Secret in the target cluster through your approved secret-management process before deploying. The workflow accepts an `image_tag` input (default `latest`), updates kubeconfig through OIDC credentials, applies Kustomize with the requested image tag, waits for all four deployments, checks the app health endpoint, and attempts rollout undo on failure. Its summary reports whether deployment succeeded, failed, or was disabled.

## Security

- Trivy is a CI gate for fixable CRITICAL image vulnerabilities and prints HIGH findings; scan reports are uploaded as workflow artifacts.
- Secrets belong in local ignored `.env` files or Kubernetes Secrets created from environment variables. Do not put real credentials in source, manifests, or commits.
- Application containers run as non-root with privilege escalation disabled and Linux capabilities dropped.
- Kubernetes NetworkPolicies restrict service traffic to the app, user service, order service, and MongoDB paths declared in the manifests. The default kind CNI does not enforce NetworkPolicies.
- GitHub Actions uses per-job permissions; GHCR write permission is granted only to the image-publish job, and EKS deployment uses OIDC rather than long-lived AWS keys.

## Results

Measured locally during this session:

- **30 Jest tests passed:** app 7, user service 9, order service 14.
- **Jest command wall time:** app 11.66 s, user service 14.33 s, order service 13.94 s. The three commands ran concurrently.
- **Local Docker image builds** (using the existing build cache):

  | Image | Reported image size | Build command elapsed |
  | --- | ---: | ---: |
  | `ghcr.io/rahulsinghkushwaha232/devops-app:local` | 50,462,462 bytes (48.1 MiB) | 6.59 s |
  | `ghcr.io/rahulsinghkushwaha232/devops-user-service:local` | 52,789,649 bytes (50.3 MiB) | 2.72 s |
  | `ghcr.io/rahulsinghkushwaha232/devops-order-service:local` | 52,789,877 bytes (50.3 MiB) | 2.04 s |
