$ErrorActionPreference = 'Stop'

if (-not (Get-Command helm -ErrorAction SilentlyContinue)) {
    throw "Required command 'helm' was not found in PATH."
}
if (-not (Get-Command kubectl -ErrorAction SilentlyContinue)) {
    throw "Required command 'kubectl' was not found in PATH."
}

$scriptDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$monitoringDirectory = Split-Path -Parent $scriptDirectory

foreach ($manifest in @(
    'app-servicemonitor.yaml',
    'user-service-servicemonitor.yaml',
    'order-service-servicemonitor.yaml',
    'prometheus-rules.yaml',
    'grafana-dashboard.yaml'
)) {
    & kubectl delete -f (Join-Path $monitoringDirectory $manifest) --ignore-not-found
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to delete monitoring manifest '$manifest'."
    }
}

& helm uninstall kube-prometheus-stack --namespace monitoring
if ($LASTEXITCODE -ne 0) {
    throw 'Failed to uninstall kube-prometheus-stack.'
}

& kubectl delete namespace monitoring --wait=true
if ($LASTEXITCODE -ne 0) {
    throw 'Failed to delete the monitoring namespace.'
}
