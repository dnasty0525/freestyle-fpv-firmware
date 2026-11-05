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

#include <math.h>
#include <stdbool.h>

#include "platform.h"

#ifdef USE_FREESTYLE_FILTERS

#include "build/debug.h"
#include "common/axis.h"
#include "common/utils.h"
#include "sensors/gyro.h"

#include "freestyle/freestyle_config.h"
#include "freestyle/freestyle_filters.h"

#ifdef USE_FREESTYLE_KALMAN
#include "freestyle/kalman.h"
#endif
#ifdef USE_FREESTYLE_SMITH_PREDICTOR
#include "freestyle/smith_predictor.h"
#endif
#ifdef USE_FREESTYLE_ABG
#include "freestyle/abg_filter.h"
#endif

#ifdef USE_FREESTYLE_KALMAN
static freestyleKalman_t kalman[XYZ_AXIS_COUNT];
static bool kalmanEnabled[XYZ_AXIS_COUNT];
#endif

#ifdef USE_FREESTYLE_SMITH_PREDICTOR
static smithPredictor_t smithPredictor[XYZ_AXIS_COUNT];
#endif

#ifdef USE_FREESTYLE_ABG
static abgFilter_t gyroAbg[XYZ_AXIS_COUNT];
static bool gyroAbgEnabled;
static abgFilter_t dtermAbg[XYZ_AXIS_COUNT];
static bool dtermAbgEnabled;
#endif

void freestyleGyroFiltersInit(uint32_t looptimeUs)
{
    const freestyleFilterConfig_t *cfg = freestyleFilterConfig();
    const float dT = looptimeUs * 1e-6f;

#ifdef USE_FREESTYLE_KALMAN
    const uint16_t q[XYZ_AXIS_COUNT] = { cfg->imuf_roll_q, cfg->imuf_pitch_q, cfg->imuf_yaw_q };
    for (int axis = 0; axis < XYZ_AXIS_COUNT; axis++) {
        kalmanEnabled[axis] = looptimeUs > 0 && q[axis] > 0;
        freestyleKalmanInit(&kalman[axis], q[axis], cfg->imuf_w, dT);
    }
#endif

#ifdef USE_FREESTYLE_SMITH_PREDICTOR
    for (int axis = 0; axis < XYZ_AXIS_COUNT; axis++) {
        smithPredictorInit(&smithPredictor[axis], cfg->smith_predict_enabled, cfg->smith_predict_str,
                           cfg->smith_predict_delay, cfg->smith_predict_filt_hz, looptimeUs);
    }
#endif

#ifdef USE_FREESTYLE_ABG
    gyroAbgEnabled = looptimeUs > 0 && cfg->gyro_abg_alpha > 0;
    for (int axis = 0; axis < XYZ_AXIS_COUNT; axis++) {
        abgFilterInit(&gyroAbg[axis], cfg->gyro_abg_alpha, cfg->gyro_abg_boost, cfg->gyro_abg_half_life, dT);
    }
#endif

    UNUSED(cfg);
    UNUSED(dT);
}

// After the RPM filter, before the static notches and lowpass.
FREESTYLE_FAST_CODE float freestyleGyroPreFilter(int axis, float gyroRate)
{
#ifdef USE_FREESTYLE_KALMAN
    if (kalmanEnabled[axis]) {
        const float input = gyroRate;
        gyroRate = freestyleKalmanApply(&kalman[axis], gyroRate);
        if (axis == gyro.gyroDebugAxis) {
            DEBUG_SET(DEBUG_KALMAN, 0, lrintf(input));                    //!< Gyro before Kalman (dbg-axis) [unit:dps]
            DEBUG_SET(DEBUG_KALMAN, 1, lrintf(gyroRate));                 //!< Gyro after Kalman (dbg-axis) [unit:dps]
            DEBUG_SET(DEBUG_KALMAN, 2, lrintf(kalman[axis].r * 1000.0f)); //!< Measured noise r (dbg-axis) [unit:0.001]
            DEBUG_SET(DEBUG_KALMAN, 3, lrintf(kalman[axis].k * 1000.0f)); //!< Kalman gain k (dbg-axis) [unit:0.001]
        }
    }
#else
    UNUSED(axis);
#endif
    return gyroRate;
}

// After the dynamic notch; the value returned becomes gyro.gyroADCf.
FREESTYLE_FAST_CODE float freestyleGyroPostFilter(int axis, float gyroRate)
{
#ifdef USE_FREESTYLE_ABG
    if (gyroAbgEnabled) {
        gyroRate = abgFilterApply((filter_t *)&gyroAbg[axis], gyroRate);
    }
#endif

#ifdef USE_FREESTYLE_KALMAN
    // noise estimate from the fully filtered rate, before delay compensation
    if (kalmanEnabled[axis]) {
        freestyleKalmanUpdateVariance(&kalman[axis], gyroRate);
    }
#endif

#ifdef USE_FREESTYLE_SMITH_PREDICTOR
    // EmuFlight called this with the roll predictor for every axis and
    // discarded the result, so the predictor never affected the gyro there.
    // Here each axis has its own predictor and the output is used.
    const float beforeSmith = gyroRate;
    gyroRate = smithPredictorApply(&smithPredictor[axis], gyroRate);
    if (axis == gyro.gyroDebugAxis) {
        DEBUG_SET(DEBUG_SMITH_PREDICTOR, 0, lrintf(beforeSmith));                                    //!< Gyro before Smith (dbg-axis) [unit:dps]
        DEBUG_SET(DEBUG_SMITH_PREDICTOR, 1, lrintf(gyroRate));                                       //!< Gyro after Smith (dbg-axis) [unit:dps]
        DEBUG_SET(DEBUG_SMITH_PREDICTOR, 2, lrintf(smithPredictor[axis].lastCorrection * 10.0f));    //!< Correction (dbg-axis) [unit:0.1dps]
        DEBUG_SET(DEBUG_SMITH_PREDICTOR, 3, smithPredictor[axis].samples);                           //!< Delay in gyro samples
    }
#endif

    UNUSED(axis);
    return gyroRate;
}

void freestyleDtermFiltersInit(float dT)
{
#ifdef USE_FREESTYLE_ABG
    const freestyleFilterConfig_t *cfg = freestyleFilterConfig();
    dtermAbgEnabled = dT > 0.0f && cfg->dterm_abg_alpha > 0;
    for (int axis = 0; axis < XYZ_AXIS_COUNT; axis++) {
        abgFilterInit(&dtermAbg[axis], cfg->dterm_abg_alpha, cfg->dterm_abg_boost, cfg->dterm_abg_half_life, dT);
    }
#else
    UNUSED(dT);
#endif
}

// After the D-term notch and lowpass filters, before the derivative is taken.
FREESTYLE_FAST_CODE float freestyleDtermApply(int axis, float gyroRateDterm)
{
#ifdef USE_FREESTYLE_ABG
    if (dtermAbgEnabled) {
        return abgFilterApply((filter_t *)&dtermAbg[axis], gyroRateDterm);
    }
#endif
    UNUSED(axis);
    return gyroRateDterm;
}

#endif // USE_FREESTYLE_FILTERS
