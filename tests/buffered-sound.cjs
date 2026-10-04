const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('app.js', 'utf8').split('// Load with a timeout')[0];
let downloads = 0;
let finishDownload;
let pendingDownload;
const context = vm.createContext({
  console,
  fetch: async path => {
    downloads++;
    if (pendingDownload) await pendingDownload;
    const index = Number(path.match(/loop-(\d+)/)?.[1] || 10);
    return { ok: true, arrayBuffer: async () => ({ index }) };
  }
});
vm.runInContext(source + '\nglobalThis.BufferedParkingSound = BufferedParkingSound;', context);
class FakeContext {
  constructor() { this.currentTime = 0; this.sources = []; this.resumes = 0; }
  createGain() {
    return { gain: { value: 1, ramps: [], setValueAtTime(value) { this.value = value; },
      linearRampToValueAtTime(value, time) { this.ramps.push([value, time]); } },
      connect() {}, disconnect() {} };
  }
  async resume() { this.resumes++; }
  async decodeAudioData(data) { return { duration: 12 / (data.index / 10) }; }
  createBufferSource() {
    const node = { stops: [], starts: [], connect() {}, disconnect() {},
      start(time, offset) { this.starts.push(offset); }, stop(time) { this.stops.push(time); } };
    Object.defineProperty(node, 'playbackRate', {
      get() { throw new Error('Pitch-preserving buffers must play at native speed'); }
    });
    this.sources.push(node);
    return node;
  }
}
async function main() {
  const audio = new FakeContext();
  const sound = new context.BufferedParkingSound(audio);
  const starting = sound.resume();
  assert.equal(audio.resumes, 1, 'Audio clock unlock happens synchronously in the tap');
  await starting;
  await Promise.all([...sound.loading.values()]);
  assert.equal(downloads, 7);
  const first = audio.sources[0];
  assert.equal(first.loop, true);
  assert.equal(sound.gain.gain.value, 0.65);
  audio.currentTime = 3;
  sound.pulse({ ratio: 1 }, 0);
  audio.currentTime = 3.1;
  sound.pulse({ ratio: 1 }, 100);
  const second = audio.sources[1];
  assert(second, 'Occupancy selects a faster tempo');
  assert.equal(sound.index, 11);
  assert.equal(second.loop, true);
  assert(Math.abs(second.starts[0] / second.buffer.duration - 3.1 / 12) < 1e-9,
    'Tempo transition preserves musical phase');
  assert(Math.abs(first.stops[0] - 3.28) < 1e-9, 'Previous source stops after the crossfade');
  assert.equal(sound.voiceGain.gain.ramps[0][0], 1);
  for (let frame = 1; frame <= 600; frame++) {
    audio.currentTime = 3.1 + frame / 60;
    sound.pulse({ ratio: 1 }, 100 + frame * 1000 / 60);
  }
  assert.equal(sound.index, 14);
  const sourceCount = audio.sources.length;
  audio.currentTime += 5;
  sound.pulse({ ratio: 1 }, 15100);
  assert.equal(audio.sources.length, sourceCount, 'Stable occupancy keeps the same source');
  sound.clear();
  const offset = sound.offset;
  assert(offset > 0 && offset < 1);
  audio.currentTime += 20;
  await sound.resume();
  assert(Math.abs(sound.source.starts[0] / sound.source.buffer.duration - offset) < 1e-9,
    'Pause retains loop position at the selected tempo');
  assert.equal(downloads, 7, 'Decoded tempo buffers are reused');
  sound.clear(true);
  await sound.resume();
  assert.equal(sound.source.starts[0], 0);
  assert.equal(sound.index, 10);
  sound.clear();

  pendingDownload = new Promise(resolve => { finishDownload = resolve; });
  const loadingContext = new FakeContext();
  const loadingSound = new context.BufferedParkingSound(loadingContext);
  const loading = loadingSound.resume();
  loadingSound.clear();
  finishDownload();
  await loading;
  assert.equal(loadingContext.sources.length, 0, 'Mute during loading prevents late playback');
  pendingDownload = null;
  await loadingSound.resume();
  await Promise.all([...loadingSound.loading.values()]);
  assert.equal(loadingContext.sources.length, 1);
  loadingSound.clear();
  context.navigator = { userAgent: 'iPhone' };
  context.AudioContext = FakeContext;
  assert.equal(vm.runInContext('createParkingSound() instanceof BufferedParkingSound', context), true);
  context.navigator = { userAgent: 'Macintosh', platform: 'MacIntel', maxTouchPoints: 5 };
  assert.equal(vm.runInContext('createParkingSound() instanceof BufferedParkingSound', context), true);
  console.log('Passed: native-pitch tempo buffers, phase-aligned crossfades, pause/reset, decode reuse, iOS selection, and loading race.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
