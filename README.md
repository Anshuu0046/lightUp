# Light Up

An all-in-one studio for creators: light yourself like a pro on camera, then edit and export your video, all on your own device. It runs as a website and as a Windows app; the Windows app also adds a **Light Up Camera** you can pick in Zoom, Teams, OBS, TikTok Live Studio or the Windows Camera app.

## Install (Windows 11)

Run `Light Up Setup <version>.exe` and approve the administrator prompt. The installer adds the app and registers the Light Up Camera device. Uninstalling removes both.

Live lighting needs a GPU with WebGPU `shader-f16` support (most GPUs from the last several years). Without it the camera shows unlit and the app says so.

## Go live: realistic lighting

- **Turn on camera**, then press **S** (or the round button) for settings.
- **1** Bulb: hold up your hand to carry a glowing bulb, or click to place it. **2** Ring light. **3** Window. **4** Natural. **F** full screen.
- Brightness, colour (warm white through daylight to blue, or an RGB colour), **Auto light**, **Soft skin** and eye catchlights. Auto light measures the skin on your face and keeps it evenly lit in any room.
- **Background light:** an RGB lamp on the wall behind you (seven colours or a slow rainbow), with its brightness and position. It tints the wall and rims your hair while your face keeps its own light.
- **Teleprompter:** type or paste a script in the settings; it sits at the top of the screen (not in the video) and scrolls by itself when you press Record, starting from the top each time. Drag it to move by hand, tap to pause.
- **Hand gestures** (hold the sign for half a second): ✌️ photo after a 3-second countdown, 👍 start or stop recording, ☝️ next light, 👌 then move your hand up or down for brightness. On a touch screen, swipe sideways to change the light and up or down for brightness (except in bulb mode, where a touch places the bulb).
- **Use in Zoom, Teams & OBS** sends the lit picture to Light Up Camera. **Photo** and **Record** save to Downloads.

## Edit a video

- **Timeline:** video, photos, music and voice on separate tracks; move, trim, split (**S**), duplicate (**Ctrl+D**), undo/redo, snapping, zoom. Drag on the preview to position things. Projects save themselves on the device.
- **Looks:** 12 one-tap looks (Cinematic, Golden hour, Vintage, Noir, Teal & orange, …) and colour sliders: brightness, contrast, saturation, warmth, tint, fade, vignette, grain, blur.
- **Effects:** fade in/out, slow zoom, camera shake, glow, glitch, flash, cinematic bars.
- **Projects:** every project is kept on the device. The folder button lists them: open, rename, copy or delete one, or start a new one.
- **Keyframes:** animate a clip's size, position, rotation and opacity. Add keyframes at the playhead, or pick a quick motion (slow zoom, drift, pop in, spin in). Dragging on the preview writes keyframes too.
- **Reverse, mirror, flip:** play a clip backwards (sound too, in the export; the preview shows the picture only), mirror it, or turn it upside down. **Remove audio** silences a clip and can be undone.
- **Filters and LUTs:** the 12 looks, ten built-in LUTs (Teal & orange, Bleach bypass, Cyberpunk, …) with a strength slider, and **Import a .cube LUT** for your own.
- **Eye effects:** glowing eyes, lightning eyes, laser eyes and “Deal with it” pixel shades that follow the person's real eyes (Effects tab).
- **Memes:** meme text (top and bottom, POV, Nobody:, …) and 28 reaction stickers, plus the sound effects in the Sounds tab.
- **Voiceover:** record your voice onto the timeline while the video plays, reading from a script that scrolls by itself.
- **Text (T):** 11 fonts including Hindi and Telugu, 12 styles (caption, subtitle box, highlight, meme, neon, …), wrapping, outline, shadow, gradients, backgrounds, and in/out animations.
- **Lighting** (Light tab on any video or photo clip): a focus light you can move, colour and soften, the room level, and an RGB background lamp. Uses the same depth relighting as the live camera where WebGPU is available, and a simpler cut-out-based light elsewhere. Preview and export match.
- **Audio:** volume up to 200%, fades, **Enhance voice**, **auto-ducking** (music dips when people talk), detach audio from video, real waveforms, and 18 built-in sound effects you can use anywhere.
- **Cut-outs & overlays:** remove or blur the background behind a person automatically, refine photo cut-outs with a brush, rounded/circle frames and one-tap picture-in-picture.
- **Stickers & GIFs:** GIPHY search (needs a free API key), your own uploaded stickers, and a shared library curated by admins. Animated GIFs and WebPs play on the timeline.
- **Export:** MP4 in 9:16, 16:9, 1:1 or 4:5, at 720p or 1080p, rendered frame by frame.

