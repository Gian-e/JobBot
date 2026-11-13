#!/usr/bin/env pwsh
if ((Test-Path "C:\Program Files\nodejs") -and ($env:Path -notlike "*C:\Program Files\nodejs*")) {
    $env:Path += ";C:\Program Files\nodejs"
}
Set-Location -Path $PSScriptRoot
node dev.js
