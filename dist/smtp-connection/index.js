'use strict';

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function _possibleConstructorReturn(self, call) { if (!self) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return call && (typeof call === "object" || typeof call === "function") ? call : self; }

function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function, not " + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass; }

var packageInfo = require('../../package.json');
var EventEmitter = require('events').EventEmitter;
var net = require('net');
var tls = require('tls');
var os = require('os');
var crypto = require('crypto');
var DataStream = require('./data-stream');
var PassThrough = require('stream').PassThrough;
var shared = require('../shared');

// default timeout values in ms
var CONNECTION_TIMEOUT = 2 * 60 * 1000; // how much to wait for the connection to be established
var SOCKET_TIMEOUT = 10 * 60 * 1000; // how much to wait for socket inactivity before disconnecting the client
var GREETING_TIMEOUT = 30 * 1000; // how much to wait after connection is established but SMTP greeting is not receieved

/**
 * Generates a SMTP connection object
 *
 * Optional options object takes the following possible properties:
 *
 *  * **port** - is the port to connect to (defaults to 587 or 465)
 *  * **host** - is the hostname or IP address to connect to (defaults to 'localhost')
 *  * **secure** - use SSL
 *  * **ignoreTLS** - ignore server support for STARTTLS
 *  * **requireTLS** - forces the client to use STARTTLS
 *  * **name** - the name of the client server
 *  * **localAddress** - outbound address to bind to (see: http://nodejs.org/api/net.html#net_net_connect_options_connectionlistener)
 *  * **greetingTimeout** - Time to wait in ms until greeting message is received from the server (defaults to 10000)
 *  * **connectionTimeout** - how many milliseconds to wait for the connection to establish
 *  * **socketTimeout** - Time of inactivity until the connection is closed (defaults to 1 hour)
 *  * **lmtp** - if true, uses LMTP instead of SMTP protocol
 *  * **logger** - bunyan compatible logger interface
 *  * **debug** - if true pass SMTP traffic to the logger
 *  * **tls** - options for createCredentials
 *  * **socket** - existing socket to use instead of creating a new one (see: http://nodejs.org/api/net.html#net_class_net_socket)
 *  * **secured** - boolean indicates that the provided socket has already been upgraded to tls
 *
 * @constructor
 * @namespace SMTP Client module
 * @param {Object} [options] Option properties
 */

