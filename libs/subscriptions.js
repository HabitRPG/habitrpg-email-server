/* eslint-disable camelcase */

// TODO fetch from api
let blocks = {
  basic_earned: {months: 1, price: 5},
  basic_3mo: {months: 3, price: 15},
  basic_6mo: {months: 6, price: 30},
  google_6mo: {months: 6, price: 24, discount: true, original: 30},
  basic_12mo: {months: 12, price: 48},
};
/* eslint-enable camelcase */

module.exports = {
  blocks,
};