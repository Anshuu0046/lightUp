# Third-party notices

Light Up bundles the following models and libraries. Each remains under its own licence.

## Models (shipped in `public/models/`)

| Model | Used for | Licence | Source |
| --- | --- | --- | --- |
| DepthART relative-depth, S, 448, balanced (`depth.depthart`) | Estimating the shape of each camera frame | Apache-2.0 | https://huggingface.co/reczkok/depthart-typegpu |
| MediaPipe Face Landmarker (`face_landmarker.task`) | Face and iris tracking | Apache-2.0 | https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker |
| MediaPipe Hand Landmarker (`hand_landmarker.task`) | Hand tracking for the hand-held bulb | Apache-2.0 | https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker |
| MediaPipe Selfie Segmenter (`selfie_segmenter.tflite`) | Background removal and blur behind people | Apache-2.0 | https://ai.google.dev/edge/mediapipe/solutions/vision/image_segmenter |

**DepthART.** "DepthART: Scaling Foundation Monocular Depth to Tiny Models" by Feng Xue et al. (https://github.com/xuefeng-cvr/DepthART). The `.depthart` file is an unofficial conversion by Software Mansion S.A. for the TypeGPU project (batch-norm folding, mixed FP16/FP32 weights). It is not affiliated with or endorsed by the DepthART authors. The original DepthART repository does not declare a licence file; the converted model is published under Apache-2.0 by its distributor. Review this before commercial release.

## Libraries

- MediaPipe Tasks Vision (Apache-2.0), including the WebAssembly runtime in `public/mediapipe/`
- TypeGPU and unplugin-typegpu (MIT), Software Mansion
- Mediabunny (MPL-2.0), for frame-accurate decoding and MP4 export
- Supabase JS client (MIT)
- React, React DOM (MIT)
- Lucide icons (ISC)
- Electron (MIT) and electron-builder (MIT)
- Fonts via Fontsource, all SIL OFL 1.1: Manrope, Instrument Serif, Poppins, Montserrat, Anton, Bebas Neue, Playfair Display, Pacifico, Permanent Marker, Noto Sans Devanagari, Noto Sans Telugu
- GIPHY content is used under the GIPHY API terms, with “Powered by GIPHY” attribution
- Built-in sound effects are synthesised by the app and carry no third-party rights

## Windows virtual camera

`desktop/native/` implements a Media Foundation virtual camera source. Its structure follows Microsoft's public documentation for `MFCreateVirtualCamera` and the open-source VCamSample by Simon Mourier (MIT).
