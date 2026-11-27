# Starts the Sales Intelligence dashboard and the Automation Hub
$env:Path = [Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [Environment]::GetEnvironmentVariable("Path","User")

$sales = Join-Path $PSScriptRoot "projects\sales-intelligence\app"
$app = "Phase18_Dashboard\phase18_dashboard.py"

if (Test-Path (Join-Path $sales $app)) {
    Start-Process py -WorkingDirectory $sales -ArgumentList "-m","streamlit","run",$app,"--server.address","127.0.0.1","--server.port","8501","--server.headless","true"
} else {
    Write-Warning "Sales dashboard not found in $sales"
}

Set-Location $PSScriptRoot
Write-Host "Hub:   http://127.0.0.1:8080"
Write-Host "Sales: http://localhost:8501"
go run ./cmd/hub serve
