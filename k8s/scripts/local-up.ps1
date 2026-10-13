$ErrorActionPreference = 'Stop'

$requiredCommands = @('docker', 'kind', 'kubectl', 'helm')
foreach ($commandName in $requiredCommands) {
    if (-not (Get-Command $commandName -ErrorAction SilentlyContinue)) {
        throw "Required command '$commandName' was not found in PATH."
    }
}

& docker info *> $null
if ($LASTEXITCODE -ne 0) {
    throw 'Docker is not running or is unavailable.'
}

$scriptDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$k8sDirectory = Split-Path -Parent $scriptDirectory
$repositoryRoot = Split-Path -Parent $k8sDirectory
$clusterName = 'devops-demo'
$namespace = 'devops-demo'
$images = @(
    @{ Name = 'ghcr.io/rahulsinghkushwaha232/devops-app:local'; Context = (Join-Path $repositoryRoot 'app') },
    @{ Name = 'ghcr.io/rahulsinghkushwaha232/devops-user-service:local'; Context = (Join-Path $repositoryRoot 'services\user-service') },
    @{ Name = 'ghcr.io/rahulsinghkushwaha232/devops-order-service:local'; Context = (Join-Path $repositoryRoot 'services\order-service') }
)

$clusters = @(& kind get clusters)
if ($LASTEXITCODE -ne 0) {
    throw 'Unable to list kind clusters.'
}
if ($clusters -notcontains $clusterName) {
    & kind create cluster --name $clusterName --config (Join-Path $k8sDirectory 'kind-config.yaml')
    if ($LASTEXITCODE -ne 0) {
        throw 'Failed to create the kind cluster.'
    }
}

& kubectl cluster-info --context "kind-$clusterName" *> $null
if ($LASTEXITCODE -ne 0) {
    throw "The kind cluster '$clusterName' is not reachable."
}

& helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx --force-update
if ($LASTEXITCODE -ne 0) {
    throw 'Failed to add the ingress-nginx Helm repository.'
}
& helm repo add metrics-server https://kubernetes-sigs.github.io/metrics-server/ --force-update
if ($LASTEXITCODE -ne 0) {
    throw 'Failed to add the metrics-server Helm repository.'
}
& helm repo update
if ($LASTEXITCODE -ne 0) {
    throw 'Failed to update Helm repositories.'
}
& helm upgrade --install ingress-nginx ingress-nginx/ingress-nginx `
    --namespace ingress-nginx --create-namespace `
    --set controller.hostPort.enabled=true `
    --set controller.service.type=NodePort `
    --set controller.publishService.enabled=false `
    --set-string controller.nodeSelector.ingress-ready=true `
    --set 'controller.tolerations[0].key=node-role.kubernetes.io/control-plane' `
    --set 'controller.tolerations[0].operator=Exists' `
    --set 'controller.tolerations[0].effect=NoSchedule' `
    --wait --timeout 5m
if ($LASTEXITCODE -ne 0) {
    throw 'Failed to install ingress-nginx.'
}
& helm upgrade --install metrics-server metrics-server/metrics-server `
    --namespace kube-system `
    --set 'args[0]=--kubelet-insecure-tls' `
    --wait --timeout 5m
if ($LASTEXITCODE -ne 0) {
    throw 'Failed to install metrics-server.'
}

foreach ($image in $images) {
    & docker build --tag $image.Name $image.Context
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to build image '$($image.Name)'."
    }
    & kind load docker-image $image.Name --name $clusterName
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to load image '$($image.Name)' into kind."
    }
}

& kubectl apply -f (Join-Path $k8sDirectory 'namespace.yaml')
if ($LASTEXITCODE -ne 0) {
    throw 'Failed to create the application namespace.'
}

$mongoUsername = $env:MONGO_ROOT_USERNAME
$mongoPassword = $env:MONGO_ROOT_PASSWORD
$existingSecret = & kubectl get secret mongo-credentials --namespace $namespace --ignore-not-found -o name
if ($LASTEXITCODE -ne 0) {
    throw 'Unable to check for an existing MongoDB credentials Secret.'
}
if ($existingSecret) {
    if (-not $mongoUsername) {
        $encodedUsername = & kubectl get secret mongo-credentials --namespace $namespace -o 'jsonpath={.data.MONGO_ROOT_USERNAME}'
        if ($LASTEXITCODE -ne 0) {
            throw 'Unable to read the existing MongoDB username Secret.'
        }
        $mongoUsername = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([string]$encodedUsername))
    }
    if (-not $mongoPassword) {
        $encodedPassword = & kubectl get secret mongo-credentials --namespace $namespace -o 'jsonpath={.data.MONGO_ROOT_PASSWORD}'
        if ($LASTEXITCODE -ne 0) {
            throw 'Unable to read the existing MongoDB password Secret.'
        }
        $mongoPassword = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([string]$encodedPassword))
    }
}
if (-not $mongoUsername) {
    $mongoUsername = 'devops'
}
if (-not $mongoPassword) {
    $randomBytes = New-Object byte[] 24
    $randomGenerator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $randomGenerator.GetBytes($randomBytes)
    } finally {
        $randomGenerator.Dispose()
    }
    $mongoPassword = -join ($randomBytes | ForEach-Object { $_.ToString('x2') })
    Write-Output "Generated MONGO_ROOT_PASSWORD for this local cluster: $mongoPassword"
}

$secretYaml = & kubectl create secret generic mongo-credentials `
    --namespace $namespace `
    --from-literal="MONGO_ROOT_USERNAME=$mongoUsername" `
    --from-literal="MONGO_ROOT_PASSWORD=$mongoPassword" `
    --dry-run=client -o yaml
if ($LASTEXITCODE -ne 0) {
    throw 'Failed to generate the MongoDB credentials Secret.'
}
$secretYaml | & kubectl apply -f -
if ($LASTEXITCODE -ne 0) {
    throw 'Failed to create the MongoDB credentials Secret.'
}

$rendered = & kubectl kustomize $k8sDirectory
if ($LASTEXITCODE -ne 0) {
    throw 'Failed to render Kubernetes manifests with Kustomize.'
}
$rendered = $rendered -replace '(ghcr\.io/rahulsinghkushwaha232/devops-(?:app|user-service|order-service))(?::[^\s]+)?', '$1:local'
$rendered | & kubectl apply -f -
if ($LASTEXITCODE -ne 0) {
    throw 'Failed to apply the Kubernetes manifests.'
}

& kubectl rollout status deployment/mongo --namespace $namespace --timeout=5m
if ($LASTEXITCODE -ne 0) {
    throw 'MongoDB did not become ready.'
}
foreach ($deployment in @('user-service', 'order-service', 'app')) {
    & kubectl rollout status "deployment/$deployment" --namespace $namespace --timeout=5m
    if ($LASTEXITCODE -ne 0) {
        throw "Deployment '$deployment' did not become ready."
    }
}

Write-Output 'Local DevOps demo is ready at http://localhost'
