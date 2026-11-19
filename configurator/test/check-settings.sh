#!/bin/sh
# Checks that every setting and command the wizard can send exists in a real
# board build (SITL leaves out the DShot, RPM and serial RX settings).
#
#   make CONFIG=GEPRCF722 && sh configurator/test/check-settings.sh obj/main/betaflight_STM32F722_GEPRCF722.elf
set -e
ELF="$1"
[ -f "$ELF" ] || { echo "usage: $0 <firmware.elf>"; exit 2; }
DIR=$(cd "$(dirname "$0")" && pwd)
STRINGS=$(mktemp)
strings -n 3 "$ELF" | sort -u > "$STRINGS"
NAMES=$(node -e '
const P = require(process.argv[1] + "/../js/presets.js");
const names = new Set();
const caps = { hasRxUart: true, motorProtocol: "PWM", hasKalman: true, kalmanOn: false };
for (const frame of Object.keys(P.FRAMES)) for (const feel of Object.keys(P.FEELS)) for (const receiver of Object.keys(P.RECEIVERS))
  for (const escRpm of [true, false]) for (const kalman of [true, false]) {
    const plan = P.buildPlan({ frame, feel, receiver, rxUart: "UART2", escRpm, propsOut: false, craftName: "X", kalman }, caps);
    for (const l of plan) {
      let m;
      if ((m = l.match(/^set (\S+) = (\S+)/))) { names.add(m[1]); if (/^[A-Z]/.test(m[2]) && !/^\d/.test(m[2]) && m[1] !== "craft_name" && m[1] !== "rx_uart") names.add(m[2]); names.delete("ON"); names.delete("OFF"); }
      else if (!l.startsWith("#")) names.add(l.split(" ")[0]);
    }
  }
["feature", "aux", "map", "RX_SERIAL"].forEach((n) => names.add(n));
console.log(Array.from(names).sort().join("\n"));
' "$DIR")
MISSING=0
for n in $NAMES; do
  if ! grep -qx -- "$n" "$STRINGS"; then echo "missing: $n"; MISSING=1; fi
done
rm -f "$STRINGS"
[ $MISSING = 0 ] && echo "all $(echo "$NAMES" | wc -l) names present in $(basename "$ELF")"
exit $MISSING
