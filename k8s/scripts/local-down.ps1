$ErrorActionPreference = 'Stop'

if (-not (Get-Command kind -ErrorAction SilentlyContinue)) {
    throw "Required command 'kind' was not found in PATH."
}

& kind delete cluster --name devops-demo
if ($LASTEXITCODE -ne 0) {
    throw "Failed to delete kind cluster 'devops-demo'."
}
