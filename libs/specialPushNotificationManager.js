var sprintf = require('sprintf-js');
var moment = require('moment');

var db, queue, pushNotifications, done, habitrpgUsers, notificationBuckets, timezoneQuery, lastNotificationDate;

var pageLimit = 30;

function processUsersWithDevices(users) {
  console.log(users);
  console.log(done);
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

  //Randomly put users into the different bucket. 5% of the users are put into the "noMessage" bucket.
  users.forEach(user => {
    var id = Math.random()*100;
    if (id <= 5) {
      noMessageUsers.push(user);
    } else {
      var bucketId = Math.floor(id / 100 * buckets.length);
      buckets[bucketId].users.push(user);
    }
  });

  var currentTime = new Date();

  //update 'noMessage' users, to prevent further processing
  habitrpgUsers.update({
      _id: {$in: noMessageUsers.map(function(user){return user._id})}
    }, {$set: {
      _ABTest: 'noMessage',
      lastPushNotification: currentTime
    }},{multi: true, castIds: false}
  );

  buckets.forEach(bucket => {
    //Update all users in the bucket, to prevent further processing
    habitrpgUsers.update({
        _id: {$in: bucket.users.map(function(user){return user._id})}
      }, {$set: {
        _ABTest: bucket.identifier,
        lastPushNotification: currentTime
      }},{multi: true, castIds: false}
    );

    bucket.users.forEach(user => {
      var details = {
        identifier: "wonChallenge", //We still need a generic notification type for android.
        title: bucket.title,
        message: sprintf.sprintf(bucket.message, user.profile.name)
      };
      console.log(user._id);
      pushNotifications.sendNotification(user, details);
    });
  });

  if (users.length === pageLimit) {
    var lastUser = users[users.length - 1];
    sendPushnotifications(lastUser._id);
  } else {
    done();
  }
}

function sendPushnotifications(lastId) {
  var query = {
    pushDevices: {'$gt': []},
    'preferences.timezoneOffset': timezoneQuery,
    $or: [{lastPushNotification: {$ne: null}}, {lastPushNotification: {$lt: lastNotificationDate}}]
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
function run(dbInc, queueInc, doneInc, pushNotificationsInc, notificationBucketsInc, timezoneQueryInc, lastNotificationDateInc) {
  db = dbInc;
  queue = queueInc;
  done = doneInc;
  pushNotifications = pushNotificationsInc;
  notificationBuckets = notificationBucketsInc;
  timezoneQuery = timezoneQueryInc;
  lastNotificationDate = moment(lastNotificationDateInc).toDate();
  console.log(lastNotificationDate);

  habitrpgUsers = db.get('users');
  sendPushnotifications();
}

module.exports = {
  run: run,
};
