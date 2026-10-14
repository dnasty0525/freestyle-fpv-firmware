/*
 * This file is part of the Freestyle fork of Betaflight.
 * Ported from EmuFlight (src/main/common/kalman.c).
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

#include <math.h>
#include <string.h>

#include "platform.h"

#ifdef USE_FREESTYLE_KALMAN

#include "common/maths.h"

#include "freestyle/kalman.h"

// Seeds match EmuFlight so tunes carry over.
#define KALMAN_R_SEED       88.0f
#define KALMAN_P_SEED       30.0f
#define KALMAN_Q_SCALE      0.0001f
#define KALMAN_GAIN_LPF_HZ  50.0f
#define KALMAN_R_DIVISOR    45.0f
#define KALMAN_P_OFFSET     10.0f

void freestyleKalmanInit(freestyleKalman_t *filter, uint16_t q, uint16_t w, float dT)
{
    memset(filter, 0, sizeof(*filter));

    filter->q = q * KALMAN_Q_SCALE;
    filter->r = KALMAN_R_SEED;
    filter->p = KALMAN_P_SEED;
    filter->e = 1.0f;

    // EmuFlight used a w + 1 slot ring with one slot always pending removal;
    // this ring holds exactly w slots, which gives the same w-sample average.
    filter->w = constrain(w, 3, FREESTYLE_KALMAN_MAX_WINDOW);
    filter->inverseN = 1.0f / filter->w;

    pt1FilterInit(&filter->kFilter, pt1FilterGain(KALMAN_GAIN_LPF_HZ, dT));
}

FAST_CODE float freestyleKalmanApply(freestyleKalman_t *filter, float input)
{
    // project the state ahead using the last change
    filter->x += (filter->x - filter->lastX) * filter->k;
    filter->lastX = filter->x;

    // Weight the process noise by how noisy the signal currently is:
    // e' = -0.7(e-1)^2 + 0.3(e-1) + 1, with e from the measured noise.
    // EmuFlight used powf() here; written out to avoid it in the 8kHz loop.
    const float eBase = constrainf(filter->r / KALMAN_R_DIVISOR + 0.005f, 0.005f, 0.9f) - 1.0f;
    filter->e = -0.7f * eBase * eBase + 0.3f * eBase + 1.0f;

    // prediction update
    filter->p = filter->p + filter->q * filter->e;

    // measurement update
    filter->k = filter->p / (filter->p + KALMAN_P_OFFSET);
    filter->k = pt1FilterApply(&filter->kFilter, filter->k);
    filter->x += filter->k * (input - filter->x);
    filter->p = (1.0f - filter->k) * filter->p;

    return filter->x;
}

// Called with the fully filtered gyro rate, so the noise estimate reflects
// what the PID loop actually sees.
FAST_CODE void freestyleKalmanUpdateVariance(freestyleKalman_t *filter, float filteredRate)
{
    const uint16_t i = filter->windex;

    // drop the oldest sample, which lives in the slot about to be overwritten
    filter->sumMean -= filter->window[i];
    filter->sumVar -= filter->varianceWindow[i];

    const float deviation = filteredRate - filter->mean;
    const float varianceElement = deviation * deviation;

    filter->window[i] = filteredRate;
    filter->varianceWindow[i] = varianceElement;
    filter->sumMean += filteredRate;
    filter->sumVar += varianceElement;

    filter->windex = (i + 1 >= filter->w) ? 0 : i + 1;

    filter->mean = filter->sumMean * filter->inverseN;
    // float drift in the running sum can push it slightly negative
    filter->variance = MAX(filter->sumVar * filter->inverseN, 0.0f);
    filter->r = sqrtf(filter->variance);
}

#endif // USE_FREESTYLE_KALMAN
