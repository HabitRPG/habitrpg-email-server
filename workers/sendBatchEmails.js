var moment = require('moment'),
    utils = require('../utils'),
    _ = require('lodash');

// Defined later
var queue, db, baseUrl, habitrpgUsers;

var limit = 100;

var nowRecapture, nowOneDay, OneDayAgo, OneDayAgoOneHour, ThreeDaysAgo, ThreeDaysAgoOneHour, TenDaysAgo, 
    TenDaysAgoOneHour, OneMonthAgo, OneMonthAgoOneHour, lastIdRecapture, lastIdOneDay;

var phaseRecapture = 0; // 2, 3 or 4 then ends
var phaseOneDay = 0; // 1, then ends

var worker = function(job, done){
  habitrpgUsers = db.get('users');

  if(job.data.type == 'sendRecaptureEmails'){
    nowRecapture = new Date();
    ThreeDaysAgo = moment(nowRecapture).subtract({days: 2, hours: 23, minutes: 50}).toDate();
    ThreeDaysAgoOneHour = moment(nowRecapture).subtract({days: 3, hours: 1, minutes: 10}).toDate();
    TenDaysAgo = moment(nowRecapture).subtract({days: 9, hours: 23, minutes: 50}).toDate();
    TenDaysAgoOneHour = moment(nowRecapture).subtract({days: 10, hours: 1, minutes: 10}).toDate();
    OneMonthAgo = moment(nowRecapture).subtract({days: 30, hours: 23, minutes: 50}).toDate();
    OneMonthAgoOneHour = moment(nowRecapture).subtract({days: 31, hours: 1, minutes: 10}).toDate();

    var findAffectedUsersRecapture = function(beforeTime, afterTime, cb){
      var query = {
        lastCron: {
          $lt: beforeTime,
          $gte: afterTime
        },
        'preferences.sleep': false,
        $or: [
          {
            'flags.recaptureEmailsPhase': {
              $exists: false
            }
          }, 

          {
            'flags.recaptureEmailsPhase': {
              $lt: phaseRecapture
            }
          }
        ],
        'preferences.emailNotifications.unsubscribeFromAll': {$ne: true},
        'preferences.emailNotifications.importantAnnouncements': {$ne: false}
      };

      if(lastIdRecapture){
        query._id = {
          $gt: lastIdRecapture
        } 
      }

      habitrpgUsers.find(query, {sort: {_id: 1}, limit: limit, fields: ['_id', 'auth', 'profile', 'lastCron']}, function(err, docs){
        if(err) return done(err);
        lastIdRecapture = docs.length > 0 ? docs[docs.length - 1]._id : null;
        cb(docs, function(err){
          if(err) return done(err);
          findAffectedUsersRecapture(beforeTime, afterTime, cb);
        });
      });
    }

    var sendEmailsRecapture = function(users, continueCb){
      var ids = [];

      var toData = users.map(function(user){
        if(!user || !user.auth) return undefined;

        ids.push(user._id);

        var email, name;

        // Code taken from habitrpg/src/controllers/payments.js
        if(user.auth.local && user.auth.local.email){
          email = user.auth.local.email;
          name = user.profile.name || user.auth.local.username;
        }else if(user.auth.facebook && user.auth.facebook.emails && user.auth.facebook.emails[0] && user.auth.facebook.emails[0].value){
          email = user.auth.facebook.emails[0].value;
          name = user.profile.name || user.auth.facebook.displayName || user.auth.facebook.username;
        }
        return {'email': email, 'name': name, _id: user._id};
      }).filter(function(data){
        return (data && data.email) ? true : false;
      });

      var personalVariables = toData.map(function(personalToData){
        return {
          rcpt: personalToData.email,
          vars: [
            {
              name: 'RECIPIENT_NAME',
              content: personalToData.name
            },
            {
              name: 'RECIPIENT_UNSUB_URL',
              content: baseUrl + '/unsubscribe?code=' + utils.encrypt(JSON.stringify({
                _id: personalToData._id,
                email: personalToData.email
              }))
            }
          ]
        };
      });

      var emailType;

      switch(phaseRecapture){
        case 2: // 3 days ago
          emailType = '3-days-recapture'
          break;
        case 3: // 10 days ago
          emailType = '10-days-recapture'
          break;
        case 4: // One month ago
          emailType = '1-month-recapture'
          break;
      }

      // Update the recaptureEmailsPhase flag in the database for each user
      habitrpgUsers.update(
        {
          _id: {
            $in: ids
          } 
        },
        {
          $set: {
            'flags.recaptureEmailsPhase': phaseRecapture
          }
        }, function(e, res){
          if(e) return done(e);

          queue.create('email', {
            emailType: emailType,
            to: toData,
            // Manually pass BASE_URL and EMAIL_SETTINGS_URL as they are sent from here and not from the main server
            variables: [
              {name: 'BASE_URL', content: baseUrl}
            ],
            personalVariables: personalVariables
          })
          .priority('high')
          .attempts(5)
          .backoff({type: 'fixed', delay: 60*1000})
          .save(function(err){
            if(err) return done(err);
            continueCb();
          });
        });
    };

    var execQueryRecapture = function(beforeTime, afterTime){
      findAffectedUsersRecapture(beforeTime, afterTime, function(docs, continueCb){
        if(docs.length < limit){
          continueCb = startPhaseRecapture;
          lastIdRecapture = null;
        }

        sendEmailsRecapture(docs, continueCb);
      });
    };

    var startPhaseRecapture = function(){
      switch(phaseRecapture){
        case 0:
          phaseRecapture = 2;
          execQueryRecapture(ThreeDaysAgo, ThreeDaysAgoOneHour);
          break;
        case 2:
          phaseRecapture = 3;
          execQueryRecapture(TenDaysAgo, TenDaysAgoOneHour);
          break;
        case 3:
          phaseRecapture = 4;
          execQueryRecapture(OneMonthAgo, OneMonthAgoOneHour);
          break;
        case 4:
          phaseRecapture = 0;

          queue.create('sendBatchEmails', {
            type: 'sendRecaptureEmails'
          })
          .priority('critical')
          .delay(moment(nowRecapture).add({hours: 1}).toDate() - new Date())
          .attempts(5)
          .save(function(err){
            return err ? done(err) : done();
          });
          break;
      }
    };

    startPhaseRecapture();
  }else if(job.data.type == 'sendOneDayEmails'){
    nowOneDay = new Date();
    OneDayAgo = moment(nowOneDay).subtract({days: 0, hours: 23, minutes: 50}).toDate();
    OneDayAgoOneHour = moment(nowOneDay).subtract({days: 1, hours: 1, minutes: 10}).toDate();

    var findAffectedUsersOneDay = function(beforeTime, afterTime, cb){
      var query = {
        lastCron: {
          $gte: afterTime
        },
        'preferences.sleep': false,
        $or: [
          {
            'flags.recaptureEmailsPhase': {
              $exists: false
            }
          }, 

          {
            'flags.recaptureEmailsPhase': {
              $lt: phaseOneDay
            }
          }
        ],
        'preferences.emailNotifications.unsubscribeFromAll': {$ne: true},
        'preferences.emailNotifications.importantAnnouncements': {$ne: false}
      };

      if(lastIdOneDay){
        query._id = {
          $gt: lastIdOneDay
        } 
      }

      habitrpgUsers.find(query, {sort: {_id: 1}, limit: limit, fields: ['_id', 'auth', 'profile', 'lastCron']}, function(err, docs){
        if(err) return done(err);
        lastIdOneDay = docs.length > 0 ? docs[docs.length - 1]._id : null;
        cb(docs, function(err){
          if(err) return done(err);
          findAffectedUsersOneDay(beforeTime, afterTime, cb);
        });
      });
    }

    var sendEmailsOneDay = function(users, continueCb){
      var ids = [];

      var toData = users.map(function(user){
        if(!user || !user.auth || !user.auth.timestamps || !user.auth.timestamps.created) return undefined;

        if(user.auth.timestamps.created <= OneDayAgoOneHour || user.auth.timestamps.created >= OneDayAgo){
          return undefined;
        }

        var email, name;

        // Code taken from habitrpg/src/controllers/payments.js
        if(user.auth.local){
          email = user.auth.local.email;
          name = user.profile.name || user.auth.local.username;
        }else if(user.auth.facebook && user.auth.facebook.emails && user.auth.facebook.emails[0] && user.auth.facebook.emails[0].value){
          email = user.auth.facebook.emails[0].value;
          name = user.profile.name || user.auth.facebook.displayName || user.auth.facebook.username;
        }

        // Here so that new users are not ignored
        ids.push(user._id);

        return {email: email, name: name, _id: user._id};
      }).filter(function(data){
        return (data && data.email) ? true : false;
      });

      var personalVariables = toData.map(function(personalToData){
        return {
          rcpt: personalToData.email,
          vars: [
            {
              name: 'RECIPIENT_NAME',
              content: personalToData.name
            },
            {
              name: 'RECIPIENT_UNSUB_URL',
              content: baseUrl + '/unsubscribe?code=' + utils.encrypt(JSON.stringify({
                _id: personalToData._id,
                email: personalToData.email
              }))
            }
          ]
        };
      });

      // Update the recaptureEmailsPhase flag in the database for each user
      habitrpgUsers.update(
        {
          _id: {
            $in: ids
          } 
        },
        {
          $set: {
            'flags.recaptureEmailsPhase': phaseOneDay
          }
        }, function(e, res){
          if(e) return done(e);

          queue.create('email', {
            emailType: '1-day-email',
            to: toData,
            // Manually pass BASE_URL as it's not been passed from server like other emails
            variables: [
              {name: 'BASE_URL', content: baseUrl}
            ],
            personalVariables: personalVariables
          })
          .priority('high')
          .attempts(5)
          .backoff({type: 'fixed', delay: 60*1000})
          .save(function(err){
            if(err) return done(err);
            continueCb();
          });
        });
    };

    var execQueryOneDay = function(beforeTime, afterTime){
      findAffectedUsersOneDay(beforeTime, afterTime, function(docs, continueCb){
        if(docs.length < limit){
          continueCb = startPhaseOneDay;
          lastIdOneDay = null;
        }

        sendEmailsOneDay(docs, continueCb);
      });
    };

    var startPhaseOneDay = function(){
      switch(phaseOneDay){
        case 0:
          phaseOneDay = 1;
          execQueryOneDay(OneDayAgo, OneDayAgoOneHour);
          break;
        case 1:
          phaseOneDay = 0;

          queue.create('sendBatchEmails', {
            type: 'sendOneDayEmails'
          })
          .priority('critical')
          .delay(moment(nowOneDay).add({hours: 1}).toDate() - new Date())
          .attempts(5)
          .save(function(err){
            return err ? done(err) : done();
          });
          break;
      }
    };

    startPhaseOneDay();
  }else{
    throw new Error('sendBatchEmails receive invalid job.data.type: ' + (job.data && job.data.type));
  }
}

module.exports = function(parentQueue, parentDb, parentBaseUrl){
  queue = parentQueue; // Pass queue from parent module
  db = parentDb; // Pass db from parent module
  baseUrl = parentBaseUrl; // Pass baseurl from parent module
  
  return worker;
}
