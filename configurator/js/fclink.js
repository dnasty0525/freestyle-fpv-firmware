/*
 * Freestyle Setup: flight controller link.
 *
 * Speaks MSP v1/v2 and the Betaflight CLI over any byte transport:
 *   transport.write(Uint8Array) -> Promise
 *   transport.onData = (Uint8Array) => {}
 *   transport.close() -> Promise
 *
 * Works in the browser (Web Serial) and in Node (TCP to SITL, for tests).
 * GPL-3.0, same as the firmware.
 */
(function (root) {
    'use strict';

    const MSP = {
        API_VERSION: 1,
        FC_VARIANT: 2,
        FC_VERSION: 3,
        BOARD_INFO: 4,
        NAME: 10,
        REBOOT: 68,
        SET_ARMING_DISABLED: 99,
        STATUS: 101,
        RC: 105,
        BATTERY_STATE: 130,
        MOTOR_TELEMETRY: 139,
        SET_MOTOR: 214,
        EEPROM_WRITE: 250,
        // MSP v2
        MOTOR_OUTPUT_REORDERING: 0x3001,
        SET_MOTOR_OUTPUT_REORDERING: 0x3002,
        SEND_DSHOT_COMMAND: 0x3003,
    };

    const DSHOT = {
        SPIN_DIRECTION_NORMAL: 20,
        SPIN_DIRECTION_REVERSED: 21,
        SAVE_SETTINGS: 12,
        TYPE_BLOCKING: 1,
    };

    function crc8DvbS2(crc, byte) {
        crc ^= byte;
        for (let i = 0; i < 8; i++) {
            crc = (crc & 0x80) ? ((crc << 1) ^ 0xD5) & 0xFF : (crc << 1) & 0xFF;
        }
        return crc;
    }

    function encodeMsp(cmd, payload) {
        payload = payload || new Uint8Array(0);
        if (cmd > 254 || payload.length > 254) {
            // MSP v2: $ X < flag cmdLo cmdHi lenLo lenHi payload crc
            const out = new Uint8Array(9 + payload.length);
            out.set([36, 88, 60, 0, cmd & 0xFF, cmd >> 8, payload.length & 0xFF, payload.length >> 8]);
            out.set(payload, 8);
            let crc = 0;
            for (let i = 3; i < 8 + payload.length; i++) crc = crc8DvbS2(crc, out[i]);
            out[8 + payload.length] = crc;
            return out;
        }
        // MSP v1: $ M < size cmd payload checksum
        const out = new Uint8Array(6 + payload.length);
        out.set([36, 77, 60, payload.length, cmd]);
        out.set(payload, 5);
        let chk = payload.length ^ cmd;
        for (const b of payload) chk ^= b;
        out[5 + payload.length] = chk;
        return out;
    }

    // Incremental MSP reply parser. Calls onFrame({cmd, ok, payload}).
    class MspParser {
        constructor(onFrame) {
            this.onFrame = onFrame;
            this.reset();
        }
        reset() {
            this.state = 0;
        }
        push(bytes) {
            for (const b of bytes) this.step(b);
        }
        step(b) {
            switch (this.state) {
            case 0: if (b === 36) this.state = 1; break;                                    // $
            case 1: this.v2 = b === 88; this.state = (b === 77 || b === 88) ? 2 : 0; break;   // M or X
            case 2: if (b === 62 || b === 33) { this.ok = b === 62; this.state = this.v2 ? 10 : 3; } else this.state = 0; break;
            // v1
            case 3: this.len = b; this.chk = b; this.state = 4; break;
            case 4: this.cmd = b; this.chk ^= b; this.buf = []; this.state = this.len ? 5 : 6; break;
            case 5: this.buf.push(b); this.chk ^= b; if (this.buf.length === this.len) this.state = 6; break;
            case 6: this.emit(b === this.chk); break;
            // v2
            case 10: this.crc = crc8DvbS2(0, b); this.state = 11; break;                       // flag
            case 11: this.cmd = b; this.crc = crc8DvbS2(this.crc, b); this.state = 12; break;
            case 12: this.cmd |= b << 8; this.crc = crc8DvbS2(this.crc, b); this.state = 13; break;
            case 13: this.len = b; this.crc = crc8DvbS2(this.crc, b); this.state = 14; break;
            case 14: this.len |= b << 8; this.crc = crc8DvbS2(this.crc, b); this.buf = []; this.state = this.len ? 15 : 16; break;
            case 15: this.buf.push(b); this.crc = crc8DvbS2(this.crc, b); if (this.buf.length === this.len) this.state = 16; break;
            case 16: this.emit(b === this.crc); break;
            }
        }
        emit(valid) {
            this.state = 0;
            if (!valid) return;
            this.onFrame({ cmd: this.cmd, ok: this.ok, payload: new DataView(new Uint8Array(this.buf).buffer) });
        }
    }

    // Little-endian payload builder
    function bytes() {
        const arr = [];
        const api = {
            u8(v) { arr.push(v & 0xFF); return api; },
            u16(v) { arr.push(v & 0xFF, (v >> 8) & 0xFF); return api; },
            done() { return new Uint8Array(arr); },
        };
        return api;
    }

    function readString(view, offset, length) {
        let s = '';
        for (let i = 0; i < length && offset + i < view.byteLength; i++) s += String.fromCharCode(view.getUint8(offset + i));
        return s;
    }

    function sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    class FCLink {
        constructor(transport, opts) {
            this.opts = Object.assign({ timeoutMs: 1500, cliTimeoutMs: 6000, log: null }, opts || {});
            this.mode = 'msp';
            this.pending = [];
            this.cliBuf = '';
            this.cliWaiter = null;
            this.parser = new MspParser((f) => this.onFrame(f));
            this.attach(transport);
        }

        attach(transport) {
            this.transport = transport;
            this.parser.reset();
            this.mode = 'msp';
            transport.onData = (data) => this.onData(data);
        }

        log(msg) {
            if (this.opts.log) this.opts.log(msg);
        }

        onData(data) {
            if (this.mode === 'msp') {
                this.parser.push(data);
            } else {
                this.cliBuf += String.fromCharCode.apply(null, Array.from(data));
                if (this.cliWaiter) this.cliWaiter();
            }
        }

        onFrame(frame) {
            const idx = this.pending.findIndex((p) => p.cmd === frame.cmd);
            if (idx < 0) return;
            const p = this.pending.splice(idx, 1)[0];
            clearTimeout(p.timer);
            if (frame.ok) p.resolve(frame.payload);
            else p.reject(new Error('FC rejected MSP command ' + frame.cmd));
        }

        // Send one MSP command and wait for its reply. One in flight per command code.
        async msp(cmd, payload, opts) {
            if (this.mode !== 'msp') throw new Error('MSP not available while in CLI mode');
            const timeoutMs = (opts && opts.timeoutMs) || this.opts.timeoutMs;
            const reply = new Promise((resolve, reject) => {
                const p = { cmd, resolve, reject };
                p.timer = setTimeout(() => {
                    const i = this.pending.indexOf(p);
                    if (i >= 0) this.pending.splice(i, 1);
                    reject(new Error('No reply to MSP command ' + cmd));
                }, timeoutMs);
                this.pending.push(p);
            });
            await this.transport.write(encodeMsp(cmd, payload));
            return reply;
        }

        // ---- high level MSP ----

        async identify() {
            const api = await this.msp(MSP.API_VERSION);
            const variant = await this.msp(MSP.FC_VARIANT);
            const version = await this.msp(MSP.FC_VERSION);
            const board = await this.msp(MSP.BOARD_INFO);

            const info = {
                apiVersion: api.getUint8(1) + '.' + api.getUint8(2),
                variant: readString(variant, 0, 4),
                version: version.getUint8(0) + 2000 + '.' + version.getUint8(1) + '.' + version.getUint8(2),
                boardId: readString(board, 0, 4),
            };
            if (version.byteLength > 3) {
                info.version = readString(version, 4, version.getUint8(3));
            }
            // board info: id[4] hwRev u16, osd u8, caps u8, targetName pstr, boardName pstr, manufacturer pstr
            let off = 8;
            if (board.byteLength > off) {
                const tlen = board.getUint8(off);
                info.target = readString(board, off + 1, tlen);
                off += 1 + tlen;
                if (board.byteLength > off) {
                    const blen = board.getUint8(off);
                    info.boardName = readString(board, off + 1, blen);
                }
            }
            info.displayName = info.boardName || info.target || info.boardId;
            return info;
        }

        // Channel values in microseconds, after the FC's channel map (0=roll 1=pitch 2=yaw 3=throttle 4..=AUX)
        async readRc() {
            const v = await this.msp(MSP.RC);
            const ch = [];
            for (let i = 0; i + 1 < v.byteLength; i += 2) ch.push(v.getUint16(i, true));
            return ch;
        }

        async readBattery() {
            const v = await this.msp(MSP.BATTERY_STATE);
            return {
                cells: v.getUint8(0),
                voltage: v.byteLength >= 11 ? v.getUint16(9, true) / 100 : v.getUint8(3) / 10,
            };
        }

        async readMotorTelemetry() {
            const v = await this.msp(MSP.MOTOR_TELEMETRY);
            const count = v.getUint8(0);
            const motors = [];
            for (let i = 0; i < count; i++) {
                const o = 1 + i * 13;
                motors.push({ rpm: v.getUint32(o, true), invalidPct: v.getUint16(o + 4, true) / 100 });
            }
            return motors;
        }

        async setArmingDisabled(disabled) {
            await this.msp(MSP.SET_ARMING_DISABLED, bytes().u8(disabled ? 1 : 0).u8(0).done());
        }

        // values: array of 1000..2000, one per motor (1000 = stopped)
        async setMotors(values, motorCount) {
            const b = bytes();
            for (let i = 0; i < Math.max(8, motorCount || 0); i++) b.u16(values[i] || 1000);
            await this.msp(MSP.SET_MOTOR, b.done());
        }

        async stopMotors() {
            await this.setMotors([1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000]);
        }

        async readMotorReordering() {
            const v = await this.msp(MSP.MOTOR_OUTPUT_REORDERING);
            const n = v.getUint8(0);
            const out = [];
            for (let i = 0; i < n; i++) out.push(v.getUint8(1 + i));
            return out;
        }

        async writeMotorReordering(order) {
            const b = bytes().u8(order.length);
            order.forEach((x) => b.u8(x));
            await this.msp(MSP.SET_MOTOR_OUTPUT_REORDERING, b.done());
        }

        // DShot commands to one motor (0-based). Persistent direction needs SAVE_SETTINGS after.
        async dshotCommand(motorIndex, commands) {
            const b = bytes().u8(DSHOT.TYPE_BLOCKING).u8(motorIndex).u8(commands.length);
            commands.forEach((c) => b.u8(c));
            await this.msp(MSP.SEND_DSHOT_COMMAND, b.done());
        }

        async setMotorDirection(motorIndex, reversed) {
            await this.dshotCommand(motorIndex, [
                reversed ? DSHOT.SPIN_DIRECTION_REVERSED : DSHOT.SPIN_DIRECTION_NORMAL,
                DSHOT.SAVE_SETTINGS,
            ]);
        }

        async eepromWrite() {
            await this.msp(MSP.EEPROM_WRITE, null, { timeoutMs: 3000 });
        }

        async reboot() {
            // MSP_REBOOT with type 0 (firmware); the FC replies, then resets.
            try {
                await this.msp(MSP.REBOOT, bytes().u8(0).done(), { timeoutMs: 1000 });
            } catch (e) { /* reply may be lost to the reset */ }
        }

        // ---- CLI ----

        async waitCli(predicate, timeoutMs) {
            const deadline = Date.now() + timeoutMs;
            while (!predicate(this.cliBuf)) {
                const left = deadline - Date.now();
                if (left <= 0) throw new Error('Timed out waiting for the flight controller CLI');
                await new Promise((resolve) => {
                    const t = setTimeout(resolve, Math.min(left, 200));
                    this.cliWaiter = () => { clearTimeout(t); resolve(); };
                });
                this.cliWaiter = null;
            }
        }

        static promptAtEnd(buf) {
            return /(\r?\n|^)# $/.test(buf);
        }

        // A "# " at the end of the buffer can also be the start of a comment
        // line in `diff` output cut at a USB packet boundary, so the prompt only
        // counts once nothing more arrives for a moment.
        async waitPrompt(timeoutMs) {
            const deadline = Date.now() + timeoutMs;
            for (;;) {
                await this.waitCli(FCLink.promptAtEnd, Math.max(100, deadline - Date.now()));
                const len = this.cliBuf.length;
                await sleep(60);
                if (this.cliBuf.length === len && FCLink.promptAtEnd(this.cliBuf)) return;
                if (Date.now() > deadline) throw new Error('Timed out waiting for the flight controller CLI');
            }
        }

        async enterCli() {
            this.pending.forEach((p) => { clearTimeout(p.timer); p.reject(new Error('Entered CLI')); });
            this.pending = [];
            this.mode = 'cli';
            this.cliBuf = '';
            await this.transport.write(new Uint8Array([35])); // '#'
            await this.waitPrompt(this.opts.cliTimeoutMs);
            this.cliBuf = '';
        }

        // Run one CLI command and return its output, without the echoed command or prompt.
        async cli(command, timeoutMs) {
            if (this.mode !== 'cli') throw new Error('Not in CLI mode');
            this.cliBuf = '';
            await this.transport.write(new TextEncoder().encode(command + '\n'));
            await this.waitPrompt(timeoutMs || this.opts.cliTimeoutMs);
            const lines = this.cliBuf.replace(/\r/g, '').split('\n');
            lines.pop(); // prompt
            if (lines.length && lines[0].trim() === command.trim()) lines.shift();
            this.log('> ' + command + (lines.length ? '\n' + lines.join('\n') : ''));
            return lines.join('\n').trim();
        }

        // Ends the CLI session. save=true writes settings; both reboot the FC.
        async leaveCli(save) {
            this.cliBuf = '';
            await this.transport.write(new TextEncoder().encode((save ? 'save' : 'exit') + '\n'));
            try {
                await this.waitCli((b) => /Rebooting|reboot/i.test(b), 4000);
            } catch (e) { /* USB may drop before the text arrives */ }
            this.mode = 'msp';
        }
    }

    // Classify a CLI reply: '' ok, 'skip' setting not in this build, 'error' otherwise
    function cliResult(output) {
        if (!/###ERROR/.test(output) && !/^ERROR/m.test(output) && !/Parse error/i.test(output)) return '';
        if (/INVALID NAME|Invalid name|UNKNOWN COMMAND|Unknown command/i.test(output)) return 'skip';
        return 'error';
    }

    const api = { FCLink, MspParser, encodeMsp, crc8DvbS2, cliResult, sleep, MSP, DSHOT };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.FS = Object.assign(root.FS || {}, api);
})(this);
