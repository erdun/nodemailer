'use strict';

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; };

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function _possibleConstructorReturn(self, call) { if (!self) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return call && (typeof call === "object" || typeof call === "function") ? call : self; }

function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function, not " + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass; }

var EventEmitter = require('events');
var SMTPConnection = require('../smtp-connection');
var wellKnown = require('../well-known');
var shared = require('../shared');
var XOAuth2 = require('../xoauth2');
var packageData = require('../../package.json');

/**
 * Creates a SMTP transport object for Nodemailer
 *
 * @constructor
 * @param {Object} options Connection options
 */

var SMTPTransport = function (_EventEmitter) {
    _inherits(SMTPTransport, _EventEmitter);

    function SMTPTransport(options) {
        _classCallCheck(this, SMTPTransport);

        var _this = _possibleConstructorReturn(this, (SMTPTransport.__proto__ || Object.getPrototypeOf(SMTPTransport)).call(this));

        options = options || {};
        if (typeof options === 'string') {
            options = {
                url: options
            };
        }

        var urlData = void 0;
        var service = options.service;

        if (typeof options.getSocket === 'function') {
            _this.getSocket = options.getSocket;
        }

        if (options.url) {
            urlData = shared.parseConnectionUrl(options.url);
            service = service || urlData.service;
        }

        _this.options = shared.assign(false, // create new object
        options, // regular options
        urlData, // url options
        service && wellKnown(service) // wellknown options
        );

        _this.logger = shared.getLogger(_this.options, {
            component: _this.options.component || 'smtp-transport'
        });

        // temporary object
        var connection = new SMTPConnection(_this.options);

        _this.name = 'SMTP';
        _this.version = packageData.version + '[client:' + connection.version + ']';

        if (_this.options.auth) {
            _this.auth = _this.getAuth({});
        }
        return _this;
    }

    /**
     * Placeholder function for creating proxy sockets. This method immediatelly returns
     * without a socket
     *
     * @param {Object} options Connection options
     * @param {Function} callback Callback function to run with the socket keys
     */


    _createClass(SMTPTransport, [{
        key: 'getSocket',
        value: function getSocket(options, callback) {
            // return immediatelly
            return setImmediate(function () {
                return callback(null, false);
            });
        }
    }, {
        key: 'getAuth',
        value: function getAuth(authOpts) {
            var _this2 = this;

            if (!authOpts) {
                return this.auth;
            }

            var hasAuth = false;
            var authData = {};

            if (this.options.auth && _typeof(this.options.auth) === 'object') {
                Object.keys(this.options.auth).forEach(function (key) {
                    hasAuth = true;
                    authData[key] = _this2.options.auth[key];
                });
            }

            if (authOpts && (typeof authOpts === 'undefined' ? 'undefined' : _typeof(authOpts)) === 'object') {
                Object.keys(authOpts).forEach(function (key) {
                    hasAuth = true;
                    authData[key] = authOpts[key];
                });
            }

            if (!hasAuth) {
                return false;
            }

            switch ((authData.type || '').toString().toUpperCase()) {
                case 'OAUTH2':
                    {
                        if (!authData.service && !authData.user) {
                            return false;
                        }
                        var oauth2 = new XOAuth2(authData, this.logger);
                        oauth2.provisionCallback = this.mailer && this.mailer.get('oauth2_provision_cb') || oauth2.provisionCallback;
                        oauth2.on('token', function (token) {
                            return _this2.mailer.emit('token', token);
                        });
                        oauth2.on('error', function (err) {
                            return _this2.emit('error', err);
                        });
                        return {
                            type: 'OAUTH2',
                            user: authData.user,
                            oauth2: oauth2,
                            method: 'XOAUTH2'
                        };
                    }
                default:
                    return {
                        type: 'LOGIN',
                        user: authData.user,
                        credentials: {
                            user: authData.user || '',
                            pass: authData.pass
                        },
                        method: (authData.method || '').trim().toUpperCase() || false
                    };
            }
        }

        /**
         * Sends an e-mail using the selected settings
         *
         * @param {Object} mail Mail object
         * @param {Function} callback Callback function
         */

    }, {
        key: 'send',
        value: function send(mail, callback) {
            var _this3 = this;

            this.getSocket(this.options, function (err, socketOptions) {
                if (err) {
                    return callback(err);
                }

                var returned = false;
                var options = _this3.options;
                if (socketOptions && socketOptions.connection) {

                    _this3.logger.info({
                        tnx: 'proxy',
                        remoteAddress: socketOptions.connection.remoteAddress,
                        remotePort: socketOptions.connection.remotePort,
                        destHost: options.host || '',
                        destPort: options.port || '',
                        action: 'connected'
                    }, 'Using proxied socket from %s:%s to %s:%s', socketOptions.connection.remoteAddress, socketOptions.connection.remotePort, options.host || '', options.port || '');

                    // only copy options if we need to modify it
                    options = shared.assign(false, options);
                    Object.keys(socketOptions).forEach(function (key) {
                        options[key] = socketOptions[key];
                    });
                }

                var connection = new SMTPConnection(options);

                connection.once('error', function (err) {
                    if (returned) {
                        return;
                    }
                    returned = true;
                    connection.close();
                    return callback(err);
                });

                connection.once('end', function () {
                    if (returned) {
                        return;
                    }
                    returned = true;
                    setTimeout(function () {
                        if (returned) {
                            return;
                        }
                        // still have not returned, this means we have an unexpected connection close
                        var err = new Error('Unexpected socket close');
                        if (connection && connection._socket && connection._socket.upgrading) {
                            // starttls connection errors
                            err.code = 'ETLS';
                        }
                        callback(err);
                    }, 1000).unref();
                });

                var sendMessage = function sendMessage() {
                    var envelope = mail.message.getEnvelope();
                    var messageId = mail.message.messageId();

                    var recipients = [].concat(envelope.to || []);
                    if (recipients.length > 3) {
                        recipients.push('...and ' + recipients.splice(2).length + ' more');
                    }

                    if (mail.data.dsn) {
                        envelope.dsn = mail.data.dsn;
                    }

                    _this3.logger.info({
                        tnx: 'send',
                        messageId: messageId
                    }, 'Sending message %s to <%s>', messageId, recipients.join(', '));

                    connection.send(envelope, mail.message.createReadStream(), function (err, info) {
                        connection.close();
                        if (err) {
                            _this3.logger.error({
                                err: err,
                                tnx: 'send'
                            }, 'Send error for %s: %s', messageId, err.message);
                            return callback(err);
                        }
                        info.envelope = {
                            from: envelope.from,
                            to: envelope.to
                        };
                        info.messageId = messageId;
                        try {
                            return callback(null, info);
                        } catch (E) {
                            _this3.logger.error({
                                err: E,
                                tnx: 'callback'
                            }, 'Callback error for %s: %s', messageId, E.message);
                        }
                    });
                };

                connection.connect(function () {
                    if (returned) {
                        return;
                    }

                    var auth = _this3.getAuth(mail.data.auth);

                    if (auth) {
                        connection.login(auth, function (err) {
                            if (auth && auth !== _this3.auth && auth.oauth2) {
                                auth.oauth2.removeAllListeners();
                            }
                            if (returned) {
                                return;
                            }
                            returned = true;

                            if (err) {
                                connection.close();
                                return callback(err);
                            }

                            sendMessage();
                        });
                    } else {
                        sendMessage();
                    }
                });
            });
        }

        /**
         * Verifies SMTP configuration
         *
         * @param {Function} callback Callback function
         */

    }, {
        key: 'verify',
        value: function verify(callback) {
            var _this4 = this;

            var promise = void 0;

            if (!callback && typeof Promise === 'function') {
                promise = new Promise(function (resolve, reject) {
                    callback = shared.callbackPromise(resolve, reject);
                });
            }

            this.getSocket(this.options, function (err, socketOptions) {
                if (err) {
                    return callback(err);
                }

                var options = _this4.options;
                if (socketOptions && socketOptions.connection) {
                    _this4.logger.info({
                        tnx: 'proxy',
                        remoteAddress: socketOptions.connection.remoteAddress,
                        remotePort: socketOptions.connection.remotePort,
                        destHost: options.host || '',
                        destPort: options.port || '',
                        action: 'connected'
                    }, 'Using proxied socket from %s:%s to %s:%s', socketOptions.connection.remoteAddress, socketOptions.connection.remotePort, options.host || '', options.port || '');

                    options = shared.assign(false, options);
                    Object.keys(socketOptions).forEach(function (key) {
                        options[key] = socketOptions[key];
                    });
                }

                var connection = new SMTPConnection(options);
                var returned = false;

                connection.once('error', function (err) {
                    if (returned) {
                        return;
                    }
                    returned = true;
                    connection.close();
                    return callback(err);
                });

                connection.once('end', function () {
                    if (returned) {
                        return;
                    }
                    returned = true;
                    return callback(new Error('Connection closed'));
                });

                var finalize = function finalize() {
                    if (returned) {
                        return;
                    }
                    returned = true;
                    connection.quit();
                    return callback(null, true);
                };

                connection.connect(function () {
                    if (returned) {
                        return;
                    }

                    var authData = _this4.getAuth({});

                    if (authData) {
                        connection.login(authData, function (err) {
                            if (returned) {
                                return;
                            }

                            if (err) {
                                returned = true;
                                connection.close();
                                return callback(err);
                            }

                            finalize();
                        });
                    } else {
                        finalize();
                    }
                });
            });

            return promise;
        }

        /**
         * Releases resources
         */

    }, {
        key: 'close',
        value: function close() {
            if (this.auth && this.auth.oauth2) {
                this.auth.oauth2.removeAllListeners();
            }
            this.emit('close');
        }
    }]);

    return SMTPTransport;
}(EventEmitter);

// expose to the world


module.exports = SMTPTransport;
