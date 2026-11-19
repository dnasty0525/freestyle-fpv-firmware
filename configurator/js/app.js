/*
 * Freestyle Setup: the wizard.
 * GPL-3.0, same as the firmware.
 */
(function () {
    'use strict';

    const FS = window.FS;
    const $ = (sel, el) => (el || document).querySelector(sel);
    const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    const POSITION_NAMES = ['Rear right', 'Front right', 'Rear left', 'Front left'];
    const SPIN_TEST_US = 1080;     // ~8% throttle: enough to see, too little to hop
    const SPIN_AUTO_STOP_MS = 6000;
    const DETECT_DELTA = 300;      // us of movement that counts as "this one moved"

    const state = {
        transport: null,
        link: null,
        demo: false,
        info: null,
        caps: {},
        backup: '',
        choices: { frame: '5', feel: 'standard', receiver: 'elrs', rxUart: '', escRpm: true, propsOut: false, craftName: '', kalman: false },
        sticks: { found: [], reversed: [], newMap: null },
        switches: {},
        motors: { reorder: null, corner: [], dirFlag: [false, false, false, false], rpmSeen: false, rpmMissing: false, orderFixed: false },
        step: 0,
        maxStep: 0,
        busy: false,
    };

    // ------------------------------------------------------------ log and status

    function log(msg) {
        const el = $('#log');
        el.textContent += msg + '\n';
        if (el.textContent.length > 60000) el.textContent = el.textContent.slice(-50000);
        el.scrollTop = el.scrollHeight;
    }

    function setConn(kind, text) {
        const el = $('#conn');
        el.className = 'conn ' + (kind || '');
        el.innerHTML = '<i class="dot"></i><span>' + esc(text) + '</span>';
    }

    // ------------------------------------------------------------ steps

    const STEPS = [
        { id: 'connect', title: 'Connect', render: renderConnect },
        { id: 'backup', title: 'Backup', render: renderBackup },
        { id: 'quad', title: 'Your quad', render: renderQuad },
        { id: 'receiver', title: 'Receiver', render: renderReceiver },
        { id: 'feel', title: 'Flying feel', render: renderFeel },
        { id: 'apply', title: 'Apply', render: renderApply },
        { id: 'sticks', title: 'Sticks', render: renderSticks },
        { id: 'switches', title: 'Switches', render: renderSwitches },
        { id: 'motors', title: 'Motors', render: renderMotors },
        { id: 'done', title: 'Ready to fly', render: renderDone },
    ];

    let leaveHooks = [];
    function onLeave(fn) { leaveHooks.push(fn); }

    async function go(step) {
        const hooks = leaveHooks;
        leaveHooks = [];
        for (const h of hooks) {
            try { await h(); } catch (e) { log('leave: ' + e.message); }
        }
        state.step = step;
        state.maxStep = Math.max(state.maxStep, step);
        renderRail();
        const main = $('#main');
        main.innerHTML = '';
        const card = document.createElement('section');
        card.className = 'card';
        main.appendChild(card);
        STEPS[step].render(card);
        window.scrollTo({ top: 0 });
        const h = card.querySelector('h1');
        if (h) { h.tabIndex = -1; h.focus({ preventScroll: true }); }
    }

    function renderRail() {
        $('#rail').innerHTML = '<ol>' + STEPS.map((s, i) => {
            const cls = i === state.step ? 'now' : (i < state.step ? 'done' : '');
            return `<li class="${cls}"${i === state.step ? ' aria-current="step"' : ''}><span>${esc(s.title)}</span></li>`;
        }).join('') + '</ol>';
        const rail = $('#rail');
        const now = rail.querySelector('.now');
        if (now && rail.scrollWidth > rail.clientWidth) rail.scrollLeft = now.offsetLeft - rail.clientWidth / 2 + now.offsetWidth / 2;
    }

    function nav(card, opts) {
        const div = document.createElement('div');
        div.className = 'nav';
        div.innerHTML = `<div>${opts.back !== false ? '<button class="btn" data-back>Back</button>' : ''}</div>
            <div class="row">${opts.extra || ''}<button class="btn primary" data-next ${opts.nextDisabled ? 'disabled' : ''}>${esc(opts.next || 'Continue')}</button></div>`;
        card.appendChild(div);
        const back = div.querySelector('[data-back]');
        if (back) back.onclick = () => go(state.step - 1);
        const next = div.querySelector('[data-next]');
        next.onclick = async () => {
            if (state.busy) return;
            if (opts.onNext) {
                next.disabled = true;
                try {
                    const ok = await opts.onNext();
                    if (ok === false) { next.disabled = false; return; }
                } catch (e) {
                    next.disabled = false;
                    showError(card, e);
                    return;
                }
            }
            go(state.step + 1);
        };
        return { next, setNextEnabled: (on) => { next.disabled = !on; } };
    }

    function showError(card, e) {
        log('error: ' + (e && e.message));
        let box = card.querySelector('.note.bad[data-err]');
        if (!box) {
            box = document.createElement('div');
            box.className = 'note bad';
            box.dataset.err = '1';
            const navEl = card.querySelector('.nav');
            card.insertBefore(box, navEl || null);
        }
        box.innerHTML = '<b>Something went wrong</b>' + esc(e && e.message ? e.message : String(e));
    }

    function choiceGrid(items, selected, onPick) {
        const grid = document.createElement('div');
        grid.className = 'choices';
        for (const [key, html] of items) {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'choice';
            b.setAttribute('aria-pressed', String(key === selected));
            b.innerHTML = html;
            b.onclick = () => {
                grid.querySelectorAll('.choice').forEach((x) => x.setAttribute('aria-pressed', 'false'));
                b.setAttribute('aria-pressed', 'true');
                onPick(key);
            };
            grid.appendChild(b);
        }
        return grid;
    }

    // ------------------------------------------------------------ connection

    async function connect(demo) {
        state.demo = demo;
        state.transport = demo ? await FS.DemoTransport.create() : await FS.WebSerialTransport.request();
        state.transport.onLost = () => setConn('lost', 'Disconnected');
        state.link = new FS.FCLink(state.transport, { log });
        await identifyAndProbe();
    }

    async function identifyAndProbe() {
        const link = state.link;
        state.info = await link.identify();
        log('Connected: ' + JSON.stringify(state.info));
        if (state.info.variant !== 'BTFL') {
            throw new Error(`This is ${state.info.variant} firmware. Freestyle Setup works with this fork and Betaflight.`);
        }
        setConn('on', state.info.displayName + ' · ' + state.info.version + (state.demo ? ' · demo' : ''));

        // Gather everything the wizard needs in one CLI session. The FC stays
        // in the CLI until Apply saves, so the whole setup costs one reboot.
        await link.enterCli();
        const get = async (name) => {
            const out = await link.cli('get ' + name);
            const m = out.match(new RegExp('^' + name + ' = (.*)$', 'm'));
            return m ? m[1].trim() : null;
        };
        const caps = {};
        caps.rxUartValue = await get('rx_uart');
        caps.hasRxUart = caps.rxUartValue !== null;
        caps.motorProtocol = await get('motor_pwm_protocol') || '';
        caps.hasKalman = (await get('imuf_w')) !== null;
        caps.kalmanOn = caps.hasKalman && parseInt(await get('imuf_roll_q'), 10) > 0;
        caps.hasBidir = (await get('dshot_bidir')) !== null;
        const mapOut = await link.cli('map');
        const mm = mapOut.match(/map\s+([A-Z0-9]{4,8})/i);
        caps.map = mm ? mm[1].toUpperCase() : 'AETR1234';
        const res = await link.cli('resource');
        const uarts = new Set();
        res.split('\n').forEach((l) => {
            const m = l.match(/^resource SERIAL_RX (\d+) (\S+)/);
            if (m && m[2] !== 'NONE') uarts.add('UART' + m[1]);
        });
        caps.uarts = uarts.size ? Array.from(uarts) : ['UART1', 'UART2', 'UART3', 'UART4', 'UART5', 'UART6'];
        state.caps = caps;
        state.backup = await link.cli('diff all', 15000);

        if (!state.choices.rxUart) {
            const cur = caps.rxUartValue && /^UART\d+$/i.test(caps.rxUartValue) ? caps.rxUartValue.toUpperCase() : null;
            state.choices.rxUart = cur && caps.uarts.includes(cur) ? cur : caps.uarts[Math.min(1, caps.uarts.length - 1)];
        }
        if (!caps.hasBidir) state.choices.escRpm = false;
        state.choices.kalman = caps.kalmanOn;
        log('Capabilities: ' + JSON.stringify(caps));
    }

    // Save (or exit) the CLI, wait for the reboot and reconnect.
    async function cliFinish(save, statusEl) {
        if (statusEl) statusEl.textContent = 'Saving and rebooting the flight controller…';
        await state.link.leaveCli(save);
        await reconnect(statusEl);
    }

    async function reconnect(statusEl) {
        setConn('', 'Rebooting…');
        if (statusEl) statusEl.textContent = 'Waiting for the flight controller to come back…';
        state.transport = await state.transport.reopen(20000);
        state.transport.onLost = () => setConn('lost', 'Disconnected');
        state.link.attach(state.transport);
        await FS.sleep(400);
        let lastErr;
        for (let i = 0; i < 8; i++) {
            try {
                state.info = await state.link.identify();
                setConn('on', state.info.displayName + ' · ' + state.info.version + (state.demo ? ' · demo' : ''));
                return;
            } catch (e) { lastErr = e; await FS.sleep(500); }
        }
        throw lastErr;
    }

    // Run CLI lines, collecting anything this firmware build doesn't have.
    async function runLines(lines, onProgress) {
        const skipped = [];
        const errors = [];
        let n = 0;
        for (const line of lines) {
            n++;
            if (line.startsWith('#')) continue;
            const out = await state.link.cli(line);
            const r = FS.cliResult(out);
            if (r === 'skip') skipped.push(line);
            if (r === 'error') errors.push({ line, out });
            if (onProgress) onProgress(n / lines.length);
        }
        return { skipped, errors };
    }

    // ------------------------------------------------------------ polling

    function poll(fn, ms) {
        let alive = true;
        (async () => {
            while (alive) {
                try {
                    if (state.link && state.link.mode === 'msp') await fn();
                } catch (e) {
                    log('poll: ' + e.message);
                }
                await FS.sleep(ms);
            }
        })();
        onLeave(() => { alive = false; });
        return () => { alive = false; };
    }

    // Wait until one of the watched channels moves from where it started.
    function detectMove(channels, indices, signal) {
        return new Promise((resolve, reject) => {
            let base = null;
            let stableSince = 0;
            let candidate = null;
            const check = (ch) => {
                if (signal.cancelled) { reject(new Error('cancelled')); return true; }
                if (!base) { base = ch.slice(); return false; }
                let best = -1;
                let bestD = 0;
                for (const i of indices) {
                    const d = Math.abs((ch[i] || 0) - (base[i] || 0));
                    if (d > bestD) { bestD = d; best = i; }
                }
                if (bestD >= DETECT_DELTA) {
                    // must stay moved for ~0.4s, so a bump of the other stick doesn't count
                    if (candidate !== best) { candidate = best; stableSince = Date.now(); }
                    if (Date.now() - stableSince > 400) {
                        resolve({ index: best, from: base[best], to: ch[best] });
                        return true;
                    }
                } else {
                    candidate = null;
                }
                return false;
            };
            channels.listeners.add(check);
        });
    }

    function rcFeed() {
        const listeners = new Set();
        let latest = [];
        const stop = poll(async () => {
            latest = await state.link.readRc();
            for (const l of Array.from(listeners)) {
                if (l(latest)) listeners.delete(l);
            }
        }, 80);
        return { listeners, get latest() { return latest; }, stop };
    }

    // ------------------------------------------------------------ 1 connect

    function renderConnect(card) {
        const supported = FS.WebSerialTransport.supported();
        card.innerHTML = `
            <h1>Set up your quad</h1>
            <p class="lede">Plug your flight controller into USB (no battery needed yet) and connect. The wizard sets the receiver, a freestyle tune for your frame size, your switches and motor order. Every step can be undone: it saves a backup first.</p>
            ${supported ? '' : `<div class="note warn"><b>This browser can't talk to USB devices.</b>Open this page in Chrome or Edge on a computer. You can still try the demo.</div>`}
            <div class="row">
                <button class="btn primary" id="go" ${supported ? '' : 'disabled'}>Connect flight controller</button>
                <button class="btn" id="demo">Try the demo</button>
            </div>
            <p id="status" class="lede" style="margin-top:14px" aria-live="polite"></p>
            <div class="note"><b>Not connecting?</b>Close the Betaflight App and any other configurator first: only one program can use the port. On Windows, if the board doesn't show up at all, run ImpulseRC Driver Fixer once.</div>`;
        const status = $('#status', card);
        const run = async (demo) => {
            status.textContent = 'Connecting…';
            try {
                await connect(demo);
                go(1);
            } catch (e) {
                if (e && e.name === 'NotFoundError') { status.textContent = ''; return; }
                status.textContent = '';
                showError(card, e);
                try { if (state.transport) await state.transport.close(); } catch (x) { /* ignore */ }
            }
        };
        $('#go', card).onclick = () => run(false);
        $('#demo', card).onclick = () => run(true);
    }

    // ------------------------------------------------------------ 2 backup

    function downloadBackup() {
        const name = (state.info.displayName || 'fc').replace(/[^A-Za-z0-9_-]/g, '_');
        const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
        const blob = new Blob([state.backup + '\n'], { type: 'text/plain' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `backup-${name}-${stamp}.txt`;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    }

    function renderBackup(card) {
        const lines = state.backup.split('\n').filter((l) => l && !l.startsWith('#')).length;
        card.innerHTML = `
            <h1>Save a backup</h1>
            <p class="lede">This is your flight controller's current setup (${lines} settings that differ from defaults). Keep it: pasting it into the CLI puts everything back exactly as it was.</p>
            <ul class="list">
                <li><span class="k">Board</span><span>${esc(state.info.displayName)}</span></li>
                <li><span class="k">Firmware</span><span>${esc(state.info.version)}</span></li>
                <li><span class="k">Receiver port</span><span>${esc(state.caps.rxUartValue || 'not set')}</span></li>
                <li><span class="k">Kalman filter</span><span>${state.caps.hasKalman ? '<span class="tag good">fork build</span>' : '<span class="tag">stock Betaflight</span>'}</span></li>
            </ul>
            <div class="row" style="margin-top:18px"><button class="btn" id="dl">Download backup</button><span id="saved" class="lede" style="margin:0"></span></div>`;
        const n = nav(card, { back: false, nextDisabled: true, next: 'Continue' });
        $('#dl', card).onclick = () => {
            downloadBackup();
            $('#saved', card).textContent = 'Saved to your downloads.';
            n.setNextEnabled(true);
        };
        const skip = document.createElement('button');
        skip.className = 'btn';
        skip.textContent = 'Skip';
        skip.onclick = () => go(2);
        card.querySelector('.nav .row').prepend(skip);
    }

    // ------------------------------------------------------------ 3 quad

    function renderQuad(card) {
        const c = state.choices;
        card.innerHTML = `
            <h1>Your quad</h1>
            <p class="lede">Pick the prop size. This sets the PIDs and filters to a freestyle starting point for that class.</p>`;
        card.appendChild(choiceGrid(Object.entries(FS.FRAMES).map(([k, f]) => [k,
            `<span class="big">${esc(f.label)}</span><small>${esc(f.blurb)}</small>`]), c.frame, (k) => { c.frame = k; }));

        const rest = document.createElement('div');
        rest.innerHTML = `
            <h2>Prop direction</h2>
            <div id="props"></div>
            <h2>ESC firmware</h2>
            <div id="esc"></div>
            <h2>Name <span class="lede" style="font-weight:400">(optional, shows in the OSD)</span></h2>
            <div class="field"><input type="text" id="name" maxlength="16" placeholder="e.g. RIPPER" value="${esc(c.craftName)}"></div>`;
        card.appendChild(rest);
        $('#props', rest).appendChild(choiceGrid([
            ['in', '<b>Props in</b><small>Betaflight default. The front props spin toward the camera.</small>'],
            ['out', '<b>Props out</b><small>Front props spin away from the camera. Popular for freestyle: kicks up less grass.</small>'],
        ], c.propsOut ? 'out' : 'in', (k) => { c.propsOut = k === 'out'; }));
        if (state.caps.hasBidir) {
            $('#esc', rest).appendChild(choiceGrid([
                ['rpm', '<b>Bluejay, BLHeli_32 or AM32</b><small>Turns on RPM filtering: the biggest single improvement in how a quad flies.</small>'],
                ['plain', '<b>BLHeli_S or not sure</b><small>Leaves RPM filtering off. You can flash Bluejay later and run this again.</small>'],
            ], c.escRpm ? 'rpm' : 'plain', (k) => { c.escRpm = k === 'rpm'; }));
        } else {
            $('#esc', rest).innerHTML = '<div class="note">This build has no DShot telemetry, so RPM filtering stays off.</div>';
        }
        $('#name', rest).oninput = (e) => { c.craftName = e.target.value; };
        nav(card, {});
    }

    // ------------------------------------------------------------ 4 receiver

    function renderReceiver(card) {
        const c = state.choices;
        card.innerHTML = `
            <h1>Receiver</h1>
            <p class="lede">What receiver is on the quad, and which UART is it wired to? The UART number is printed next to the RX/TX pads on most boards (R2/T2 is UART2).</p>`;
        card.appendChild(choiceGrid(Object.entries(FS.RECEIVERS).map(([k, r]) => [k,
            `<b>${esc(r.label)}</b><small>${esc(r.hint)}</small>`]), c.receiver, (k) => { c.receiver = k; }));
        const f = document.createElement('div');
        const current = state.caps.rxUartValue;
        f.innerHTML = `
            <h2>Wired to</h2>
            <div class="field">
                <label for="uart">UART</label>
                <select id="uart">${state.caps.uarts.map((u) => `<option ${u === c.rxUart ? 'selected' : ''}>${u}</option>`).join('')}</select>
            </div>
            ${current && /^UART/i.test(current) ? `<p class="lede">The board is currently set to ${esc(current)}${current.toUpperCase() === c.rxUart ? ', so the board maker\'s pad is already selected' : ''}.</p>` : ''}
            <div class="note"><b>Receiver wiring</b>Receiver TX goes to the FC's RX pad, receiver RX to the FC's TX pad. SBUS goes to the pad marked SBUS.</div>`;
        card.appendChild(f);
        $('#uart', f).onchange = (e) => { c.rxUart = e.target.value; };
        nav(card, {});
    }

    // ------------------------------------------------------------ 5 feel

    function curvePath(a) {
        // Betaflight actual rates
        const pts = [];
        for (let i = 0; i <= 40; i++) {
            const x = i / 40;
            const expof = x * (Math.pow(x, 5) * a.expo + x * (1 - a.expo));
            const rate = x * a.center + Math.max(0, a.max - a.center) * expof;
            pts.push([x * 160, 60 - (rate / 1000) * 56]);
        }
        return 'M' + pts.map((p) => p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' L');
    }

    function renderFeel(card) {
        const c = state.choices;
        card.innerHTML = `
            <h1>Flying feel</h1>
            <p class="lede">Rates: how fast the quad rotates for a given stick. You can change these any time in the Betaflight App.</p>`;
        card.appendChild(choiceGrid(Object.entries(FS.FEELS).map(([k, f]) => [k,
            `<b>${esc(f.label)}</b><small>${esc(f.blurb)}</small>
             <svg class="curve" viewBox="0 0 160 64" preserveAspectRatio="none" aria-hidden="true"><line x1="0" y1="60" x2="160" y2="60"/><path d="${curvePath(f.rp)}"/></svg>
             <small>${f.rp.center}°/s at center · ${f.rp.max}°/s full stick</small>`]), c.feel, (k) => { c.feel = k; }));
        if (state.caps.hasKalman) {
            const k = document.createElement('div');
            k.innerHTML = `
                <h2>Extra smoothing</h2>
                <label class="check"><input type="checkbox" id="kal" ${c.kalman ? 'checked' : ''}>
                <span><b>Kalman filter</b><br><span class="lede">EmuFlight-style smoothing on top of the normal filters. Softer feel, slightly more delay. ${state.caps.kalmanOn ? 'It\'s on now; leaving this ticked keeps your current Kalman settings.' : 'Leave it off for your first flights on a new build.'}</span></span></label>`;
            card.appendChild(k);
            $('#kal', k).onchange = (e) => { c.kalman = e.target.checked; };
        }
        nav(card, {});
    }

    // ------------------------------------------------------------ 6 apply

    function summaryList() {
        const c = state.choices;
        const f = FS.FRAMES[c.frame];
        const r = FS.RECEIVERS[c.receiver];
        const feel = FS.FEELS[c.feel];
        return `<ul class="list">
            <li><span class="k">Frame</span><span>${esc(f.label)} freestyle${c.craftName ? ' · ' + esc(c.craftName) : ''}</span></li>
            <li><span class="k">Props</span><span>${c.propsOut ? 'Props out' : 'Props in'}</span></li>
            <li><span class="k">RPM filtering</span><span>${c.escRpm ? 'On' : 'Off'}</span></li>
            <li><span class="k">Receiver</span><span>${esc(r.label)} on ${esc(c.rxUart)}</span></li>
            <li><span class="k">Rates</span><span>${esc(feel.label)}</span></li>
            ${state.caps.hasKalman ? `<li><span class="k">Kalman</span><span>${c.kalman ? 'On' : 'Off'}</span></li>` : ''}
        </ul>`;
    }

    function renderApply(card) {
        const plan = FS.buildPlan(state.choices, state.caps);
        card.innerHTML = `
            <h1>Apply</h1>
            <p class="lede">This writes your choices to the flight controller and reboots it. Takes about ten seconds.</p>
            ${summaryList()}
            <details class="plan"><summary>Show the exact commands (${plan.filter((l) => !l.startsWith('#')).length})</summary><pre>${esc(plan.join('\n'))}</pre></details>
            <div class="progress" hidden><div></div></div>
            <p id="status" class="lede" aria-live="polite"></p>`;
        const bar = $('.progress', card);
        const status = $('#status', card);
        nav(card, {
            next: 'Apply and reboot',
            onNext: async () => {
                state.busy = true;
                try {
                    bar.hidden = false;
                    if (state.link.mode !== 'cli') await state.link.enterCli();
                    status.textContent = 'Writing settings…';
                    const result = await runLines(plan, (p) => { bar.firstElementChild.style.width = (p * 100) + '%'; });
                    if (result.errors.length) {
                        const first = result.errors[0];
                        await state.link.leaveCli(false);
                        await reconnect(status);
                        await state.link.enterCli();
                        throw new Error(`The flight controller refused "${first.line}" (${first.out.replace(/#/g, '').trim()}). Nothing was saved.`);
                    }
                    if (result.skipped.length) log('Not in this build, skipped:\n' + result.skipped.join('\n'));
                    await cliFinish(true, status);
                    status.textContent = 'Done.';
                } finally {
                    state.busy = false;
                }
            },
        });
    }

    // ------------------------------------------------------------ 7 sticks

    const STICK_PROMPTS = [
        { f: 0, act: 'roll', text: 'Push the <b>right stick fully right</b> and hold it (roll).' },
        { f: 1, act: 'pitch', text: 'Push the <b>right stick fully up</b> and hold it (pitch).' },
        { f: 2, act: 'yaw', text: 'Push the <b>left stick fully right</b> and hold it (yaw).' },
        { f: 3, act: 'throttle', text: 'Push the <b>left stick fully up</b> and hold it (throttle).' },
    ];

    function stickWidget() {
        const w = document.createElement('div');
        w.className = 'sticks';
        w.innerHTML = `
            <div class="gimbal"><div class="pad"><div class="knob" id="kl"></div></div><p>Throttle / yaw</p></div>
            <div class="gimbal"><div class="pad"><div class="knob" id="kr"></div></div><p>Pitch / roll</p></div>
            <div class="bars" id="bars"></div>`;
        const pos = (v) => Math.min(100, Math.max(0, (v - 1000) / 10));
        const names = ['Roll', 'Pitch', 'Yaw', 'Throttle'];
        return {
            el: w,
            update(ch) {
                if (!ch.length) return;
                const kl = $('#kl', w), kr = $('#kr', w);
                if (kl && kr) {
                kl.style.left = (8 + pos(ch[2]) * 1.24) + 'px';
                kl.style.top = (8 + (100 - pos(ch[3])) * 1.24) + 'px';
                kr.style.left = (8 + pos(ch[0]) * 1.24) + 'px';
                kr.style.top = (8 + (100 - pos(ch[1])) * 1.24) + 'px';
                }
                const bars = $('#bars', w);
                const n = Math.min(ch.length, 12);
                if (bars.children.length !== n) {
                    bars.innerHTML = '';
                    for (let i = 0; i < n; i++) {
                        bars.insertAdjacentHTML('beforeend', `<div class="bar"><span>${i < 4 ? names[i] : 'AUX' + (i - 3)}</span><div class="track"><div class="fill"></div></div><span class="val"></span></div>`);
                    }
                }
                for (let i = 0; i < n; i++) {
                    const row = bars.children[i];
                    row.querySelector('.fill').style.width = pos(ch[i]) + '%';
                    row.querySelector('.val').textContent = ch[i];
                }
            },
        };
    }

    function renderSticks(card) {
        card.innerHTML = `
            <h1>Check your sticks</h1>
            <p class="lede">Turn on your radio. The wizard checks that each stick reaches the right channel and fixes the channel order if it doesn't.</p>`;
        const widget = stickWidget();
        card.appendChild(widget.el);
        const area = document.createElement('div');
        area.setAttribute('aria-live', 'polite');
        card.appendChild(area);
        const n = nav(card, { nextDisabled: true, back: false });

        const feed = rcFeed();
        const signal = { cancelled: false };
        onLeave(() => { signal.cancelled = true; });
        const tick = () => { widget.update(feed.latest); if (!signal.cancelled) requestAnimationFrame(tick); };
        requestAnimationFrame(tick);

        const run = async () => {
            // wait for a live link first
            const t0 = Date.now();
            while (!feed.latest.length || feed.latest.slice(0, 4).every((v) => v === 0)) {
                if (signal.cancelled) return;
                if (Date.now() - t0 > 3000) {
                    area.innerHTML = '<div class="note warn"><b>No receiver signal yet.</b>Check the radio is on and bound, and the receiver LED is solid.</div>';
                }
                await FS.sleep(200);
            }
            area.innerHTML = '';
            const s = state.sticks;
            s.found = []; s.reversed = [];
            for (const p of STICK_PROMPTS) {
                area.innerHTML = `<div class="prompt"><i class="spin"></i><span>${p.text}</span></div>`;
                if (state.demo) state.transport.fc.act(p.act);
                const r = await detectMove(feed, [0, 1, 2, 3], signal);
                s.found[p.f] = r.index;
                s.reversed[p.f] = r.to < r.from;
                area.innerHTML = '<div class="prompt"><span>Got it. Let go of the stick.</span></div>';
                // wait for return to center (or low, for throttle)
                const back = Date.now();
                while (Math.abs(feed.latest[r.index] - r.from) > 150 && Date.now() - back < 5000) {
                    if (signal.cancelled) return;
                    await FS.sleep(100);
                }
            }
            const newMap = FS.fixChannelMap(state.caps.map, s.found);
            const names = ['Roll', 'Pitch', 'Yaw', 'Throttle'];
            const rev = s.reversed.map((r, i) => (r ? names[i] : null)).filter(Boolean);
            let html = '';
            if (!newMap) {
                html += '<div class="note bad"><b>Two sticks landed on the same channel.</b>Try again, moving only one stick at a time.</div><button class="btn" id="again">Try again</button>';
            } else if (newMap !== state.caps.map) {
                s.newMap = newMap;
                html += `<div class="note good"><b>Channel order fixed.</b>Your radio sends a different order than the board expected. It will be set to ${esc(newMap.slice(0, 4))} when you save switches.</div>`;
            } else {
                s.newMap = null;
                html += '<div class="note good"><b>All four sticks are on the right channels.</b></div>';
            }
            if (rev.length) {
                html += `<div class="note warn"><b>${esc(rev.join(', '))} ${rev.length > 1 ? 'are' : 'is'} reversed.</b>Reverse ${rev.length > 1 ? 'those channels' : 'that channel'} on your radio (Outputs page on EdgeTX) and run this step again.</div>`;
            }
            area.innerHTML = html;
            const again = $('#again', area);
            if (again) again.onclick = () => run();
            n.setNextEnabled(!!newMap);
        };
        run().catch((e) => { if (e.message !== 'cancelled') showError(card, e); });
    }

    // ------------------------------------------------------------ 8 switches

    function renderSwitches(card) {
        card.innerHTML = `
            <h1>Switches</h1>
            <p class="lede">Flip each switch to the position you want. Arm is required; the others are optional but worth having.</p>`;
        const widget = stickWidget();
        widget.el.querySelectorAll('.gimbal').forEach((g) => g.remove());
        card.appendChild(widget.el);
        const area = document.createElement('div');
        area.setAttribute('aria-live', 'polite');
        card.appendChild(area);
        const status = document.createElement('p');
        status.className = 'lede';
        card.appendChild(status);

        const feed = rcFeed();
        const signal = { cancelled: false };
        onLeave(() => { signal.cancelled = true; });
        const tick = () => { widget.update(feed.latest); if (!signal.cancelled) requestAnimationFrame(tick); };
        requestAnimationFrame(tick);

        const keys = Object.keys(FS.MODES);
        const sw = state.switches;
        let n;

        const summary = () => keys.map((k) => {
            const s = sw[k];
            return `<li><span class="k">${esc(FS.MODES[k].label)}</span><span>${s ? `AUX${s.aux + 1} <span class="tag good">set</span>` : (s === null ? '<span class="tag">skipped</span>' : '…')}</span></li>`;
        }).join('');

        const ask = (key) => new Promise((resolve) => {
            const optional = key !== 'arm';
            area.innerHTML = `<ul class="list">${summary()}</ul>
                <div class="prompt"><i class="spin"></i><span>Flip the switch you want for <b>${esc(FS.MODES[key].label)}</b>${key === 'arm' ? ', then flip it back to disarmed' : ''}.</span></div>
                ${optional ? '<button class="btn small" id="skip">Skip</button>' : ''}`;
            const sig = { cancelled: false };
            const parentCancel = setInterval(() => { if (signal.cancelled) sig.cancelled = true; }, 100);
            if (optional) $('#skip', area).onclick = () => { sig.cancelled = true; clearInterval(parentCancel); resolve(null); };
            if (state.demo) state.transport.fc.act(key);
            const aux = [];
            for (let i = 4; i < Math.max(feed.latest.length, 8); i++) aux.push(i);
            detectMove(feed, aux, sig).then((r) => {
                clearInterval(parentCancel);
                resolve({ aux: r.index - 4, value: r.to });
            }, () => { clearInterval(parentCancel); resolve(undefined); });
        });

        const run = async () => {
            while (!feed.latest.length) { if (signal.cancelled) return; await FS.sleep(100); }
            for (const k of keys) {
                if (signal.cancelled) return;
                let r = await ask(k);
                if (r === undefined) return; // left the step
                if (r && k !== 'arm' && sw.arm && r.aux === sw.arm.aux) {
                    area.insertAdjacentHTML('beforeend', '<div class="note warn"><b>That\'s the arm switch.</b>Pick a different switch.</div>');
                    await FS.sleep(1500);
                    r = await ask(k);
                    if (r === undefined) return;
                }
                sw[k] = r;
                if (k === 'arm') {
                    // wait for the switch to go back to disarmed
                    const t = Date.now();
                    while (Math.abs(feed.latest[r.aux + 4] - r.value) < 200 && Date.now() - t < 8000) {
                        if (state.demo) state.transport.fc.aux[0] = 1000;
                        await FS.sleep(100);
                    }
                }
            }
            area.innerHTML = `<ul class="list">${summary()}</ul>`;
            n.setNextEnabled(true);
        };

        n = nav(card, {
            nextDisabled: true,
            next: 'Save switches',
            onNext: async () => {
                state.busy = true;
                try {
                    const lines = FS.switchLines(sw);
                    if (state.sticks.newMap) lines.push('map ' + state.sticks.newMap);
                    signal.cancelled = true;
                    await FS.sleep(150);
                    await state.link.enterCli();
                    const r = await runLines(lines);
                    if (r.errors.length) {
                        await state.link.leaveCli(false);
                        await reconnect(status);
                        throw new Error('The flight controller refused "' + r.errors[0].line + '". Nothing was saved.');
                    }
                    await cliFinish(true, status);
                    if (state.sticks.newMap) state.caps.map = state.sticks.newMap;
                } finally {
                    state.busy = false;
                }
            },
        });
        run().catch((e) => showError(card, e));
    }

    // ------------------------------------------------------------ 9 motors

    // Top view, front up. Positions: 0 RR, 1 FR, 2 RL, 3 FL (Betaflight motors 1-4).
    const QUAD_XY = [[200, 200], [200, 60], [60, 200], [60, 60]];

    function quadSvg() {
        const motors = QUAD_XY.map(([x, y], i) => `
            <g class="motor" data-pos="${i}" tabindex="0" role="button" aria-label="${POSITION_NAMES[i]}">
                <circle cx="${x}" cy="${y}" r="34"/><path class="dir" data-dir="${i}" d=""/><text x="${x}" y="${y}">${i + 1}</text>
            </g>`).join('');
        return `<svg class="quad" viewBox="0 0 260 260" role="group" aria-label="Quad seen from above, front at the top">
            <line class="arm" x1="60" y1="60" x2="200" y2="200"/><line class="arm" x1="200" y1="60" x2="60" y2="200"/>
            <rect class="body" x="100" y="96" width="60" height="68" rx="10"/><path class="nose" d="M118 96 L130 80 L142 96 Z"/>
            ${motors}</svg>`;
    }

    // Arc arrow around a motor, CW or CCW as seen from above
    function arcArrow(x, y, dir) {
        const r = 44;
        const a0 = -150 * Math.PI / 180, a1 = -30 * Math.PI / 180;
        const p = (a) => [x + r * Math.cos(a), y + r * Math.sin(a)];
        const [sx, sy] = p(a0), [ex, ey] = p(a1);
        const cw = dir === 'CW';
        const tip = cw ? [ex, ey] : [sx, sy];
        const tangent = cw ? a1 + Math.PI / 2 : a0 - Math.PI / 2;
        const back = (len, off) => [tip[0] - len * Math.cos(tangent + off), tip[1] - len * Math.sin(tangent + off)];
        const h1 = back(10, 0.5), h2 = back(10, -0.5);
        return `M${sx.toFixed(1)} ${sy.toFixed(1)} A${r} ${r} 0 0 1 ${ex.toFixed(1)} ${ey.toFixed(1)} M${h1[0].toFixed(1)} ${h1[1].toFixed(1)} L${tip[0].toFixed(1)} ${tip[1].toFixed(1)} L${h2[0].toFixed(1)} ${h2[1].toFixed(1)}`;
    }

    function renderMotors(card) {
        const m = state.motors;
        card.innerHTML = `
            <h1>Motors</h1>
            <p class="lede">Each motor spins slowly, one at a time. Tell the wizard where it is, then whether it spins the right way. It fixes both.</p>
            <div class="note bad"><b>Take the props off.</b>All four, before plugging in the battery. A motor test with props on can cut you badly.</div>
            <label class="check"><input type="checkbox" id="props"><span>All props are off</span></label>
            <label class="check"><input type="checkbox" id="armoff"><span>The arm switch is in the disarmed position</span></label>
            <p class="lede" id="bat" aria-live="polite"></p>
            <div class="row"><button class="btn primary" id="start" disabled>Start motor test</button></div>
            <div id="area" aria-live="polite"></div>`;
        const area = $('#area', card);
        const bat = $('#bat', card);
        const start = $('#start', card);
        const n = nav(card, { nextDisabled: true });
        const signal = { cancelled: false };
        let spinTimer = null;
        let liveMotor = -1;

        const stopAll = async () => {
            clearTimeout(spinTimer);
            liveMotor = -1;
            try { if (state.link.mode === 'msp') await state.link.stopMotors(); } catch (e) { log('stop: ' + e.message); }
            card.querySelectorAll('.motor').forEach((g) => g.classList.remove('live'));
        };
        const spin = async (i) => {
            await stopAll();
            const vals = [1000, 1000, 1000, 1000];
            vals[i] = SPIN_TEST_US;
            await state.link.setMotors(vals, 4);
            liveMotor = i;
            spinTimer = setTimeout(stopAll, SPIN_AUTO_STOP_MS);
        };
        const releaseArming = async () => {
            try { if (state.link.mode === 'msp') await state.link.setArmingDisabled(false); } catch (e) { log('arming: ' + e.message); }
        };
        onLeave(async () => { signal.cancelled = true; await stopAll(); await releaseArming(); });
        window.addEventListener('pagehide', stopAll);

        let haveBattery = false;
        let testing = false;
        const refresh = () => {
            start.disabled = testing || !($('#props', card).checked && $('#armoff', card).checked && haveBattery);
        };
        $('#props', card).onchange = refresh;
        $('#armoff', card).onchange = refresh;

        // battery + rpm telemetry
        poll(async () => {
            const b = await state.link.readBattery();
            haveBattery = b.cells > 0 || b.voltage > 5;
            bat.innerHTML = haveBattery
                ? `Battery: <b>${b.voltage.toFixed(1)} V</b>${b.cells ? ` (${b.cells}S)` : ''}`
                : '<b>Plug in a battery</b> (props off!). Motors don\'t spin on USB power alone.';
            refresh();
            if (liveMotor >= 0 && state.choices.escRpm) {
                const t = await state.link.readMotorTelemetry();
                const rpm = t[liveMotor] ? t[liveMotor].rpm : 0;
                if (rpm > 0) m.rpmSeen = true;
                const el = $('#rpm', card);
                if (el) el.textContent = rpm > 0 ? `${rpm} rpm` : 'no RPM telemetry yet';
            }
        }, 400);

        const pickCorner = (prompt) => new Promise((resolve) => {
            area.querySelector('.prompt span').innerHTML = prompt;
            area.querySelectorAll('.motor').forEach((g) => {
                const pick = () => resolve(parseInt(g.dataset.pos, 10));
                g.onclick = pick;
                g.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } };
            });
        });

        const orderTest = async () => {
            m.reorder = await state.link.readMotorReordering();
            area.innerHTML = `<div class="prompt"><i class="spin"></i><span></span></div>${quadSvg()}<p class="lede" id="rpm"></p>`;
            m.corner = [];
            for (let i = 0; i < 4; i++) {
                if (signal.cancelled) return false;
                await spin(i);
                const demoHint = state.demo ? ` <small>(demo: it's the ${POSITION_NAMES[state.transport.fc.spinningCorner(i)].toLowerCase()})</small>` : '';
                const pos = await pickCorner(`Motor ${i + 1} is spinning. <b>Click where it is on the quad.</b>${demoHint}`);
                await stopAll();
                if (m.corner.includes(pos)) {
                    i--; // same corner twice: ask again
                    area.querySelector('.prompt span').innerHTML = 'That corner is already taken. Watch again.';
                    await FS.sleep(1200);
                    continue;
                }
                m.corner[i] = pos;
                area.querySelector(`.motor[data-pos="${pos}"]`).classList.add('picked');
            }
            const next = FS.fixMotorOrder(m.reorder, m.corner);
            const changed = next && next.some((v, i) => v !== m.reorder[i]);
            if (changed) {
                area.querySelector('.prompt').innerHTML = '<i class="spin"></i><span>Fixing motor order and rebooting…</span>';
                await state.link.writeMotorReordering(next);
                await state.link.eepromWrite();
                await state.link.reboot();
                await reconnect();
                await state.link.setArmingDisabled(true);
                m.orderFixed = true;
            }
            return true;
        };

        const directionTest = async () => {
            const propsOut = state.choices.propsOut;
            area.innerHTML = `<div class="prompt"><i class="spin"></i><span></span></div>${quadSvg()}
                <p class="lede" id="rpm"></p>
                <div class="row" id="dirbtns"><button class="btn primary" id="ok">Spinning the right way</button><button class="btn" id="bad">Wrong way, reverse it</button></div>`;
            for (let pos = 0; pos < 4; pos++) {
                const [x, y] = QUAD_XY[pos];
                area.querySelector(`[data-dir="${pos}"]`).setAttribute('d', arcArrow(x, y, FS.expectedSpin(pos, propsOut)));
            }
            for (let pos = 0; pos < 4; pos++) {
                if (signal.cancelled) return false;
                for (;;) {
                    await spin(pos);
                    area.querySelectorAll('.motor').forEach((g) => g.classList.toggle('live', g.dataset.pos === String(pos)));
                    const want = FS.expectedSpin(pos, propsOut) === 'CW' ? 'clockwise' : 'counter-clockwise';
                    const demoHint = state.demo ? ` <small>(demo: ${state.transport.fc.spinsWrong(pos) ? 'it\'s spinning the wrong way' : 'it\'s correct'})</small>` : '';
                    area.querySelector('.prompt span').innerHTML = `${POSITION_NAMES[pos]} should spin <b>${want}</b> seen from above.${demoHint}`;
                    const ok = await new Promise((resolve) => {
                        $('#ok', area).onclick = () => resolve(true);
                        $('#bad', area).onclick = () => resolve(false);
                    });
                    await stopAll();
                    if (ok) {
                        area.querySelector(`.motor[data-pos="${pos}"]`).classList.add('picked');
                        break;
                    }
                    area.querySelector('.prompt span').textContent = 'Reversing…';
                    m.dirFlag[pos] = !m.dirFlag[pos];
                    await FS.sleep(300);
                    try {
                        await state.link.setMotorDirection(pos, m.dirFlag[pos]);
                    } catch (e) {
                        throw new Error('The ESC did not accept the direction command. Reverse this motor in ESC Configurator (esc-configurator.com) instead.');
                    }
                    await FS.sleep(800);
                }
            }
            return true;
        };

        start.onclick = async () => {
            testing = true;
            start.disabled = true;
            card.querySelectorAll('.check input').forEach((c) => { c.disabled = true; });
            try {
                await state.link.setArmingDisabled(true);
                if (!(await orderTest())) return;
                if (!(await directionTest())) return;
                await releaseArming();
                if (state.choices.escRpm && !m.rpmSeen) m.rpmMissing = true;
                area.innerHTML = `<div class="note good"><b>Motors are sorted.</b>${m.orderFixed ? 'Motor order was fixed. ' : 'Motor order was already right. '}All four spin the right way.</div>`
                    + (m.rpmMissing ? '<div class="note warn"><b>No RPM telemetry from the ESCs.</b>They may not support bidirectional DShot. The next step can turn RPM filtering off.</div>' : '');
                n.setNextEnabled(true);
            } catch (e) {
                await stopAll();
                showError(card, e);
                testing = false;
                card.querySelectorAll('.check input').forEach((c) => { c.disabled = false; });
                refresh();
            }
        };

        const skip = document.createElement('button');
        skip.className = 'btn';
        skip.textContent = 'Skip';
        skip.onclick = () => go(state.step + 1);
        card.querySelector('.nav .row').prepend(skip);
    }

    // ------------------------------------------------------------ 10 done

    function renderDone(card) {
        const m = state.motors;
        card.innerHTML = `
            <h1>Ready to fly</h1>
            <p class="lede">Your quad is set up. Unplug the battery, put the props back on (check each one matches its motor's spin direction) and go fly.</p>
            ${summaryList()}
            ${m.rpmMissing ? `<div class="note warn"><b>RPM filtering is on but the ESCs aren't sending RPM.</b>The quad will still fly, but with weaker filtering and warnings in the OSD.<div class="row" style="margin-top:10px"><button class="btn small" id="norpm">Turn RPM filtering off</button></div></div>` : ''}
            <h2>First flight</h2>
            <ul class="list">
                <li><span class="k">1</span><span>Hover low for 20 seconds, then land. Touch the motors: warm is fine, too hot to hold is not.</span></li>
                <li><span class="k">2</span><span>Fly a short pack. Listen for oscillations on hard throttle punches and in prop wash.</span></li>
                <li><span class="k">3</span><span>Check the motors again. If all is well, rip.</span></li>
            </ul>
            <p class="lede" id="status" style="margin-top:16px"></p>
            <div class="row" style="margin-top:16px"><button class="btn" id="dl">Download the original backup again</button><button class="btn" id="disc">Disconnect</button></div>`;
        $('#dl', card).onclick = downloadBackup;
        $('#disc', card).onclick = async () => {
            try { await state.transport.close(); } catch (e) { /* ignore */ }
            setConn('', 'Not connected');
            state.maxStep = 0;
            go(0);
        };
        const norpm = $('#norpm', card);
        if (norpm) {
            norpm.onclick = async () => {
                norpm.disabled = true;
                const status = $('#status', card);
                try {
                    await state.link.enterCli();
                    await runLines(['set dshot_bidir = OFF', 'set dyn_notch_count = 3', 'set dyn_notch_q = 300', 'set dyn_idle_min_rpm = 0']);
                    await cliFinish(true, status);
                    state.choices.escRpm = false;
                    m.rpmMissing = false;
                    go(state.step);
                } catch (e) {
                    showError(card, e);
                }
            };
        }
    }

    // ------------------------------------------------------------ boot

    setConn('', 'Not connected');
    go(0);
})();
