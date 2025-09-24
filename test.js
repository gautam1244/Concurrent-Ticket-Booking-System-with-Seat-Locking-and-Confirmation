// test.js
// Run: node test.js  (while server.js is running)

const axios = require('axios');

const SERVER = 'http://localhost:3000';
const targetSeat = 5; // seat to contest
const userA = 'alice';
const userB = 'bob';

async function attemptLock(user) {
  try {
    const r = await axios.post(`${SERVER}/lock`, { seatId: targetSeat, userId: user });
    console.log(`[${user}] lock success:`, r.data.message);
    return { user, success: true, data: r.data };
  } catch (err) {
    if (err.response) console.log(`[${user}] lock failed:`, err.response.data.message);
    else console.log(`[${user}] lock failed:`, err.message);
    return { user, success: false, error: err.response ? err.response.data : err.message };
  }
}

async function confirm(user) {
  try {
    const r = await axios.post(`${SERVER}/confirm`, { seatId: targetSeat, userId: user });
    console.log(`[${user}] confirm success:`, r.data.message);
  } catch (err) {
    if (err.response) console.log(`[${user}] confirm failed:`, err.response.data.message);
    else console.log(`[${user}] confirm failed:`, err.message);
  }
}

(async () => {
  // Kick off two lock attempts almost simultaneously
  const p1 = attemptLock(userA);
  const p2 = attemptLock(userB);
  const results = await Promise.all([p1, p2]);

  console.log('\nLock results:', results.map(r => ({ user: r.user, success: r.success })));

  // Small delay then confirm
  await new Promise(r => setTimeout(r, 300));

  await confirm(userA);
  await confirm(userB);

  // Final state
  const final = await axios.get(`${SERVER}/seats`);
  console.log('\nFinal seat state:', final.data.seats.find(s => s.id === targetSeat));
})();
