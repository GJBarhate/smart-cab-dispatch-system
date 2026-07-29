"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.Counter = void 0;
exports.nextSequence = nextSequence;
var _mongoose = require("mongoose");
var _shared = require("./_shared");
// Atomic sequence generator (e.g. Trip.code "T-0142"). A plain
// Trip.countDocuments()-based counter races under concurrent commits — two
// commits reading the same count both mint the same code and one loses to
// the unique index. findOneAndUpdate with $inc is atomic per document.

const counterSchema = new _mongoose.Schema({
  key: {
    type: String,
    required: true,
    unique: true
  },
  seq: {
    type: Number,
    default: 0
  }
}, {
  versionKey: false
});
counterSchema.index({
  key: 1
}, {
  unique: true
});
const Counter = (0, _shared.getModel)('Counter', counterSchema);
exports.Counter = Counter;
async function nextSequence(key) {
  const doc = await Counter.findOneAndUpdate({
    key
  }, {
    $inc: {
      seq: 1
    }
  }, {
    upsert: true,
    new: true
  });
  return doc.seq;
}
