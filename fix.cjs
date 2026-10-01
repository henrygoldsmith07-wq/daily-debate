const fs = require('fs');
const p = 'src/lib/analytics/events.ts';
let s = fs.readFileSync(p, 'utf8');
s = s
  .replace(/^function dayOf/m, 'export function dayOf')
  .replace(/^function addDays/m, 'export function addDays')
  .replace(/^function median\(/m, 'export function median(')
  .replace(/^function rate\(/m, 'export function rate(')
  .replace(/^function distinctUsers/m, 'export function distinctUsers')
  .replace(/^const DEBATE_STARTS/m, 'export const DEBATE_STARTS')
  .replace(/^const isSuccessfulRepairCompletion/m, 'export function isSuccessfulRepairCompletion')
  .replace(/^const isRepairAttempt/m, 'export function isRepairAttempt');
fs.writeFileSync(p, s);
console.log(s.split('\n').filter(l => /^(export )?(function|const|interface|type) /.test(l)).join('\n'));
