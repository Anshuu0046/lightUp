// Light Up virtual camera: a Media Foundation media source loaded by the Windows Frame Server.
#include <windows.h>
#include <initguid.h>
#include <mfapi.h>
#include <mfidl.h>
#include <mfobjects.h>
#include <mferror.h>
#include <mfvirtualcamera.h>
#include <ks.h>
#include <ksmedia.h>
#include <ksproxy.h>
#include <sddl.h>
#include <atomic>
#include <chrono>
#include <mutex>
#include <thread>
#include <vector>
#include <cstring>
#include "shared.h"

static std::atomic<long> g_objects{0};
static HMODULE g_module;

// ---- IMFAttributes forwarding (the Frame Server reads attributes straight off our objects) ----
template <class I>
class AttrBaseT : public I {
public:
    AttrBaseT() { MFCreateAttributes(&m_a, 8); }
    virtual ~AttrBaseT() { if (m_a) m_a->Release(); }
    STDMETHODIMP GetItem(REFGUID k, PROPVARIANT* v) override { return m_a->GetItem(k, v); }
    STDMETHODIMP GetItemType(REFGUID k, MF_ATTRIBUTE_TYPE* t) override { return m_a->GetItemType(k, t); }
    STDMETHODIMP CompareItem(REFGUID k, REFPROPVARIANT v, BOOL* r) override { return m_a->CompareItem(k, v, r); }
    STDMETHODIMP Compare(IMFAttributes* o, MF_ATTRIBUTES_MATCH_TYPE t, BOOL* r) override { return m_a->Compare(o, t, r); }
    STDMETHODIMP GetUINT32(REFGUID k, UINT32* v) override { return m_a->GetUINT32(k, v); }
    STDMETHODIMP GetUINT64(REFGUID k, UINT64* v) override { return m_a->GetUINT64(k, v); }
    STDMETHODIMP GetDouble(REFGUID k, double* v) override { return m_a->GetDouble(k, v); }
    STDMETHODIMP GetGUID(REFGUID k, GUID* v) override { return m_a->GetGUID(k, v); }
    STDMETHODIMP GetStringLength(REFGUID k, UINT32* n) override { return m_a->GetStringLength(k, n); }
    STDMETHODIMP GetString(REFGUID k, LPWSTR s, UINT32 n, UINT32* l) override { return m_a->GetString(k, s, n, l); }
    STDMETHODIMP GetAllocatedString(REFGUID k, LPWSTR* s, UINT32* l) override { return m_a->GetAllocatedString(k, s, l); }
    STDMETHODIMP GetBlobSize(REFGUID k, UINT32* n) override { return m_a->GetBlobSize(k, n); }
    STDMETHODIMP GetBlob(REFGUID k, UINT8* b, UINT32 n, UINT32* l) override { return m_a->GetBlob(k, b, n, l); }
    STDMETHODIMP GetAllocatedBlob(REFGUID k, UINT8** b, UINT32* n) override { return m_a->GetAllocatedBlob(k, b, n); }
    STDMETHODIMP GetUnknown(REFGUID k, REFIID i, LPVOID* o) override { return m_a->GetUnknown(k, i, o); }
    STDMETHODIMP SetItem(REFGUID k, REFPROPVARIANT v) override { return m_a->SetItem(k, v); }
    STDMETHODIMP DeleteItem(REFGUID k) override { return m_a->DeleteItem(k); }
    STDMETHODIMP DeleteAllItems() override { return m_a->DeleteAllItems(); }
    STDMETHODIMP SetUINT32(REFGUID k, UINT32 v) override { return m_a->SetUINT32(k, v); }
    STDMETHODIMP SetUINT64(REFGUID k, UINT64 v) override { return m_a->SetUINT64(k, v); }
    STDMETHODIMP SetDouble(REFGUID k, double v) override { return m_a->SetDouble(k, v); }
    STDMETHODIMP SetGUID(REFGUID k, REFGUID v) override { return m_a->SetGUID(k, v); }
    STDMETHODIMP SetString(REFGUID k, LPCWSTR v) override { return m_a->SetString(k, v); }
    STDMETHODIMP SetBlob(REFGUID k, const UINT8* b, UINT32 n) override { return m_a->SetBlob(k, b, n); }
    STDMETHODIMP SetUnknown(REFGUID k, IUnknown* u) override { return m_a->SetUnknown(k, u); }
    STDMETHODIMP LockStore() override { return m_a->LockStore(); }
    STDMETHODIMP UnlockStore() override { return m_a->UnlockStore(); }
    STDMETHODIMP GetCount(UINT32* n) override { return m_a->GetCount(n); }
    STDMETHODIMP GetItemByIndex(UINT32 i, GUID* k, PROPVARIANT* v) override { return m_a->GetItemByIndex(i, k, v); }
    STDMETHODIMP CopyAllItems(IMFAttributes* d) override { return m_a->CopyAllItems(d); }
protected:
    IMFAttributes* m_a = nullptr;
};

