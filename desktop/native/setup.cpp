// lightup_setup install | remove   (needs an elevated prompt)
// Registers the Light Up Camera media source and creates the system-wide virtual camera.
#include <windows.h>
#include <mfapi.h>
#include <mfidl.h>
#include <mfvirtualcamera.h>
#include <shlobj.h>
#include <string>
#include <cstdio>
#include "shared.h"

static std::wstring InstallDir() {
    wchar_t pf[MAX_PATH]; SHGetFolderPathW(nullptr, CSIDL_PROGRAM_FILES, nullptr, 0, pf);
    return std::wstring(pf) + L"\\Light Up Camera";
}

static HRESULT CreateCamera(IMFVirtualCamera** cam) {
    return MFCreateVirtualCamera(MFVirtualCameraType_SoftwareCameraSource, MFVirtualCameraLifetime_System, MFVirtualCameraAccess_AllUsers,
        LU_CAMERA_NAME, LU_CLSID_STRING, nullptr, 0, cam);
}

int wmain(int argc, wchar_t** argv) {
    if (argc < 2) { puts("usage: lightup_setup install|remove"); return 2; }
    const std::wstring cmd = argv[1];
    CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    HRESULT hr = MFStartup(MF_VERSION);
    if (FAILED(hr)) { printf("MFStartup failed 0x%08lx\n", hr); return 1; }

    wchar_t self[MAX_PATH]; GetModuleFileNameW(nullptr, self, MAX_PATH);
    std::wstring from = self; from = from.substr(0, from.find_last_of(L'\\'));
    const std::wstring dir = InstallDir(), dll = dir + L"\\lightup_vcam.dll";

    if (cmd == L"install") {
        CreateDirectoryW(dir.c_str(), nullptr);
        if (!CopyFileW((from + L"\\lightup_vcam.dll").c_str(), dll.c_str(), FALSE)) { printf("copy failed %lu\n", GetLastError()); return 1; }
        HMODULE m = LoadLibraryW(dll.c_str());
        auto reg = m ? (HRESULT(STDAPICALLTYPE*)())GetProcAddress(m, "DllRegisterServer") : nullptr;
        if (!reg || FAILED(hr = reg())) { printf("register failed 0x%08lx (run as administrator)\n", hr); return 1; }
        IMFVirtualCamera* cam = nullptr;
        if (FAILED(hr = CreateCamera(&cam))) { printf("MFCreateVirtualCamera failed 0x%08lx\n", hr); return 1; }
        if (FAILED(hr = cam->Start(nullptr))) { printf("Start failed 0x%08lx\n", hr); return 1; }
        cam->Release();
        puts("Light Up Camera installed.");
    } else if (cmd == L"remove") {
        IMFVirtualCamera* cam = nullptr;
        if (SUCCEEDED(CreateCamera(&cam))) { cam->Remove(); cam->Release(); }
        HMODULE m = LoadLibraryW(dll.c_str());
        auto unreg = m ? (HRESULT(STDAPICALLTYPE*)())GetProcAddress(m, "DllUnregisterServer") : nullptr;
        if (unreg) unreg();
        if (m) FreeLibrary(m);
        DeleteFileW(dll.c_str()); RemoveDirectoryW(dir.c_str());
        puts("Light Up Camera removed.");
    } else return 2;
    MFShutdown();
    return 0;
}
