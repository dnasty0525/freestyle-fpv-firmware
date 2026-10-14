/*
 * This file is part of the Freestyle fork of Betaflight.
 *
 * CLI setting rows for fork features. Textually included at the end of
 * valueTable[] in cli/settings.c so upstream edits to that table never
 * conflict with fork settings. Names match EmuFlight so tunes paste over.
 */

#ifdef USE_FREESTYLE_KALMAN
    { "imuf_roll_q",                VAR_UINT16 | MASTER_VALUE, .config.minmaxUnsigned = { 0, 16000 }, PG_FREESTYLE_FILTER_CONFIG, offsetof(freestyleFilterConfig_t, imuf_roll_q) },
    { "imuf_pitch_q",               VAR_UINT16 | MASTER_VALUE, .config.minmaxUnsigned = { 0, 16000 }, PG_FREESTYLE_FILTER_CONFIG, offsetof(freestyleFilterConfig_t, imuf_pitch_q) },
    { "imuf_yaw_q",                 VAR_UINT16 | MASTER_VALUE, .config.minmaxUnsigned = { 0, 16000 }, PG_FREESTYLE_FILTER_CONFIG, offsetof(freestyleFilterConfig_t, imuf_yaw_q) },
    { "imuf_w",                     VAR_UINT16 | MASTER_VALUE, .config.minmaxUnsigned = { 3, FREESTYLE_KALMAN_MAX_WINDOW }, PG_FREESTYLE_FILTER_CONFIG, offsetof(freestyleFilterConfig_t, imuf_w) },
#endif

#ifdef USE_FREESTYLE_SMITH_PREDICTOR
    { "smith_predict_enabled",      VAR_UINT8  | MASTER_VALUE | MODE_LOOKUP, .config.lookup = { TABLE_OFF_ON }, PG_FREESTYLE_FILTER_CONFIG, offsetof(freestyleFilterConfig_t, smith_predict_enabled) },
    { "smith_predict_str",          VAR_UINT8  | MASTER_VALUE, .config.minmaxUnsigned = { 0, 100 }, PG_FREESTYLE_FILTER_CONFIG, offsetof(freestyleFilterConfig_t, smith_predict_str) },
    { "smith_predict_delay",        VAR_UINT8  | MASTER_VALUE, .config.minmaxUnsigned = { 0, FREESTYLE_SMITH_MAX_DELAY }, PG_FREESTYLE_FILTER_CONFIG, offsetof(freestyleFilterConfig_t, smith_predict_delay) },
    { "smith_predict_filt_hz",      VAR_UINT8  | MASTER_VALUE, .config.minmaxUnsigned = { 1, 250 }, PG_FREESTYLE_FILTER_CONFIG, offsetof(freestyleFilterConfig_t, smith_predict_filt_hz) },
#endif

#ifdef USE_FREESTYLE_ABG
    { "gyro_abg_alpha",             VAR_UINT16 | MASTER_VALUE, .config.minmaxUnsigned = { 0, 1000 }, PG_FREESTYLE_FILTER_CONFIG, offsetof(freestyleFilterConfig_t, gyro_abg_alpha) },
    { "gyro_abg_boost",             VAR_UINT16 | MASTER_VALUE, .config.minmaxUnsigned = { 0, 2000 }, PG_FREESTYLE_FILTER_CONFIG, offsetof(freestyleFilterConfig_t, gyro_abg_boost) },
    { "gyro_abg_half_life",         VAR_UINT8  | MASTER_VALUE, .config.minmaxUnsigned = { 0, 250 },  PG_FREESTYLE_FILTER_CONFIG, offsetof(freestyleFilterConfig_t, gyro_abg_half_life) },
    { "dterm_abg_alpha",            VAR_UINT16 | MASTER_VALUE, .config.minmaxUnsigned = { 0, 1000 }, PG_FREESTYLE_FILTER_CONFIG, offsetof(freestyleFilterConfig_t, dterm_abg_alpha) },
    { "dterm_abg_boost",            VAR_UINT16 | MASTER_VALUE, .config.minmaxUnsigned = { 0, 2000 }, PG_FREESTYLE_FILTER_CONFIG, offsetof(freestyleFilterConfig_t, dterm_abg_boost) },
    { "dterm_abg_half_life",        VAR_UINT8  | MASTER_VALUE, .config.minmaxUnsigned = { 0, 250 },  PG_FREESTYLE_FILTER_CONFIG, offsetof(freestyleFilterConfig_t, dterm_abg_half_life) },
#endif