using AttrBase = AttrBaseT<IMFAttributes>;

#define LU_REFCOUNT \
    std::atomic<long> m_ref{1}; \
    STDMETHODIMP_(ULONG) AddRef() override { return ++m_ref; } \
    STDMETHODIMP_(ULONG) Release() override { long r = --m_ref; if (!r) delete this; return r; }

// ---- Shared frame section ----
class FrameSection {
public:
    FrameSection() {
        SECURITY_ATTRIBUTES sa = { sizeof(sa), nullptr, FALSE };
        // everyone, plus app packages, may read and write
        ConvertStringSecurityDescriptorToSecurityDescriptorW(L"D:(A;;GA;;;WD)(A;;GA;;;AC)", SDDL_REVISION_1, &sa.lpSecurityDescriptor, nullptr);
        m_map = CreateFileMappingW(INVALID_HANDLE_VALUE, &sa, PAGE_READWRITE, 0, (DWORD)LU_SHM_SIZE, LU_SHM_NAME);
        if (sa.lpSecurityDescriptor) LocalFree(sa.lpSecurityDescriptor);
        if (m_map) m_view = (LuHeader*)MapViewOfFile(m_map, FILE_MAP_ALL_ACCESS, 0, 0, LU_SHM_SIZE);
        if (m_view && m_view->magic != LU_MAGIC) { m_view->width = LU_WIDTH; m_view->height = LU_HEIGHT; m_view->seq = 0; m_view->magic = LU_MAGIC; }
    }
    ~FrameSection() { if (m_view) UnmapViewOfFile(m_view); if (m_map) CloseHandle(m_map); }
    // BGRA pixels, or null while the app isn't feeding us
    const uint8_t* pixels(LONG* seq) const {
        if (!m_view || m_view->magic != LU_MAGIC || m_view->seq == 0) return nullptr;
        *seq = m_view->seq; return (const uint8_t*)(m_view + 1);
    }
private:
    HANDLE m_map = nullptr; LuHeader* m_view = nullptr;
};

static void BgraToNv12(const uint8_t* src, uint8_t* dst) {
    uint8_t* y = dst; uint8_t* uv = dst + LU_WIDTH * LU_HEIGHT;
    for (int row = 0; row < LU_HEIGHT; row++) {
        const uint8_t* p = src + (size_t)row * LU_WIDTH * 4;
        for (int col = 0; col < LU_WIDTH; col++, p += 4) {
            int b = p[0], g = p[1], r = p[2];
            y[row * LU_WIDTH + col] = (uint8_t)(((66 * r + 129 * g + 25 * b + 128) >> 8) + 16);
            if (!(row & 1) && !(col & 1)) {
                uint8_t* o = uv + (row / 2) * LU_WIDTH + col;
                o[0] = (uint8_t)(((-38 * r - 74 * g + 112 * b + 128) >> 8) + 128);
                o[1] = (uint8_t)(((112 * r - 94 * g - 18 * b + 128) >> 8) + 128);
            }
        }
    }
}

