# Freestyle fork sources. Included from mk/source.mk so upstream edits to
# that file never touch fork source lists.

FREESTYLE_SRC = \
            freestyle/freestyle_config.c \
            freestyle/freestyle_filters.c \
            freestyle/kalman.c \
            freestyle/smith_predictor.c \
            freestyle/abg_filter.c

COMMON_SRC += $(FREESTYLE_SRC)

# these run every gyro / PID loop
SPEED_OPTIMISED_SRC += \
            freestyle/freestyle_filters.c \
            freestyle/kalman.c \
            freestyle/smith_predictor.c \
            freestyle/abg_filter.c

SIZE_OPTIMISED_SRC += \
            freestyle/freestyle_config.c
