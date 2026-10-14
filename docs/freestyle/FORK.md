# Freestyle fork: layout and upstream sync

This is a fork of [Betaflight](https://github.com/betaflight/betaflight) aimed at
freestyle flying with a short setup path. It tracks Betaflight `master` and
carries a small, isolated set of changes on top, so it can be rebased onto each
Betaflight release (two per year: June and December) without a merge marathon.

"Freestyle" is a working name; rename the `freestyle/` directory, the
`USE_FREESTYLE_*` flags and the `FREESTYLE` markers together if it changes.

## Branches

| Branch            | Purpose                                                   |
|-------------------|-----------------------------------------------------------|
| `upstream/master` | Betaflight, untouched                                     |
| `freestyle/main`  | the fork: upstream plus the fork commits on top           |
| `feature/*`       | one branch per fork feature, merged into `freestyle/main` |

## Where fork code lives

All fork logic lives in files upstream never touches:

```
mk/freestyle.mk                     fork source lists (included from mk/source.mk)
src/main/freestyle/
  freestyle_pre.h                   USE_FREESTYLE_* feature switches
  freestyle_config.[ch]             parameter group (PG 3000) and defaults
  freestyle_settings.inc            CLI rows, spliced into cli/settings.c
  freestyle_filters.[ch]            the only filter API upstream code calls
  kalman.[ch]                       ported from EmuFlight
  smith_predictor.[ch]              ported from EmuFlight
  abg_filter.[ch]                   ported from EmuFlight
src/test/freestyle/                 parity test against EmuFlight's algorithms
docs/freestyle/                     these docs
```

## Upstream touch points

Every edit to an upstream file is a few lines, guarded by `USE_FREESTYLE*` and
tagged with a `FREESTYLE` comment, so `git grep FREESTYLE -- ':!src/main/freestyle'`
lists all of them. Today that is 49 added lines in 10 files:

| File                                  | What the hook does                                   |
|---------------------------------------|------------------------------------------------------|
| `target/common_post.h`                | includes `freestyle/freestyle_pre.h`                 |
| `mk/source.mk`                        | includes `mk/freestyle.mk`                           |
| `sensors/gyro_filter_impl.c`          | pre-filter hook (Kalman), post-filter hook (ABG, Smith) |
| `sensors/gyro.c`, `sensors/gyro_init.c` | header include, filter init                        |
| `flight/pid.c`, `flight/pid_init.c`   | D-term ABG apply and init                            |
| `cli/settings.c`                      | includes `freestyle_settings.inc` at the end of the table |
| `build/debug.[ch]`                    | `KALMAN` and `SMITH_PREDICTOR` debug modes           |

Rules that keep rebases cheap:

- New behaviour goes in `src/main/freestyle/`; upstream files only get a call.
- Fork settings go in the fork's own parameter group, never in `gyroConfig_t`
  or `pidProfile_t`. Changing an upstream struct changes its EEPROM layout and
  conflicts on nearly every upstream release.
- Fork debug modes stay at the end of the enum. Blackbox Explorer shows them by
  number, not name, until the fork ships its own explorer build.
- Fork PG IDs are 3000 and up; upstream uses below 600 and 4093-4095.

## Rebasing onto a new Betaflight release

```sh
git fetch upstream
git rebase upstream/master          # or a release tag, e.g. 2026.12.0
git grep -n FREESTYLE -- ':!src/main/freestyle' ':!docs/freestyle'   # re-check every hook
make SITL && make test && make -C src/test/freestyle
make CONFIG=<a board you fly>
```

If a hook conflicts, the usual cause is upstream reshaping the gyro or D-term
pipeline. Re-place the hook at the same logical stage (see the pipeline diagram
in `freestyle_filters.h`) rather than resolving the conflict line by line.

## Building

Same as Betaflight: `make arm_sdk_install` once, then `make CONFIG=<BOARD>`.
`make SITL` builds a simulator that runs on the desktop, with the CLI on TCP port 5761.

## Licence

Betaflight is GPL-3.0, and so is this fork. Anyone you give a binary to can
ask for the matching source, so publish the source for every release.
