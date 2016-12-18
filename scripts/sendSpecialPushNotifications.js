var request = require('request');
var moment = require('moment');

//Date at which the notifications should be sent. Always use UTC. Adjustments for users in different timezones can
//be made,by using multime workers with the 'timezoneQueries' variable.
var sendDate = moment("2016-12-18 16:10+00:00").utc();

//List of the different notifications that are sent.
//'identifier' will be used as the value in the ABTest field
var notificationBuckets = [
  {
    identifier: "test1",
    title: "Title 1",
    message: "Text 1"
  },
  {
    identifier: "test2",
    title: "Title 2",
    message: "Text 2 %s"
  }
];

//Each entry will create a worker, that runs at the specified hour offset. The offset is relative to UTC.
//The query is a mongodb query value for the 'timezoneOffset' field.
//p.e. {query: 480, hourOffset: 8} would send a notification to users in PST
var timezoneQueries = [
  {
    query: {'$gte': -60, '$lte': 0},
    hourOffset: -1
  }, {
    query: -120,
    hourOffset: -2
  }
];

var jobs = [];

timezoneQueries.forEach(timezoneQuery => {
  jobs.push({
    type: "sendSpecialPushNotifications",
    data: {
      notificationBuckets,
      timezoneQuery: timezoneQuery.query,
      lastNotificationDate: moment('2016-12-16 00:00+00:00').utc(),
      lastLoginDate: moment('2016-11-01')
    },
    options: {
      delay: (sendDate.clone().add(timezoneQuery.hourOffset, 'hour').toDate() - moment().utc())
    }
  });
});

request({
  url: "http://admin:password@localhost:3100/job",
  method: "POST",
  json: jobs
}, function (error, resp, body) {
  console.log(body);
});