// ---- The one video stream ----
class MediaStream : public AttrBase, public IMFMediaStream2, public IKsControl {
public:
    LU_REFCOUNT
    MediaStream(IMFMediaSource* src) : m_source(src) { src->AddRef(); ++g_objects; }
    ~MediaStream() { Shutdown(); --g_objects; }

    STDMETHODIMP QueryInterface(REFIID riid, void** ppv) override {
        if (!ppv) return E_POINTER; *ppv = nullptr;
        if (riid == IID_IUnknown || riid == IID_IMFMediaEventGenerator || riid == IID_IMFMediaStream || riid == IID_IMFMediaStream2) *ppv = static_cast<IMFMediaStream2*>(this);
        else if (riid == IID_IMFAttributes) *ppv = static_cast<IMFAttributes*>(this);
        else if (riid == __uuidof(IKsControl)) *ppv = static_cast<IKsControl*>(this);
        else return E_NOINTERFACE;
        AddRef(); return S_OK;
    }

    HRESULT Init() {
        HRESULT hr;
        if (FAILED(hr = m_a->SetGUID(MF_DEVICESTREAM_STREAM_CATEGORY, PINNAME_VIDEO_CAPTURE))) return hr;
        m_a->SetUINT32(MF_DEVICESTREAM_STREAM_ID, 0);
        m_a->SetUINT32(MF_DEVICESTREAM_FRAMESERVER_SHARED, 1);
        m_a->SetUINT32(MF_DEVICESTREAM_ATTRIBUTE_FRAMESOURCE_TYPES, MFFrameSourceTypes_Color);
        if (FAILED(hr = MFCreateEventQueue(&m_queue))) return hr;
        IMFMediaType* types[2] = {};
        for (int i = 0; i < 2; i++) {
            const bool nv12 = i == 0;
            MFCreateMediaType(&types[i]);
            types[i]->SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Video);
            types[i]->SetGUID(MF_MT_SUBTYPE, nv12 ? MFVideoFormat_NV12 : MFVideoFormat_RGB32);
            types[i]->SetUINT32(MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive);
            types[i]->SetUINT32(MF_MT_ALL_SAMPLES_INDEPENDENT, TRUE);
            MFSetAttributeSize(types[i], MF_MT_FRAME_SIZE, LU_WIDTH, LU_HEIGHT);
            types[i]->SetUINT32(MF_MT_DEFAULT_STRIDE, nv12 ? LU_WIDTH : LU_WIDTH * 4);
            types[i]->SetUINT32(MF_MT_SAMPLE_SIZE, nv12 ? LU_WIDTH * LU_HEIGHT * 3 / 2 : LU_PIXEL_BYTES);
            MFSetAttributeRatio(types[i], MF_MT_FRAME_RATE, 30, 1);
            MFSetAttributeRatio(types[i], MF_MT_PIXEL_ASPECT_RATIO, 1, 1);
            types[i]->SetUINT32(MF_MT_AVG_BITRATE, (nv12 ? LU_WIDTH * LU_HEIGHT * 12 : LU_WIDTH * LU_HEIGHT * 32) * 30);
        }
        hr = MFCreateStreamDescriptor(0, 2, types, &m_desc);
        if (SUCCEEDED(hr)) { IMFMediaTypeHandler* h = nullptr; if (SUCCEEDED(m_desc->GetMediaTypeHandler(&h))) { h->SetCurrentMediaType(types[0]); h->Release(); } }
        for (auto t : types) if (t) t->Release();
        return hr;
    }

    HRESULT Start(IMFMediaType* type) {
        std::lock_guard<std::mutex> l(m_lock);
        if (!m_queue) return MF_E_SHUTDOWN;
        if (type) { GUID sub; if (SUCCEEDED(type->GetGUID(MF_MT_SUBTYPE, &sub))) m_nv12 = (sub == MFVideoFormat_NV12); }
        if (!m_running) {
            m_running = true; m_state = MF_STREAM_STATE_RUNNING;
            m_thread = std::thread([this] { Pump(); });
        }
        return m_queue->QueueEventParamVar(MEStreamStarted, GUID_NULL, S_OK, nullptr);
    }
    HRESULT Stop() {
        { std::lock_guard<std::mutex> l(m_lock); m_running = false; m_state = MF_STREAM_STATE_STOPPED; }
        if (m_thread.joinable()) m_thread.join();
        std::lock_guard<std::mutex> l(m_lock);
        for (auto t : m_tokens) if (t) t->Release();
        m_tokens.clear();
        return m_queue ? m_queue->QueueEventParamVar(MEStreamStopped, GUID_NULL, S_OK, nullptr) : MF_E_SHUTDOWN;
    }
    void Shutdown() {
        { std::lock_guard<std::mutex> l(m_lock); m_running = false; }
        if (m_thread.joinable()) m_thread.join();
        std::lock_guard<std::mutex> l(m_lock);
        for (auto t : m_tokens) if (t) t->Release();
        m_tokens.clear();
        if (m_queue) { m_queue->Shutdown(); m_queue->Release(); m_queue = nullptr; }
        if (m_desc) { m_desc->Release(); m_desc = nullptr; }
        if (m_source) { m_source->Release(); m_source = nullptr; }
    }
    IMFStreamDescriptor* Descriptor() { return m_desc; }

    // IMFMediaEventGenerator
    STDMETHODIMP BeginGetEvent(IMFAsyncCallback* cb, IUnknown* st) override { return m_queue ? m_queue->BeginGetEvent(cb, st) : MF_E_SHUTDOWN; }
    STDMETHODIMP EndGetEvent(IMFAsyncResult* r, IMFMediaEvent** e) override { return m_queue ? m_queue->EndGetEvent(r, e) : MF_E_SHUTDOWN; }
    STDMETHODIMP GetEvent(DWORD f, IMFMediaEvent** e) override { return m_queue ? m_queue->GetEvent(f, e) : MF_E_SHUTDOWN; }
    STDMETHODIMP QueueEvent(MediaEventType t, REFGUID g, HRESULT hr, const PROPVARIANT* v) override { return m_queue ? m_queue->QueueEventParamVar(t, g, hr, v) : MF_E_SHUTDOWN; }
    // IMFMediaStream
    STDMETHODIMP GetMediaSource(IMFMediaSource** s) override { if (!s) return E_POINTER; if (!m_source) return MF_E_SHUTDOWN; *s = m_source; m_source->AddRef(); return S_OK; }
    STDMETHODIMP GetStreamDescriptor(IMFStreamDescriptor** d) override { if (!d) return E_POINTER; if (!m_desc) return MF_E_SHUTDOWN; *d = m_desc; m_desc->AddRef(); return S_OK; }
    STDMETHODIMP RequestSample(IUnknown* token) override {
        std::lock_guard<std::mutex> l(m_lock);
        if (!m_queue) return MF_E_SHUTDOWN;
        if (token) token->AddRef();
        m_tokens.push_back(token);
        return S_OK;
    }
    // IMFMediaStream2
    STDMETHODIMP SetStreamState(MF_STREAM_STATE v) override {
        if (v == m_state) return S_OK;
        if (v == MF_STREAM_STATE_RUNNING) return Start(nullptr);
        if (v == MF_STREAM_STATE_STOPPED) return Stop();
        if (v == MF_STREAM_STATE_PAUSED && m_state == MF_STREAM_STATE_RUNNING) { m_state = v; return S_OK; }
        return MF_E_INVALID_STATE_TRANSITION;
    }
    STDMETHODIMP GetStreamState(MF_STREAM_STATE* v) override { if (!v) return E_POINTER; *v = m_state; return S_OK; }
    // IKsControl: no camera controls
    STDMETHODIMP_(NTSTATUS) KsProperty(PKSPROPERTY, ULONG, LPVOID, ULONG, ULONG*) override { return HRESULT_FROM_WIN32(ERROR_SET_NOT_FOUND); }
    STDMETHODIMP_(NTSTATUS) KsMethod(PKSMETHOD, ULONG, LPVOID, ULONG, ULONG*) override { return HRESULT_FROM_WIN32(ERROR_SET_NOT_FOUND); }
    STDMETHODIMP_(NTSTATUS) KsEvent(PKSEVENT, ULONG, LPVOID, ULONG, ULONG*) override { return HRESULT_FROM_WIN32(ERROR_SET_NOT_FOUND); }

