var fs = require('fs'),
    nconf = require('nconf');
    mandrill = require('mandrill-api'),
    _ = require('lodash');

var mandrillClient = new mandrill.Mandrill(nconf.get('MANDRILL_API_KEY'));

var standardReplyTo = nconf.get('STANDARD_REPLY_TO_ADDR');
var orgsReplyTo = nconf.get('ORGS_REPLY_TO_ADDR');

// A simple map that link an email type to its key stored in
// user.preferences.emailNotifications[key]
var mapEmailsToPreferences = {
  'new-pm': 'newPM',
  'kicked-from-guild': 'kickedGroup',
  'kicked-from-party': 'kickedGroup',
  'won-challenge': 'wonChallenge',
  'gifted-gems': 'giftedGems',
  'gifted-subscription': 'giftedSubscription',
  'invited-party': 'invitedParty',
  'invited-guild': 'invitedGuild',
  'quest-started': 'questStarted',
  'invite-boss-quest': 'invitedQuest',
  'invite-collection-quest': 'invitedQuest',
  //'reminder-to-login': 'remindersToLogin',
  '1-day-email': 'importantAnnouncements',
  '3-days-recapture': 'importantAnnouncements',
  '10-days-recapture': 'importantAnnouncements',
  '1-month-recapture': 'importantAnnouncements'
};

module.exports = function(job, done){
  var replyToAddress = standardReplyTo; // For beta and production

  var baseUrl = _.find(job.data.variables, {name: 'BASE_URL'});

  if(baseUrl && baseUrl.content){
    baseUrl = baseUrl.content;
    if(['https://beta.habitrpg.com', 'https://habitrpg.com'].indexOf(baseUrl) == -1){
      replyToAddress = orgsReplyTo; // For org plans
    }

    job.data.variables.push({
      name: 'EMAIL_SETTINGS_URL',
      content: baseUrl + '/#/options/settings/notifications'
    }, {
      name: 'UNSUB_EMAIL_TYPE_URL',
      content: baseUrl + '/#/options/settings/notifications?unsubFrom=' + mapEmailsToPreferences[job.data.emailType]
    });
  }

  var replyToAddressVar = _.find(job.data.variables, {name: 'REPLY_TO_ADDRESS'});

  if(replyToAddressVar && replyToAddressVar.content){
    replyToAddress = replyToAddressVar.content;
  };

  // If it's an object there is only one email to send, otherwise
  // the same one to multiple users
  var toArr = job.data.to.email ? [job.data.to] : job.data.to;
  mandrillClient.messages.sendTemplate({
    template_name: job.data.emailType, // template_name === tag === emailType
    message: {
      to: toArr,
      'headers': {
        'Reply-To': replyToAddress
      },
      global_merge_vars: job.data.variables,
      merge_vars: job.data.personalVariables,
      //google_analytics_domains: ['habitrpg.com'],
      from_email: 'messengers@habitrpg.com',
      from_name: 'HabitRPG',
      track_opens: true,
      preserve_recipients: false,
      tags: [job.data.emailType]
    }
  }, function(r){
    done(null, r);
  }, function(e){
    done(e);
  });
};