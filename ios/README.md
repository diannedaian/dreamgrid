# DreamGrid Measure (iPhone, native)

> No-install alternative: `apps/web/measure.html` measures with Safari's camera and tilt sensor.
> See `apps/web/README.md`. This native app is the more accurate option and needs Xcode once.

Native iOS app that opens straight into an ARKit camera, has you tap out length, width,
and height, and sends the inches to the web app running on your Mac.

## One-time build (needs Xcode on the Mac)

```sh
brew install xcodegen
cd ios/DreamGridMeasure
xcodegen generate
open DreamGridMeasure.xcodeproj
```

In Xcode: select your iPhone as the run target, set your team under Signing & Capabilities,
and press Run. A free personal team works (the build expires after 7 days).

## Every time

1. On the Mac: `cd apps/web && npm run dev` and open the Local URL. Leave the room form open.
2. On the phone (same Wi-Fi): open `dreamgrid://measure?return=http://<mac-ip>:5173/` in Safari
   (bookmark it). It launches the app straight into the camera.
3. Tap two points for length, two for width, floor and ceiling for height.
4. Tap **Send to DreamGrid**. The room on the Mac builds itself from the measurements.

The phone page launches the app via `dreamgrid://measure?return=<web-app-origin>/`. The app
POSTs `{ w, d, h }` in whole inches to `<origin>/api/measurement`; the desktop page polls that
endpoint while the form is open. If the POST fails, **Open room on this phone** opens the
room page with `?w=&d=&h=` instead.
