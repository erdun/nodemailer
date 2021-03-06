'use strict';

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; };

var Mailer = require('./mailer');
var shared = require('./shared');
var SMTPPool = require('./smtp-pool');
var SMTPTransport = require('./smtp-transport');
var SendmailTransport = require('./sendmail-transport');
var StreamTransport = require('./stream-transport');
var JSONTransport = require('./json-transport');
var SESTransport = require('./ses-transport');

module.exports.createTransport = function (transporter, defaults) {
    var urlConfig = void 0;
    var options = void 0;
    var mailer = void 0;

    if (
    // provided transporter is a configuration object, not transporter plugin
    (typeof transporter === 'undefined' ? 'undefined' : _typeof(transporter)) === 'object' && typeof transporter.send !== 'function' ||
    // provided transporter looks like a connection url
    typeof transporter === 'string' && /^(smtps?|direct):/i.test(transporter)) {

        if (urlConfig = typeof transporter === 'string' ? transporter : transporter.url) {
            // parse a configuration URL into configuration options
            options = shared.parseConnectionUrl(urlConfig);
        } else {
            options = transporter;
        }

        if (options.pool) {
            transporter = new SMTPPool(options);
        } else if (options.sendmail) {
            transporter = new SendmailTransport(options);
        } else if (options.streamTransport) {
            transporter = new StreamTransport(options);
        } else if (options.jsonTransport) {
            transporter = new JSONTransport(options);
        } else if (options.SES) {
            transporter = new SESTransport(options);
        } else {
            transporter = new SMTPTransport(options);
        }
    }

    mailer = new Mailer(transporter, options, defaults);

    return mailer;
};
