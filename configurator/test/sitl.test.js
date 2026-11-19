/*
 * Runs the wizard's protocol layer and every preset against the SITL build.
 *
 *   make SITL
 *   node configurator/test/sitl.test.js
 *
 * Starts obj/main/betaflight_SITL.elf in a temp dir, talks MSP and CLI over
 * TCP 5761 exactly as the browser does over USB, and checks that every CLI
 * line the wizard can send is accepted (or is a hardware-only setting that
 * SITL doesn't build, which the wizard skips).
 */
'use strict';

const net = require('net');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const assert = require('assert');

const FS = Object.assign({}, require('../js/fclink.js'), require('../js/presets.js'));

const ROOT = path.resolve(__dirname, '../..');
const ELF = path.join(ROOT, 'obj/main/betaflight_SITL.elf');
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-sitl-'));

// Settings SITL leaves out because it has no DShot/ESC hardware.
// These are checked against a real board build instead (test/check-settings.sh).
const HARDWARE_ONLY = new Set(['dshot_bidir', 'dyn_idle_min_rpm', 'rpm_filter_min_hz', 'serialrx_provider',
    'dyn_notch_count', 'dyn_notch_q', 'dyn_notch_min_hz']);

let sitl = null;
function startSitl() {
    sitl = spawn(ELF, [], { cwd: WORK, stdio: 'ignore' });
}
async function stopSitl() {
    if (!sitl) return;
    const p = sitl;
    sitl = null;
    if (p.exitCode === null) {
        await new Promise((r) => { p.once('exit', r); p.kill('SIGKILL'); });
    }
}

class TcpTransport {
    constructor() { this.onData = null; }
    static async connect() {
        for (let i = 0; i < 60; i++) {
            try {
                const t = new TcpTransport();
                await new Promise((resolve, reject) => {
                    t.sock = net.createConnection(5761, '127.0.0.1', resolve);
                    t.sock.once('error', reject);
                });
                t.sock.on('data', (d) => t.onData && t.onData(new Uint8Array(d)));
                t.sock.on('error', () => {});
                return t;
            } catch (e) { await FS.sleep(150); }
        }
        throw new Error('SITL did not open TCP 5761');
    }
    async write(b) { this.sock.write(Buffer.from(b)); }
    async close() { this.sock.destroy(); }
    // SITL's "reboot" exits the process, so restart it.
    async reopen() {
        await this.close();
        await FS.sleep(300);
        await stopSitl();
        startSitl();
        return TcpTransport.connect();
    }
}

const results = [];
async function test(name, fn) {
    try {
        await fn();
        results.push(['PASS', name]);
    } catch (e) {
        results.push(['FAIL', name + ': ' + e.message]);
    }
}

async function probe(link) {
    await link.enterCli();
    const get = async (name) => {
        const out = await link.cli('get ' + name);
        const m = out.match(new RegExp('^' + name + ' = (.*)$', 'm'));
        return m ? m[1].trim() : null;
    };
    const caps = {
        rxUartValue: await get('rx_uart'),
        motorProtocol: (await get('motor_pwm_protocol')) || '',
        hasKalman: (await get('imuf_w')) !== null,
    };
    caps.hasRxUart = caps.rxUartValue !== null;
    caps.kalmanOn = parseInt(await get('imuf_roll_q'), 10) > 0;
    return caps;
}

