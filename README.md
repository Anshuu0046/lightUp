# Light Up

An all-in-one studio for creators: light yourself like a pro on camera, then edit, caption and export your video, all on your own device. It runs as a website and as a Windows app; the Windows app also adds a **Light Up Camera** you can pick in Zoom, Teams, OBS, TikTok Live Studio or the Windows Camera app.

## Install (Windows 11)

Run `Light Up Setup <version>.exe` and approve the administrator prompt. The installer adds the app and registers the Light Up Camera device. Uninstalling removes both.

Live lighting needs a GPU with WebGPU `shader-f16` support (most GPUs from the last several years). Without it the camera shows unlit and the app says so.

## Go live: realistic lighting

- **Turn on camera**, then press **S** (or the round button) for settings.
- **1** Bulb: hold up your hand to carry a glowing bulb, or click to place it. **2** Ring light. **3** Window. **4** Natural. **F** full screen.
- Brightness, colour (warm, daylight, blue), **Auto light** and eye catchlights. Auto light measures your face and keeps it evenly lit in any room.
- **Use in Zoom, Teams & OBS** sends the lit picture to Light Up Camera. **Photo** and **Record** save to Downloads.

## Edit a video

- **Timeline:** video, photos, music and voice on separate tracks; move, trim, split (**S**), duplicate (**Ctrl+D**), undo/redo, snapping, zoom. Drag on the preview to position things. Projects save themselves on the device.
- **Looks:** 12 one-tap looks (Cinematic, Golden hour, Vintage, Noir, Teal & orange, …) and colour sliders: brightness, contrast, saturation, warmth, tint, fade, vignette, grain, blur.
- **Effects:** fade in/out, slow zoom, camera shake, glow, glitch, flash, cinematic bars.
- **Text (T):** 11 fonts including Hindi and Telugu, 12 styles (caption, subtitle box, highlight, meme, neon, …), wrapping, outline, shadow, gradients, backgrounds, and in/out animations.
- **Auto captions** in English, हिन्दी Hindi and తెలుగు Telugu, made on the device with Whisper (the model downloads once: Fast ~200 MB, Accurate larger). Captions are editable text; regenerate or restyle in one step.
- **Audio:** volume up to 200%, fades, **Enhance voice**, **auto-ducking** (music dips when people talk), detach audio from video, real waveforms, and 18 built-in sound effects you can use anywhere.
- **Cut-outs & overlays:** remove or blur the background behind a person automatically, refine photo cut-outs with a brush, rounded/circle frames and one-tap picture-in-picture.
- **Stickers & GIFs:** GIPHY search (needs a free API key), your own uploaded stickers, and a shared library curated by admins. Animated GIFs and WebPs play on the timeline.
- **Export:** MP4 in 9:16, 16:9, 1:1 or 4:5, at 720p or 1080p, rendered frame by frame.

## Accounts and admin panel (optional)

Without setup, everything works on the device. To add sign-in, cloud projects, the shared sticker library and the admin panel:

1. Create a project at [supabase.com](https://supabase.com) and run `supabase/schema.sql` in its SQL editor.
2. Copy `.env.example` to `.env` and fill in the project URL and anon key from **Project settings → API**.
3. In **Authentication → Email templates**, include `{{ .Token }}` in the magic-link email so users receive a 6-digit code.
4. Rebuild, sign in once, then make yourself admin: `update public.profiles set role = 'admin' where email = 'you@example.com';`
5. Open **Account menu → Admin panel** (or `#/admin`): usage overview, users (roles, blocking), projects, the shared sticker library, activity log and settings (GIPHY key for everyone).

## Develop

Requires Node.js 20+. For the Windows camera, Visual Studio Build Tools with the C++ workload.

```bash
npm install
npm run dev          # web version at http://localhost:5173
npm run desktop      # desktop app (after `npm run build`)
npm run native       # build the virtual camera DLL, installer helper and feeder
npm run dist         # build everything and produce release/Light Up Setup <version>.exe
```

Dev-only helpers: `#/live?video=/clip.mp4` uses a video file as the camera.

## Project structure

```text
src/App.tsx          Home screen and routes (#/live, #/edit, #/admin)
src/live/            Live lighting: camera view, settings panel, light rig, auto light
src/editor/          Video editor: timeline, preview, export, looks, text, captions, audio, cut-outs, stickers
src/cloud/           Supabase accounts, cloud projects, usage events
src/admin/           Admin panel
src/depth/           DepthART inference and the relighting shader
desktop/             Electron shell and the Windows virtual camera (desktop/native)
supabase/schema.sql  Database, security rules and storage for accounts
public/              Bundled models, MediaPipe and ONNX runtimes
build/               Icon and installer script
```

See `THIRD_PARTY_NOTICES.md` for licences.
