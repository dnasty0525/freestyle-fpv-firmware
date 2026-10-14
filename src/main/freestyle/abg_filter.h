/*
 * This file is part of the Freestyle fork of Betaflight.
 * Ported from EmuFlight (src/main/common/filter.c, ABGInit/alphaBetaGammaApply).
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

// Alpha-beta-gamma(-eta) tracking filter: estimates position, velocity,
// acceleration and jerk of the signal and returns the position estimate.
typedef struct abgFilter_s {
    float a, b, g, e;
    float xk, vk, ak, jk;   // state estimates
    float rk;               // last residual, kept for logging
    float dT, dT2, dT3;
    float halfLife;         // per-sample decay applied to the state
    float boost;
    pt1Filter_t boostFilter, velFilter, accFilter, jerkFilter;
} abgFilter_t;

void abgFilterInit(abgFilter_t *filter, uint16_t alpha, uint16_t boostGain, uint8_t halfLife, float dT);
float abgFilterApply(filter_t *filter, float input);
