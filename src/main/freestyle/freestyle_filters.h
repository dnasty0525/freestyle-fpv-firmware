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

/*
 * The only interface upstream code calls for the ported filters. Each hook
 * is a single line at a well-defined point in Betaflight's pipeline:
 *
 *   gyro:   downsample -> RPM filter -> [PreFilter: Kalman]
 *           -> static notches -> LPF -> dynamic notch
 *           -> [PostFilter: gyro ABG, Kalman variance update, Smith predictor]
 *
 *   D-term: gyro rate -> notch -> LPF1 -> LPF2 -> [DtermApply: D-term ABG]
 */

#pragma once

#include <stdint.h>

#include "platform.h"

#ifdef USE_FREESTYLE_FILTERS

void freestyleGyroFiltersInit(uint32_t looptimeUs);
float freestyleGyroPreFilter(int axis, float gyroRate);
float freestyleGyroPostFilter(int axis, float gyroRate);

void freestyleDtermFiltersInit(float dT);
float freestyleDtermApply(int axis, float gyroRateDterm);

#endif // USE_FREESTYLE_FILTERS
