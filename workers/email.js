import fs from 'fs';
import nconf from 'nconf';
import mandrill from 'mandrill-api';
import _ from 'lodash';

var mandrillClient = new mandrill.Mandrill(nconf.get('MANDRILL_API_KEY'));

var standardReplyTo = nconf.get('STANDARD_REPLY_TO_ADDR');
var orgsReplyTo = nconf.get('ORGS_REPLY_TO_ADDR');
var blacklistedBaseUrls = nconf.get('BLACKLISTED_BASE_URLS');

// A simple map that link an email type to its key stored in
// user.preferences.emailNotifications[key]
var mapEmailsToPreferences = {
  '1-day-email': 'importantAnnouncements',
  '1-month-recapture': 'importantAnnouncements',
  '10-days-recapture': 'importantAnnouncements',
  '3-days-recapture': 'importantAnnouncements',
  'amazon-payments-issue': 'importantAnnouncements',
  'g1g1-announcement': 'importantAnnouncements',  
  'g1g1-last-chance': 'importantAnnouncements',
  'g1g1-recapture': 'importantAnnouncements',
  'gift-one-get-one': 'giftedSubscription',
  'gifted-gems': 'giftedGems',
  'gifted-subscription': 'giftedSubscription',
  'groups-interactivity-beta': 'importantAnnouncements',
  'guild-invite-rescinded': 'kickedGroup',
  'in-app-purchaser-survey': 'majorUpdates',
  'invite-boss-quest': 'invitedQuest',
  'invite-collection-quest': 'invitedQuest',
  'invited-guild': 'invitedGuild',
  'invited-party': 'invitedParty',
  'kicked-from-guild': 'kickedGroup',
  'kicked-from-party': 'kickedGroup',
  'mystic-hourglass-survey': 'majorUpdates',
  'new-pm': 'newPM',
  'onboarding-add-edit-task-1': 'onboarding',
  'onboarding-buy-reward-1': 'onboarding',
  'onboarding-check-off-task-1': 'onboarding',
  'onboarding-join-guild-1': 'onboarding',
  'onboarding-join-party-1': 'onboarding',
  'onboarding-post-message-guild-1': 'onboarding',
  'onboarding-set-reminder-1': 'onboarding',
  'orb-of-rebirth-survey': 'majorUpdates',
  'party-invite-rescinded': 'kickedGroup',
  'product-fit-survey': 'majorUpdates',
  'quest-started': 'questStarted',
  'subscription-renewal': 'subscriptionReminders',
  'subscription-renewal-apple': 'subscriptionReminders',
  'gift-subscription-reminder': 'subscriptionReminders',
  'group-renewal': 'subscriptionReminders',
  'important-subscription-notice': 'majorUpdates',
  'weekly-recap': 'weeklyRecaps',
  'weekly-stats-survey': 'majorUpdates',
  'weekly-stats-survey-subscribers': 'majorUpdates',
  'welcome': 'onboarding',
  'welcome-v2': 'onboarding',
  'welcome-v2b': 'onboarding',
  'welcome-v2c': 'onboarding',
  'welcome-v2d': 'onboarding',
  'won-challenge': 'wonChallenge',
  //'reminder-to-login': 'remindersToLogin',  
};

export default function(job, done){
  var replyToAddress = standardReplyTo; // For beta and production

  if(!job.data.variables) job.data.variables = [];
  var baseUrlI = _.findIndex(job.data.variables, {name: 'BASE_URL'});
  var baseUrl;

  if(baseUrlI === -1){
    job.data.variables.push({name: 'BASE_URL', content: 'https://habitica.com'});
    baseUrl = job.data.variables[job.data.variables.length - 1];
  }else{
    baseUrl = job.data.variables[baseUrlI];
  } 

  // Exclude some base urls, falling back to the main site
  // TODO this is a string not an array
  if(blacklistedBaseUrls.indexOf(baseUrl.content) !== -1){
    baseUrl.content = 'https://habitica.com';
  }

  if(baseUrl && baseUrl.content){
    baseUrl = baseUrl.content;
    if(['https://beta.habitrpg.com', 'https://habitrpg.com', 'https://habitica.com'].indexOf(baseUrl) == -1){
      replyToAddress = orgsReplyTo; // For org plans
    }

    job.data.variables.push({
      name: 'EMAIL_SETTINGS_URL',
      content: '/user/settings/notifications'
    });

    if (mapEmailsToPreferences[job.data.emailType]) {
      job.data.variables.push({
        name: 'UNSUB_EMAIL_TYPE_URL',
        content: '/user/settings/notifications?unsubFrom=' + mapEmailsToPreferences[job.data.emailType]
      });
    } else {
      job.data.variables.push({
        name: 'UNSUB_EMAIL_TYPE_URL',
        content: '/user/settings/notifications'
      });
    }
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
    template_content: [], // must be supplied even if not used
    message: {
      to: toArr,
      'headers': {
        'Reply-To': replyToAddress
      },
      global_merge_vars: job.data.variables,
      merge_vars: job.data.personalVariables,
      //google_analytics_domains: ['habitica.com'],
      from_email: 'messengers@habitica.com',
      from_name: 'Habitica',
      track_opens: true,
      preserve_recipients: false,
      tags: job.data.tags ? job.data.tags.concat([job.data.emailType]) : [job.data.emailType]
    }
  }, function(r){
    done(null, r);
  }, function(e){
    done(e);
  });
};