private:
    void Pump() {
        FrameSection frames;
        std::vector<uint8_t> last((size_t)LU_PIXEL_BYTES, 0); // black until the app sends frames
        for (size_t i = 3; i < last.size(); i += 4) last[i] = 255;
        LONG seen = 0;
        auto next = std::chrono::steady_clock::now();
        while (true) {
            next += std::chrono::milliseconds(33);
            std::this_thread::sleep_until(next);
            IUnknown* token = nullptr; bool have = false;
            {
                std::lock_guard<std::mutex> l(m_lock);
                if (!m_running || !m_queue) return;
                if (!m_tokens.empty()) { token = m_tokens.front(); m_tokens.erase(m_tokens.begin()); have = true; }
            }
            if (!have) continue;
            LONG seq = 0;
            if (const uint8_t* px = frames.pixels(&seq)) { if (seq != seen) { memcpy(last.data(), px, last.size()); seen = seq; } }

            IMFSample* sample = nullptr; IMFMediaBuffer* buf = nullptr;
            const DWORD size = m_nv12 ? LU_WIDTH * LU_HEIGHT * 3 / 2 : LU_PIXEL_BYTES;
            if (SUCCEEDED(MFCreateSample(&sample)) && SUCCEEDED(MFCreateMemoryBuffer(size, &buf))) {
                BYTE* data = nullptr;
                if (SUCCEEDED(buf->Lock(&data, nullptr, nullptr))) {
                    if (m_nv12) BgraToNv12(last.data(), data); else memcpy(data, last.data(), size);
                    buf->Unlock(); buf->SetCurrentLength(size);
                    sample->AddBuffer(buf);
                    sample->SetSampleTime(MFGetSystemTime()); sample->SetSampleDuration(333333);
                    if (token) sample->SetUnknown(MFSampleExtension_Token, token);
                    std::lock_guard<std::mutex> l(m_lock);
                    if (m_queue) m_queue->QueueEventParamUnk(MEMediaSample, GUID_NULL, S_OK, sample);
                }
            }
            if (buf) buf->Release();
            if (sample) sample->Release();
            if (token) token->Release();
        }
    }

    std::mutex m_lock;
    IMFMediaSource* m_source;
    IMFMediaEventQueue* m_queue = nullptr;
    IMFStreamDescriptor* m_desc = nullptr;
    std::vector<IUnknown*> m_tokens;
    std::thread m_thread;
    bool m_running = false, m_nv12 = true;
    MF_STREAM_STATE m_state = MF_STREAM_STATE_STOPPED;
};

