const mongoose = require('mongoose');

const WanStatusSnapshotSchema = new mongoose.Schema({
  timestamp: { type: Date, default: Date.now, index: true },
  zte:     { type: String, enum: ['up', 'down'], required: true },
  digisol: { type: String, enum: ['up', 'down'], required: true },
});

// Auto-expire after 7 days
WanStatusSnapshotSchema.index({ timestamp: 1 }, { expireAfterSeconds: 604800 });

module.exports = mongoose.model('WanStatusSnapshot', WanStatusSnapshotSchema);
