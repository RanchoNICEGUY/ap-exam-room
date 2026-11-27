#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
app="../AP 模考室.app"
portable="../AP-Exam-Room-Portable"
stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT

python3 build.py "$stage/index.html"
swiftc -O App.swift History.swift -o "$stage/APExamRoom" -framework AppKit -framework WebKit -framework PDFKit -lsqlite3
swiftc -O pdf_helper.swift -o "$stage/pdf_helper" -framework PDFKit -framework AppKit

mkdir -p "$app/Contents/Resources/Assets/icons" "$app/Contents/Resources/Assets/fonts" "$app/Contents/Resources/Assets/pdfjs/cmaps" "$app/Contents/Resources/Data" "$app/Contents/MacOS"
cp "$stage/index.html" "JSON Import Format.md" "manifest.json" "dev_server.py" "$app/Contents/Resources/"
cp "$stage/APExamRoom" "$app/Contents/MacOS/"
cp "$stage/pdf_helper" "./pdf_helper"
cp "$stage/pdf_helper" "$app/Contents/Resources/pdf_helper"
cp Icon/AppIcon.icns "$app/Contents/Resources/"
cp Assets/*.svg Assets/*.wav Assets/*.js Assets/*.css Assets/*.png "$app/Contents/Resources/Assets/"
cp Assets/icons/*.svg "$app/Contents/Resources/Assets/icons/" 2>/dev/null || true
cp Assets/fonts/*.woff2 "$app/Contents/Resources/Assets/fonts/" 2>/dev/null || true
if [ -d Assets/pdfjs ]; then
  rm -rf "$app/Contents/Resources/Assets/pdfjs"
  cp -R Assets/pdfjs "$app/Contents/Resources/Assets/pdfjs"
fi
rm -rf "$app/Contents/Resources/Data"
cp -R Data "$app/Contents/Resources/Data"
cp Info.plist "$app/Contents/"
codesign --force --sign - "$app"
codesign --verify --deep --strict "$app"

# Sync Portable bundle as well
mkdir -p "$portable/Assets/icons" "$portable/Assets/fonts"
python3 build.py "$portable/index.html"
cp Assets/*.svg Assets/*.wav Assets/*.js Assets/*.css Assets/*.png "$portable/Assets/"
cp Assets/icons/*.svg "$portable/Assets/icons/" 2>/dev/null || true
cp Assets/fonts/*.woff2 "$portable/Assets/fonts/" 2>/dev/null || true
if [ -d Assets/pdfjs ]; then
  rm -rf "$portable/Assets/pdfjs"
  cp -R Assets/pdfjs "$portable/Assets/pdfjs"
fi
rm -rf "$portable/Data"
cp -R Data "$portable/Data"
cp "JSON Import Format.md" manifest.json dev_server.py pdf_helper "Start AP Exam Room.command" "$portable/"
if [ -d win ]; then
  cp win/APExamRoom-Server.ps1 win/Start-APExamRoom.bat win/设置题库PDF路径.bat win/Windows使用说明.txt "$portable/"
fi
chmod +x "$portable/Start AP Exam Room.command" "Start AP Exam Room.command"

# Build Zero-Dependency Windows standalone ZIP
winzip="../AP-Exam-Room-Windows-ZeroDep.zip"
winstage="$stage/AP-Exam-Room-Windows"
mkdir -p "$winstage/Assets/icons" "$winstage/Assets/fonts"
cp "$portable/index.html" "$portable/JSON Import Format.md" "$portable/manifest.json" "$winstage/"
cp Assets/*.svg Assets/*.wav Assets/*.js Assets/*.css Assets/*.png "$winstage/Assets/"
cp Assets/icons/*.svg "$winstage/Assets/icons/" 2>/dev/null || true
cp Assets/fonts/*.woff2 "$winstage/Assets/fonts/" 2>/dev/null || true
if [ -d Assets/pdfjs ]; then
  cp -R Assets/pdfjs "$winstage/Assets/pdfjs"
fi
cp -R Data "$winstage/Data"
if [ -d win ]; then
  cp win/APExamRoom-Server.ps1 win/Start-APExamRoom.bat win/设置题库PDF路径.bat win/Windows使用说明.txt "$winstage/"
fi
find "$winstage" -name ".DS_Store" -delete
rm -f "$winzip"
python3 - "$winstage" "$winzip" <<'PY'
import sys, unicodedata, zipfile
from pathlib import Path
src = Path(sys.argv[1])
out = Path(sys.argv[2])
with zipfile.ZipFile(out, "w", compression=zipfile.ZIP_DEFLATED) as zf:
    for p in sorted(src.rglob("*")):
        if p.is_file():
            arc = unicodedata.normalize("NFC", f"AP-Exam-Room-Windows/{p.relative_to(src).as_posix()}")
            zf.write(p, arc)
PY
echo "BUILD_AND_SYNC_OK"
