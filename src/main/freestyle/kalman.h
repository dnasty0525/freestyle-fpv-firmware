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

#pragma once

#include <stdint.h>

#include "common/filter.h"
#include "freestyle/freestyle_config.h"

// Scalar Kalman filter whose process-noise weight adapts to the measured
// variance of the (post-filter) gyro signal over a sliding window.
typedef struct freestyleKalman_s {
    float q;        // process noise covariance (scaled)
    float r;        // measured noise (sqrt of windowed variance)
    float p;        // estimation error covariance
    float k;        // kalman gain
    float x;        // state
    float lastX;    // previous state
    float e;        // adaptive process-noise weight

    // sliding variance window
    float window[FREESTYLE_KALMAN_MAX_WINDOW + 1];
    float varianceWindow[FREESTYLE_KALMAN_MAX_WINDOW + 1];
    float sumMean;
    float mean;
    float sumVar;
    float variance;
    float inverseN;
    uint16_t windex;
    uint16_t w;

    pt1Filter_t kFilter;
} freestyleKalman_t;

void freestyleKalmanInit(freestyleKalman_t *filter, uint16_t q, uint16_t w, float dT);
float freestyleKalmanApply(freestyleKalman_t *filter, float input);
void freestyleKalmanUpdateVariance(freestyleKalman_t *filter, float filteredRate);
