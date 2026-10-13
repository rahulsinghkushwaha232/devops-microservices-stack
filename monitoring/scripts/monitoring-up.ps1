$ErrorActionPreference = 'Stop'

foreach ($commandName in @('helm', 'kubectl')) {
    if (-not (Get-Command $commandName -ErrorAction SilentlyContinue)) {
        throw "Required command '$commandName' was not found in PATH."
    }
}

$scriptDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$monitoringDirectory = Split-Path -Parent $scriptDirectory
$repositoryRoot = Split-Path -Parent $monitoringDirectory
$valuesFile = Join-Path $monitoringDirectory 'values-kube-prometheus-stack.yaml'

& kubectl create namespace monitoring --dry-run=client -o yaml | & kubectl apply -f -
if ($LASTEXITCODE -ne 0) {
    throw 'Failed to create the monitoring namespace.'
}

& helm repo add prometheus-community https://prometheus-community.github.io/helm-charts --force-update
if ($LASTEXITCODE -ne 0) {
    throw 'Failed to add the Prometheus Community Helm repository.'
}
& helm repo update prometheus-community
if ($LASTEXITCODE -ne 0) {
    throw 'Failed to update the Prometheus Community Helm repository.'
}
& helm upgrade --install kube-prometheus-stack prometheus-community/kube-prometheus-stack `
    --namespace monitoring `
    --values $valuesFile `
    --wait `
    --timeout 10m
if ($LASTEXITCODE -ne 0) {
    throw 'Failed to install kube-prometheus-stack.'
}

foreach ($manifest in @(
    'app-servicemonitor.yaml',
    'user-service-servicemonitor.yaml',
    'order-service-servicemonitor.yaml',
    'prometheus-rules.yaml',
    'grafana-dashboard.yaml'
)) {
    & kubectl apply -f (Join-Path $monitoringDirectory $manifest)
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to apply monitoring manifest '$manifest'."
    }
}

Write-Output 'Monitoring stack is installed in namespace monitoring.'
Write-Output 'Run: kubectl port-forward -n monitoring svc/kube-prometheus-stack-grafana 3000:80'
