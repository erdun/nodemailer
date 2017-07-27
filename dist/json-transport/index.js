'use strict';

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

var packageData = require('../../package.json');
var shared = require('../shared');

/**
 * Generates a Transport object for Sendmail
 *
 * Possible options can be the following:
 *
 *  * **path** optional path to sendmail binary
 *  * **newline** either 'windows' or 'unix'
 *  * **args** an array of arguments for the sendmail binary
 *
 * @constructor
 * @param {Object} optional config parameter for the AWS Sendmail service
 */

var JSONTransport = function () {
    function JSONTransport(options) {
        _classCallCheck(this, JSONTransport);

        options = options || {};

        this.options = options || {};

        this.name = 'StreamTransport';
        this.version = packageData.version;

        this.logger = shared.getLogger(this.options, {
            component: this.options.component || 'stream-transport'
        });
    }

    /**
     * <p>Compiles a mailcomposer message and forwards it to handler that sends it.</p>
     *
     * @param {Object} emailMessage MailComposer object
     * @param {Function} callback Callback function to run when the sending is completed
     */


    _createClass(JSONTransport, [{
        key: 'send',
        value: function send(mail, done) {
            var _this = this;

            // Sendmail strips this header line by itself
            mail.message.keepBcc = true;

            var envelope = mail.data.envelope || mail.message.getEnvelope();
            var messageId = mail.message.messageId();

            var recipients = [].concat(envelope.to || []);
            if (recipients.length > 3) {
                recipients.push('...and ' + recipients.splice(2).length + ' more');
            }
            this.logger.info({
                tnx: 'send',
                messageId: messageId
            }, 'Composing JSON structure of %s to <%s>', messageId, recipients.join(', '));

            setImmediate(function () {
                mail.resolveAll(function (err, data) {
                    if (err) {
                        _this.logger.error({
                            err: err,
                            tnx: 'send',
                            messageId: messageId
                        }, 'Failed building JSON structure for %s. %s', messageId, err.message);
                        return done(err);
                    }

                    data.messageId = messageId;

                    ['html', 'text', 'watchHtml'].forEach(function (key) {
                        if (data[key] && data[key].content) {
                            if (typeof data[key].content === 'string') {
                                data[key] = data[key].content;
                            } else if (Buffer.isBuffer(data[key].content)) {
                                data[key] = data[key].content.toString();
                            }
                        }
                    });

                    if (data.icalEvent && Buffer.isBuffer(data.icalEvent.content)) {
                        data.icalEvent.content = data.icalEvent.content.toString('base64');
                        data.icalEvent.encoding = 'base64';
                    }

                    if (data.alternatives && data.alternatives.length) {
                        data.alternatives.forEach(function (alternative) {
                            if (alternative && alternative.content && Buffer.isBuffer(alternative.content)) {
                                alternative.content = alternative.content.toString('base64');
                                alternative.encoding = 'base64';
                            }
                        });
                    }

                    if (data.attachments && data.attachments.length) {
                        data.attachments.forEach(function (attachment) {
                            if (attachment && attachment.content && Buffer.isBuffer(attachment.content)) {
                                attachment.content = attachment.content.toString('base64');
                                attachment.encoding = 'base64';
                            }
                        });
                    }

                    return done(null, {
                        envelope: mail.data.envelope || mail.message.getEnvelope(),
                        messageId: messageId,
                        message: JSON.stringify(data)
                    });
                });
            });
        }
    }]);

    return JSONTransport;
}();

module.exports = JSONTransport;
