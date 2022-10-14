import nconf from 'nconf';
import { IncomingWebhook } from '@slack/webhook';

const SEVERITY_NORMAL = 0;
const SEVERITY_BAD = 1;
const SEVERITY_HORRIBLE = 2;

const slack_url = nconf

const webhook = new IncomingWebhook(slack_url);

function sendToSlack(message, severity) {
    if (severity === SEVERITY_HORRIBLE) {
        message.append("\n@channel - this is urgent.")
    }
    webhook.send({
        text: message
    });
}

function notifyAdmins (job, message, severity) {
    sendToSlack(message, severity)
}

export {
    notifyAdmins,
    SEVERITY_NORMAL,
    SEVERITY_BAD,
    SEVERITY_HORRIBLE
}