## Android app

`release/LightUp-<version>.apk` installs on Android 7+ (allow “Install unknown apps” for your browser or file manager). Everything is bundled, so it works offline; exports, photos and recordings save to **Documents › Light Up** and open the share sheet (Instagram, YouTube, WhatsApp, Drive, Gallery). Realistic live lighting needs WebGPU in Android System WebView, which many phones don’t have yet; the app falls back to the plain camera and says so. The editor works everywhere. The Windows virtual camera is desktop-only.

Building it needs Java 21 and the Android SDK (platform 36, build-tools 36):

```bash
set JAVA_HOME=C:\path\to\jdk-21
set ANDROID_HOME=C:\path\to\android-sdk
npm run apk          # signed release APK in android/app/build/outputs/apk/release/
```

Release signing reads `android/keystore.properties` (not in git), which points at your `.jks` key. **Back up that key and its password**: every future update must be signed with the same key, or phones will refuse to install it. If Gradle fails with “Unable to establish loopback connection”, set `JAVA_TOOL_OPTIONS=-Djdk.net.unixdomain.tmpdir=C:\shortpath` (a folder without spaces).

## Website

The home page (`#/`) is the landing page; `#/login` is sign-in and sign-up. The landing page's Windows and Android buttons link to the latest GitHub release, so publish `Light Up Setup <version>.exe` and `LightUp-<version>.apk` there.

## Accounts and admin panel (optional)

Without setup, everything works on the device. To add sign-in, cloud projects, the shared sticker library and the admin panel:

1. Create a project at [supabase.com](https://supabase.com) and run `supabase/schema.sql` in its SQL editor.
2. Copy `.env.example` to `.env` and fill in the project URL and anon key from **Project settings → API**.
3. In **Authentication → Email templates**, include `{{ .Token }}` in the **Magic link** and **Confirm signup** emails, so people receive a 6-digit code (used to confirm a new account, to sign in without a password and to reset a forgotten one).
4. Optional, website only: to show **Continue with Google**, turn on Google in **Authentication → Providers** and add your site address (for example `https://light-up-six.vercel.app/`) under **URL configuration → Redirect URLs**. The desktop and Android apps offer email sign-in only.
5. Rebuild, sign in once, then make yourself admin: `update public.profiles set role = 'admin' where email = 'you@example.com';`
6. Open **Account menu → Admin panel** (or `#/admin`): usage overview, users (roles, blocking), projects, the shared sticker library, activity log and settings (GIPHY key for everyone).

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
src/landing/         Home page (landing) and the lit bust illustration
src/live/            Live lighting: camera view, settings panel, light rig, auto light, gestures
src/editor/          Video editor: timeline, preview, export, looks, text, audio, cut-outs, stickers
src/cloud/           Supabase accounts, sign-in page, cloud projects, usage events
src/admin/           Admin panel
src/depth/           DepthART inference and the relighting shader
desktop/             Electron shell and the Windows virtual camera (desktop/native)
supabase/schema.sql  Database, security rules and storage for accounts
public/              Bundled models and MediaPipe runtime
build/               Icon and installer script
```

See `THIRD_PARTY_NOTICES.md` for licences.
