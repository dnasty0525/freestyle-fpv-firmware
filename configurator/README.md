# Freestyle Setup

A setup wizard for the Freestyle fork, in the spirit of BossHobby's Quicksilver
configurator: plug in the quad, answer a few questions, fly. It runs in Chrome
or Edge and talks to the flight controller over USB (Web Serial). There's
nothing to install.

It also works with stock Betaflight 2025.12 and newer. The Kalman option only
appears on fork builds.

## What it does

| Step         | What happens                                                                 |
|--------------|------------------------------------------------------------------------------|
| Connect      | Reads the board, firmware and current setup in one CLI session               |
| Backup       | Offers the current `diff all` as a download, to paste back if needed         |
| Your quad    | Frame size (3", 4", 5", 7"), props in/out, ESC firmware (RPM filter on/off), name |
| Receiver     | Receiver type and UART                                                       |
| Flying feel  | Smooth / Standard / Aggressive rates; Kalman on/off (fork builds)            |
| Apply        | Writes everything and saves: **one reboot**                                  |
| Sticks       | Live sticks; detects a wrong channel order and fixes it                      |
| Switches     | "Flip the switch you want for arm": arm, angle, turtle, beeper               |
| Motors       | Props-off motor test: click where each motor is, then confirm its spin direction. Fixes motor order (output reordering) and reverses ESCs over DShot |
| Ready to fly | Summary and first-flight checks; offers to turn RPM filtering off if the ESCs sent no RPM |

Everything the wizard writes is shown on the Apply step ("Show the exact
commands"). The browser's **Flight controller log** at the bottom shows every
command and reply.

## Presets

All presets start from the firmware defaults (Betaflight's defaults are tuned
on a 5" freestyle quad). They change the PIDs and filters only through the
simplified tuning sliders, so the maths stays upstream's.

| Frame | Master | PI   | D    | FF   | Gyro filter | D-term filter | Also                                         |
|-------|--------|------|------|------|-------------|---------------|----------------------------------------------|
| 3"    | 1.10   | 1.00 | 1.00 | 1.00 | 1.20        | 1.15          | dyn notch min 120 Hz, dynamic idle 45        |
| 4"    | 1.05   | 1.00 | 1.00 | 1.00 | 1.10        | 1.05          | dyn notch min 110 Hz, dynamic idle 40        |
| 5"    | 1.00   | 1.00 | 1.00 | 1.00 | 1.00        | 1.00          | dynamic idle 35                              |
| 7"    | 0.85   | 0.95 | 1.10 | 0.90 | 0.80        | 0.80          | I-term relax 10, dyn notch 70, RPM min 80, dynamic idle 25 |

Every preset also sets 100% sag compensation. With RPM filtering on, it sets
one dynamic notch at Q 500 and dynamic idle. Rates are Actual rates:

| Feel       | Center | Max     | Expo | Yaw          | RC smoothing |
|------------|--------|---------|------|--------------|--------------|
| Smooth     | 150°/s | 650°/s  | 0.40 | 150/550/0.30 | 50           |
| Standard   | 200°/s | 750°/s  | 0.50 | 200/650/0.40 | 35           |
| Aggressive | 250°/s | 900°/s  | 0.55 | 220/750/0.45 | 30           |

The 3", 4" and 7" numbers are reasonable starting points, not flight-proven
tunes yet. Fly a short pack, land and feel the motors. Once a preset is proven
on your quads, edit `js/presets.js`; the tests below check every combination.

The wizard only changes the Kalman filter if you change its checkbox, so
an existing Kalman tune on the quad is left alone.

## Run it

**Hosted:** the `Freestyle Setup` workflow publishes this folder to GitHub
Pages on every push to `freestyle/main`. One-time setup: repo **Settings →
Pages → Source: GitHub Actions**. The site is then at
`https://<user>.github.io/<repo>/`.

**Locally:** Web Serial needs `https://` or `localhost`:

```sh
cd configurator
python3 -m http.server 8000
# open http://localhost:8000 in Chrome or Edge
```

Opening `index.html` directly works for the demo only.

**Demo:** "Try the demo" on the first page runs the whole wizard against a
simulated flight controller, which has a wrong channel order, two swapped
motors and one reversed motor for the wizard to fix.

## Safety

- The motor step will not start until you tick "props off" and "disarmed",
  and a battery is detected. It spins one motor at a time at about 8% for at
  most 6 seconds, and stops all motors when you leave the step or close the page.
- Arming is disabled over MSP for the length of the motor test.
- A failed command on the Apply or Switches step exits the CLI *without
  saving*, so a half-applied setup never gets stored.

## Files

```
index.html, style.css
js/fclink.js      MSP v1/v2 + CLI over any byte transport (browser and Node)
js/presets.js     frame presets, rates, and the CLI plan builder
js/transports.js  Web Serial transport and the demo flight controller
js/app.js         the wizard
test/sitl.test.js runs the protocol layer and every preset against SITL
test/check-settings.sh  checks every setting name exists in a real board build
```

## Tests

```sh
make SITL
node configurator/test/sitl.test.js           # 12 checks against the simulator

make CONFIG=GEPRCF722
sh configurator/test/check-settings.sh obj/main/betaflight_STM32F722_GEPRCF722.elf
```

SITL has no DShot, RPM filter, dynamic notch or serial RX, so those settings
are verified against a real board build instead.

## Not covered yet

- Quads other than Quad X (hex, octo)
- VTX setup (power table, band/channel), and OSD layout
- GPS rescue
- ESC flashing (use esc-configurator.com)
