const mongoose = require('mongoose');

const ThroughputSnapshotSchema = new mongoose.Schema({
  timestamp: { type: Date, default: Date.now, index: true },
  zte: {
    rxBytes: Number,
    txBytes: Number,
    rxRate:  Number, // bytes/sec
    txRate:  Number,
  },
  digisol: {
    rxBytes: Number,
    txBytes: Number,
    rxRate:  Number,
    txRate:  Number,
  },
});

// Auto-expire snapshots older than 24 hours
ThroughputSnapshotSchema.index({ timestamp: 1 }, { expireAfterSeconds: 86400 });

module.exports = mongoose.model('ThroughputSnapshot', ThroughputSnapshotSchema);
