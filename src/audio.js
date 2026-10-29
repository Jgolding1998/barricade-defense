// Procedural sound effects. Context creation and confirmation need an explicit
// Sound gesture. The same tone graph can be rendered by OfflineAudioContext.

export const VOICE_LIMIT = 32;

export function scheduleTone(ctx, destination, type, f0, f1, dur, vol, delay = 0, onEnd = () => {}) {
  const t = ctx.currentTime + 0.02 + delay;
  const oscillator = ctx.createOscillator(), gain = ctx.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(f0, t);
  oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  gain.gain.setValueAtTime(vol, t);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  oscillator.connect(gain).connect(destination);
  oscillator.onended = () => {
    oscillator.disconnect(); gain.disconnect(); onEnd(oscillator);
  };
  oscillator.start(t); oscillator.stop(t + dur + 0.02);
  return oscillator;
}

export function createAudio(onStatus = () => {}) {
  let ctx = null;
  let master = null;
  let enabled = false;
  let busy = false;
  let wantRunning = false;
  let epoch = 0;
  const voices = new Set();

  function quiet(method) {
    try {
      const result = ctx?.[method]?.();
      if (result && typeof result.catch === 'function') result.catch(() => {});
    } catch { /* Sound is optional when the browser denies it. */ }
  }

  function publish(kind, message) {
    try { onStatus({enabled, busy, kind, message}); } catch { /* UI callbacks cannot stop play. */ }
  }

  function unavailable() {
    enabled = busy = false;
    wantRunning = false;
    epoch++;
    quiet('close');
    ctx = master = null;
    voices.clear();
    publish('unavailable', 'Sound is blocked or unavailable. Press Sound to retry; the game still works.');
  }

  async function running(token) {
    const current = ctx;
    if (!current) return false;
    let timer;
    try {
      if (current.state !== 'running') await Promise.race([
        Promise.resolve(current.resume()),
        new Promise((resolve, reject) => {timer = setTimeout(() => reject(new Error('Audio start timed out')), 3000);}),
      ]);
      if (token !== epoch) {
        if (!wantRunning || current !== ctx) {
          try { current.suspend()?.catch?.(() => {}); } catch { /* A newer pause or Sound off wins. */ }
        }
        return false;
      }
      if (current.state !== 'running') throw new Error('Audio did not start');
      return true;
    } catch {
      if (token === epoch) unavailable();
      return false;
    } finally { clearTimeout(timer); }
  }

  function init() {
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) return false;
    try {
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.4;
      master.connect(ctx.destination);
      return true;
    } catch {
      if (ctx) quiet('close');
      ctx = master = null;
      return false;
    }
  }

  function tone(type, f0, f1, dur, vol, delay = 0) {
    if (voices.size >= VOICE_LIMIT) return;
    const source = scheduleTone(ctx, master, type, f0, f1, dur, vol, delay, node => voices.delete(node));
    voices.add(source);
  }

  return {
    get enabled() {
      return enabled;
    },
    // Must be called from a click or key handler.
    async toggle() {
      if (busy) return enabled;
      if (enabled) {
        epoch++; enabled = false; wantRunning = false; quiet('suspend');
        publish('off', 'Sound off.');
        return false;
      }
      if (!ctx && !init()) {unavailable(); return false;}
      busy = true;
      wantRunning = true;
      const token = ++epoch;
      publish('pending', 'Enabling sound...');
      const ok = await running(token);
      if (token !== epoch) return enabled;
      enabled = ok; busy = false;
      if (enabled) {
        this.play(660, 0.15, 'triangle', 0.18);
        if (enabled) publish('on', 'Sound enabled. A short test tone was sent; check tab and device volume if silent.');
      }
      return enabled;
    },
    suspend() {
      const wasBusy = busy;
      epoch++; busy = false;
      wantRunning = false;
      quiet('suspend');
      if (enabled) publish('paused', 'Sound paused with the game.');
      else if (wasBusy) publish('off', 'Sound was paused before it started. Press Sound to retry.');
    },
    async resume() {
      if (!ctx || !enabled) return false;
      wantRunning = true;
      const token = ++epoch;
      const ok = await running(token);
      if (ok && token === epoch) publish('on', 'Sound enabled. Check tab and device volume if silent.');
      return ok;
    },
    play(frequency, duration, type = 'sine', volume = 0.14) {
      if (!enabled || !ctx || ctx.state !== 'running') return;
      try { tone(type, frequency, frequency, duration, volume); } catch { unavailable(); }
    },
  };
}
