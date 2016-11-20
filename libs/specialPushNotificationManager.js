var sprintf = require('sprintf-js');

var db, queue, pushNotifications, done, habitrpgUsers, notificationBuckets, timezoneQuery;

var pageLimit = 5;

function processUsersWithDevices(users) {
  if (users.length === 0) {
    done();
    return;
  }

  var buckets = [];
  var noMessageUsers = [];

  notificationBuckets.forEach(notificationBucket => {
    buckets.push({
      identifier: notificationBucket.identifier,
      title: notificationBucket.title,
      message: notificationBucket.message,
      users: []
    })
  });

  users.forEach(user => {
    var id = Math.random()*100;
    if (id <= 5) {
      noMessageUsers.push(user);
    } else {
      var bucketId = Math.floor(id / 100 * buckets.length);
      buckets[bucketId].users.push(user);
    }
  });

  buckets.forEach(bucket => {
    bucket.users.forEach(user => {
      var details = {
        identifier: "wonChallenge", //We still need a generic notification type for android.
        title: bucket.title,
        message: sprintf.sprintf(bucket.message, user.profile.name)
      };
      pushNotifications.sendNotification(user, details);
    });
  });

  if (users.length === pageLimit) {
    var lastUser = users[users.length - 1];
    sendPushnotifications(lastUser._id);
  } else {
    setTimeout(done, 5000);
  }
};

function sendPushnotifications(lastId) {
  var query = {
    'pushDevices': {'$gt': []},
    'preferences.timezoneOffset': timezoneQuery
  };

  if (lastId) {
    query._id = {
      $gt: lastId
    }
  }

  habitrpgUsers.find(query, {
    sort: {_id: 1},
    limit: pageLimit,
    fields: ['_id', 'pushDevices', 'profile']
  })
    .then(processUsersWithDevices)
    .catch(function (err) {
      console.log(err);
    });
}

//@TODO: Constructor?
function run(dbInc, queueInc, doneInc, pushNotificationsInc, notificationBucketsInc, timezoneQueryInc) {
  db = dbInc;
  queue = queueInc;
  done = doneInc;
  pushNotifications = pushNotificationsInc;
  notificationBuckets = notificationBucketsInc;
  timezoneQuery = timezoneQueryInc;

  habitrpgUsers = db.get('users');
  sendPushnotifications();
}

module.exports = {
  run: run,
};
