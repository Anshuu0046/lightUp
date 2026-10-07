# Light Up

Light Up gives your webcam a realistic hand-held bulb, ring light or window light. It runs live on your own computer, and the Windows app adds a **Light Up Camera** you can pick in Zoom, Teams, OBS, TikTok Live Studio or the Windows Camera app.

## Install (Windows 11)

Run `Light Up Setup 1.0.0.exe` and approve the administrator prompt. The installer adds the app and registers the Light Up Camera device. Uninstalling removes both.

Needs a GPU with WebGPU `shader-f16` support (most GPUs from the last several years). Without it the app shows your camera unlit and says so.

## Using it

- **Turn on camera**, then press **S** (or the round button) for settings.
- **1** Bulb: hold up your hand to carry a glowing bulb, or click to place it. **2** Ring light. **3** Window. **4** Natural (your camera untouched). **F** toggles full screen.
- Brightness, colour (warm through daylight to blue), **Auto light** and eye catchlights are in the panel. Auto light measures your face and adjusts the light so you stay evenly lit in a dark or bright room, and eases off if skin starts to blow out or take on a colour cast.
- **Use in Zoom, Teams & OBS** sends the lit picture to Light Up Camera. **Photo** and **Record** save to Downloads.

## How it works

1. A depth model (DepthART, run with WebGPU/TypeGPU) estimates the shape of every frame. Its soft edges are snapped to the real edges in the picture.
2. A virtual light is placed where a real one would be and each pixel is lit from its depth and surface direction, with falloff. A ring light at the lens lifts your face well above the room behind you.
3. MediaPipe tracks your face, irises and hand. The light follows, and its reflection is painted inside each iris and fades out when you blink.

Everything runs offline. All models ship inside the app, and video never leaves your device.

## Develop

Requires Node.js 20+. For the Windows camera, Visual Studio Build Tools with the C++ workload.

```bash
npm install
npm run dev          # web version at http://localhost:5173
npm run desktop      # desktop app (after `npm run build`)
npm run native       # build the virtual camera DLL, installer helper and feeder
npm run dist         # build everything and produce release/Light Up Setup <version>.exe
```

For development without a webcam, open `http://localhost:5173/#video=/some-clip.mp4` (dev server only) to use a video file as the camera.

## Project structure

```text
src/live/            The app: start screen, live view, settings panel, light rig
src/faceTracker.ts   Face, iris and hand tracking
src/depthRuntime.ts  Depth model loading and per-frame relighting
src/depth/           DepthART inference and the relighting shader
src/recorder.ts      Photo and video capture
src/virtualCamera.ts Sends frames to Light Up Camera (desktop only)
desktop/main.cjs     Electron shell
desktop/native/      Windows virtual camera (Media Foundation), installer helper, frame feeder
public/models/       Bundled models
build/               Icon and installer script
```

See `THIRD_PARTY_NOTICES.md` for licences.

