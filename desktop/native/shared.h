#pragma once
#include <windows.h>

// {58F0E16A-1B3D-421B-ACA2-AAE1AA9C1416}
static const GUID CLSID_LightUpVCam = { 0x58f0e16a, 0x1b3d, 0x421b, { 0xac, 0xa2, 0xaa, 0xe1, 0xaa, 0x9c, 0x14, 0x16 } };
#define LU_CLSID_STRING L"{58F0E16A-1B3D-421B-ACA2-AAE1AA9C1416}"
#define LU_CAMERA_NAME L"Light Up Camera"

// Frames travel from the Light Up app to the camera through this shared section.
// The camera (running inside the Windows Frame Server) creates it; the app opens it and writes BGRA frames.
#define LU_SHM_NAME L"Global\\LightUpVCamFrames"
#define LU_WIDTH 1280
#define LU_HEIGHT 720
#define LU_MAGIC 0x4356554C /* 'LUVC' */

struct LuHeader {
    volatile LONG magic;
    volatile LONG seq;     // bumped after each completed frame
    LONG width, height;
};
#define LU_PIXEL_BYTES (LU_WIDTH * LU_HEIGHT * 4)
#define LU_SHM_SIZE (sizeof(LuHeader) + LU_PIXEL_BYTES)
