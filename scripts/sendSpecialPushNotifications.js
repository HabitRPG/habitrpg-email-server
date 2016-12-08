var request = require('request');
var moment = require('moment');

const sendDate = moment("2016-12-08 13:20").utc();

const notificationBuckets = [
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

const timezoneQueries = [
  {
    query: {'$gte': -60, '$lte': 0},
    hourOffset: 1
  }, {
    query: -120,
    hourOffset: 2
  }
];

var jobs = [];

timezoneQueries.forEach(timezoneQuery => {
  jobs.push({
    type: "sendSpecialPushNotifications",
    data: {
      notificationBuckets,
      timezoneQuery: timezoneQuery.query
    },
    options: {
      delay: (sendDate.clone().add(timezoneQuery.hourOffset, 'hour').toDate() - new Date())
    }
  })
});

request({
  url: "http://admin:password@localhost:3100/job",
  method: "POST",
  json: jobs
}, function (error, resp, body) {
  console.log(body);
});