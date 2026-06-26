# inspect_xlsx.ps1
# Pure PowerShell parser for xlsx files to extract sheets and preview rows.

$filePath = "C:\Users\mk.muhammad.fadhil\.gemini\antigravity\scratch\pipeline-visualizer\12 inch HA to M2, 2.071 km FR Pipetally Rev.0.xlsx"
$tempDir = "C:\Users\mk.muhammad.fadhil\.gemini\antigravity\scratch\pipeline-visualizer\temp_unzip"

if (Test-Path $tempDir) { Remove-Item -Recurse -Force $tempDir }
New-Item -ItemType Directory -Path $tempDir

# Copy xlsx to zip and extract
$zipPath = "$tempDir\temp.zip"
Copy-Item $filePath $zipPath
Expand-Archive -Path $zipPath -DestinationPath $tempDir

# Read workbook.xml to get sheet names
$workbookPath = "$tempDir\xl\workbook.xml"
if (Test-Path $workbookPath) {
    [xml]$wb = Get-Content $workbookPath
    Write-Host "--- Sheets ---"
    $wb.workbook.sheets.sheet | ForEach-Object { Write-Host "Sheet Name: $($_.name)" }
}

# Read sharedStrings.xml
$sharedStringsPath = "$tempDir\xl\sharedStrings.xml"
$sharedStrings = @()
if (Test-Path $sharedStringsPath) {
    [xml]$ssXml = Get-Content $sharedStringsPath
    $ns = New-Object Xml.XmlNamespaceManager($ssXml.NameTable)
    $ns.AddNamespace("ns", "http://schemas.openxmlformats.org/spreadsheetml/2006/main")
    
    # Extract string texts (some might be nested in <si><r><t> structure, but basic <t> holds it)
    $ssXml.SelectNodes("//ns:si", $ns) | ForEach-Object {
        # Try direct ns:t text
        $tNode = $_.SelectSingleNode("ns:t", $ns)
        if ($tNode) {
            $sharedStrings += $tNode.InnerText
        } else {
            # Try nested runs <r><t>
            $rNodes = $_.SelectNodes("ns:r/ns:t", $ns)
            if ($rNodes.Count -gt 0) {
                $combined = ""
                foreach ($r in $rNodes) { $combined += $r.InnerText }
                $sharedStrings += $combined
            } else {
                $sharedStrings += ""
            }
        }
    }
}

Write-Host "Shared strings count: $($sharedStrings.Length)"

$sheet1Path = "$tempDir\xl\worksheets\sheet1.xml"
if (Test-Path $sheet1Path) {
    [xml]$sheetXml = Get-Content $sheet1Path
    $ns = New-Object Xml.XmlNamespaceManager($sheetXml.NameTable)
    $ns.AddNamespace("ns", "http://schemas.openxmlformats.org/spreadsheetml/2006/main")
    
    # Read rows
    $rows = $sheetXml.SelectNodes("//ns:row", $ns)
    Write-Host "--- Rows count: $($rows.Count) ---"
    Write-Host "--- First 25 Rows ---"
    
    $rowLimit = [Math]::Min($rows.Count, 25)
    for ($i = 0; $i -lt $rowLimit; $i++) {
        $row = $rows[$i]
        $cells = $row.SelectNodes("ns:c", $ns)
        $rowData = @()
        foreach ($c in $cells) {
            $val = ""
            if ($c.v) {
                $val = $c.v.InnerText
                # If cell type is 's' (shared string), look it up
                if ($c.t -eq "s") {
                    $idx = [int]$val
                    if ($idx -lt $sharedStrings.Length) {
                        $val = $sharedStrings[$idx]
                    }
                }
            }
            $rowData += $val
        }
        Write-Host "Row $($row.r): $($rowData -join ' | ')"
    }
}

# Clean up
Remove-Item -Recurse -Force $tempDir
