const mongoose = require('mongoose');

const ActionLogSchema = new mongoose.Schema({
  action:  { type: String, required: true },
  user:    { type: String, default: 'system' },
  note:    { type: String, default: '' },
  output:  { type: String, default: '' },
  success: { type: Boolean, default: true },
}, { timestamps: true });

ActionLogSchema.index({ createdAt: -1 });

module.exports = mongoose.model('ActionLog', ActionLogSchema);
