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
 * Fork-wide feature switches. Included once from target/common_post.h, after
 * the board config and target.h, so every fork feature can be compiled out
 * per board, and so upstream files only ever see USE_FREESTYLE_* guards.
 *
 * Define FREESTYLE_DISABLE_FILTERS in a board config to drop the ported
 * EmuFlight filters entirely (for example on a tight F411 build).
 */

#pragma once

#define USE_FREESTYLE

// Placement for the fork's per-loop filter code. STM32F7 has only 16KB of
// ITCM and stock Betaflight already fills about 95% of it, so on F7 the fork
// code runs from flash (through the ART accelerator and instruction cache).
// H7 has 64KB of ITCM, so it keeps FAST_CODE. A board can override this.
#ifndef FREESTYLE_FAST_CODE
#if defined(STM32F7)
#define FREESTYLE_FAST_CODE
#else
#define FREESTYLE_FAST_CODE FAST_CODE
#endif
#endif

#if !defined(FREESTYLE_DISABLE_FILTERS) && !defined(USE_GYRO_IMUF9001)
#define USE_FREESTYLE_KALMAN            // EmuFlight-style adaptive Kalman on gyro
#define USE_FREESTYLE_SMITH_PREDICTOR   // gyro delay compensation
#define USE_FREESTYLE_ABG               // alpha-beta-gamma filter (gyro and D-term)
#endif

#if defined(USE_FREESTYLE_KALMAN) || defined(USE_FREESTYLE_SMITH_PREDICTOR) || defined(USE_FREESTYLE_ABG)
#define USE_FREESTYLE_FILTERS
#endif