// ---- The media source ----
class MediaSource : public AttrBase, public IMFMediaSourceEx, public IMFGetService, public IKsControl, public IMFSampleAllocatorControl {
public:
    LU_REFCOUNT
    MediaSource() { ++g_objects; }
    ~MediaSource() { Shutdown(); --g_objects; }

    STDMETHODIMP QueryInterface(REFIID riid, void** ppv) override {
        if (!ppv) return E_POINTER; *ppv = nullptr;
        if (riid == IID_IUnknown || riid == IID_IMFMediaEventGenerator || riid == IID_IMFMediaSource || riid == IID_IMFMediaSourceEx) *ppv = static_cast<IMFMediaSourceEx*>(this);
        else if (riid == IID_IMFAttributes) *ppv = static_cast<IMFAttributes*>(this);
        else if (riid == __uuidof(IMFGetService)) *ppv = static_cast<IMFGetService*>(this);
        else if (riid == __uuidof(IKsControl)) *ppv = static_cast<IKsControl*>(this);
        else if (riid == __uuidof(IMFSampleAllocatorControl)) *ppv = static_cast<IMFSampleAllocatorControl*>(this);
        else return E_NOINTERFACE;
        AddRef(); return S_OK;
    }

    HRESULT Init(IMFAttributes* from) {
        HRESULT hr;
        if (from) from->CopyAllItems(m_a);
        m_stream = new MediaStream(static_cast<IMFMediaSource*>(static_cast<IMFMediaSourceEx*>(this)));
        if (FAILED(hr = m_stream->Init())) return hr;
        IMFSensorProfileCollection* coll = nullptr; IMFSensorProfile* profile = nullptr;
        if (SUCCEEDED(MFCreateSensorProfileCollection(&coll))) {
            if (SUCCEEDED(MFCreateSensorProfile(KSCAMERAPROFILE_Legacy, 0, nullptr, &profile))) { profile->AddProfileFilter(0, L"((RES==;FRT<=30,1;SUT==))"); coll->AddProfile(profile); profile->Release(); }
            m_a->SetUnknown(MF_DEVICEMFT_SENSORPROFILE_COLLECTION, coll); coll->Release();
        }
        IMFStreamDescriptor* d = m_stream->Descriptor();
        if (FAILED(hr = MFCreatePresentationDescriptor(1, &d, &m_pd))) return hr;
        return MFCreateEventQueue(&m_queue);
    }

