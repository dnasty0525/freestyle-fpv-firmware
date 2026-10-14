# Parity test: the fork's ported filters against EmuFlight's original
# algorithms on a synthetic 8kHz gyro trace. Run with: make -C src/test/freestyle
MAIN := ../../main
CC   ?= gcc

emu_parity_test: emu_parity_test.c $(MAIN)/freestyle/kalman.c $(MAIN)/freestyle/abg_filter.c $(MAIN)/freestyle/smith_predictor.c
	$(CC) -std=gnu11 -O2 -Wall -Wextra -Wno-unused-parameter -Istub -I$(MAIN) -o $@ $^ $(MAIN)/common/filter.c $(MAIN)/common/maths.c -lm
	./$@

clean:
	rm -f emu_parity_test

.PHONY: clean
