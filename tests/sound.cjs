const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('app.js', 'utf8').split('// Load with a timeout')[0];
const context = vm.createContext({});
vm.runInContext(source + '\nglobalThis.soundExports = { ParkingSound, occupancyRhythm };', context);
const { ParkingSound, occupancyRhythm } = context.soundExports;
class FakeAudio {
  constructor() { this.paused = true; this.currentTime = 0; this.listeners = {}; }
  addEventListener(type, listener) { this.listeners[type] = listener; }
  pause() { this.paused = true; }
  async play() { if (this.loading) await this.loading; this.paused = false; }
}
async function main() {
  const unloadedAudio = new FakeAudio();
  Object.defineProperty(unloadedAudio, 'currentTime', {
    get() { return 0; },
    set() { throw new Error('Cannot seek before audio metadata is loaded'); }
  });
  const unloadedSound = new ParkingSound(unloadedAudio);
  unloadedSound.clear(true);
  assert.equal(unloadedAudio.paused, true, 'Initialization and restart avoid seeking unloaded audio');
  const sensors = [{SpaceID: 'A'}, {SpaceID: 'B'}];
  const states = new Map([['A', {state: 'OCCUPIED'}], ['B', {state: null}]]);
  assert.equal(occupancyRhythm(states, sensors).ratio, 0.5);
  assert.equal(occupancyRhythm(states, [sensors[1]]).ratio, 0, 'Offscreen occupancy is excluded');
  assert.equal(occupancyRhythm(states, []).ratio, 0);
  const audio = new FakeAudio();
  const sound = new ParkingSound(audio);
  assert.equal(audio.currentTime, 0);
  assert.equal(audio.preservesPitch, true);
  assert.equal(audio.loop, true, 'Native looping avoids restarting playback at the seam');
  assert.equal(audio.paused, true, 'No autoplay before enable and Play');
  await sound.resume();
  assert.equal(audio.paused, false);
  for (let now = 0; now < 2000; now += 20) sound.pulse({ratio: 0}, now);
  assert(Math.abs(audio.playbackRate - 0.8) < 0.001);
  for (let now = 2000; now < 4000; now += 20) sound.pulse({ratio: 1}, now);
  assert(Math.abs(audio.playbackRate - 1.4) < 0.001);
  assert.equal(audio.volume, 0.65, 'Speed changes preserve volume');
  audio.currentTime = 19;
  sound.clear();
  assert.equal(audio.paused, true);
  assert.equal(audio.currentTime, 19, 'Pause and mute retain song position');
  await sound.resume();
  assert.equal(audio.currentTime, 19);
  sound.clear(true);
  assert.equal(audio.currentTime, 0, 'Explicit restart returns to the beginning');
  assert.equal(audio.playbackRate, 1);
  let loaded;
  audio.loading = new Promise(resolve => { loaded = resolve; });
  const starting = sound.resume();
  sound.clear();
  loaded();
  await starting;
  assert.equal(audio.paused, true, 'Mute during loading prevents late playback');
  audio.loading = null;
  await sound.resume();
  assert.equal(audio.paused, false);
  sound.clear();
  console.log('Passed: visible occupancy, pitch preservation, track speed, pause/resume, offset reset and loading races.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
