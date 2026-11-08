$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)

if (-not (Get-Command flutter -ErrorAction SilentlyContinue)) {
  throw 'Flutter SDK is not installed or not on PATH. Install Flutter stable and Android Studio/Android SDK.'
}

flutter --version
flutter doctor -v
if (-not (Test-Path 'android/app/src/main/AndroidManifest.xml')) {
  flutter create --platforms=android --org com.darb --project-name darb_gps .
}

$manifestPath = 'android/app/src/main/AndroidManifest.xml'
[xml]$manifest = Get-Content $manifestPath
$root = $manifest.DocumentElement
$required = @(
  'android.permission.INTERNET',
  'android.permission.ACCESS_COARSE_LOCATION',
  'android.permission.ACCESS_FINE_LOCATION',
  'android.permission.FOREGROUND_SERVICE',
  'android.permission.FOREGROUND_SERVICE_LOCATION'
)
foreach ($permission in $required) {
  $found = $false
  foreach ($node in $root.SelectNodes('uses-permission')) {
    if ($node.GetAttribute('name', 'http://schemas.android.com/apk/res/android') -eq $permission) { $found = $true }
  }
  if (-not $found) {
    $node = $manifest.CreateElement('uses-permission')
    $attr = $manifest.CreateAttribute('android', 'name', 'http://schemas.android.com/apk/res/android')
    $attr.Value = $permission
    [void]$node.Attributes.Append($attr)
    [void]$root.InsertBefore($node, $root.SelectSingleNode('application'))
  }
}
$manifest.Save((Resolve-Path $manifestPath))

flutter pub get
flutter analyze
flutter test
flutter build apk --release
$apk = Join-Path (Get-Location) 'build/app/outputs/flutter-apk/app-release.apk'
if (-not (Test-Path $apk)) { throw "APK not found: $apk" }
Get-FileHash $apk -Algorithm SHA256
Write-Host "APK created: $apk"
