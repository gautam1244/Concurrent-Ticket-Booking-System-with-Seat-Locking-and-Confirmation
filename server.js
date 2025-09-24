// server.js
// Run: npm init -y && npm install express body-parser cors
// Then: node server.js

const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(bodyParser.json());

// Configuration
const LOCK_DURATION_MS = 60 * 1000; // 1 minute
const CLEANUP_INTERVAL_MS = 5 * 1000; // cleanup expired locks every 5s

// In-memory seats store
// Example: 20 seats (1..20)
const seats = new Map();
for (let i = 1; i <= 20; i++) {
  seats.set(i, {
    id: i,
    status: 'available', // 'available' | 'locked' | 'booked'
    lockOwner: null,
    lockExpiresAt: null,
    timeoutId: null,
  });
}

// Helper: release lock (internal)
function releaseLock(seat) {
  if (!seat) return;
  if (seat.timeoutId) {
    clearTimeout(seat.timeoutId);
    seat.timeoutId = null;
  }
  seat.status = 'available';
  seat.lockOwner = null;
  seat.lockExpiresAt = null;
}

// Helper: schedule auto-release for a locked seat
function scheduleAutoRelease(seat) {
  if (seat.timeoutId) clearTimeout(seat.timeoutId);
  const ms = Math.max(0, seat.lockExpiresAt - Date.now());
  seat.timeoutId = setTimeout(() => {
    // Only release if still locked and expired
    if (seat.status === 'locked' && seat.lockExpiresAt && Date.now() >= seat.lockExpiresAt) {
      console.log(`Auto-releasing seat ${seat.id} (lock expired)`);
      releaseLock(seat);
    }
  }, ms + 5);
}

// Periodic cleanup (safety)
setInterval(() => {
  const now = Date.now();
  for (const seat of seats.values()) {
    if (seat.status === 'locked' && seat.lockExpiresAt && now >= seat.lockExpiresAt) {
      console.log(`Cleanup: releasing expired lock for seat ${seat.id}`);
      releaseLock(seat);
    }
  }
}, CLEANUP_INTERVAL_MS);

// GET /seats - view all seats
app.get('/seats', (req, res) => {
  const arr = Array.from(seats.values()).map(s => ({
    id: s.id,
    status: s.status,
    lockOwner: s.lockOwner,
    lockExpiresAt: s.lockExpiresAt,
  }));
  res.json({ success: true, seats: arr });
});

// POST /lock  - body: { seatId, userId }
app.post('/lock', (req, res) => {
  const { seatId, userId } = req.body;
  if (typeof seatId !== 'number' || !userId) {
    return res.status(400).json({ success: false, message: 'seatId (number) and userId are required' });
  }

  const seat = seats.get(seatId);
  if (!seat) return res.status(404).json({ success: false, message: 'Seat not found' });

  // If booked -> cannot lock
  if (seat.status === 'booked') {
    return res.status(409).json({ success: false, message: 'Seat already booked' });
  }

  // If locked by someone else and not expired -> conflict
  if (seat.status === 'locked') {
    // check expiration
    if (seat.lockExpiresAt && Date.now() >= seat.lockExpiresAt) {
      // expired, release and continue to lock
      releaseLock(seat);
    } else {
      if (seat.lockOwner === userId) {
        // refresh lock (extend)
        seat.lockExpiresAt = Date.now() + LOCK_DURATION_MS;
        scheduleAutoRelease(seat);
        return res.json({ success: true, message: 'Lock refreshed', seat: { id: seat.id, status: seat.status, lockExpiresAt: seat.lockExpiresAt } });
      }
      return res.status(409).json({ success: false, message: `Seat is currently locked by another user (${seat.lockOwner})` });
    }
  }

  // Seat is available -> lock it
  seat.status = 'locked';
  seat.lockOwner = userId;
  seat.lockExpiresAt = Date.now() + LOCK_DURATION_MS;
  scheduleAutoRelease(seat);

  res.json({ success: true, message: `Seat ${seatId} locked for user ${userId} for ${LOCK_DURATION_MS / 1000} seconds`, seat: { id: seat.id, status: seat.status, lockExpiresAt: seat.lockExpiresAt } });
});

// POST /confirm - body: { seatId, userId }
app.post('/confirm', (req, res) => {
  const { seatId, userId } = req.body;
  if (typeof seatId !== 'number' || !userId) {
    return res.status(400).json({ success: false, message: 'seatId (number) and userId are required' });
  }

  const seat = seats.get(seatId);
  if (!seat) return res.status(404).json({ success: false, message: 'Seat not found' });

  if (seat.status === 'booked') {
    return res.status(409).json({ success: false, message: 'Seat already booked' });
  }

  if (seat.status !== 'locked') {
    return res.status(409).json({ success: false, message: 'Seat is not locked. Cannot confirm without a lock.' });
  }

  if (seat.lockOwner !== userId) {
    return res.status(403).json({ success: false, message: `You do not own the lock. Locked by ${seat.lockOwner}` });
  }

  // Check expiration
  if (seat.lockExpiresAt && Date.now() >= seat.lockExpiresAt) {
    // lock expired
    releaseLock(seat);
    return res.status(409).json({ success: false, message: 'Lock has expired. Cannot confirm.' });
  }

  // Confirm booking
  if (seat.timeoutId) {
    clearTimeout(seat.timeoutId);
    seat.timeoutId = null;
  }
  seat.status = 'booked';
  seat.lockOwner = userId;
  seat.lockExpiresAt = null;

  res.json({ success: true, message: `Seat ${seatId} successfully booked by ${userId}`, seat: { id: seat.id, status: seat.status, bookedBy: userId } });
});

// POST /release - optional manual release (body: {seatId, userId})
app.post('/release', (req, res) => {
  const { seatId, userId } = req.body;
  if (typeof seatId !== 'number' || !userId) {
    return res.status(400).json({ success: false, message: 'seatId (number) and userId are required' });
  }
  const seat = seats.get(seatId);
  if (!seat) return res.status(404).json({ success: false, message: 'Seat not found' });

  if (seat.status !== 'locked') return res.status(409).json({ success: false, message: 'Seat is not locked' });
  if (seat.lockOwner !== userId) return res.status(403).json({ success: false, message: 'Only lock owner can release the lock' });

  releaseLock(seat);
  res.json({ success: true, message: `Lock released for seat ${seatId}` });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Ticket booking server running on http://localhost:${PORT}`);
});