    // IMFMediaEventGenerator
    STDMETHODIMP BeginGetEvent(IMFAsyncCallback* cb, IUnknown* st) override { std::lock_guard<std::mutex> l(m_lock); return m_queue ? m_queue->BeginGetEvent(cb, st) : MF_E_SHUTDOWN; }
    STDMETHODIMP EndGetEvent(IMFAsyncResult* r, IMFMediaEvent** e) override { std::lock_guard<std::mutex> l(m_lock); return m_queue ? m_queue->EndGetEvent(r, e) : MF_E_SHUTDOWN; }
    STDMETHODIMP GetEvent(DWORD f, IMFMediaEvent** e) override { std::lock_guard<std::mutex> l(m_lock); return m_queue ? m_queue->GetEvent(f, e) : MF_E_SHUTDOWN; }
    STDMETHODIMP QueueEvent(MediaEventType t, REFGUID g, HRESULT hr, const PROPVARIANT* v) override { std::lock_guard<std::mutex> l(m_lock); return m_queue ? m_queue->QueueEventParamVar(t, g, hr, v) : MF_E_SHUTDOWN; }
    // IMFMediaSource
    STDMETHODIMP GetCharacteristics(DWORD* c) override { if (!c) return E_POINTER; *c = MFMEDIASOURCE_IS_LIVE; return S_OK; }
    STDMETHODIMP CreatePresentationDescriptor(IMFPresentationDescriptor** pd) override {
        if (!pd) return E_POINTER; std::lock_guard<std::mutex> l(m_lock); if (!m_pd) return MF_E_SHUTDOWN; return m_pd->Clone(pd);
    }
    STDMETHODIMP Start(IMFPresentationDescriptor* pd, const GUID* fmt, const PROPVARIANT* pos) override {
        if (!pd || !pos) return E_POINTER;
        if (fmt && *fmt != GUID_NULL) return E_INVALIDARG;
        std::lock_guard<std::mutex> l(m_lock);
        if (!m_queue || !m_pd) return MF_E_SHUTDOWN;
        PROPVARIANT t; PropVariantInit(&t); t.vt = VT_I8; t.hVal.QuadPart = MFGetSystemTime();
        BOOL sel = FALSE; IMFStreamDescriptor* sd = nullptr;
        if (FAILED(pd->GetStreamDescriptorByIndex(0, &sel, &sd))) return E_FAIL;
        IMFMediaTypeHandler* h = nullptr; IMFMediaType* type = nullptr;
        if (SUCCEEDED(sd->GetMediaTypeHandler(&h))) { h->GetCurrentMediaType(&type); h->Release(); }
        sd->Release();
        m_pd->SelectStream(0);
        m_queue->QueueEventParamUnk(m_started ? MEUpdatedStream : MENewStream, GUID_NULL, S_OK, static_cast<IMFMediaStream2*>(m_stream));
        m_started = true;
        HRESULT hr = m_stream->Start(type);
        if (type) type->Release();
        if (FAILED(hr)) return hr;
        return m_queue->QueueEventParamVar(MESourceStarted, GUID_NULL, S_OK, &t);
    }
    STDMETHODIMP Stop() override {
        std::lock_guard<std::mutex> l(m_lock);
        if (!m_queue || !m_pd) return MF_E_SHUTDOWN;
        PROPVARIANT t; PropVariantInit(&t); t.vt = VT_I8; t.hVal.QuadPart = MFGetSystemTime();
        m_stream->Stop(); m_pd->DeselectStream(0);
        return m_queue->QueueEventParamVar(MESourceStopped, GUID_NULL, S_OK, &t);
    }
    STDMETHODIMP Pause() override { return MF_E_INVALID_STATE_TRANSITION; }
    STDMETHODIMP Shutdown() override {
        std::lock_guard<std::mutex> l(m_lock);
        if (!m_queue) return MF_E_SHUTDOWN;
        m_queue->Shutdown(); m_queue->Release(); m_queue = nullptr;
        if (m_stream) { m_stream->Shutdown(); m_stream->Release(); m_stream = nullptr; }
        if (m_pd) { m_pd->Release(); m_pd = nullptr; }
        return S_OK;
    }
    // IMFMediaSourceEx
    STDMETHODIMP GetSourceAttributes(IMFAttributes** a) override { if (!a) return E_POINTER; *a = static_cast<IMFAttributes*>(this); AddRef(); return S_OK; }
    STDMETHODIMP GetStreamAttributes(DWORD id, IMFAttributes** a) override {
        if (!a) return E_POINTER; *a = nullptr; if (id != 0 || !m_stream) return E_FAIL;
        return m_stream->QueryInterface(IID_IMFAttributes, (void**)a);
    }
    STDMETHODIMP SetD3DManager(IUnknown*) override { return S_OK; } // CPU frames only
    // IMFGetService
    STDMETHODIMP GetService(REFGUID, REFIID, LPVOID*) override { return MF_E_UNSUPPORTED_SERVICE; }
    // IKsControl
    STDMETHODIMP_(NTSTATUS) KsProperty(PKSPROPERTY, ULONG, LPVOID, ULONG, ULONG*) override { return HRESULT_FROM_WIN32(ERROR_SET_NOT_FOUND); }
    STDMETHODIMP_(NTSTATUS) KsMethod(PKSMETHOD, ULONG, LPVOID, ULONG, ULONG*) override { return HRESULT_FROM_WIN32(ERROR_SET_NOT_FOUND); }
    STDMETHODIMP_(NTSTATUS) KsEvent(PKSEVENT, ULONG, LPVOID, ULONG, ULONG*) override { return HRESULT_FROM_WIN32(ERROR_SET_NOT_FOUND); }
    // IMFSampleAllocatorControl: we make our own CPU samples
    STDMETHODIMP SetDefaultAllocator(DWORD, IUnknown*) override { return S_OK; }
    STDMETHODIMP GetAllocatorUsage(DWORD out, DWORD* in, MFSampleAllocatorUsage* u) override { if (!in || !u) return E_POINTER; *in = out; *u = MFSampleAllocatorUsage_DoesNotAllocate; return S_OK; }

private:
    std::mutex m_lock;
    IMFMediaEventQueue* m_queue = nullptr;
    IMFPresentationDescriptor* m_pd = nullptr;
    MediaStream* m_stream = nullptr;
    bool m_started = false;
};

