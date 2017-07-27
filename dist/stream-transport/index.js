'use strict';

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

var packageData = require('../../package.json');
var shared = require('../shared');
var LeWindows = require('../sendmail-transport/le-windows');
var LeUnix = require('../sendmail-transport/le-unix');

/**
 * Generates a Transport object for streaming
 *
 * Possible options can be the following:
 *
 *  * **buffer** if true, then returns the message as a Buffer object instead of a stream
 *  * **newline** either 'windows' or 'unix'
 *
 * @constructor
 * @param {Object} optional config parameter for the AWS Sendmail service
 */

var SendmailTransport = function () {
    function SendmailTransport(options) {
        _classCallCheck(this, SendmailTransport);

        options = options || {};

        this.options = options || {};

        this.name = 'StreamTransport';
        this.version = packageData.version;

        this.logger = shared.getLogger(this.options, {
            component: this.options.component || 'stream-transport'
        });

        this.winbreak = ['win', 'windows', 'dos', '\r\n'].includes((options.newline || '').toString().toLowerCase());
    }

    /**
     * Compiles a mailcomposer message and forwards it to handler that sends it
     *
     * @param {Object} emailMessage MailComposer object
     * @param {Function} callback Callback function to run when the sending is completed
     */


    _createClass(SendmailTransport, [{
        key: 'send',
        value: function send(mail, done) {
            var _this = this;

            // We probably need this in the output
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
            }, 'Sending message %s to <%s> using %s line breaks', messageId, recipients.join(', '), this.winbreak ? '<CR><LF>' : '<LF>');

            setImmediate(function () {

                var sourceStream = void 0;
                var stream = void 0;
                var transform = void 0;

                try {
                    transform = _this.winbreak ? new LeWindows() : new LeUnix();
                    sourceStream = mail.message.createReadStream();
                    stream = sourceStream.pipe(transform);
                    sourceStream.on('error', function (err) {
                        return stream.emit('error', err);
                    });
                } catch (E) {
                    _this.logger.error({
                        err: E,
                        tnx: 'send',
                        messageId: messageId
                    }, 'Creating send stream failed for %s. %s', messageId, E.message);
                    return done(E);
                }

                if (!_this.options.buffer) {
                    stream.once('error', function (err) {
                        _this.logger.error({
                            err: err,
                            tnx: 'send',
                            messageId: messageId
                        }, 'Failed creating message for %s. %s', messageId, err.message);
                    });
                    return done(null, {
                        envelope: mail.data.envelope || mail.message.getEnvelope(),
                        messageId: messageId,
                        message: stream
                    });
                }

                var chunks = [];
                var chunklen = 0;
                stream.on('readable', function () {
                    var chunk = void 0;
                    while ((chunk = stream.read()) !== null) {
                        chunks.push(chunk);
                        chunklen += chunk.length;
                    }
                });

                stream.once('error', function (err) {
                    _this.logger.error({
                        err: err,
                        tnx: 'send',
                        messageId: messageId
                    }, 'Failed creating message for %s. %s', messageId, err.message);
                    return done(err);
                });

                stream.on('end', function () {
                    return done(null, {
                        envelope: mail.data.envelope || mail.message.getEnvelope(),
                        messageId: messageId,
                        message: Buffer.concat(chunks, chunklen)
                    });
                });
            });
        }
    }]);

    return SendmailTransport;
}();

module.exports = SendmailTransport;
