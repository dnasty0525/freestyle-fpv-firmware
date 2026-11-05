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

#include <string.h>

#include "platform.h"

#ifdef USE_FREESTYLE_SMITH_PREDICTOR

#include "common/maths.h"

#include "freestyle/smith_predictor.h"

void smithPredictorInit(smithPredictor_t *sp, bool enabled, uint8_t strengthPercent, uint8_t delayTenthsMs,
                        uint8_t filterHz, uint32_t looptimeUs)
{
    memset(sp, 0, sizeof(*sp));

    if (looptimeUs == 0) {
        return;
    }

    // delay [0.1ms] * 100 / looptime [us] = samples (same as EmuFlight)
    const uint32_t samples = (uint32_t)delayTenthsMs * 100 / looptimeUs;

    // EmuFlight stored the sample count in a uint8_t and never bounded it by
    // the buffer size; clamp so a long delay at a fast loop can't overrun.
    sp->samples = MIN(samples, FREESTYLE_SMITH_MAX_SAMPLES);
    sp->enabled = enabled && sp->samples > 1;
    sp->strength = strengthPercent / 100.0f;

    pt1FilterInit(&sp->correctionFilter, pt1FilterGain(MAX(filterHz, 1), looptimeUs * 1e-6f));
}

FREESTYLE_FAST_CODE float smithPredictorApply(smithPredictor_t *sp, float gyroFiltered)
{
    if (!sp->enabled) {
        return gyroFiltered;
    }

    sp->data[sp->idx] = gyroFiltered;
    sp->idx++;
    if (sp->idx > sp->samples) {
        sp->idx = 0;
    }
    // the next slot to be written holds the oldest sample: `samples` ago
    const float delayedGyro = sp->data[sp->idx];

    float correction = sp->strength * (gyroFiltered - delayedGyro);
    correction = pt1FilterApply(&sp->correctionFilter, correction);
    sp->lastCorrection = correction;

    return gyroFiltered + correction;
}

#endif // USE_FREESTYLE_SMITH_PREDICTOR
