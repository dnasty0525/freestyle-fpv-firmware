/*
 * Freestyle Setup: transports.
 *
 * WebSerialTransport: the real thing (Chrome/Edge desktop, https or localhost).
 * DemoTransport: a simulated flight controller for trying the wizard without a quad.
 *
 * GPL-3.0, same as the firmware.
 */
(function (root) {
    'use strict';

    const FS = root.FS;

    // ---------------------------------------------------------------- Web Serial

    class WebSerialTransport {
        constructor(port) {
            this.port = port;
            this.onData = null;
            this.onLost = null;
            this.reading = false;
        }

        static supported() {
            return typeof navigator !== 'undefined' && 'serial' in navigator;
        }

        static async request() {
            // STM32 VCP, AT32, GD32, APM32, CP210x, CH340: same filters as the Betaflight App
            const filters = [
                { usbVendorId: 0x0483 }, { usbVendorId: 0x2e3c }, { usbVendorId: 0x28e9 },
                { usbVendorId: 0x314b }, { usbVendorId: 0x10c4 }, { usbVendorId: 0x1a86 },
            ];
            const port = await navigator.serial.requestPort({ filters });
            const t = new WebSerialTransport(port);
            await t.open();
            return t;
        }

        async open() {
            this.info = this.port.getInfo();
            await this.port.open({ baudRate: 115200 });
            this.writer = this.port.writable.getWriter();
            this.readLoop();
        }

        async readLoop() {
            this.reading = true;
            try {
                while (this.reading && this.port.readable) {
                    this.reader = this.port.readable.getReader();
                    try {
                        for (;;) {
                            const { value, done } = await this.reader.read();
                            if (done) break;
                            if (value && this.onData) this.onData(value);
                        }
                    } finally {
                        this.reader.releaseLock();
                    }
                }
            } catch (e) {
                // device lost (FC rebooted or unplugged)
            }
            if (this.reading && this.onLost) this.onLost();
        }

        async write(bytes) {
            await this.writer.write(bytes);
        }

        async close() {
            this.reading = false;
            try { if (this.reader) await this.reader.cancel(); } catch (e) { /* already gone */ }
            try { this.writer.releaseLock(); } catch (e) { /* already gone */ }
            try { await this.port.close(); } catch (e) { /* already gone */ }
        }

        // After a reboot the FC re-enumerates over USB. Chrome remembers the
        // permission, so find the same device again and reopen it.
        async reopen(timeoutMs) {
            await this.close();
            const deadline = Date.now() + (timeoutMs || 15000);
            await FS.sleep(1500);
            while (Date.now() < deadline) {
                const ports = await navigator.serial.getPorts();
                for (const p of ports) {
                    const i = p.getInfo();
                    if (i.usbVendorId === this.info.usbVendorId && i.usbProductId === this.info.usbProductId) {
                        try {
                            const t = new WebSerialTransport(p);
                            await t.open();
                            return t;
                        } catch (e) { /* not ready yet */ }
                    }
                }
                await FS.sleep(500);
            }
            throw new Error('The flight controller did not come back after rebooting. Unplug it, plug it back in and press Reconnect.');
        }
    }

    // ---------------------------------------------------------------- Demo FC

    class DemoFC {
        constructor() {
            this.settings = {
                rx_uart: 'UART2', serialrx_provider: 'SBUS', motor_pwm_protocol: 'DSHOT600',
                dshot_bidir: 'OFF', imuf_w: '32', craft_name: '-',
            };
            this.map = 'TAER1234';      // deliberately wrong so the stick step has something to fix
            this.reorder = [1, 0, 2, 3, 4, 5, 6, 7]; // two motors swapped
            this.baseWrong = [false, true, false, false]; // ESC at this corner spins the wrong way...
            this.reversed = [false, false, false, false];  // ...until its direction is reversed
            this.motors = [1000, 1000, 1000, 1000];
            this.aux = [1000, 1000, 1000, 1000];
            this.stick = [1500, 1500, 1500, 1000];
            this.cli = false;
            this.listeners = new Set();
        }
        // raw channel values the "radio" sends, before the FC's map
        rawChannels() {
            // the radio sends AETR; map letter at raw position tells the FC what it is
            const radio = { A: this.stick[0], E: this.stick[1], R: this.stick[2], T: this.stick[3] };
            const raw = ['A', 'E', 'T', 'R'].map((f) => radio[f]);
            return raw.concat(this.aux);
        }
        mappedChannels() {
            const raw = this.rawChannels();
            const out = raw.slice();
            this.map.slice(0, 4).split('').forEach((letter, rawIdx) => {
                out['AERT'.indexOf(letter)] = raw[rawIdx];
            });
            return out;
        }
        // Simulated pilot input for the wizard's "move this stick" prompts
        act(kind) {
            const set = (fn, ms) => setTimeout(fn, ms);
            if (kind === 'roll') { set(() => { this.stick[0] = 2000; }, 600); set(() => { this.stick[0] = 1500; }, 2600); }
            if (kind === 'pitch') { set(() => { this.stick[1] = 2000; }, 600); set(() => { this.stick[1] = 1500; }, 2600); }
            if (kind === 'yaw') { set(() => { this.stick[2] = 2000; }, 600); set(() => { this.stick[2] = 1500; }, 2600); }
            if (kind === 'throttle') { set(() => { this.stick[3] = 2000; }, 600); set(() => { this.stick[3] = 1000; }, 2600); }
            const auxFor = { arm: 0, angle: 1, turtle: 2, beeper: 3 };
            if (kind in auxFor) {
                const a = auxFor[kind];
                set(() => { this.aux[a] = 2000; }, 700);
                if (kind !== 'arm' && kind !== 'angle') set(() => { this.aux[a] = 1000; }, 4000);
            }
            if (kind === 'reset') { this.aux = [1000, 1000, 1000, 1000]; }
        }
        // physical corner spinning when logical motor i is driven
        spinningCorner(i) {
            return this.reorder[i];
        }
        spinsWrong(corner) {
            return this.baseWrong[corner] !== this.reversed[corner];
        }
    }

    class DemoTransport {
        constructor(fc) {
            this.fc = fc || new DemoFC();
            this.onData = null;
            this.parser = new FS.MspParser(() => {});
            this.rx = [];
        }
        static async create() { return new DemoTransport(); }

        send(bytes) {
            const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
            setTimeout(() => this.onData && this.onData(b), 8);
        }
        sendText(s) { this.send(new TextEncoder().encode(s)); }

        reply(cmd, payload) {
            const frame = FS.encodeMsp(cmd, payload);
            frame[2] = 62; // '>'
            // recompute checksum/crc for the direction change (direction byte is not covered, so no-op)
            this.send(frame);
        }

        async write(bytes) {
            const fc = this.fc;
            if (fc.cli) {
                const text = new TextDecoder().decode(bytes);
                for (const line of text.split('\n')) {
                    if (line === '') continue;
                    this.cliCommand(line.trim());
                }
                return;
            }
            if (bytes.length === 1 && bytes[0] === 35) {
                fc.cli = true;
                this.sendText('\r\nEntering CLI Mode, type \'exit\' to return, or \'help\'\r\n\r\n# ');
                return;
            }
            // decode request
            let req = null;
            const p = new FS.MspParser((f) => { req = f; });
            const copy = bytes.slice();
            copy[2] = 62; // parse requests with the reply parser
            p.push(copy);
            if (!req) return;
            this.handleMsp(req.cmd, req.payload);
        }

        handleMsp(cmd, v) {
            const fc = this.fc;
            const u16 = (arr, x) => arr.push(x & 0xFF, (x >> 8) & 0xFF);
            const str = (s) => Array.from(s).map((c) => c.charCodeAt(0));
            const M = FS.MSP;
            let out = [];
            switch (cmd) {
            case M.API_VERSION: out = [0, 1, 49]; break;
            case M.FC_VARIANT: out = str('BTFL'); break;
            case M.FC_VERSION: out = [26, 12, 0, 13].concat(str('2026.12.0-fs')); break;
            case M.BOARD_INFO: out = str('DEMO').concat([0, 0, 2, 0], [9], str('STM32F722'), [9], str('DEMO F722'), [4], str('DEMO')); break;
            case M.RC: fc.mappedChannels().forEach((x) => u16(out, x)); break;
            case M.BATTERY_STATE: out = [4]; u16(out, 1300); out.push(165); u16(out, 0); u16(out, 0); out.push(0); u16(out, 1652); break;
            case M.MOTOR_TELEMETRY: {
                out = [4];
                for (let i = 0; i < 4; i++) {
                    const rpm = fc.settings.dshot_bidir === 'ON' && fc.motors[i] > 1000 ? 4200 + i * 37 : 0;
                    out.push(rpm & 0xFF, (rpm >> 8) & 0xFF, 0, 0);
                    u16(out, 0); out.push(0); u16(out, 0); u16(out, 0); u16(out, 0);
                }
                break;
            }
            case M.SET_MOTOR:
                for (let i = 0; i < 4; i++) fc.motors[i] = v.getUint16(i * 2, true);
                break;
            case M.MOTOR_OUTPUT_REORDERING: out = [8].concat(fc.reorder); break;
            case M.SET_MOTOR_OUTPUT_REORDERING: {
                const n = v.getUint8(0);
                fc.pendingReorder = [];
                for (let i = 0; i < n; i++) fc.pendingReorder.push(v.getUint8(1 + i));
                break;
            }
            case M.SEND_DSHOT_COMMAND: {
                const motor = v.getUint8(1);
                const c = v.getUint8(3);
                const corner = fc.reorder[motor];
                if (c === FS.DSHOT.SPIN_DIRECTION_REVERSED) fc.reversed[corner] = true;
                if (c === FS.DSHOT.SPIN_DIRECTION_NORMAL) fc.reversed[corner] = false;
                break;
            }
            case M.EEPROM_WRITE: break;
            case M.REBOOT: setTimeout(() => this.rebootSim(), 50); break;
            default: break;
            }
            this.reply(cmd, new Uint8Array(out));
        }

        rebootSim() {
            const fc = this.fc;
            if (fc.pendingReorder) { fc.reorder = fc.pendingReorder; fc.pendingReorder = null; }
            fc.motors = [1000, 1000, 1000, 1000];
            fc.cli = false;
        }

        cliCommand(line) {
            const fc = this.fc;
            let out = '';
            let m;
            if ((m = line.match(/^get (\S+)/))) {
                const k = m[1];
                out = k in fc.settings ? `${k} = ${fc.settings[k]}` : '###ERROR IN get: INVALID NAME: ' + k + '###';
            } else if ((m = line.match(/^set (\S+) = (.*)$/))) {
                if (/^(rx_uart|imuf_|serialrx|dshot_bidir|motor_pwm|craft_name|yaw_motors|simplified_|rates_type|roll_|pitch_|yaw_|dyn_|iterm|vbat_sag|rc_smoothing|rpm_filter)/.test(m[1])) {
                    fc.settings[m[1]] = m[2];
                    out = `${m[1]} set to ${m[2]}`;
                } else {
                    out = '###ERROR IN set: INVALID NAME: ' + m[1] + '###';
                }
            } else if ((m = line.match(/^map(?: (\S+))?$/))) {
                if (m[1]) fc.map = m[1].toUpperCase();
                out = 'map ' + fc.map;
            } else if (line === 'resource') {
                out = ['resource SERIAL_TX 1 A09', 'resource SERIAL_TX 2 A02', 'resource SERIAL_TX 3 B10', 'resource SERIAL_TX 4 A00', 'resource SERIAL_TX 6 C06',
                    'resource SERIAL_RX 1 A10', 'resource SERIAL_RX 2 A03', 'resource SERIAL_RX 3 B11', 'resource SERIAL_RX 4 A01', 'resource SERIAL_RX 6 C07'].join('\r\n');
            } else if (line.startsWith('diff')) {
                out = '# diff all\r\n# version\r\n# Betaflight / STM32F722 (S722) 2026.12.0-fs DEMO\r\nboard_name DEMO\r\nmap ' + fc.map + '\r\nset rx_uart = ' + fc.settings.rx_uart + '\r\n';
            } else if (line === 'save' || line === 'exit') {
                this.sendText('\r\n' + (line === 'save' ? '# Saving\r\n' : '') + '\r\nRebooting\r\n');
                setTimeout(() => this.rebootSim(), 50);
                return;
            } else {
                out = '';
            }
            this.sendText(line + '\r\n' + (out ? out + '\r\n' : '') + '\r\n# ');
        }

        async close() { }
        async reopen() {
            await FS.sleep(1200);
            this.fc.cli = false;
            return this;
        }
    }

    const api = { WebSerialTransport, DemoTransport, DemoFC };
    root.FS = Object.assign(root.FS || {}, api);
})(this);
