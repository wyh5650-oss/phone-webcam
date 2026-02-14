#include <stdint.h>
#include <string.h>

// RGBA → BGR conversion with vertical flip (for DirectShow bottom-up format)
// This native C function is ~50x faster than JavaScript pixel-by-pixel loop
__declspec(dllexport) void __cdecl rgba_to_bgr_flip(
    const uint8_t* rgba, uint8_t* bgr, int width, int height)
{
    const int rowBytes4 = width * 4;
    const int rowBytes3 = width * 3;

    for (int y = 0; y < height; y++) {
        const uint8_t* src = rgba + y * rowBytes4;
        // Direct conversion without flip (fixes inverted image)
        uint8_t* dst = bgr + y * rowBytes3;
        for (int x = 0; x < width; x++) {
            dst[0] = src[2]; // B
            dst[1] = src[1]; // G
            dst[2] = src[0]; // R
            dst += 3;
            src += 4;
        }
    }
}

// Combined: convert RGBA to BGR flip + send to softcam in one call
// Avoids extra buffer copy
typedef void* scCamera;
typedef void (__cdecl *scSendFrameFunc)(scCamera camera, const void* image_bits);

static uint8_t* g_bgr_buffer = NULL;
static int g_buffer_size = 0;

__declspec(dllexport) void __cdecl convert_and_send(
    const uint8_t* rgba, int width, int height,
    scCamera camera, scSendFrameFunc sendFrame)
{
    const int needed = width * height * 3;
    if (g_buffer_size < needed) {
        if (g_bgr_buffer) free(g_bgr_buffer);
        g_bgr_buffer = (uint8_t*)malloc(needed);
        g_buffer_size = needed;
    }

    rgba_to_bgr_flip(rgba, g_bgr_buffer, width, height);
    sendFrame(camera, g_bgr_buffer);
}
