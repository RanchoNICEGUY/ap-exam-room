@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -STA -Command "Add-Type -AssemblyName System.Windows.Forms; $dlg = New-Object System.Windows.Forms.FolderBrowserDialog; $dlg.Description = 'Select your AP Vault root folder (AP Content Learning)'; if ($dlg.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [System.IO.File]::WriteAllText('%~dp0vault_path.txt', $dlg.SelectedPath, (New-Object System.Text.UTF8Encoding($false))); Write-Host ('Saved vault path: ' + $dlg.SelectedPath) -ForegroundColor Green } else { Write-Host 'Cancelled.' }"
pause
