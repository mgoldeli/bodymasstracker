const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readFileSync } = require('node:fs');
const { webcrypto } = require('node:crypto');
const html = readFileSync(require('node:path').join(__dirname, '../index.html'), 'utf8');
const source = html.slice(html.indexOf('      const GYM_CACHE_KEY'), html.indexOf('      function drawGymChart()'));
const copy = value => JSON.parse(JSON.stringify(value));
function device(cloud, initialCache = {}) {
  const cache = new Map(Object.entries(initialCache));
  const nodes = { gymMessage: { style: {} }, saveGymDayButton: {} };
  const client = {
    from(table) {
      assert.equal(table, 'gym_state');
      let update;
      const filters = {};
      const query = {
        select() { return update ? query.execute() : query; },
        eq(key, value) { filters[key] = value; return query; },
        update(value) { update = value; return query; },
        async single() {
          if (cloud.failure) return { error: cloud.failure };
          return { data: copy(cloud.row) };
        },
        async execute() {
          if (cloud.failure) return { error: cloud.failure };
          if (filters.revision !== cloud.row.revision) return { data: [] };
          cloud.row = copy(update);
          return { data: [{ revision: update.revision }] };
        }
      };
      return query;
    }
  };
  const context = vm.createContext({ crypto: webcrypto, console, supabase: client,
    localStorage: { getItem: key => cache.get(key) || null, setItem: (key, value) => cache.set(key, value) },
    document: { getElementById: id => nodes[id] }
  });
  vm.runInContext(source + '\nrenderGymTable = () => {}; function drawGymChart() {}', context);
  const run = code => vm.runInContext(code, context);
  return { run, cache, nodes };
}
function emptyCloud() { return { row: { revision: 0, payload: { program: [], days: [] } } }; }
function addWorkout(d) {
  d.run(`gymProgram = [{id:'squat',name:'Squat',values:{day1:{reps:'8',weight:'20'}}}]; gymDays=[{id:'day1',date:'2026-09-28'}]; markGymDirty();`);
}
test('new planner has no date columns and does not store placeholders as entries', async () => {
  const d = device(emptyCloud()); d.run('loadGymProgram()');
  assert.equal(d.run('gymDays.length'), 0);
  assert.equal(d.run('gymProgram[0].name'), '');
  assert.equal(d.cache.size, 0);
});
test('Save Day syncs dates, paired inputs and exercise order across independent devices', async () => {
  const cloud = emptyCloud(); const phone = device(cloud); const pc = device(cloud);
  await phone.run('loadGymCloud()'); addWorkout(phone);
  phone.run(`gymProgram.unshift({id:'bench',name:'Bench',values:{day1:{reps:'10',weight:'0'}}}); markGymDirty();`);
  assert.equal(cloud.row.payload.program.length, 0);
  await phone.run('saveGymDay()'); await pc.run('loadGymCloud()');
  assert.equal(pc.run('gymProgram[0].name'), 'Bench');
  assert.equal(pc.run('gymProgram[1].values.day1.weight'), '20');
  assert.equal(pc.run('gymDays[0].date'), '2026-09-28');
  assert.equal(pc.run('gymHistory[0].weight'), 0);
  assert.equal(phone.run('gymDirty'), false);
});
test('stale device cannot overwrite a newer cloud save', async () => {
  const cloud = emptyCloud(); const first = device(cloud); const second = device(cloud);
  await first.run('loadGymCloud()'); await second.run('loadGymCloud()');
  addWorkout(first); await first.run('saveGymDay()'); addWorkout(second);
  second.run(`gymProgram[0].name='Unsynced rename'; markGymDirty();`);
  await second.run('saveGymDay()');
  assert.equal(cloud.row.payload.program[0].name, 'Squat');
  assert.equal(second.run('gymDirty'), true);
  assert.match(second.nodes.gymMessage.textContent, /Cloud refreshed/);
});
test('incomplete sets, negative kg, fractional reps and missing dates block saving', async () => {
  const cloud = emptyCloud(); const d = device(cloud); await d.run('loadGymCloud()');
  for (const code of [`gymProgram[0].values.day1.reps=''`, `gymProgram[0].values.day1.weight='-1'`, `gymProgram[0].values.day1.reps='2.5'`, `gymDays[0].date=''`]) {
    addWorkout(d); d.run(code); await d.run('saveGymDay()');
    assert.equal(cloud.row.revision, 0);
  }
});
test('deleting exercise and day syncs and removes history', async () => {
  const cloud = emptyCloud(); const d = device(cloud); await d.run('loadGymCloud()'); addWorkout(d); await d.run('saveGymDay()');
  d.run('gymProgram=[]; gymDays=[]; markGymDirty();'); await d.run('saveGymDay()');
  const pc = device(cloud); await pc.run('loadGymCloud()');
  assert.equal(pc.run('gymHistory.length'), 0); assert.equal(pc.run('gymDays.length'), 0);
});
test('network failure keeps a recoverable draft and never reports cloud success', async () => {
  const cloud = emptyCloud(); const d = device(cloud); await d.run('loadGymCloud()'); addWorkout(d);
  cloud.failure = {message:'network unavailable'}; await d.run('saveGymDay()');
  assert.match(d.nodes.gymMessage.textContent, /Could not sync/);
  const reopened = device(cloud, Object.fromEntries(d.cache)); reopened.run('loadGymProgram()');
  assert.equal(reopened.run('gymProgram[0].values.day1.weight'), '20'); assert.equal(reopened.run('gymDirty'), true);
});
test('legacy migration preserves multiple entries on the same date and leaves old keys intact', () => {
  const old = {program:[{id:'squat',name:'Squat',values:{Mon:'8x 20kg',Tue:'10x 22kg'}}],date:'2026-09-28',history:[
    {exerciseId:'squat',exercise:'Squat',day:'Mon',date:'2026-09-28',reps:8,weight:20},
    {exerciseId:'squat',exercise:'Squat',day:'Tue',date:'2026-09-28',reps:10,weight:22}]};
  const d = device(emptyCloud(), {'bodymasstracker.gym-state.v2':JSON.stringify(old)}); d.run('loadGymProgram()');
  assert.equal(d.run('gymDays.length'), 2); assert.equal(d.run('gymHistory.length'), 2);
  assert.equal(d.run('gymDirty'), true); assert.ok(d.cache.has('bodymasstracker.gym-state.v2'));
});
test('local migration does not overwrite an existing cloud planner', async () => {
  const cloud = emptyCloud(); const d = device(cloud); addWorkout(d);
  cloud.row = {revision:5,payload:{program:[{id:'remote',name:'Remote exercise',values:{}}],days:[]}};
  await d.run('saveGymDay()');
  assert.equal(cloud.row.revision, 5); assert.equal(d.run('gymProgram[0].name'), 'Squat');
  assert.match(d.nodes.gymMessage.textContent, /Cloud refreshed/);
});
test('touch/pointer drag reorders on drop and cancellation preserves order', () => {
  for (const cancelled of [false, true]) {
    const d = device(emptyCloud());
    d.run(`
      gymProgram = ['a','b','c'].map(id => ({id, name:id, values:{}}));
      const rows = gymProgram.map((e, index) => ({dataset:{exerciseId:e.id}, classList:{add(){},remove(){}}, getBoundingClientRect:()=>({top:100+index*100,bottom:200+index*100,height:100})}));
      document.querySelectorAll = () => rows;
      const listeners = {};
      const handle = {setPointerCapture(){},hasPointerCapture:()=>false, addEventListener:(name, fn)=>listeners[name]=fn,removeEventListener:(name)=>delete listeners[name]};
      globalThis.requestAnimationFrame = () => 1;
      globalThis.cancelAnimationFrame = () => {};
      startGymDrag({button:0,pointerId:1,clientY:150,currentTarget:handle,preventDefault(){}}, 'a', rows[0]);
      listeners.pointermove({clientY:375});
    `);
    d.run(`listeners.${cancelled ? 'pointercancel' : 'pointerup'}({type:'${cancelled ? 'pointercancel' : 'pointerup'}'})`);
    assert.equal(d.run('gymProgram.map(e=>e.id).join()'), cancelled ? 'a,b,c' : 'b,c,a');
    assert.equal(d.run('gymDrag'), null);
    assert.equal(d.run('gymDirty'), !cancelled);
  }
});
test('reps-only entries and per-exercise graph preference persist across devices', async () => {
  const cloud = emptyCloud(); const phone = device(cloud); await phone.run('loadGymCloud()'); addWorkout(phone);
  phone.run(`gymProgram[0].plotUnit='reps'; gymProgram[0].values.day1.weight=''; markGymDirty();`);
  await phone.run('saveGymDay()');
  const pc = device(cloud); await pc.run('loadGymCloud()');
  assert.equal(pc.run('gymProgram[0].plotUnit'), 'reps');
  assert.equal(pc.run('gymHistory[0].reps'), 8);
  assert.equal(pc.run('gymHistory[0].weight'), null);
});
test('graph uses selected metric and never treats missing weight as zero kg', () => {
  const d = device(emptyCloud());
  d.nodes.gymHistoryChart = {};
  d.nodes.gymChartTitle = {};
  d.nodes.gymChartSubtitle = {};
  d.run(html.slice(html.indexOf('      function drawGymChart()'), html.indexOf('      function switchSection')));
  d.run(`
    function createChartBase(canvas, data, options) { globalThis.axis = options.yLabel; return {}; }
    function drawLine(base, data, accessor) { globalThis.points = data.map(accessor); }
    function prepareCanvas() { return {ctx:{},width:300,height:180}; }
    function drawEmpty(ctx, width, height, label) { globalThis.emptyLabel = label; }
    gymProgram=[{id:'a',name:'Any exercise',plotUnit:'reps',values:{}}];
    selectedExercise='a';
    gymHistory=[{exerciseId:'a',date:'2026-09-28',reps:12,weight:null}];
    drawGymChart();
  `);
  assert.equal(d.run('axis'), 'Repetitions');
  assert.equal(d.run('points.join()'), '12');
  d.run(`gymProgram[0].plotUnit='kg'; drawGymChart();`);
  assert.equal(d.run('emptyLabel'), 'No saved kg entries yet');
  d.run(`gymHistory[0].weight=20; drawGymChart();`);
  assert.equal(d.run('axis'), 'Weight (kg)');
  assert.equal(d.run('points.join()'), '20');
});
test('automatic refresh merges remote cells without losing a dirty local field', async () => {
  const cloud = emptyCloud(); const seed = device(cloud); await seed.run('loadGymCloud()'); addWorkout(seed); await seed.run('saveGymDay()');
  const phone = device(cloud); const pc = device(cloud);
  await phone.run('loadGymCloud()'); await pc.run('loadGymCloud()');
  phone.run(`gymProgram[0].name='Back squat'; markGymDirty();`);
  pc.run(`gymProgram[0].values.day1.weight='30'; markGymDirty();`);
  await pc.run('saveGymDay()'); await phone.run('loadGymCloud()');
  assert.equal(phone.run('gymProgram[0].name'), 'Back squat');
  assert.equal(phone.run('gymProgram[0].values.day1.weight'), '30');
  assert.equal(phone.run('gymDirty'), true);
  assert.equal(cloud.row.payload.program[0].name, 'Squat');
  await phone.run('saveGymDay()');
  assert.equal(cloud.row.payload.program[0].name, 'Back squat');
  assert.equal(cloud.row.payload.program[0].values.day1.weight, '30');
});
test('automatic refresh preserves local deletions and includes remote added workouts', async () => {
  const cloud = emptyCloud(); const seed = device(cloud); await seed.run('loadGymCloud()'); addWorkout(seed); await seed.run('saveGymDay()');
  const phone = device(cloud); const pc = device(cloud); await phone.run('loadGymCloud()'); await pc.run('loadGymCloud()');
  phone.run(`gymDays=[]; gymProgram[0].values={}; markGymDirty();`);
  pc.run(`gymDays.push({id:'day2',date:'2026-09-29'}); gymProgram[0].values.day2={reps:'10',weight:'25'}; markGymDirty();`);
  await pc.run('saveGymDay()'); await phone.run('loadGymCloud()');
  assert.equal(phone.run('gymDays.map(d=>d.id).join()'), 'day2');
  assert.equal(phone.run('gymProgram[0].values.day1'), undefined);
  assert.equal(phone.run('gymProgram[0].values.day2.reps'), '10');
  assert.equal(cloud.row.payload.days.length, 2);
});