var SMTPConnection = function (_EventEmitter) {
    _inherits(SMTPConnection, _EventEmitter);

    function SMTPConnection(options) {
        _classCallCheck(this, SMTPConnection);

        var _this = _possibleConstructorReturn(this, (SMTPConnection.__proto__ || Object.getPrototypeOf(SMTPConnection)).call(this, options));

        _this.id = crypto.randomBytes(8).toString('base64').replace(/\W/g, '');
        _this.stage = 'init';

        _this.options = options || {};

        _this.secureConnection = !!_this.options.secure;
        _this.alreadySecured = !!_this.options.secured;

        _this.port = _this.options.port || (_this.secureConnection ? 465 : 587);
        _this.host = _this.options.host || 'localhost';

        if (typeof _this.options.secure === 'undefined' && _this.port === 465) {
            // if secure option is not set but port is 465, then default to secure
            _this.secureConnection = true;
        }

        _this.name = _this.options.name || _this._getHostname();

        _this.logger = shared.getLogger(_this.options, {
            component: _this.options.component || 'smtp-connection',
            sid: _this.id
        });

        /**
         * Expose version nr, just for the reference
         * @type {String}
         */
        _this.version = packageInfo.version;

        /**
         * If true, then the user is authenticated
         * @type {Boolean}
         */
        _this.authenticated = false;

        /**
         * If set to true, this instance is no longer active
         * @private
         */
        _this.destroyed = false;

        /**
         * Defines if the current connection is secure or not. If not,
         * STARTTLS can be used if available
         * @private
         */
        _this.secure = !!_this.secureConnection;

        /**
         * Store incomplete messages coming from the server
         * @private
         */
        _this._remainder = '';

        /**
         * Unprocessed responses from the server
         * @type {Array}
         */
        _this._responseQueue = [];

        _this.lastServerResponse = false;

        /**
         * The socket connecting to the server
         * @publick
         */
        _this._socket = false;

        /**
         * Lists supported auth mechanisms
         * @private
         */
        _this._supportedAuth = [];

        /**
         * Includes current envelope (from, to)
         * @private
         */
        _this._envelope = false;

        /**
         * Lists supported extensions
         * @private
         */
        _this._supportedExtensions = [];

        /**
         * Defines the maximum allowed size for a single message
         * @private
         */
        _this._maxAllowedSize = 0;

        /**
         * Function queue to run if a data chunk comes from the server
         * @private
         */
        _this._responseActions = [];
        _this._recipientQueue = [];

        /**
         * Timeout variable for waiting the greeting
         * @private
         */
        _this._greetingTimeout = false;

        /**
         * Timeout variable for waiting the connection to start
         * @private
         */
        _this._connectionTimeout = false;

        /**
         * If the socket is deemed already closed
         * @private
         */
        _this._destroyed = false;

        /**
         * If the socket is already being closed
         * @private
         */
        _this._closing = false;
        return _this;
    }

    /**
     * Creates a connection to a SMTP server and sets up connection
     * listener
     */


    _createClass(SMTPConnection, [{
        key: 'connect',
        value: function connect(connectCallback) {
            var _this2 = this;

            if (typeof connectCallback === 'function') {
                this.once('connect', function () {
                    _this2.logger.debug({
                        tnx: 'smtp'
                    }, 'SMTP handshake finished');
                    connectCallback();
                });
            }

            var opts = {
                port: this.port,
                host: this.host
            };

            if (this.options.localAddress) {
                opts.localAddress = this.options.localAddress;
            }

            if (this.options.connection) {
                // connection is already opened
                this._socket = this.options.connection;
                if (this.secureConnection && !this.alreadySecured) {
                    setImmediate(function () {
                        return _this2._upgradeConnection(function (err) {
                            if (err) {
                                _this2._onError(new Error('Error initiating TLS - ' + (err.message || err)), 'ETLS', false, 'CONN');
                                return;
                            }
                            _this2._onConnect();
                        });
                    });
                } else {
                    setImmediate(function () {
                        return _this2._onConnect();
                    });
                }
            } else if (this.options.socket) {
                // socket object is set up but not yet connected
                this._socket = this.options.socket;
                try {
                    this._socket.connect(this.port, this.host, function () {
                        _this2._socket.setKeepAlive(true);
                        _this2._onConnect();
                    });
                } catch (E) {
                    return setImmediate(function () {
                        return _this2._onError(E, 'ECONNECTION', false, 'CONN');
                    });
                }
            } else if (this.secureConnection) {
                // connect using tls
                if (this.options.tls) {
                    Object.keys(this.options.tls).forEach(function (key) {
                        opts[key] = _this2.options.tls[key];
                    });
                }
                try {
                    this._socket = tls.connect(this.port, this.host, opts, function () {
                        _this2._socket.setKeepAlive(true);
                        _this2._onConnect();
                    });
                } catch (E) {
                    return setImmediate(function () {
                        return _this2._onError(E, 'ECONNECTION', false, 'CONN');
                    });
                }
            } else {
                // connect using plaintext
                try {
                    this._socket = net.connect(opts, function () {
                        _this2._socket.setKeepAlive(true);
                        _this2._onConnect();
                    });
                } catch (E) {
                    return setImmediate(function () {
                        return _this2._onError(E, 'ECONNECTION', false, 'CONN');
                    });
                }
            }

            this._connectionTimeout = setTimeout(function () {
                _this2._onError('Connection timeout', 'ETIMEDOUT', false, 'CONN');
            }, this.options.connectionTimeout || CONNECTION_TIMEOUT);

            this._socket.on('error', function (err) {
                _this2._onError(err, 'ECONNECTION', false, 'CONN');
            });
        }

        /**
         * Sends QUIT
         */

    }, {
        key: 'quit',
        value: function quit() {
            this._sendCommand('QUIT');
            this._responseActions.push(this.close);
        }

        /**
         * Closes the connection to the server
         */

    }, {
        key: 'close',
        value: function close() {
            clearTimeout(this._connectionTimeout);
            clearTimeout(this._greetingTimeout);
            this._responseActions = [];

            // allow to run this function only once
            if (this._closing) {
                return;
            }
            this._closing = true;

            var closeMethod = 'end';

            if (this.stage === 'init') {
                // Close the socket immediately when connection timed out
                closeMethod = 'destroy';
            }

            this.logger.debug({
                tnx: 'smtp'
            }, 'Closing connection to the server using "%s"', closeMethod);

            var socket = this._socket && this._socket.socket || this._socket;

            if (socket && !socket.destroyed) {
                try {
                    this._socket[closeMethod]();
                } catch (E) {
                    // just ignore
                }
            }

            this._destroy();
        }

        /**
         * Authenticate user
         */

    }, {
        key: 'login',
        value: function login(authData, callback) {
            var _this3 = this;

            this._auth = authData || {};

            // Select SASL authentication method
            this._authMethod = (this._auth.method || '').toString().trim().toUpperCase() || false;
            if (!this._authMethod && this._auth.oauth2 && !this._auth.credentials) {
                this._authMethod = 'XOAUTH2';
            } else if (!this._authMethod || this._authMethod === 'XOAUTH2' && !this._auth.oauth2) {
                // use first supported
                this._authMethod = (this._supportedAuth[0] || 'PLAIN').toUpperCase().trim();
            }

            if (this._authMethod !== 'XOAUTH2' && !this._auth.credentials) {
                if (this._auth.user && this._auth.pass) {
                    this._auth.credentials = {
                        user: this._auth.user,
                        pass: this._auth.pass
                    };
                } else {
                    return callback(this._formatError('Missing credentials for "' + this._authMethod + '"', 'EAUTH', false, 'API'));
                }
            }

            switch (this._authMethod) {
                case 'XOAUTH2':
                    this._handleXOauth2Token(false, callback);
                    return;
                case 'LOGIN':
                    this._responseActions.push(function (str) {
                        _this3._actionAUTH_LOGIN_USER(str, callback);
                    });
                    this._sendCommand('AUTH LOGIN');
                    return;
                case 'PLAIN':
                    this._responseActions.push(function (str) {
                        _this3._actionAUTHComplete(str, callback);
                    });
                    this._sendCommand('AUTH PLAIN ' + new Buffer(
                    //this._auth.user+'\u0000'+
                    '\0' + // skip authorization identity as it causes problems with some servers
                    this._auth.credentials.user + '\0' + this._auth.credentials.pass, 'utf-8').toString('base64'));
                    return;
                case 'CRAM-MD5':
                    this._responseActions.push(function (str) {
                        _this3._actionAUTH_CRAM_MD5(str, callback);
                    });
                    this._sendCommand('AUTH CRAM-MD5');
                    return;
            }

            return callback(this._formatError('Unknown authentication method "' + this._authMethod + '"', 'EAUTH', false, 'API'));
        }

        /**
         * Sends a message
         *
         * @param {Object} envelope Envelope object, {from: addr, to: [addr]}
         * @param {Object} message String, Buffer or a Stream
         * @param {Function} callback Callback to return once sending is completed
         */

    }, {
        key: 'send',
        value: function send(envelope, message, done) {
            var _this4 = this;

            if (!message) {
                return done(this._formatError('Empty message', 'EMESSAGE', false, 'API'));
            }

            // reject larger messages than allowed
            if (this._maxAllowedSize && envelope.size > this._maxAllowedSize) {
                return setImmediate(function () {
                    done(_this4._formatError('Message size larger than allowed ' + _this4._maxAllowedSize, 'EMESSAGE', false, 'MAIL FROM'));
                });
            }

            // ensure that callback is only called once
            var returned = false;
            var callback = function callback() {
                if (returned) {
                    return;
                }
                returned = true;

                done.apply(undefined, arguments);
            };

            if (typeof message.on === 'function') {
                message.on('error', function (err) {
                    return callback(_this4._formatError(err, 'ESTREAM', false, 'API'));
                });
            }

            this._setEnvelope(envelope, function (err, info) {
                if (err) {
                    return callback(err);
                }
                var stream = _this4._createSendStream(function (err, str) {
                    if (err) {
                        return callback(err);
                    }
                    info.response = str;
                    return callback(null, info);
                });
                if (typeof message.pipe === 'function') {
                    message.pipe(stream);
                } else {
                    stream.write(message);
                    stream.end();
                }
            });
        }

        /**
         * Resets connection state
         *
         * @param {Function} callback Callback to return once connection is reset
         */

    }, {
        key: 'reset',
        value: function reset(callback) {
            var _this5 = this;

            this._sendCommand('RSET');
            this._responseActions.push(function (str) {
                if (str.charAt(0) !== '2') {
                    return callback(_this5._formatError('Could not reset session state:\n' + str, 'EPROTOCOL', str, 'RSET'));
                }
                _this5._envelope = false;
                return callback(null, true);
            });
        }

        /**
         * Connection listener that is run when the connection to
         * the server is opened
         *
         * @event
         */

    }, {
        key: '_onConnect',
        value: function _onConnect() {
            var _this6 = this;

            clearTimeout(this._connectionTimeout);

            this.logger.info({
                tnx: 'network',
                localAddress: this._socket.localAddress,
                localPort: this._socket.localPort,
                remoteAddress: this._socket.remoteAddress,
                remotePort: this._socket.remotePort
            }, '%s established to %s:%s', this.secure ? 'Secure connection' : 'Connection', this._socket.remoteAddress, this._socket.remotePort);

            if (this._destroyed) {
                // Connection was established after we already had canceled it
                this.close();
                return;
            }

            this.stage = 'connected';

            // clear existing listeners for the socket
            this._socket.removeAllListeners('data');
            this._socket.removeAllListeners('timeout');
            this._socket.removeAllListeners('close');
            this._socket.removeAllListeners('end');

            this._socket.on('data', function (chunk) {
                return _this6._onData(chunk);
            });
            this._socket.once('close', function (errored) {
                return _this6._onClose(errored);
            });
            this._socket.once('end', function () {
                return _this6._onEnd();
            });

            this._socket.setTimeout(this.options.socketTimeout || SOCKET_TIMEOUT);
            this._socket.on('timeout', function () {
                return _this6._onTimeout();
            });

            this._greetingTimeout = setTimeout(function () {
                // if still waiting for greeting, give up
                if (_this6._socket && !_this6._destroyed && _this6._responseActions[0] === _this6._actionGreeting) {
                    _this6._onError('Greeting never received', 'ETIMEDOUT', false, 'CONN');
                }
            }, this.options.greetingTimeout || GREETING_TIMEOUT);

            this._responseActions.push(this._actionGreeting);

            // we have a 'data' listener set up so resume socket if it was paused
            this._socket.resume();
        }

        /**
         * 'data' listener for data coming from the server
         *
         * @event
         * @param {Buffer} chunk Data chunk coming from the server
         */

    }, {
        key: '_onData',
        value: function _onData(chunk) {
            if (this._destroyed || !chunk || !chunk.length) {
                return;
            }

            var data = (chunk || '').toString('binary');
            var lines = (this._remainder + data).split(/\r?\n/);
            var lastline = void 0;

            this._remainder = lines.pop();

            for (var i = 0, len = lines.length; i < len; i++) {
                if (this._responseQueue.length) {
                    lastline = this._responseQueue[this._responseQueue.length - 1];
                    if (/^\d+\-/.test(lastline.split('\n').pop())) {
                        this._responseQueue[this._responseQueue.length - 1] += '\n' + lines[i];
                        continue;
                    }
                }
                this._responseQueue.push(lines[i]);
            }

            this._processResponse();
        }

        /**
         * 'error' listener for the socket
         *
         * @event
         * @param {Error} err Error object
         * @param {String} type Error name
         */

    }, {
        key: '_onError',
        value: function _onError(err, type, data, command) {
            clearTimeout(this._connectionTimeout);
            clearTimeout(this._greetingTimeout);

            if (this._destroyed) {
                // just ignore, already closed
                // this might happen when a socket is canceled because of reached timeout
                // but the socket timeout error itself receives only after
                return;
            }

            err = this._formatError(err, type, data, command);

            var entry = {
                err: err
            };
            if (type) {
                entry.errorType = type;
            }
            if (data) {
                entry.errorData = data;
            }
            if (command) {
                entry.command = command;
            }

            this.logger.error(data, err.message);

            this.emit('error', err);
            this.close();
        }
    }, {
        key: '_formatError',
        value: function _formatError(message, type, response, command) {
            var err = void 0;

            if (/Error\]$/i.test(Object.prototype.toString.call(message))) {
                err = message;
            } else {
                err = new Error(message);
            }

            if (type && type !== 'Error') {
                err.code = type;
            }

            if (response) {
                err.response = response;
                err.message += ': ' + response;
            }

            var responseCode = typeof response === 'string' && Number((response.match(/^\d+/) || [])[0]) || false;
            if (responseCode) {
                err.responseCode = responseCode;
            }

            if (command) {
                err.command = command;
            }

            return err;
        }

        /**
         * 'close' listener for the socket
         *
         * @event
         */

    }, {
        key: '_onClose',
        value: function _onClose() {
            this.logger.info({
                tnx: 'network'
            }, 'Connection closed');

            if (this.upgrading && !this._destroyed) {
                return this._onError(new Error('Connection closed unexpectedly'), 'ETLS', false, 'CONN');
            } else if (![this._actionGreeting, this.close].includes(this._responseActions[0]) && !this._destroyed) {
                return this._onError(new Error('Connection closed unexpectedly'), 'ECONNECTION', false, 'CONN');
            }

            this._destroy();
        }

        /**
         * 'end' listener for the socket
         *
         * @event
         */

    }, {
        key: '_onEnd',
        value: function _onEnd() {
            this._destroy();
        }

        /**
         * 'timeout' listener for the socket
         *
         * @event
         */

    }, {
        key: '_onTimeout',
        value: function _onTimeout() {
            return this._onError(new Error('Timeout'), 'ETIMEDOUT', false, 'CONN');
        }

        /**
         * Destroys the client, emits 'end'
         */

    }, {
        key: '_destroy',
        value: function _destroy() {
            if (this._destroyed) {
                return;
            }
            this._destroyed = true;
            this.emit('end');
        }

        /**
         * Upgrades the connection to TLS
         *
         * @param {Function} callback Callback function to run when the connection
         *        has been secured
         */

    }, {
        key: '_upgradeConnection',
        value: function _upgradeConnection(callback) {
            var _this7 = this;

            // do not remove all listeners or it breaks node v0.10 as there's
            // apparently a 'finish' event set that would be cleared as well

            // we can safely keep 'error', 'end', 'close' etc. events
            this._socket.removeAllListeners('data'); // incoming data is going to be gibberish from this point onwards
            this._socket.removeAllListeners('timeout'); // timeout will be re-set for the new socket object

            var socketPlain = this._socket;
            var opts = {
                socket: this._socket,
                host: this.host
            };

            Object.keys(this.options.tls || {}).forEach(function (key) {
                opts[key] = _this7.options.tls[key];
            });

            this.upgrading = true;
            this._socket = tls.connect(opts, function () {
                _this7.secure = true;
                _this7.upgrading = false;
                _this7._socket.on('data', function (chunk) {
                    return _this7._onData(chunk);
                });

                socketPlain.removeAllListeners('close');
                socketPlain.removeAllListeners('end');

                return callback(null, true);
            });

            this._socket.on('error', function (err) {
                return _this7._onError(err, 'ESOCKET', false, 'CONN');
            });
            this._socket.once('close', function (errored) {
                return _this7._onClose(errored);
            });
            this._socket.once('end', function () {
                return _this7._onEnd();
            });

            this._socket.setTimeout(this.options.socketTimeout || SOCKET_TIMEOUT); // 10 min.
            this._socket.on('timeout', function () {
                return _this7._onTimeout();
            });

            // resume in case the socket was paused
            socketPlain.resume();
        }

        /**
         * Processes queued responses from the server
         *
         * @param {Boolean} force If true, ignores _processing flag
         */

    }, {
        key: '_processResponse',
        value: function _processResponse() {
            var _this8 = this;

            if (!this._responseQueue.length) {
                return false;
            }

            var str = this.lastServerResponse = (this._responseQueue.shift() || '').toString();

            if (/^\d+\-/.test(str.split('\n').pop())) {
                // keep waiting for the final part of multiline response
                return;
            }

            if (this.options.debug || this.options.transactionLog) {
                this.logger.debug({
                    tnx: 'server'
                }, str.replace(/\r?\n$/, ''));
            }

            if (!str.trim()) {
                // skip unexpected empty lines
                setImmediate(function () {
                    return _this8._processResponse(true);
                });
            }

            var action = this._responseActions.shift();

            if (typeof action === 'function') {
                action.call(this, str);
                setImmediate(function () {
                    return _this8._processResponse(true);
                });
            } else {
                return this._onError(new Error('Unexpected Response'), 'EPROTOCOL', str, 'CONN');
            }
        }

        /**
         * Send a command to the server, append \r\n
         *
         * @param {String} str String to be sent to the server
         */

    }, {
        key: '_sendCommand',
        value: function _sendCommand(str) {
            if (this._destroyed) {
                // Connection already closed, can't send any more data
                return;
            }

            if (this._socket.destroyed) {
                return this.close();
            }

            if (this.options.debug || this.options.transactionLog) {
                this.logger.debug({
                    tnx: 'client'
                }, (str || '').toString().replace(/\r?\n$/, ''));
            }

            this._socket.write(new Buffer(str + '\r\n', 'utf-8'));
        }

        /**
         * Initiates a new message by submitting envelope data, starting with
         * MAIL FROM: command
         *
         * @param {Object} envelope Envelope object in the form of
         *        {from:'...', to:['...']}
         *        or
         *        {from:{address:'...',name:'...'}, to:[address:'...',name:'...']}
         */

    }, {
        key: '_setEnvelope',
        value: function _setEnvelope(envelope, callback) {
            var _this9 = this;

            var args = [];
            var useSmtpUtf8 = false;

            this._envelope = envelope || {};
            this._envelope.from = (this._envelope.from && this._envelope.from.address || this._envelope.from || '').toString().trim();

            this._envelope.to = [].concat(this._envelope.to || []).map(function (to) {
                return (to && to.address || to || '').toString().trim();
            });

            if (!this._envelope.to.length) {
                return callback(this._formatError('No recipients defined', 'EENVELOPE', false, 'API'));
            }

            if (this._envelope.from && /[\r\n<>]/.test(this._envelope.from)) {
                return callback(this._formatError('Invalid sender ' + JSON.stringify(this._envelope.from), 'EENVELOPE', false, 'API'));
            }

            // check if the sender address uses only ASCII characters,
            // otherwise require usage of SMTPUTF8 extension
            if (/[\x80-\uFFFF]/.test(this._envelope.from)) {
                useSmtpUtf8 = true;
            }

            for (var i = 0, len = this._envelope.to.length; i < len; i++) {
                if (!this._envelope.to[i] || /[\r\n<>]/.test(this._envelope.to[i])) {
                    return callback(this._formatError('Invalid recipient ' + JSON.stringify(this._envelope.to[i]), 'EENVELOPE', false, 'API'));
                }

                // check if the recipients addresses use only ASCII characters,
                // otherwise require usage of SMTPUTF8 extension
                if (/[\x80-\uFFFF]/.test(this._envelope.to[i])) {
                    useSmtpUtf8 = true;
                }
            }

            // clone the recipients array for latter manipulation
            this._envelope.rcptQueue = JSON.parse(JSON.stringify(this._envelope.to || []));
            this._envelope.rejected = [];
            this._envelope.rejectedErrors = [];
            this._envelope.accepted = [];

            if (this._envelope.dsn) {
                try {
                    this._envelope.dsn = this._setDsnEnvelope(this._envelope.dsn);
                } catch (err) {
                    return callback(this._formatError('Invalid DSN ' + err.message, 'EENVELOPE', false, 'API'));
                }
            }

            this._responseActions.push(function (str) {
                _this9._actionMAIL(str, callback);
            });

            // If the server supports SMTPUTF8 and the envelope includes an internationalized
            // email address then append SMTPUTF8 keyword to the MAIL FROM command
            if (useSmtpUtf8 && this._supportedExtensions.includes('SMTPUTF8')) {
                args.push('SMTPUTF8');
                this._usingSmtpUtf8 = true;
            }

            // If the server supports 8BITMIME and the message might contain non-ascii bytes
            // then append the 8BITMIME keyword to the MAIL FROM command
            if (this._envelope.use8BitMime && this._supportedExtensions.includes('8BITMIME')) {
                args.push('BODY=8BITMIME');
                this._using8BitMime = true;
            }

            if (this._envelope.size && this._supportedExtensions.includes('SIZE')) {
                args.push('SIZE=' + this._envelope.size);
            }

            // If the server supports DSN and the envelope includes an DSN prop
            // then append DSN params to the MAIL FROM command
            if (this._envelope.dsn && this._supportedExtensions.includes('DSN')) {
                if (this._envelope.dsn.ret) {
                    args.push('RET=' + shared.encodeXText(this._envelope.dsn.ret));
                }
                if (this._envelope.dsn.envid) {
                    args.push('ENVID=' + shared.encodeXText(this._envelope.dsn.envid));
                }
            }

            this._sendCommand('MAIL FROM:<' + this._envelope.from + '>' + (args.length ? ' ' + args.join(' ') : ''));
        }
    }, {
        key: '_setDsnEnvelope',
        value: function _setDsnEnvelope(params) {
            var ret = (params.ret || params.return || '').toString().toUpperCase() || null;
            if (ret) {
                switch (ret) {
                    case 'HDRS':
                    case 'HEADERS':
                        ret = 'HDRS';
                        break;
                    case 'FULL':
                    case 'BODY':
                        ret = 'full';
                        break;
                }
            }

            if (ret && !['FULL', 'HDRS'].includes(ret)) {
                throw new Error('ret: ' + JSON.stringify(ret));
            }

            var envid = (params.envid || params.id || '').toString() || null;

            var notify = params.notify || null;
            if (notify) {
                if (typeof notify === 'string') {
                    notify = notify.split(',');
                }
                notify = notify.map(function (n) {
                    return n.trim().toUpperCase();
                });
                var validNotify = ['NEVER', 'SUCCESS', 'FAILURE', 'DELAY'];
                var invaliNotify = notify.filter(function (n) {
                    return !validNotify.includes(n);
                });
                if (invaliNotify.length || notify.length > 1 && notify.includes('NEVER')) {
                    throw new Error('notify: ' + JSON.stringify(notify.join(',')));
                }
                notify = notify.join(',');
            }

            var orcpt = (params.orcpt || params.recipient || '').toString() || null;
            if (orcpt && orcpt.indexOf(';') < 0) {
                orcpt = 'rfc822;' + orcpt;
            }

            return {
                ret: ret,
                envid: envid,
                notify: notify,
                orcpt: orcpt
            };
        }
    }, {
        key: '_getDsnRcptToArgs',
        value: function _getDsnRcptToArgs() {
            var args = [];
            // If the server supports DSN and the envelope includes an DSN prop
            // then append DSN params to the RCPT TO command
            if (this._envelope.dsn && this._supportedExtensions.includes('DSN')) {
                if (this._envelope.dsn.notify) {
                    args.push('NOTIFY=' + shared.encodeXText(this._envelope.dsn.notify));
                }
                if (this._envelope.dsn.orcpt) {
                    args.push('ORCPT=' + shared.encodeXText(this._envelope.dsn.orcpt));
                }
            }
            return args.length ? ' ' + args.join(' ') : '';
        }
    }, {
        key: '_createSendStream',
        value: function _createSendStream(callback) {
            var _this10 = this;

            var dataStream = new DataStream();
            var logStream = void 0;

            if (this.options.lmtp) {
                this._envelope.accepted.forEach(function (recipient, i) {
                    var final = i === _this10._envelope.accepted.length - 1;
                    _this10._responseActions.push(function (str) {
                        _this10._actionLMTPStream(recipient, final, str, callback);
                    });
                });
            } else {
                this._responseActions.push(function (str) {
                    _this10._actionSMTPStream(str, callback);
                });
            }

            dataStream.pipe(this._socket, {
                end: false
            });

            if (this.options.debug) {
                logStream = new PassThrough();
                logStream.on('readable', function () {
                    var chunk = void 0;
                    while (chunk = logStream.read()) {
                        _this10.logger.debug({
                            tnx: 'message'
                        }, chunk.toString('binary').replace(/\r?\n$/, ''));
                    }
                });
                dataStream.pipe(logStream);
            }

            dataStream.once('end', function () {
                _this10.logger.info({
                    tnx: 'message',
                    inByteCount: dataStream.inByteCount,
                    outByteCount: dataStream.outByteCount
                }, '<%s bytes encoded mime message (source size %s bytes)>', dataStream.outByteCount, dataStream.inByteCount);
            });

            return dataStream;
        }

        /** ACTIONS **/

        /**
         * Will be run after the connection is created and the server sends
         * a greeting. If the incoming message starts with 220 initiate
         * SMTP session by sending EHLO command
         *
         * @param {String} str Message from the server
         */

    }, {
        key: '_actionGreeting',
        value: function _actionGreeting(str) {
            clearTimeout(this._greetingTimeout);

            if (str.substr(0, 3) !== '220') {
                this._onError(new Error('Invalid greeting from server:\n' + str), 'EPROTOCOL', str, 'CONN');
                return;
            }

            if (this.options.lmtp) {
                this._responseActions.push(this._actionLHLO);
                this._sendCommand('LHLO ' + this.name);
            } else {
                this._responseActions.push(this._actionEHLO);
                this._sendCommand('EHLO ' + this.name);
            }
        }

        /**
         * Handles server response for LHLO command. If it yielded in
         * error, emit 'error', otherwise treat this as an EHLO response
         *
         * @param {String} str Message from the server
         */

    }, {
        key: '_actionLHLO',
        value: function _actionLHLO(str) {
            if (str.charAt(0) !== '2') {
                this._onError(new Error('Invalid response for LHLO:\n' + str), 'EPROTOCOL', str, 'LHLO');
                return;
            }

            this._actionEHLO(str);
        }

        /**
         * Handles server response for EHLO command. If it yielded in
         * error, try HELO instead, otherwise initiate TLS negotiation
         * if STARTTLS is supported by the server or move into the
         * authentication phase.
         *
         * @param {String} str Message from the server
         */

    }, {
        key: '_actionEHLO',
        value: function _actionEHLO(str) {
            var match = void 0;

            if (str.substr(0, 3) === '421') {
                this._onError(new Error('Server terminates connection:\n' + str), 'ECONNECTION', str, 'EHLO');
                return;
            }

            if (str.charAt(0) !== '2') {
                if (this.options.requireTLS) {
                    this._onError(new Error('EHLO failed but HELO does not support required STARTTLS:\n' + str), 'ECONNECTION', str, 'EHLO');
                    return;
                }

                // Try HELO instead
                this._responseActions.push(this._actionHELO);
                this._sendCommand('HELO ' + this.name);
                return;
            }

            // Detect if the server supports STARTTLS
            if (!this.secure && !this.options.ignoreTLS && (/[ \-]STARTTLS\b/mi.test(str) || this.options.requireTLS)) {
                this._sendCommand('STARTTLS');
                this._responseActions.push(this._actionSTARTTLS);
                return;
            }

            // Detect if the server supports SMTPUTF8
            if (/[ \-]SMTPUTF8\b/mi.test(str)) {
                this._supportedExtensions.push('SMTPUTF8');
            }

            // Detect if the server supports DSN
            if (/[ \-]DSN\b/mi.test(str)) {
                this._supportedExtensions.push('DSN');
            }

            // Detect if the server supports 8BITMIME
            if (/[ \-]8BITMIME\b/mi.test(str)) {
                this._supportedExtensions.push('8BITMIME');
            }

            // Detect if the server supports PIPELINING
            if (/[ \-]PIPELINING\b/mi.test(str)) {
                this._supportedExtensions.push('PIPELINING');
            }

            // Detect if the server supports PLAIN auth
            if (/AUTH(?:(\s+|=)[^\n]*\s+|\s+|=)PLAIN/i.test(str)) {
                this._supportedAuth.push('PLAIN');
            }

            // Detect if the server supports LOGIN auth
            if (/AUTH(?:(\s+|=)[^\n]*\s+|\s+|=)LOGIN/i.test(str)) {
                this._supportedAuth.push('LOGIN');
            }

            // Detect if the server supports CRAM-MD5 auth
            if (/AUTH(?:(\s+|=)[^\n]*\s+|\s+|=)CRAM-MD5/i.test(str)) {
                this._supportedAuth.push('CRAM-MD5');
            }

            // Detect if the server supports XOAUTH2 auth
            if (/AUTH(?:(\s+|=)[^\n]*\s+|\s+|=)XOAUTH2/i.test(str)) {
                this._supportedAuth.push('XOAUTH2');
            }

            // Detect if the server supports SIZE extensions (and the max allowed size)
            if (match = str.match(/[ \-]SIZE(?:[ \t]+(\d+))?/mi)) {
                this._supportedExtensions.push('SIZE');
                this._maxAllowedSize = Number(match[1]) || 0;
            }

            this.emit('connect');
        }

        /**
         * Handles server response for HELO command. If it yielded in
         * error, emit 'error', otherwise move into the authentication phase.
         *
         * @param {String} str Message from the server
         */

    }, {
        key: '_actionHELO',
        value: function _actionHELO(str) {
            if (str.charAt(0) !== '2') {
                this._onError(new Error('Invalid response for EHLO/HELO:\n' + str), 'EPROTOCOL', str, 'HELO');
                return;
            }

            this.emit('connect');
        }

        /**
         * Handles server response for STARTTLS command. If there's an error
         * try HELO instead, otherwise initiate TLS upgrade. If the upgrade
         * succeedes restart the EHLO
         *
         * @param {String} str Message from the server
         */

    }, {
        key: '_actionSTARTTLS',
        value: function _actionSTARTTLS(str) {
            var _this11 = this;

            if (str.charAt(0) !== '2') {
                if (this.options.opportunisticTLS) {
                    this.logger.info({
                        tnx: 'smtp'
                    }, 'Failed STARTTLS upgrade, continuing unencrypted');
                    return this.emit('connect');
                }
                this._onError(new Error('Error upgrading connection with STARTTLS'), 'ETLS', str, 'STARTTLS');
                return;
            }

            this._upgradeConnection(function (err, secured) {
                if (err) {
                    _this11._onError(new Error('Error initiating TLS - ' + (err.message || err)), 'ETLS', false, 'STARTTLS');
                    return;
                }

                _this11.logger.info({
                    tnx: 'smtp'
                }, 'Connection upgraded with STARTTLS');

                if (secured) {
                    // restart session
                    if (_this11.options.lmtp) {
                        _this11._responseActions.push(_this11._actionLHLO);
                        _this11._sendCommand('LHLO ' + _this11.name);
                    } else {
                        _this11._responseActions.push(_this11._actionEHLO);
                        _this11._sendCommand('EHLO ' + _this11.name);
                    }
                } else {
                    _this11.emit('connect');
                }
            });
        }

        /**
         * Handle the response for AUTH LOGIN command. We are expecting
         * '334 VXNlcm5hbWU6' (base64 for 'Username:'). Data to be sent as
         * response needs to be base64 encoded username. We do not need
         * exact match but settle with 334 response in general as some
         * hosts invalidly use a longer message than VXNlcm5hbWU6
         *
         * @param {String} str Message from the server
         */

    }, {
        key: '_actionAUTH_LOGIN_USER',
        value: function _actionAUTH_LOGIN_USER(str, callback) {
            var _this12 = this;

            if (!/^334[ \-]/.test(str)) {
                // expecting '334 VXNlcm5hbWU6'
                callback(this._formatError('Invalid login sequence while waiting for "334 VXNlcm5hbWU6"', 'EAUTH', str, 'AUTH LOGIN'));
                return;
            }

            this._responseActions.push(function (str) {
                _this12._actionAUTH_LOGIN_PASS(str, callback);
            });

            this._sendCommand(new Buffer(this._auth.credentials.user + '', 'utf-8').toString('base64'));
        }

        /**
         * Handle the response for AUTH CRAM-MD5 command. We are expecting
         * '334 <challenge string>'. Data to be sent as response needs to be
         * base64 decoded challenge string, MD5 hashed using the password as
         * a HMAC key, prefixed by the username and a space, and finally all
         * base64 encoded again.
         *
         * @param {String} str Message from the server
         */

    }, {
        key: '_actionAUTH_CRAM_MD5',
        value: function _actionAUTH_CRAM_MD5(str, callback) {
            var _this13 = this;

            var challengeMatch = str.match(/^334\s+(.+)$/);
            var challengeString = '';

            if (!challengeMatch) {
                return callback(this._formatError('Invalid login sequence while waiting for server challenge string', 'EAUTH', str, 'AUTH CRAM-MD5'));
            } else {
                challengeString = challengeMatch[1];
            }

            // Decode from base64
            var base64decoded = new Buffer(challengeString, 'base64').toString('ascii'),
                hmac_md5 = crypto.createHmac('md5', this._auth.credentials.pass);

            hmac_md5.update(base64decoded);

            var hex_hmac = hmac_md5.digest('hex');
            var prepended = this._auth.credentials.user + ' ' + hex_hmac;

            this._responseActions.push(function (str) {
                _this13._actionAUTH_CRAM_MD5_PASS(str, callback);
            });

            this._sendCommand(new Buffer(prepended).toString('base64'));
        }

        /**
         * Handles the response to CRAM-MD5 authentication, if there's no error,
         * the user can be considered logged in. Start waiting for a message to send
         *
         * @param {String} str Message from the server
         */

    }, {
        key: '_actionAUTH_CRAM_MD5_PASS',
        value: function _actionAUTH_CRAM_MD5_PASS(str, callback) {
            if (!str.match(/^235\s+/)) {
                return callback(this._formatError('Invalid login sequence while waiting for "235"', 'EAUTH', str, 'AUTH CRAM-MD5'));
            }

            this.logger.info({
                tnx: 'smtp',
                username: this._auth.user,
                action: 'authenticated',
                method: this._authMethod
            }, 'User %s authenticated', JSON.stringify(this._auth.user));
            this.authenticated = true;
            callback(null, true);
        }

        /**
         * Handle the response for AUTH LOGIN command. We are expecting
         * '334 UGFzc3dvcmQ6' (base64 for 'Password:'). Data to be sent as
         * response needs to be base64 encoded password.
         *
         * @param {String} str Message from the server
         */

    }, {
        key: '_actionAUTH_LOGIN_PASS',
        value: function _actionAUTH_LOGIN_PASS(str, callback) {
            var _this14 = this;

            if (!/^334[ \-]/.test(str)) {
                // expecting '334 UGFzc3dvcmQ6'
                return callback(this._formatError('Invalid login sequence while waiting for "334 UGFzc3dvcmQ6"', 'EAUTH', str, 'AUTH LOGIN'));
            }

            this._responseActions.push(function (str) {
                _this14._actionAUTHComplete(str, callback);
            });

            this._sendCommand(new Buffer(this._auth.credentials.pass + '', 'utf-8').toString('base64'));
        }

        /**
         * Handles the response for authentication, if there's no error,
         * the user can be considered logged in. Start waiting for a message to send
         *
         * @param {String} str Message from the server
         */

    }, {
        key: '_actionAUTHComplete',
        value: function _actionAUTHComplete(str, isRetry, callback) {
            var _this15 = this;

            if (!callback && typeof isRetry === 'function') {
                callback = isRetry;
                isRetry = false;
            }

            if (str.substr(0, 3) === '334') {
                this._responseActions.push(function (str) {
                    if (isRetry || _this15._authMethod !== 'XOAUTH2') {
                        _this15._actionAUTHComplete(str, true, callback);
                    } else {
                        // fetch a new OAuth2 access token
                        setImmediate(function () {
                            return _this15._handleXOauth2Token(true, callback);
                        });
                    }
                });
                this._sendCommand('');
                return;
            }

            if (str.charAt(0) !== '2') {
                this.logger.info({
                    tnx: 'smtp',
                    username: this._auth.user,
                    action: 'authfail',
                    method: this._authMethod
                }, 'User %s failed to authenticate', JSON.stringify(this._auth.user));
                return callback(this._formatError('Invalid login', 'EAUTH', str, 'AUTH ' + this._authMethod));
            }

            this.logger.info({
                tnx: 'smtp',
                username: this._auth.user,
                action: 'authenticated',
                method: this._authMethod
            }, 'User %s authenticated', JSON.stringify(this._auth.user));
            this.authenticated = true;
            callback(null, true);
        }

        /**
         * Handle response for a MAIL FROM: command
         *
         * @param {String} str Message from the server
         */

    }, {
        key: '_actionMAIL',
        value: function _actionMAIL(str, callback) {
            var _this16 = this;

            var message = void 0,
                curRecipient = void 0;
            if (Number(str.charAt(0)) !== 2) {
                if (this._usingSmtpUtf8 && /^550 /.test(str) && /[\x80-\uFFFF]/.test(this._envelope.from)) {
                    message = 'Internationalized mailbox name not allowed';
                } else {
                    message = 'Mail command failed';
                }
                return callback(this._formatError(message, 'EENVELOPE', str, 'MAIL FROM'));
            }

            if (!this._envelope.rcptQueue.length) {
                return callback(this._formatError('Can\'t send mail - no recipients defined', 'EENVELOPE', false, 'API'));
            } else {
                this._recipientQueue = [];

                if (this._supportedExtensions.includes('PIPELINING')) {
                    while (this._envelope.rcptQueue.length) {
                        curRecipient = this._envelope.rcptQueue.shift();
                        this._recipientQueue.push(curRecipient);
                        this._responseActions.push(function (str) {
                            _this16._actionRCPT(str, callback);
                        });
                        this._sendCommand('RCPT TO:<' + curRecipient + '>' + this._getDsnRcptToArgs());
                    }
                } else {
                    curRecipient = this._envelope.rcptQueue.shift();
                    this._recipientQueue.push(curRecipient);
                    this._responseActions.push(function (str) {
                        _this16._actionRCPT(str, callback);
                    });
                    this._sendCommand('RCPT TO:<' + curRecipient + '>' + this._getDsnRcptToArgs());
                }
            }
        }

        /**
         * Handle response for a RCPT TO: command
         *
         * @param {String} str Message from the server
         */

    }, {
        key: '_actionRCPT',
        value: function _actionRCPT(str, callback) {
            var _this17 = this;

            var message = void 0,
                err = void 0,
                curRecipient = this._recipientQueue.shift();
            if (Number(str.charAt(0)) !== 2) {
                // this is a soft error
                if (this._usingSmtpUtf8 && /^553 /.test(str) && /[\x80-\uFFFF]/.test(curRecipient)) {
                    message = 'Internationalized mailbox name not allowed';
                } else {
                    message = 'Recipient command failed';
                }
                this._envelope.rejected.push(curRecipient);
                // store error for the failed recipient
                err = this._formatError(message, 'EENVELOPE', str, 'RCPT TO');
                err.recipient = curRecipient;
                this._envelope.rejectedErrors.push(err);
            } else {
                this._envelope.accepted.push(curRecipient);
            }

            if (!this._envelope.rcptQueue.length && !this._recipientQueue.length) {
                if (this._envelope.rejected.length < this._envelope.to.length) {
                    this._responseActions.push(function (str) {
                        _this17._actionDATA(str, callback);
                    });
                    this._sendCommand('DATA');
                } else {
                    err = this._formatError('Can\'t send mail - all recipients were rejected', 'EENVELOPE', str, 'RCPT TO');
                    err.rejected = this._envelope.rejected;
                    err.rejectedErrors = this._envelope.rejectedErrors;
                    return callback(err);
                }
            } else if (this._envelope.rcptQueue.length) {
                curRecipient = this._envelope.rcptQueue.shift();
                this._recipientQueue.push(curRecipient);
                this._responseActions.push(function (str) {
                    _this17._actionRCPT(str, callback);
                });
                this._sendCommand('RCPT TO:<' + curRecipient + '>' + this._getDsnRcptToArgs());
            }
        }

        /**
         * Handle response for a DATA command
         *
         * @param {String} str Message from the server
         */

    }, {
        key: '_actionDATA',
        value: function _actionDATA(str, callback) {
            // response should be 354 but according to this issue https://github.com/eleith/emailjs/issues/24
            // some servers might use 250 instead, so lets check for 2 or 3 as the first digit
            if (!/^[23]/.test(str)) {
                return callback(this._formatError('Data command failed', 'EENVELOPE', str, 'DATA'));
            }

            var response = {
                accepted: this._envelope.accepted,
                rejected: this._envelope.rejected
            };

            if (this._envelope.rejectedErrors.length) {
                response.rejectedErrors = this._envelope.rejectedErrors;
            }

            callback(null, response);
        }

        /**
         * Handle response for a DATA stream when using SMTP
         * We expect a single response that defines if the sending succeeded or failed
         *
         * @param {String} str Message from the server
         */

    }, {
        key: '_actionSMTPStream',
        value: function _actionSMTPStream(str, callback) {
            if (Number(str.charAt(0)) !== 2) {
                // Message failed
                return callback(this._formatError('Message failed', 'EMESSAGE', str, 'DATA'));
            } else {
                // Message sent succesfully
                return callback(null, str);
            }
        }

        /**
         * Handle response for a DATA stream
         * We expect a separate response for every recipient. All recipients can either
         * succeed or fail separately
         *
         * @param {String} recipient The recipient this response applies to
         * @param {Boolean} final Is this the final recipient?
         * @param {String} str Message from the server
         */

    }, {
        key: '_actionLMTPStream',
        value: function _actionLMTPStream(recipient, final, str, callback) {
            var err = void 0;
            if (Number(str.charAt(0)) !== 2) {
                // Message failed
                err = this._formatError('Message failed for recipient ' + recipient, 'EMESSAGE', str, 'DATA');
                err.recipient = recipient;
                this._envelope.rejected.push(recipient);
                this._envelope.rejectedErrors.push(err);
                for (var i = 0, len = this._envelope.accepted.length; i < len; i++) {
                    if (this._envelope.accepted[i] === recipient) {
                        this._envelope.accepted.splice(i, 1);
                    }
                }
            }
            if (final) {
                return callback(null, str);
            }
        }
    }, {
        key: '_handleXOauth2Token',
        value: function _handleXOauth2Token(isRetry, callback) {
            var _this18 = this;

            this._auth.oauth2.getToken(isRetry, function (err, accessToken) {
                if (err) {
                    _this18.logger.info({
                        tnx: 'smtp',
                        username: _this18._auth.user,
                        action: 'authfail',
                        method: _this18._authMethod
                    }, 'User %s failed to authenticate', JSON.stringify(_this18._auth.user));
                    return callback(_this18._formatError(err, 'EAUTH', false, 'AUTH XOAUTH2'));
                }
                _this18._responseActions.push(function (str) {
                    _this18._actionAUTHComplete(str, isRetry, callback);
                });
                _this18._sendCommand('AUTH XOAUTH2 ' + _this18._auth.oauth2.buildXOAuth2Token(accessToken));
            });
        }
    }, {
        key: '_getHostname',
        value: function _getHostname() {
            // defaul hostname is machine hostname or [IP]
            var defaultHostname = os.hostname() || '';

            // ignore if not FQDN
            if (defaultHostname.indexOf('.') < 0) {
                defaultHostname = '[127.0.0.1]';
            }

            // IP should be enclosed in []
            if (defaultHostname.match(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/)) {
                defaultHostname = '[' + defaultHostname + ']';
            }

            return defaultHostname;
        }
    }]);

    return SMTPConnection;
}(EventEmitter);

module.exports = SMTPConnection;
