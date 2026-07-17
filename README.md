# Cornhole Scoreboard Simulator

Public browser simulator for the cornhole scoreboard project.

Open the simulator here after GitHub Pages finishes publishing:

https://diterex.github.io/cornhole-scoreboard-simulator/

## What This Is

This is a phone-friendly browser simulation of the cornhole scoreboard logic.

It lets you test:

- Board A and Board B score displays.
- Manual score button behavior from 0 to 21.
- Reset behavior.
- Vibration feedback.
- IR motion feedback.
- Score color changes.
- Sound on/off and volume controls.
- Light sleep and deep sleep simulation.
- Board A staying awake while a phone is connected to its portal.
- OTA window status.
- App/status payload preview.

## What This Is Not

This simulator does not prove the real electronics.

It does not test:

- Real ESP32 hardware.
- Real WS2812B LED timing.
- Real battery runtime.
- Real speaker loudness.
- Real vibration or IR sensor noise.
- Real ESP-NOW range.
- Real OTA updates.

Those still require hardware testing.

## Phone Audio Note

Most phone browsers block sound until you tap the page once.

If `Test Speaker` does not play, tap anywhere on the simulator page first, then try again.
