param (
    [Parameter(Mandatory=$true)][string]$SourceDir,
    [Parameter(Mandatory=$true)][string]$ZipFile
)

Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.IO.Compression

if (Test-Path $ZipFile) {
    Remove-Item $ZipFile -Force
}

$zip = [System.IO.Compression.ZipFile]::Open($ZipFile, [System.IO.Compression.ZipArchiveMode]::Create)
$sourcePath = (Resolve-Path $SourceDir).Path

Get-ChildItem -Path $sourcePath -Recurse -File | ForEach-Object {
    $relPath = $_.FullName.Substring($sourcePath.Length + 1).Replace("\", "/")
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $_.FullName, $relPath, [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
}

$zip.Dispose()
