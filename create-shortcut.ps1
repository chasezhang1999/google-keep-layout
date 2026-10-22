# 在桌面和开始菜单建「Keep 窄窗」快捷方式：用 chrome --app 打开 Keep。
# 这种窗口不算「已安装的应用」，没有 Chrome 给已安装应用定死的 500 最小宽度，能拖到约 180。
# 油猴脚本 0.4.0 起会记住这个窗口的大小和位置；地址里的 #kc-narrow 是给脚本认窗口用的。
# 快捷方式写上和窗口相同的任务栏身份，固定到任务栏后图标和窗口是同一个。
# 用法：powershell -ExecutionPolicy Bypass -File create-shortcut.ps1 [-ChromeProfile Default]
param([string]$ChromeProfile = 'Default')
$ErrorActionPreference = 'Stop'

$appPaths = 'SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe'
$chrome = (Get-ItemProperty "HKLM:\$appPaths" -ErrorAction SilentlyContinue).'(default)'
if (-not $chrome) { $chrome = (Get-ItemProperty "HKCU:\$appPaths" -ErrorAction SilentlyContinue).'(default)' }
if (-not $chrome -or -not (Test-Path $chrome)) { throw '找不到 chrome.exe' }

# 图标借已安装的 Keep 应用的，复制一份到脚本旁边，以后卸掉那个应用也不丢
$bundled = Join-Path $PSScriptRoot 'keep.ico'
if (-not (Test-Path $bundled)) {
  $apps = "$env:LOCALAPPDATA\Google\Chrome\User Data\$ChromeProfile\Web Applications"
  $source = Get-ChildItem $apps -Recurse -Filter 'Google Keep.ico' -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($source) { Copy-Item $source.FullName $bundled }
}
# 快捷方式用的那份再复制到 %USERPROFILE%\.google-keep-layout。下面两处都试过，都显示成一张白纸：
# - D:\Code：ASUS 上被沙箱加了规则（低完整性标签等），里面新建的文件都继承，Windows 不从这种文件给快捷方式取图标；
# - %LOCALAPPDATA%：在 Claude / Codex 会话里跑这个脚本时，新建到这里的文件会被 MSIX 容器转存，资源管理器看不见。
$icon = Join-Path $env:USERPROFILE '.google-keep-layout\keep.ico'
if ((Test-Path $bundled) -and -not (Test-Path $icon)) {
  New-Item -ItemType Directory -Force (Split-Path $icon) | Out-Null
  Copy-Item $bundled $icon
}
$iconLocation = if (Test-Path $icon) { "$icon,0" } else { "$chrome,0" }

# 任务栏按「应用身份」（AppUserModelID）把快捷方式和窗口对上。Chrome 给 --app 窗口的身份是
# Chrome.<主机>_<路径>（# 后面不算），快捷方式不写同一个，固定到任务栏后点它会另起一个图标。
# Default 以外的资料，Chrome 还会在身份后面加资料名，没验证过，先不写。
$appId = if ($ChromeProfile -eq 'Default') { 'Chrome.keep.google.com_/' }
if ($appId) {
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;

public static class KeepShortcut {
  [StructLayout(LayoutKind.Sequential, Pack = 4)]
  public struct PropertyKey { public Guid fmtid; public uint pid; }
  [StructLayout(LayoutKind.Explicit, Size = 24)]
  public struct PropVariant { [FieldOffset(0)] public ushort vt; [FieldOffset(8)] public IntPtr p; }
  [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IPropertyStore {
    [PreserveSig] int GetCount(out uint c);
    [PreserveSig] int GetAt(uint i, out PropertyKey k);
    [PreserveSig] int GetValue(ref PropertyKey k, out PropVariant v);
    [PreserveSig] int SetValue(ref PropertyKey k, ref PropVariant v);
    [PreserveSig] int Commit();
  }
  [ComImport, Guid("00021401-0000-0000-C000-000000000046")]
  public class ShellLink { }

  // 写快捷方式的 System.AppUserModel.ID
  public static void SetAppId(string path, string id) {
    object link = new ShellLink();
    ((IPersistFile)link).Load(path, 2);
    PropertyKey key = new PropertyKey { fmtid = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"), pid = 5 };
    PropVariant value = new PropVariant { vt = 31, p = Marshal.StringToCoTaskMemUni(id) };
    IPropertyStore store = (IPropertyStore)link;
    int hr = store.SetValue(ref key, ref value);   // 值没变时返回 S_FALSE(1)，也算成功
    Marshal.FreeCoTaskMem(value.p);
    if (hr >= 0) hr = store.Commit();
    if (hr < 0) Marshal.ThrowExceptionForHR(hr);
    ((IPersistFile)link).Save(path, true);
    Marshal.ReleaseComObject(link);
  }
}
'@
}

$shell = New-Object -ComObject WScript.Shell
foreach ($folder in [Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs')) {
  $path = Join-Path $folder 'Keep 窄窗.lnk'
  $link = $shell.CreateShortcut($path)
  $link.TargetPath = $chrome
  $link.Arguments = "--profile-directory=$ChromeProfile --app=https://keep.google.com/#kc-narrow"
  $link.WorkingDirectory = Split-Path $chrome
  $link.IconLocation = $iconLocation
  $link.Description = 'Google Keep 窄窗口（能拖到很窄）'
  $link.Save()
  if ($appId) { [KeepShortcut]::SetAppId($path, $appId) }
  "已创建：$path"
}
