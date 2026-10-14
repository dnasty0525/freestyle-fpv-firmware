/*
 * This file is part of the Freestyle fork of Betaflight.
 *
 * Betaflight is free software. You can redistribute this software
 * and/or modify this software under the terms of the GNU General
 * Public License as published by the Free Software Foundation,
 * either version 3 of the License, or (at your option) any later
 * version.
 *
 * This software is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 * See the GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this software. If not, see <http://www.gnu.org/licenses/>.
 */

#pragma once

#include <stdint.h>

#include "pg/pg.h"

// Fork parameter groups live in their own range, well clear of upstream's
// IDs (currently < 600) and the testing IDs at the top (4093-4095), so an
// upstream rebase never collides with them.
#define PG_FREESTYLE_FILTER_CONFIG  3000

// Kalman measurement window. EmuFlight allowed up to 512 samples per axis
// (about 12KB of RAM); 128 keeps it near 3KB and is well above the default of 32.
#define FREESTYLE_KALMAN_MAX_WINDOW 128

// Smith predictor delay is configured in tenths of a millisecond. 120 (12ms)
// at an 8kHz gyro loop needs 96 samples.
#define FREESTYLE_SMITH_MAX_DELAY   120
#define FREESTYLE_SMITH_MAX_SAMPLES 100U

typedef struct freestyleFilterConfig_s {
    // Kalman (gyro). q = 0 disables the filter on that axis.
    uint16_t imuf_roll_q;
    uint16_t imuf_pitch_q;
    uint16_t imuf_yaw_q;
    uint16_t imuf_w;                 // variance window, samples (3..FREESTYLE_KALMAN_MAX_WINDOW)

    // Smith predictor (gyro)
    uint8_t smith_predict_enabled;
    uint8_t smith_predict_str;       // percent
    uint8_t smith_predict_delay;     // tenths of a millisecond
    uint8_t smith_predict_filt_hz;   // lowpass on the correction term

    // Alpha-beta-gamma (gyro). alpha = 0 disables.
    uint16_t gyro_abg_alpha;         // 0..1000 -> 0.000..1.000
    uint16_t gyro_abg_boost;
    uint8_t  gyro_abg_half_life;     // hundredths of a second, 0 = infinite memory

    // Alpha-beta-gamma (D-term). alpha = 0 disables.
    uint16_t dterm_abg_alpha;
    uint16_t dterm_abg_boost;
    uint8_t  dterm_abg_half_life;
} freestyleFilterConfig_t;

PG_DECLARE(freestyleFilterConfig_t, freestyleFilterConfig);
