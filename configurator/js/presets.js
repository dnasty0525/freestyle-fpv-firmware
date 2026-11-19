/*
 * Freestyle Setup: frame presets and the setup plan.
 *
 * Every preset starts from the firmware defaults (Betaflight's defaults are
 * tuned on a 5" freestyle quad) and moves only a few things, mostly through
 * the simplified tuning sliders so the PID and filter maths stay upstream's.
 *
 * These are starting points. After the first pack on a new preset, land and
 * feel the motors: warm is fine, too hot to hold means back off.
 *
 * GPL-3.0, same as the firmware.
 */
(function (root) {
    'use strict';

    const FRAMES = {
        '3': {
            label: '3"',
            blurb: '3–3.5" freestyle, 1404–1804 motors, 4S or 6S',
            sliders: { master: 110, pi: 100, d: 100, ff: 100, gyroFilter: 120, dtermFilter: 115 },
            extra: ['set iterm_relax_cutoff = 15', 'set dyn_notch_min_hz = 120'],
            dynIdleMinRpm: 45,
        },
        '4': {
            label: '4"',
            blurb: '4" freestyle, 1804–2004 motors',
            sliders: { master: 105, pi: 100, d: 100, ff: 100, gyroFilter: 110, dtermFilter: 105 },
            extra: ['set iterm_relax_cutoff = 15', 'set dyn_notch_min_hz = 110'],
            dynIdleMinRpm: 40,
        },
        '5': {
            label: '5"',
            blurb: '5" freestyle, 2205–2306 motors, the classic',
            sliders: { master: 100, pi: 100, d: 100, ff: 100, gyroFilter: 100, dtermFilter: 100 },
            extra: ['set iterm_relax_cutoff = 15', 'set dyn_notch_min_hz = 100'],
            dynIdleMinRpm: 35,
        },
        '7': {
            label: '7"',
            blurb: '7" long range freestyle, 2806–2810 motors',
            sliders: { master: 85, pi: 95, d: 110, ff: 90, gyroFilter: 80, dtermFilter: 80 },
            extra: ['set iterm_relax_cutoff = 10', 'set dyn_notch_min_hz = 70', 'set rpm_filter_min_hz = 80'],
            dynIdleMinRpm: 25,
        },
    };

    // Actual rates: center = rate at stick center (deg/s), max = full stick, expo 0..1
    const FEELS = {
        smooth: {
            label: 'Smooth',
            blurb: 'Floaty and precise. Cinematic lines, gaps, slow rolls.',
            rp: { center: 150, max: 650, expo: 0.40 },
            yaw: { center: 150, max: 550, expo: 0.30 },
            rcSmoothing: 50,
        },
        standard: {
            label: 'Standard',
            blurb: 'All-round freestyle. A good place to start.',
            rp: { center: 200, max: 750, expo: 0.50 },
            yaw: { center: 200, max: 650, expo: 0.40 },
            rcSmoothing: 35,
        },
        aggressive: {
            label: 'Aggressive',
            blurb: 'Fast flips and snappy combos. Twitchy at center for some.',
            rp: { center: 250, max: 900, expo: 0.55 },
            yaw: { center: 220, max: 750, expo: 0.45 },
            rcSmoothing: 30,
        },
    };

    const RECEIVERS = {
        elrs:   { label: 'ExpressLRS', provider: 'CRSF', hint: 'Any ELRS receiver' },
        crsf:   { label: 'TBS Crossfire / Tracer', provider: 'CRSF', hint: 'Nano RX, Tracer' },
        ghost:  { label: 'ImmersionRC Ghost', provider: 'GHST', hint: 'Ghost Atto, Zepto' },
        sbus:   { label: 'FrSky / FlySky SBUS', provider: 'SBUS', hint: 'Use the board\'s SBUS pad' },
        srxl2:  { label: 'Spektrum SRXL2', provider: 'SRXL2', hint: 'SPM4651T and newer' },
        ibus:   { label: 'FlySky iBUS', provider: 'IBUS', hint: 'FS-A8S, FS-X6B' },
    };

    // Mode permanent IDs (msp_box.c)
    const MODES = {
        arm:    { id: 0, label: 'Arm' },
        angle:  { id: 1, label: 'Angle (self-level)' },
        turtle: { id: 35, label: 'Turtle (flip over after crash)' },
        beeper: { id: 13, label: 'Beeper (find a lost quad)' },
    };

    function rateLines(feel) {
        const r = (axis, a) => [
            `set ${axis}_rc_rate = ${Math.round(a.center / 10)}`,
            `set ${axis}_srate = ${Math.round(a.max / 10)}`,
            `set ${axis}_expo = ${Math.round(a.expo * 100)}`,
        ];
        return [
            'set rates_type = ACTUAL',
            ...r('roll', feel.rp),
            ...r('pitch', feel.rp),
            ...r('yaw', feel.yaw),
        ];
    }

    function sliderLines(s) {
        return [
            'set simplified_pids_mode = RPY',
            `set simplified_master_multiplier = ${s.master}`,
            `set simplified_pi_gain = ${s.pi}`,
            `set simplified_d_gain = ${s.d}`,
            `set simplified_feedforward_gain = ${s.ff}`,
            'set simplified_gyro_filter = ON',
            `set simplified_gyro_filter_multiplier = ${s.gyroFilter}`,
            'set simplified_dterm_filter = ON',
            `set simplified_dterm_filter_multiplier = ${s.dtermFilter}`,
        ];
    }

    // Round a channel value into an aux range the FC accepts (900..2100, 25us steps).
    function auxRange(value) {
        const clamp = (v) => Math.min(2100, Math.max(900, Math.round(v / 25) * 25));
        return [clamp(value - 175), clamp(value + 175)];
    }

    /*
     * Build the CLI commands for the first apply (before the reboot).
     *
     * choices: { frame, feel, receiver, rxUart, escRpm (bool), propsOut (bool),
     *            craftName, kalman (bool) }
     * caps:    { hasRxUart (bool: firmware uses `set rx_uart`), motorProtocol (string),
     *            hasKalman (bool), kalmanOn (bool: Kalman already enabled on the FC) }
     */
    function buildPlan(choices, caps) {
        const frame = FRAMES[choices.frame];
        const feel = FEELS[choices.feel];
        const rx = RECEIVERS[choices.receiver];
        const lines = [];
        const section = (title) => lines.push('# ' + title);

        section('Receiver: ' + rx.label + ' on ' + choices.rxUart);
        lines.push('feature RX_SERIAL');
        if (caps.hasRxUart) {
            lines.push('set rx_uart = ' + choices.rxUart);
        } else {
            const n = parseInt(choices.rxUart.replace(/\D/g, ''), 10);
            lines.push(`serial ${n - 1} 64 115200 57600 0 115200`);
        }
        lines.push('set serialrx_provider = ' + rx.provider);

        section('Motors and ESCs');
        if (!/^DSHOT/.test(caps.motorProtocol || '')) {
            lines.push('set motor_pwm_protocol = DSHOT600');
        }
        lines.push('set yaw_motors_reversed = ' + (choices.propsOut ? 'ON' : 'OFF'));
        if (choices.escRpm) {
            lines.push('set dshot_bidir = ON');
            lines.push('set dyn_notch_count = 1');
            lines.push('set dyn_notch_q = 500');
            lines.push('set dyn_idle_min_rpm = ' + frame.dynIdleMinRpm);
        } else {
            lines.push('set dshot_bidir = OFF');
            lines.push('set dyn_idle_min_rpm = 0');
        }

        section('Tune: ' + frame.label + ' freestyle');
        lines.push(...sliderLines(frame.sliders));
        lines.push('simplified_tuning apply');
        lines.push(...frame.extra);
        lines.push('set vbat_sag_compensation = 100');
        lines.push('set rc_smoothing_auto_factor = ' + feel.rcSmoothing);

        // Only touch the Kalman filter when the pilot changed it, so a tune
        // already on the quad survives the wizard.
        if (caps.hasKalman && choices.kalman !== caps.kalmanOn) {
            section('Kalman smoothing');
            const q = choices.kalman ? 6000 : 0;
            lines.push(`set imuf_roll_q = ${q}`, `set imuf_pitch_q = ${q}`, `set imuf_yaw_q = ${q}`);
        }

        section('Rates: ' + feel.label);
        lines.push(...rateLines(feel));

        if (choices.craftName) {
            section('Name');
            lines.push('set craft_name = ' + choices.craftName.replace(/[^A-Za-z0-9 _-]/g, '').slice(0, 16));
        }

        return lines;
    }

    /*
     * Switches: { arm: {aux, value}, angle: {...}|null, ... } where aux is the
     * AUX index (0 = AUX1) and value the channel reading in the ON position.
     */
    function switchLines(switches) {
        const lines = ['# Switches'];
        for (let i = 0; i < 20; i++) lines.push(`aux ${i} 0 0 900 900 0 0`);
        let slot = 0;
        for (const key of Object.keys(MODES)) {
            const s = switches[key];
            if (!s) continue;
            const [lo, hi] = auxRange(s.value);
            lines.push(`aux ${slot} ${MODES[key].id} ${s.aux} ${lo} ${hi} 0 0`);
            slot++;
        }
        return lines;
    }

    /*
     * Channel map. found[f] = mapped index where stick function f
     * (0 roll, 1 pitch, 2 yaw, 3 throttle) showed up; currentMap is the
     * FC's `map` string. Returns the corrected map string.
     */
    function fixChannelMap(currentMap, found) {
        // Betaflight's function letters in rcData order: roll, pitch, yaw, throttle.
        // In a map string, position = raw receiver channel, letter = what it carries.
        const letters = 'AERT';
        const cur = currentMap.toUpperCase().padEnd(8, '-').split('');
        // rawChannelOf[mapped function] = raw channel carrying it today
        const rawOf = {};
        cur.forEach((ch, raw) => {
            const f = letters.indexOf(ch);
            if (f >= 0) rawOf[f] = raw;
        });
        const next = cur.slice();
        for (let raw = 0; raw < 4; raw++) next[raw] = null;
        for (let f = 0; f < 4; f++) {
            const raw = rawOf[found[f]];
            if (raw === undefined || raw > 3) return null;
            next[raw] = letters[f];
        }
        if (next.slice(0, 4).some((x) => x === null)) return null;
        return next.slice(0, 8).join('');
    }

    /*
     * Motor order. reorder = current output reordering; corner[i] = which
     * position (0 rear-right, 1 front-right, 2 rear-left, 3 front-left,
     * i.e. Betaflight motor numbers 1-4) spun when logical motor i was driven.
     * Returns the new reordering, or null if the answers are not a permutation.
     */
    function fixMotorOrder(reorder, corner) {
        if (new Set(corner).size !== 4 || corner.some((c) => c < 0 || c > 3)) return null;
        const next = reorder.slice();
        for (let i = 0; i < 4; i++) next[corner[i]] = reorder[i];
        return next;
    }

    // Expected spin per position, viewed from above. Props in = Betaflight default.
    function expectedSpin(position, propsOut) {
        const propsIn = ['CW', 'CCW', 'CCW', 'CW'][position];
        if (!propsOut) return propsIn;
        return propsIn === 'CW' ? 'CCW' : 'CW';
    }

    const api = { FRAMES, FEELS, RECEIVERS, MODES, buildPlan, switchLines, fixChannelMap, fixMotorOrder, expectedSpin, auxRange };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.FS = Object.assign(root.FS || {}, api);
})(this);
