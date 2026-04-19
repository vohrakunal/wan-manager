const mongoose = require('mongoose');

const ClientUsageSchema = new mongoose.Schema({
  ip: String,
  mac: String,
  hostname: String,
  txBytes: Number,
  rxBytes: Number,
  totalBytes: Number,
  txRateBps: Number,
  rxRateBps: Number,
  totalRateBps: Number,
}, { _id: false });

const LanClientSnapshotSchema = new mongoose.Schema({
  bucketStart: { type: Date, required: true, index: true },
  lastSampleAt: { type: Date, default: Date.now },
  lanIface: { type: String, required: true },
  lanIp: String,
  dataSource: String,
  countersAvailable: { type: Boolean, default: false },
  sampleCount: { type: Number, default: 0 },
  clients: [ClientUsageSchema],
});

LanClientSnapshotSchema.index({ bucketStart: 1, lanIface: 1 }, { unique: true });
LanClientSnapshotSchema.index({ bucketStart: 1 }, { expireAfterSeconds: 7 * 24 * 3600 });

module.exports = mongoose.model('LanClientSnapshot', LanClientSnapshotSchema);
