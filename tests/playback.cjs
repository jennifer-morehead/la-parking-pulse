const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// Exercise the actual playback logic without a browser or network dependency.
const source = fs.readFileSync('app.js', 'utf8').split('// Load with a timeout')[0];
let now = 0;
let scheduled;
const elements = Object.fromEntries(['#clock', '#play-pause', '#restart'].map(id => [id, {
  disabled: true, setAttribute(name, value) { this[name] = value; }, addEventListener(type, fn) { this.click = fn; }
}]));
const context = vm.createContext({
  assert, fs, elements,
  document: { querySelector: id => elements[id] },
  performance: { now: () => now },
  requestAnimationFrame: fn => { scheduled = fn; return 1; },
  cancelAnimationFrame: () => { scheduled = null; }
});
vm.runInContext(source + `
assert.equal(eventTime('8/11/2026 12:00:00 AM'), 0);
assert.equal(eventTime('8/11/2026 12:00:00 PM'), DAY_MS / 2);
assert.equal(eventTime('8/11/2026 11:59:59 PM'), DAY_MS - 1000);
assert.equal(eventTime('8/12/2026 12:00:00 AM'), null);
assert.equal(eventTime('8/11/2026 13:00:00 PM'), null);
const events = [
  { id: 'A', time: 1000, state: 'VACANT' },
  { id: 'A', time: 2000, state: 'VACANT' },
  { id: 'A', time: 3000, state: 'OCCUPIED' },
  { id: 'A', time: 4000, state: 'VACANT' }
];
const model = new SensorPlayback(events, ['A', 'B']);
assert.equal(model.states.get('A').state, null);
model.advance(2000);
assert.equal(model.states.get('A').state, 'VACANT');
model.advance(3000);
assert.equal(model.states.get('A').state, 'OCCUPIED');
model.advance(4000);
assert.equal(model.states.get('A').state, 'VACANT');
assert.equal(model.states.get('B').state, null);
model.reset();
assert.equal(model.cursor, 0);
assert.equal(model.states.get('A').state, null);

// All actual event timestamps parse, and the displayed district joins by ID.
const readCSV = path => fs.readFileSync(path, 'utf8').trim().split(/\\r?\\n/)
  .slice(1).map(line => line.split(','));
const locations = readCSV('sensor_locations.csv');
const ids = new Set(locations.map(row => row[0]));
const district = new Set(locations.filter(row => +row[3] >= -118.26 && +row[3] < -118.25 &&
  +row[2] >= 34.03 && +row[2] < 34.04).map(row => row[0]));
const rows = readCSV('one-day-state-change.csv');
assert(rows.every(row => eventTime(row[1]) !== null));
assert.equal(rows.filter(row => !ids.has(row[0])).length, 2172);
assert.equal(district.size, 748);
const joined = rows.filter(row => district.has(row[0]))
  .map(row => ({ id: row[0], time: eventTime(row[1]), state: row[2] }))
  .sort((a, b) => a.time - b.time);
const actual = new SensorPlayback(joined, [...district]);
actual.advance(DAY_MS - 1);
assert.equal(actual.cursor, joined.length);
for (const id of district) {
  const last = joined.filter(event => event.id === id).at(-1);
  assert.equal(actual.states.get(id).state, last ? last.state : null);
}

let dotClass;
startPlayback(events, [{ SpaceID: 'A' }], { attr(name, fn) { dotClass = fn({ SpaceID: 'A' }); } });
assert.equal(elements['#clock'].textContent, '00:00:00');
assert.equal(dotClass, 'sensor unestablished');
`, context);
function step(time) { now = time; assert(scheduled); scheduled(time); }
step(10000);
assert.equal(elements['#clock'].textContent, '12:00:00');
elements['#play-pause'].click();
assert.equal(scheduled, null);
assert.equal(elements['#play-pause']['aria-label'], 'Play');
now = 15000;
elements['#play-pause'].click();
step(16000);
assert.equal(elements['#clock'].textContent, '13:12:00');
elements['#restart'].click();
assert.equal(elements['#clock'].textContent, '00:00:00');
step(36000);
assert.equal(elements['#clock'].textContent, '00:00:00');
elements['#play-pause'].click();
elements['#restart'].click();
assert.equal(scheduled, null);
assert.equal(elements['#clock'].textContent, '00:00:00');
console.log('Passed: local timestamps, CSV joins, state changes, pause/resume, restart, 20-second loop.');

// The recording starts paused; camera movement holds time without changing
// the user's playback choice or introducing a catch-up jump afterward.
vm.runInContext(`
const recording = startPlayback(events, [{ SpaceID: 'A' }], { attr() {} }, false);
`, context);
assert.equal(scheduled, null);
assert.equal(elements['#play-pause']['aria-label'], 'Play');
vm.runInContext('recording.play();', context);
step(now + 1000);
assert.equal(elements['#clock'].textContent, '01:12:00');
vm.runInContext('recording.hold(true);', context);
step(now + 500);
assert.equal(elements['#clock'].textContent, '01:12:00');
step(now + 500);
assert.equal(elements['#clock'].textContent, '01:12:00');
vm.runInContext('recording.hold(false);', context);
step(now + 1000);
assert.equal(elements['#clock'].textContent, '02:24:00');
console.log('Passed: initial pause, automatic play, camera time hold, resume without catch-up.');

// Navigation holds the map clock while enabled audio keeps playing.
let navigationAudio;
context.Audio = class {
  constructor() { navigationAudio = this; this.paused = true; this.currentTime = 0; }
  pause() { this.paused = true; }
  async play() {
    if (this.rejectPlay) throw new Error('Playback blocked');
    this.paused = false;
  }
};
elements['#sound-toggle'] = {
  setAttribute() {}, addEventListener(type, fn) { this.click = fn; }
};
async function checkNavigationAudio() {
  vm.runInContext('const audible = startPlayback([], [{ SpaceID: "A" }], { attr() {} });', context);
  await elements['#sound-toggle'].click();
  navigationAudio.currentTime = 3;
  vm.runInContext('audible.hold(true);', context);
  step(now + 500);
  assert.equal(navigationAudio.paused, false, 'Camera movement must keep audio playing');
  assert.equal(navigationAudio.currentTime, 3, 'Navigation must not reset the track');
  vm.runInContext('audible.hold(false);', context);
  step(now + 21000);
  assert.equal(navigationAudio.paused, false, 'Day boundaries must keep audio playing');
  assert.equal(navigationAudio.currentTime, 3);
  elements['#play-pause'].click();
  assert.equal(navigationAudio.paused, true, 'Explicit Pause still pauses audio');
  elements['#play-pause'].click();
  await elements['#sound-toggle'].click();
  assert.equal(navigationAudio.paused, true, 'Mute still pauses audio');
  vm.runInContext('audible.hold(true);', context);
  await elements['#sound-toggle'].click();
  assert.equal(navigationAudio.paused, false, 'Sound can be enabled during a camera move');
  await elements['#sound-toggle'].click();
  navigationAudio.rejectPlay = true;
  await elements['#sound-toggle'].click();
  assert.equal(elements['#sound-toggle'].textContent, 'Retry sound');
  assert.equal(elements['#sound-toggle'].disabled, false, 'Playback failure permits retry');
  navigationAudio.rejectPlay = false;
  await elements['#sound-toggle'].click();
  assert.equal(navigationAudio.paused, false, 'A subsequent tap retries playback');
  console.log('Passed: continuous navigation audio, day boundaries, explicit pause and mute.');
}
checkNavigationAudio().catch(error => { console.error(error); process.exitCode = 1; });