// ---- Activator: what MFCreateVirtualCamera's CLSID points at ----
class Activator : public AttrBaseT<IMFActivate> {
public:
    LU_REFCOUNT
    Activator() { ++g_objects; }
    ~Activator() { --g_objects; }
    STDMETHODIMP QueryInterface(REFIID riid, void** ppv) override {
        if (!ppv) return E_POINTER; *ppv = nullptr;
        if (riid == IID_IUnknown || riid == IID_IMFActivate || riid == IID_IMFAttributes) *ppv = static_cast<IMFActivate*>(this);
        else return E_NOINTERFACE;
        AddRef(); return S_OK;
    }
    HRESULT Init() {
        m_source = new MediaSource();
        m_a->SetUINT32(MF_VIRTUALCAMERA_PROVIDE_ASSOCIATED_CAMERA_SOURCES, 1);
        m_a->SetGUID(MFT_TRANSFORM_CLSID_Attribute, CLSID_LightUpVCam);
        return m_source->Init(this);
    }
    STDMETHODIMP ActivateObject(REFIID riid, void** ppv) override { if (!ppv) return E_POINTER; *ppv = nullptr; return m_source ? m_source->QueryInterface(riid, ppv) : MF_E_SHUTDOWN; }
    STDMETHODIMP ShutdownObject() override { return S_OK; }
    STDMETHODIMP DetachObject() override { if (m_source) { m_source->Release(); m_source = nullptr; } return S_OK; }
private:
    MediaSource* m_source = nullptr;
};

