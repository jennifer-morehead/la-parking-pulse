const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('app.js', 'utf8').split('// Load with a timeout')[0];
let downloads = 0;
let finishDownload;
let pendingDownload;
const context = vm.createContext({
  fetch: async () => {
    downloads++;
    if (pendingDownload) await pendingDownload;
    return { ok: true, arrayBuffer: async () => new ArrayBuffer(0) };
  }
});
vm.runInContext(source + '\nglobalThis.BufferedParkingSound = BufferedParkingSound;', context);
class FakeContext {
  constructor() { this.currentTime = 0; this.sources = []; this.resumes = 0; }
  createGain() { return { gain: {}, connect() {} }; }
  async resume() { this.resumes++; }
  async decodeAudioData() { return { duration: 12 }; }
  createBufferSource() {
    const node = {
      stops: 0, starts: [], targets: [],
      connect() {}, disconnect() {},
      start(time, offset) { this.starts.push(offset); },
      stop() { this.stops++; }
    };
    node.playbackRate = {
      setValueAtTime() {}, cancelScheduledValues() {},
      setTargetAtTime(value) { node.targets.push(value); }
    };
    this.sources.push(node);
    return node;
  }
}
async function main() {
  const audio = new FakeContext();
  const sound = new context.BufferedParkingSound(audio);
  assert.equal(downloads, 0);
  const starting = sound.resume();
  assert.equal(audio.resumes, 1, 'Audio context unlock happens synchronously in the tap');
  await starting;
  const node = audio.sources[0];
  assert.equal(node.loop, true);
  assert.equal(sound.gain.gain.value, 0.65);
  sound.pulse({ ratio: 1 });
  for (let frame = 1; frame <= 600; frame++) {
    audio.currentTime = frame / 60;
    sound.pulse({ ratio: 1 });
  }
  assert.equal(node.targets.length, 2, 'Stable occupancy does not reschedule speed');
  assert.equal(node.stops, 0, 'Speed updates never stop the audio source');
  assert.equal(audio.sources.length, 1, 'One source continues through all animation frames');
  sound.clear();
  // Integral of a 1 -> 1.4 exponential ramp over 10 seconds, modulo 12.
  const expected = (14 - 0.1 * (1 - Math.exp(-40))) % 12;
  assert(Math.abs(sound.offset - expected) < 1e-9);
  audio.currentTime = 30;
  await sound.resume();
  assert(Math.abs(audio.sources[1].starts[0] - expected) < 1e-9, 'Pause resumes at the correct variable-speed position');
  assert.equal(downloads, 1, 'Decoded audio is reused');
  sound.clear(true);
  await sound.resume();
  assert.equal(audio.sources[2].starts[0], 0, 'Restart resets position');
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
  assert.equal(loadingContext.sources.length, 1);
  loadingSound.clear();
  context.navigator = { userAgent: 'iPhone' };
  context.AudioContext = FakeContext;
  assert.equal(vm.runInContext('createParkingSound() instanceof BufferedParkingSound', context), true);
  context.navigator = { userAgent: 'Macintosh', platform: 'MacIntel', maxTouchPoints: 5 };
  assert.equal(vm.runInContext('createParkingSound() instanceof BufferedParkingSound', context), true);
  console.log('Passed: iOS buffered loop, continuous speed ramps, position tracking, reset, decode reuse, and loading race.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
