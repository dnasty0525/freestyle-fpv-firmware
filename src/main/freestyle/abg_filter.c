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

#include <math.h>
#include <string.h>

#include "platform.h"

#ifdef USE_FREESTYLE_ABG

#include "freestyle/abg_filter.h"

// Gains for beta, gamma and eta derive from alpha as in
// Jeong et al. 2017, "A Study on the alpha-beta-gamma-eta filter".
void abgFilterInit(abgFilter_t *filter, uint16_t alpha, uint16_t boostGain, uint8_t halfLife, float dT)
{
    memset(filter, 0, sizeof(*filter));

    const float a = alpha * 0.001f;
    const float xi = powf(1.0f - a, 0.25f);  // fourth root of (1 - alpha)
    const float oneMinusXi = 1.0f - xi;

    filter->a = a;
    filter->b = (1.0f / 6.0f) * oneMinusXi * oneMinusXi * (11.0f + 14.0f * xi + 11.0f * xi * xi);
    filter->g = 2.0f * oneMinusXi * oneMinusXi * oneMinusXi * (1.0f + xi);
    filter->e = (1.0f / 6.0f) * oneMinusXi * oneMinusXi * oneMinusXi * oneMinusXi;
    filter->dT = dT;
    filter->dT2 = dT * dT;
    filter->dT3 = dT * dT * dT;

    pt1FilterInit(&filter->boostFilter, pt1FilterGain(100, dT));
    pt1FilterInit(&filter->velFilter, pt1FilterGain(75, dT));
    pt1FilterInit(&filter->accFilter, pt1FilterGain(50, dT));
    pt1FilterInit(&filter->jerkFilter, pt1FilterGain(25, dT));

    // EmuFlight computed this as (boost * boost / 1000000) * 0.003 in integer
    // math, which truncated to 0 for every boost below 1000 (including the
    // default 275). Done in float here so the setting actually does something.
    filter->boost = ((float)boostGain * boostGain / 1000000.0f) * 0.003f;

    filter->halfLife = halfLife != 0 ? powf(0.5f, dT / (halfLife / 100.0f)) : 1.0f;
}

FREESTYLE_FAST_CODE float abgFilterApply(filter_t *filterPtr, float input)
{
    abgFilter_t *filter = (abgFilter_t *)filterPtr;

    // limited history: decay the state toward zero
    filter->xk *= filter->halfLife;
    filter->vk *= filter->halfLife;
    filter->ak *= filter->halfLife;
    filter->jk *= filter->halfLife;

    // predict
    filter->xk += filter->dT * filter->vk + 0.5f * filter->dT2 * filter->ak + (1.0f / 6.0f) * filter->dT3 * filter->jk;
    filter->vk += filter->dT * filter->ak + 0.5f * filter->dT2 * filter->jk;
    filter->ak += filter->dT * filter->jk;

    // residual, boosted to sharpen the response to large errors
    float rk = input - filter->xk;
    rk += pt1FilterApply(&filter->boostFilter, fabsf(rk) * rk * filter->boost);
    filter->rk = rk;

    // correct
    filter->xk += filter->a * rk;
    filter->vk += filter->b / filter->dT * rk;
    filter->ak += filter->g / (2.0f * filter->dT2) * rk;
    filter->jk += filter->e / (6.0f * filter->dT3) * rk;

    filter->vk = pt1FilterApply(&filter->velFilter, filter->vk);
    filter->ak = pt1FilterApply(&filter->accFilter, filter->ak);
    filter->jk = pt1FilterApply(&filter->jerkFilter, filter->jk);

    return filter->xk;
}

#endif // USE_FREESTYLE_ABG