class Factory : public IClassFactory {
public:
    STDMETHODIMP QueryInterface(REFIID riid, void** ppv) override { if (riid == IID_IUnknown || riid == IID_IClassFactory) { *ppv = this; AddRef(); return S_OK; } *ppv = nullptr; return E_NOINTERFACE; }
    STDMETHODIMP_(ULONG) AddRef() override { return 2; }
    STDMETHODIMP_(ULONG) Release() override { return 1; }
    STDMETHODIMP CreateInstance(IUnknown* outer, REFIID riid, void** ppv) override {
        if (outer) return CLASS_E_NOAGGREGATION;
        MFStartup(MF_VERSION, MFSTARTUP_LITE);
        Activator* a = new Activator();
        HRESULT hr = a->Init();
        if (SUCCEEDED(hr)) hr = a->QueryInterface(riid, ppv);
        a->Release();
        return hr;
    }
    STDMETHODIMP LockServer(BOOL l) override { if (l) ++g_objects; else --g_objects; return S_OK; }
};
static Factory g_factory;

BOOL APIENTRY DllMain(HMODULE m, DWORD reason, LPVOID) { if (reason == DLL_PROCESS_ATTACH) { g_module = m; DisableThreadLibraryCalls(m); } return TRUE; }
STDAPI DllGetClassObject(REFCLSID clsid, REFIID riid, void** ppv) { if (clsid != CLSID_LightUpVCam) return CLASS_E_CLASSNOTAVAILABLE; return g_factory.QueryInterface(riid, ppv); }
STDAPI DllCanUnloadNow() { return g_objects.load() ? S_FALSE : S_OK; }

STDAPI DllRegisterServer() {
    wchar_t path[MAX_PATH]; GetModuleFileNameW(g_module, path, MAX_PATH);
    HKEY k;
    if (RegCreateKeyExW(HKEY_LOCAL_MACHINE, L"SOFTWARE\\Classes\\CLSID\\" LU_CLSID_STRING L"\\InprocServer32", 0, nullptr, 0, KEY_WRITE, nullptr, &k, nullptr) != ERROR_SUCCESS) return ((HRESULT)0x80040201L);
    RegSetValueExW(k, nullptr, 0, REG_SZ, (BYTE*)path, (DWORD)((wcslen(path) + 1) * 2));
    const wchar_t* model = L"Both"; RegSetValueExW(k, L"ThreadingModel", 0, REG_SZ, (BYTE*)model, 10);
    RegCloseKey(k); return S_OK;
}
STDAPI DllUnregisterServer() { RegDeleteTreeW(HKEY_LOCAL_MACHINE, L"SOFTWARE\\Classes\\CLSID\\" LU_CLSID_STRING); return S_OK; }

