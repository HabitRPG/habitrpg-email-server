import { sprintf as _sprintf } from 'sprintf-js';
import moment from 'moment';

var db, queue, pushNotifications, done, habitrpgUsers, notificationBuckets, timezoneQuery, lastNotificationDate, lastLoginDate, testUserIDs, isDryRun;

var pageLimit = 30;

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
      '_ABTests.pushNotification': 'noMessage',
      _lastPushNotification: currentTime
    }},{multi: true, castIds: false}
  ).then(() => { // after the first promise that sets some users' _ABtest to noMessage
    return Promise.all(buckets.map(bucket => {
      return habitrpgUsers.update({
          _id: {$in: bucket.users.map(user => user._id)}
        }, {$set: {
          '_ABTests.pushNotification': bucket.identifier,
          _lastPushNotification: currentTime
        }}, {multi: true, castIds: false}
      ).then(() => {
        bucket.users.map(user => {
          var details = {
            identifier: "wonChallenge", //We still need a generic notification type for android.
            title: bucket.title,
            message: _sprintf(bucket.message, user.profile.name)
          };
          if (!isDryRun) {
            pushNotifications.sendNotification(user, details);
          }
        });
        if (isDryRun) {
          console.log("Would send notification to ", bucket.users.length, " users");
        }
      });
    }));
  }).catch(function (err) {
    console.log(err);
    done(err);
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
    'auth.timestamps.loggedin': {'$gte': lastLoginDate},
    $or: [{_lastPushNotification: null}, {_lastPushNotification: {$lt: lastNotificationDate}}]
  };

  if (lastId) {
    query._id = {
      $gt: lastId
    }
  }
  if (testUserIDs) {
    query._id = {
      $in: testUserIDs
    }
  }

  habitrpgUsers.find(query, {
    sort: {_id: 1},
    limit: pageLimit,
    fields: ['_id', 'pushDevices', 'profile']
  }, {castIds: false})
    .then(processUsersWithDevices)
    .catch(function (err) {
      console.log(err);
      done(err);
    });
}

//@TODO: Constructor?
function run(dbInc,
             queueInc,
             doneInc,
             pushNotificationsInc,
             notificationBucketsInc,
             timezoneQueryInc,
             lastNotificationDateInc,
             lastLoginDateInc,
             testUserIDsInc,
             dryRunInc) {
  db = dbInc;
  queue = queueInc;
  done = doneInc;
  pushNotifications = pushNotificationsInc;
  notificationBuckets = notificationBucketsInc;
  timezoneQuery = timezoneQueryInc;
  lastNotificationDate = moment(lastNotificationDateInc).toDate();
  lastLoginDate = moment(lastLoginDateInc).toDate();
  testUserIDs = testUserIDsInc;
  isDryRun = dryRunInc;

  habitrpgUsers = db.get('users', { castIds: false });
  sendPushnotifications();
}

export { run };
