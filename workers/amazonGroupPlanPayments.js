var groupSubscriptionManager = require('../libs/groupSubscriptionManager');
var amazonPayment = require('../libs/amazonPayments');

var db, queue;

var worker = function(job, done)
{
  groupSubscriptionManager.init(db, queue, done, amazonPayment);
  done();
}

module.exports = function(parentQueue, parentDb) {
  // Pass db and queue from parent module
  db = parentDb;
  queue = parentQueue;

  return worker;
}
