const mongoose = require('mongoose');

function inList(values) {
  return mongoose.trusted({ $in: values });
}

function notEqual(value) {
  return mongoose.trusted({ $ne: value });
}

function regexContains(escaped, flags = 'i') {
  return mongoose.trusted({ $regex: escaped, $options: flags });
}

module.exports = { inList, notEqual, regexContains };
