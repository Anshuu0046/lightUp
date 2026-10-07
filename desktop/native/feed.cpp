// lightup_feed: reads raw 1280x720 RGBA frames from stdin and publishes them to the Light Up Camera.
// lightup_feed --pattern   sends a moving test pattern instead (for checking the camera without the app).
#include <windows.h>
#include <io.h>
#include <fcntl.h>
#include <cstdio>
#include <cstring>
#include <vector>
#include "shared.h"

static LuHeader* Open(HANDLE* map) {
    *map = OpenFileMappingW(FILE_MAP_ALL_ACCESS, FALSE, LU_SHM_NAME);
    if (!*map) return nullptr;
    LuHeader* h = (LuHeader*)MapViewOfFile(*map, FILE_MAP_ALL_ACCESS, 0, 0, LU_SHM_SIZE);
    if (!h) { CloseHandle(*map); *map = nullptr; }
    return h;
}

static void Publish(LuHeader* h, const uint8_t* rgba) {
    // the camera expects BGRA, so swap red and blue on the way in
    const uint32_t* s = (const uint32_t*)rgba; uint32_t* d = (uint32_t*)(h + 1);
    for (int i = 0; i < LU_WIDTH * LU_HEIGHT; i++) { uint32_t p = s[i]; d[i] = (p & 0xFF00FF00u) | ((p & 0xFFu) << 16) | ((p >> 16) & 0xFFu); }
    InterlockedIncrement(&h->seq);
}

int main(int argc, char** argv) {
    const bool pattern = argc > 1 && !strcmp(argv[1], "--pattern");
    _setmode(_fileno(stdin), _O_BINARY);
    std::vector<uint8_t> frame(LU_PIXEL_BYTES);
    HANDLE map = nullptr; LuHeader* h = nullptr;
    for (unsigned t = 0;; t++) {
        if (pattern) {
            for (int y = 0; y < LU_HEIGHT; y++) for (int x = 0; x < LU_WIDTH; x++) {
                uint8_t* p = &frame[((size_t)y * LU_WIDTH + x) * 4];
                p[0] = (uint8_t)(x * 255 / LU_WIDTH); p[1] = (uint8_t)(y * 255 / LU_HEIGHT); p[2] = (uint8_t)(t * 4); p[3] = 255;
            }
            Sleep(33);
        } else {
            size_t got = 0;
            while (got < frame.size()) { size_t n = fread(frame.data() + got, 1, frame.size() - got, stdin); if (!n) return 0; got += n; }
        }
        // The camera only exists while an app is using it; keep trying to attach.
        if (!h) h = Open(&map);
        if (h) Publish(h, frame.data());
        else if (pattern) Sleep(200);
    }
}

