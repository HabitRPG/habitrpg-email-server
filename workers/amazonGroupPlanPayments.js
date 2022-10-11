import groupSubscriptionManager from '../libs/groupSubscriptionManager.js';
import amazonPayment from '../libs/amazonPayments.js';
import request from 'request';

var db, queue;

var worker = function(job, done)
{
  groupSubscriptionManager(db, queue, done, amazonPayment, request);
}

export default function(parentQueue, parentDb) {
  // Pass db and queue from parent module
  db = parentDb;
  queue = parentQueue;

  return worker;
}
