var groupSubscriptionManager = require('../libs/groupSubscriptionManager');

var db, queue;

var worker = function(job, done)
{
  groupSubscriptionManager.setUp(db, queue);
  done();
}

module.exports = function(parentQueue, parentDb) {
  // Pass db and queue from parent module
  db = parentDb;
  queue = parentQueue;

  return worker;
}
