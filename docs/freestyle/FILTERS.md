# Ported EmuFlight filters

Three filters from EmuFlight, added on top of Betaflight's stack (RPM filter,
static notches, gyro lowpass, dynamic notch). All of them ship **off**: the
upstream stack is the known-good baseline, so turn one on at a time and check
it in Blackbox before stacking the next.

CLI names match EmuFlight, so the relevant lines of an EmuFlight `diff` paste
straight in.

## Where they sit

```
gyro:   RPM filter -> [Kalman] -> notches -> LPF -> dynamic notch -> [gyro ABG] -> [Smith predictor]
D-term: gyro -> D notch -> D LPF1 -> D LPF2 -> [D-term ABG] -> derivative
```

## Kalman (gyro)

An adaptive Kalman filter: it smooths harder when the gyro is noisy and backs
off when it's clean, using the variance of the filtered gyro over a short window.

| Setting        | Default | EmuFlight default | Notes                                        |
|----------------|---------|-------------------|----------------------------------------------|
| `imuf_roll_q`  | 0 (off) | 6000              | higher q = less filtering, less delay        |
| `imuf_pitch_q` | 0 (off) | 6000              |                                              |
| `imuf_yaw_q`   | 0 (off) | 6000              |                                              |
| `imuf_w`       | 32      | 32                | variance window in samples, 3-128            |

Turn on: `set imuf_roll_q = 6000`, the same for pitch and yaw. Use
`set debug_mode = KALMAN`: debug 0/1 are gyro before/after, 2 is measured
noise, 3 is the Kalman gain.

## Smith predictor (gyro)

Adds back an estimate of the delay the filter stack introduced, which sharpens
response and helps propwash at the cost of some noise.

| Setting                 | Default   | Notes                                              |
|-------------------------|-----------|----------------------------------------------------|
| `smith_predict_enabled` | OFF       |                                                    |
| `smith_predict_str`     | 50        | percent of the estimated lag to add back           |
| `smith_predict_delay`   | 40        | tenths of a millisecond (40 = 4ms), max 120        |
| `smith_predict_filt_hz` | 5         | lowpass on the correction term                     |

**Treat this as new.** In EmuFlight 0.4.x the predictor was called with the
roll axis state for every axis and its output was thrown away, so it never
changed the gyro signal. It works here, which means no EmuFlight tune has ever
flown with it active. Start with a low `smith_predict_str` (around 20), hover,
check motor temperatures, then raise it. `debug_mode = SMITH_PREDICTOR` logs
gyro before/after, the correction, and the delay in samples.

## Alpha-beta-gamma (gyro and D-term)

A tracking filter that estimates the signal's rate, acceleration and jerk. It
follows fast moves with less lag than a lowpass of similar smoothing.

| Setting                                       | Default | Notes                                  |
|-----------------------------------------------|---------|----------------------------------------|
| `gyro_abg_alpha` / `dterm_abg_alpha`          | 0 (off) | 1-1000; lower = more smoothing         |
| `gyro_abg_boost` / `dterm_abg_boost`          | 0       | extra response to large errors         |
| `gyro_abg_half_life` / `dterm_abg_half_life`  | 50      | state memory in 1/100 s, 0 = infinite  |

Two changes from EmuFlight:

- **Gyro ABG works.** EmuFlight set it up but never ran it in the gyro loop.
- **Boost works.** EmuFlight computed it with integer math, so any boost below
  1000 (including its default 275) became 0. The default here is 0 to match
  what EmuFlight pilots actually flew; values below 1000 now have a small real effect.

D-term ABG is one global setting rather than per PID profile, which keeps it out
of Betaflight's `pidProfile_t`.

## Suggested test order

1. Fly the stock tune and save a Blackbox log as the baseline.
2. Kalman at 6000 on all axes. Compare gyro noise and motor temperatures.
3. D-term ABG (`dterm_abg_alpha = 300` is a reasonable start).
4. Smith predictor, starting at a low strength.

Props off for every first arm after a filter change, and land to check motor
temperature after the first short pack.

## Cost

Measured with `make CONFIG=...` against the same build with
`FREESTYLE_DISABLE_FILTERS` defined:

| Board           | Flash    | RAM      |
|-----------------|----------|----------|
| MATEKF411       | +2.6 KB  | +5.1 KB  |
| SPEEDYBEEF405V3 | +3.7 KB  | +5.1 KB  |
| MATEKH743       | +2.9 KB  | +5.1 KB  |

On STM32F7 boards the fork's filter code runs from flash rather than ITCM
(F7 has only 16 KB of ITCM and stock Betaflight fills about 95% of it), so
expect slightly more CPU per loop there than on H7.

CPU cost per loop has not been measured on hardware yet. On F411 boards check
`status` (CPU load) and `tasks` with all three enabled before flying.
