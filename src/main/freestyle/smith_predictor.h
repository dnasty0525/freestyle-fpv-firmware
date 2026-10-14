/*
 * This file is part of the Freestyle fork of Betaflight.
 * Ported from EmuFlight (src/main/sensors/gyro.c, applySmithPredictor).
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

#include <stdbool.h>
#include <stdint.h>

#include "common/filter.h"
#include "freestyle/freestyle_config.h"

// Adds back an estimate of the phase lag the gyro filter stack introduced,
// from the difference between the current filtered sample and one from
// `delay` ago. The correction itself is lowpassed so it does not add noise.
typedef struct smithPredictor_s {
    bool enabled;
    uint16_t samples;
    uint16_t idx;
    float strength;
    float data[FREESTYLE_SMITH_MAX_SAMPLES + 1];
    pt1Filter_t correctionFilter;
    float lastCorrection;   // for logging
} smithPredictor_t;

void smithPredictorInit(smithPredictor_t *sp, bool enabled, uint8_t strengthPercent, uint8_t delayTenthsMs,
                        uint8_t filterHz, uint32_t looptimeUs);
float smithPredictorApply(smithPredictor_t *sp, float gyroFiltered);
