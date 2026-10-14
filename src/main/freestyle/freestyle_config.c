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

#include "platform.h"

#ifdef USE_FREESTYLE_FILTERS

#include "pg/pg_ids.h"

#include "freestyle/freestyle_config.h"

PG_REGISTER_WITH_RESET_TEMPLATE(freestyleFilterConfig_t, freestyleFilterConfig, PG_FREESTYLE_FILTER_CONFIG, 0);

// Everything ships disabled. Upstream's RPM + dynamic notch + lowpass stack
// is the known-good baseline; each ported filter gets switched on and
// flight-tested on its own (see docs/freestyle/FILTERS.md).
// The non-zero values are EmuFlight's defaults, so enabling a filter only
// needs its on/off value set. ABG boost defaults to 0, not EmuFlight's 275:
// EmuFlight's integer math turned 275 into an effective boost of 0, so 0 is
// what pilots there actually flew (see abg_filter.c).
PG_RESET_TEMPLATE(freestyleFilterConfig_t, freestyleFilterConfig,
    .imuf_roll_q = 0,
    .imuf_pitch_q = 0,
    .imuf_yaw_q = 0,
    .imuf_w = 32,

    .smith_predict_enabled = 0,
    .smith_predict_str = 50,
    .smith_predict_delay = 40,
    .smith_predict_filt_hz = 5,

    .gyro_abg_alpha = 0,
    .gyro_abg_boost = 0,
    .gyro_abg_half_life = 50,

    .dterm_abg_alpha = 0,
    .dterm_abg_boost = 0,
    .dterm_abg_half_life = 50,
);

#endif // USE_FREESTYLE_FILTERS
