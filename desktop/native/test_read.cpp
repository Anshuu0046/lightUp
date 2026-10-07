// test_read: opens "Light Up Camera" like any app would and saves one frame to frame.bmp
#include <windows.h>
#include <mfapi.h>
#include <mfidl.h>
#include <mfreadwrite.h>
#include <mferror.h>
#include <cstdio>
#include <cwchar>
#include <vector>

int main() {
    CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    MFStartup(MF_VERSION);
    IMFAttributes* attr = nullptr; MFCreateAttributes(&attr, 1);
    attr->SetGUID(MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE, MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE_VIDCAP_GUID);
    IMFActivate** devs = nullptr; UINT32 n = 0;
    MFEnumDeviceSources(attr, &devs, &n);
    IMFActivate* pick = nullptr;
    for (UINT32 i = 0; i < n; i++) {
        WCHAR* name = nullptr; UINT32 len = 0;
        devs[i]->GetAllocatedString(MF_DEVSOURCE_ATTRIBUTE_FRIENDLY_NAME, &name, &len);
        wprintf(L"device: %s\n", name);
        if (name && wcsstr(name, L"Light Up")) pick = devs[i];
    }
    if (!pick) { puts("Light Up Camera not found"); return 1; }
    IMFMediaSource* src = nullptr;
    HRESULT hr = pick->ActivateObject(IID_PPV_ARGS(&src));
    if (FAILED(hr)) { printf("ActivateObject failed 0x%08lx\n", hr); return 1; }
    IMFAttributes* ra = nullptr; MFCreateAttributes(&ra, 1);
    ra->SetUINT32(MF_SOURCE_READER_ENABLE_VIDEO_PROCESSING, TRUE);
    IMFSourceReader* rd = nullptr;
    hr = MFCreateSourceReaderFromMediaSource(src, ra, &rd);
    if (FAILED(hr)) { printf("reader failed 0x%08lx\n", hr); return 1; }
    IMFMediaType* mt = nullptr; MFCreateMediaType(&mt);
    mt->SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Video); mt->SetGUID(MF_MT_SUBTYPE, MFVideoFormat_RGB32);
    hr = rd->SetCurrentMediaType((DWORD)MF_SOURCE_READER_FIRST_VIDEO_STREAM, nullptr, mt);
    if (FAILED(hr)) { printf("set type failed 0x%08lx\n", hr); return 1; }
    IMFMediaType* cur = nullptr; rd->GetCurrentMediaType((DWORD)MF_SOURCE_READER_FIRST_VIDEO_STREAM, &cur);
    UINT32 w = 0, h = 0; MFGetAttributeSize(cur, MF_MT_FRAME_SIZE, &w, &h);
    printf("size %ux%u\n", w, h);
    IMFSample* last = nullptr; int got = 0;
    for (int i = 0; i < 90 && got < 45; i++) {
        DWORD flags = 0; IMFSample* s = nullptr;
        hr = rd->ReadSample((DWORD)MF_SOURCE_READER_FIRST_VIDEO_STREAM, 0, nullptr, &flags, nullptr, &s);
        if (FAILED(hr)) { printf("ReadSample failed 0x%08lx\n", hr); break; }
        if (s) { if (last) last->Release(); last = s; got++; }
    }
    printf("frames read: %d\n", got);
    if (!last) return 1;
    IMFMediaBuffer* buf = nullptr; last->ConvertToContiguousBuffer(&buf);
    BYTE* p = nullptr; DWORD max = 0, curLen = 0; buf->Lock(&p, &max, &curLen);
    BITMAPFILEHEADER fh = { 0x4D42, (DWORD)(sizeof(fh) + sizeof(BITMAPINFOHEADER) + w * h * 4), 0, 0, sizeof(fh) + sizeof(BITMAPINFOHEADER) };
    BITMAPINFOHEADER ih = { sizeof(ih), (LONG)w, -(LONG)h, 1, 32, BI_RGB, w * h * 4, 0, 0, 0, 0 };
    FILE* f = fopen("frame.bmp", "wb"); fwrite(&fh, sizeof(fh), 1, f); fwrite(&ih, sizeof(ih), 1, f); fwrite(p, 1, w * h * 4, f); fclose(f);
    puts("saved frame.bmp");
    buf->Unlock();
    src->Shutdown();
    return 0;
}