(async () => {
    assert(fs.existsSync(ELF), 'build SITL first: make SITL');
    startSitl();
    let transport = await TcpTransport.connect();
    const link = new FS.FCLink(transport, { cliTimeoutMs: 8000 });

    // ---- pure logic
    await test('channel map: TAER radio on AETR board is detected and fixed', async () => {
        // Board map AETR1234, radio sends TAER: throttle on raw 0, roll raw 1, pitch raw 2, yaw raw 3.
        // Mapped index j shows raw rxMap[j]: roll stick (raw 1) shows at mapped E(1), etc.
        // mapped order is roll, pitch, yaw, throttle: roll stick shows at 1, pitch at 3, yaw at 2, throttle at 0
        assert.strictEqual(FS.fixChannelMap('AETR1234', [1, 3, 2, 0]), 'TAER1234');
        // and back: board TAER, radio AETR -> roll stick at 3, pitch at 0, yaw at 2, throttle at 1
        assert.strictEqual(FS.fixChannelMap('TAER1234', [3, 0, 2, 1]), 'AETR1234');
        assert.strictEqual(FS.fixChannelMap('AETR1234', [0, 1, 2, 3]), 'AETR1234');
        assert.strictEqual(FS.fixChannelMap('AETR1234', [0, 0, 2, 3]), null);
    });
    await test('motor order: swapped front/rear right is fixed, bad answers rejected', async () => {
        assert.deepStrictEqual(FS.fixMotorOrder([0, 1, 2, 3, 4, 5, 6, 7], [1, 0, 2, 3]), [1, 0, 2, 3, 4, 5, 6, 7]);
        assert.deepStrictEqual(FS.fixMotorOrder([1, 0, 2, 3, 4, 5, 6, 7], [1, 0, 2, 3]), [0, 1, 2, 3, 4, 5, 6, 7]);
        assert.deepStrictEqual(FS.fixMotorOrder([0, 1, 2, 3], [3, 2, 1, 0]), [3, 2, 1, 0]);
        assert.strictEqual(FS.fixMotorOrder([0, 1, 2, 3], [0, 0, 1, 2]), null);
    });
    await test('spin directions match Betaflight Quad X', async () => {
        assert.deepStrictEqual([0, 1, 2, 3].map((p) => FS.expectedSpin(p, false)), ['CW', 'CCW', 'CCW', 'CW']);
        assert.deepStrictEqual([0, 1, 2, 3].map((p) => FS.expectedSpin(p, true)), ['CCW', 'CW', 'CW', 'CCW']);
    });
    await test('aux ranges stay inside 900..2100 on 25us steps', async () => {
        for (const v of [988, 1000, 1500, 2000, 2012]) {
            const [lo, hi] = FS.auxRange(v);
            assert(lo >= 900 && hi <= 2100 && lo % 25 === 0 && hi % 25 === 0 && lo < v && hi > v, `${v} -> ${lo}..${hi}`);
        }
    });

    // ---- MSP against SITL
    let info;
    await test('MSP identify', async () => {
        info = await link.identify();
        assert.strictEqual(info.variant, 'BTFL');
        assert(/2026/.test(info.version), info.version);
        console.log('   ', JSON.stringify(info));
    });
    await test('MSP RC, battery, reordering, arming, motors', async () => {
        const rc = await link.readRc(); // SITL without an RX link reports 0 channels
        console.log('    RC channels in SITL: ' + rc.length);
        await link.readBattery();
        const order = await link.readMotorReordering();
        assert(order.length >= 4, 'reorder length ' + order.length);
        await link.writeMotorReordering([1, 0, 2, 3, 4, 5, 6, 7].slice(0, order.length));
        const order2 = await link.readMotorReordering();
        assert.deepStrictEqual(order2.slice(0, 4), [1, 0, 2, 3]);
        await link.writeMotorReordering(order);
        await link.setArmingDisabled(true);
        await link.setMotors([1080, 1000, 1000, 1000], 4);
        await link.stopMotors();
        await link.setArmingDisabled(false);
    });
    await test('MSP v2 frames round-trip (crc8 dvb-s2)', async () => {
        const frame = FS.encodeMsp(0x3001);
        assert.strictEqual(frame[1], 88);
        let got = null;
        const p = new FS.MspParser((f) => { got = f; });
        const reply = frame.slice(); reply[2] = 62;
        p.push(reply);
        assert(got && got.cmd === 0x3001);
    });

    // ---- CLI: every frame x feel x receiver plan
    let caps;
    await test('CLI probe', async () => {
        caps = await probe(link);
        console.log('    caps', JSON.stringify(caps));
        assert(caps.hasKalman, 'fork setting imuf_w should exist');
    });

    const skippedNames = new Set();
    await test('every preset combination is accepted by the CLI', async () => {
        const combos = [];
        for (const frame of Object.keys(FS.FRAMES)) {
            for (const feel of Object.keys(FS.FEELS)) {
                combos.push({ frame, feel, receiver: 'elrs', rxUart: 'UART2', escRpm: true, propsOut: feel === 'aggressive', craftName: 'TEST ' + frame, kalman: frame === '7' });
            }
        }
        for (const receiver of Object.keys(FS.RECEIVERS)) {
            combos.push({ frame: '5', feel: 'standard', receiver, rxUart: 'UART3', escRpm: false, propsOut: false, craftName: '', kalman: false });
        }
        // legacy `serial` form too
        combos.push({ frame: '5', feel: 'standard', receiver: 'elrs', rxUart: 'UART2', escRpm: true, propsOut: false, craftName: '', kalman: false, legacy: true });

        for (const c of combos) {
            const plan = FS.buildPlan(c, c.legacy ? Object.assign({}, caps, { hasRxUart: false }) : caps);
            for (const line of plan) {
                if (line.startsWith('#')) continue;
                const out = await link.cli(line);
                const r = FS.cliResult(out);
                if (r === 'error') throw new Error(`"${line}" -> ${out}`);
                if (r === 'skip') {
                    const name = (line.match(/^set (\S+)/) || [])[1] || line;
                    skippedNames.add(name);
                }
            }
        }
        console.log(`    ${combos.length} combinations applied; not in SITL: ${Array.from(skippedNames).join(', ') || 'none'}`);
        for (const n of skippedNames) assert(HARDWARE_ONLY.has(n), 'unexpected missing setting: ' + n);
    });

    await test('switches and channel map are accepted', async () => {
        const lines = FS.switchLines({ arm: { aux: 0, value: 2000 }, angle: { aux: 1, value: 1500 }, turtle: { aux: 2, value: 2000 }, beeper: null });
        lines.push('map TAER1234');
        for (const line of lines) {
            if (line.startsWith('#')) continue;
            const out = await link.cli(line);
            if (FS.cliResult(out)) throw new Error(`"${line}" -> ${out}`);
        }
        const aux = await link.cli('aux');
        assert(/aux 0 0 0 1825 2100 0 0/.test(aux), 'arm range: ' + aux.split('\n')[0]);
        assert(/aux 2 35 2 1825 2100 0 0/.test(aux), 'turtle');
    });

    await test('diff all comes back whole (prompt detection)', async () => {
        const diff = await link.cli('diff all', 20000);
        assert(/# version/.test(diff) && /rateprofile/.test(diff), 'diff looks truncated');
        assert(!/\n# $/.test(diff));
    });

    // ---- save, reboot, verify one full setup survives
    await test('5" standard setup saves and survives reboot', async () => {
        const c = { frame: '5', feel: 'standard', receiver: 'elrs', rxUart: 'UART2', escRpm: true, propsOut: true, craftName: 'RIPPER', kalman: true };
        for (const line of FS.buildPlan(c, caps)) {
            if (!line.startsWith('#')) await link.cli(line);
        }
        for (const line of FS.switchLines({ arm: { aux: 0, value: 1900 } })) {
            if (!line.startsWith('#')) await link.cli(line);
        }
        await link.leaveCli(true);
        transport = await transport.reopen();
        link.attach(transport);
        await FS.sleep(300);
        await link.identify();
        await link.enterCli();
        const want = {
            craft_name: 'RIPPER', yaw_motors_reversed: 'ON', rates_type: 'ACTUAL', roll_rc_rate: '20', roll_srate: '75',
            roll_expo: '50', yaw_srate: '65', imuf_roll_q: '6000', rc_smoothing_auto_factor: '35',
            // vbat_sag_compensation is zeroed by the firmware without an ADC voltage meter, which SITL lacks
            simplified_master_multiplier: '100',
        };
        for (const [k, v] of Object.entries(want)) {
            const out = await link.cli('get ' + k);
            const m = out.match(new RegExp('^' + k + ' = (.*)$', 'm'));
            assert(m && m[1].trim() === v, `${k}: expected ${v}, got ${m && m[1]}`);
        }
        const aux = await link.cli('aux');
        assert(/aux 0 0 0 1725 2075 0 0/.test(aux), 'arm switch saved');
        // simplified_tuning apply must have produced the stock 5" PIDs
        const p = await link.cli('get p_roll');
        assert(/p_roll = 45/.test(p), p);
        await link.leaveCli(false);
    });

    await stopSitl();
    fs.rmSync(WORK, { recursive: true, force: true });
    for (const [s, n] of results) console.log(`${s}  ${n}`);
    const failed = results.filter((r) => r[0] === 'FAIL').length;
    console.log(failed ? `${failed} FAILED` : `all ${results.length} passed`);
    process.exit(failed ? 1 : 0);
})().catch(async (e) => {
    console.error(e);
    await stopSitl();
    process.exit(1);
});
