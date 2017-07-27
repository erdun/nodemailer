'use strict';

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function _possibleConstructorReturn(self, call) { if (!self) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return call && (typeof call === "object" || typeof call === "function") ? call : self; }

function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function, not " + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass; }

var EventEmitter = require('events');
var shared = require('../shared');
var mimeTypes = require('../mime-funcs/mime-types');
var MailComposer = require('../mail-composer');
var DKIM = require('../dkim');
var httpProxyClient = require('../smtp-connection/http-proxy-client');
var util = require('util');
var urllib = require('url');
var packageData = require('../../package.json');
var MailMessage = require('./mail-message');
var net = require('net');
var dns = require('dns');
var crypto = require('crypto');

/**
 * Creates an object for exposing the Mail API
 *
 * @constructor
 * @param {Object} transporter Transport object instance to pass the mails to
 */

var Mail = function (_EventEmitter) {
    _inherits(Mail, _EventEmitter);

    function Mail(transporter, options, defaults) {
        _classCallCheck(this, Mail);

        var _this = _possibleConstructorReturn(this, (Mail.__proto__ || Object.getPrototypeOf(Mail)).call(this));

        _this.options = options || {};
        _this._defaults = defaults || {};

        _this._defaultPlugins = {
            compile: [function () {
                return _this._convertDataImages.apply(_this, arguments);
            }],
            stream: []
        };

        _this._userPlugins = {
            compile: [],
            stream: []
        };

        _this.meta = new Map();

        _this.dkim = _this.options.dkim ? new DKIM(_this.options.dkim) : false;

        _this.transporter = transporter;
        _this.transporter.mailer = _this;

        _this.logger = shared.getLogger(_this.options, {
            component: _this.options.component || 'mail'
        });

        _this.logger.debug({
            tnx: 'create'
        }, 'Creating transport: %s', _this.getVersionString());

        // setup emit handlers for the transporter
        if (typeof transporter.on === 'function') {

            // deprecated log interface
            _this.transporter.on('log', function (log) {
                _this.logger.debug({
                    tnx: 'transport'
                }, '%s: %s', log.type, log.message);
            });

            // transporter errors
            _this.transporter.on('error', function (err) {
                _this.logger.error({
                    err: err,
                    tnx: 'transport'
                }, 'Transport Error: %s', err.message);
                _this.emit('error', err);
            });

            // indicates if the sender has became idle
            _this.transporter.on('idle', function () {
                for (var _len = arguments.length, args = Array(_len), _key = 0; _key < _len; _key++) {
                    args[_key] = arguments[_key];
                }

                _this.emit.apply(_this, ['idle'].concat(args));
            });
        }

        /**
         * Optional methods passed to the underlying transport object
         */
        ['close', 'isIdle', 'verify'].forEach(function (method) {
            _this[method] = function () {
                if (typeof _this.transporter[method] === 'function') {
                    var _this$transporter;

                    return (_this$transporter = _this.transporter)[method].apply(_this$transporter, arguments);
                } else {
                    _this.logger.warn({
                        tnx: 'transport',
                        methodName: method
                    }, 'Non existing method %s called for transport', method);
                    return false;
                }
            };
        });

        // setup proxy handling
        if (_this.options.proxy && typeof _this.options.proxy === 'string') {
            _this.setupProxy(_this.options.proxy);
        }
        return _this;
    }

    _createClass(Mail, [{
        key: 'use',
        value: function use(step, plugin) {
            step = (step || '').toString();
            if (!this._userPlugins.hasOwnProperty(step)) {
                this._userPlugins[step] = [plugin];
            } else {
                this._userPlugins[step].push(plugin);
            }
        }

        /**
         * Sends an email using the preselected transport object
         *
         * @param {Object} data E-data description
         * @param {Function} callback Callback to run once the sending succeeded or failed
         */

    }, {
        key: 'sendMail',
        value: function sendMail(data, callback) {
            var _this2 = this;

            var promise = void 0;

            if (!callback && typeof Promise === 'function') {
                promise = new Promise(function (resolve, reject) {
                    callback = shared.callbackPromise(resolve, reject);
                });
            }

            if (typeof this.getSocket === 'function') {
                this.transporter.getSocket = this.getSocket;
                this.getSocket = false;
            }

            var mail = new MailMessage(this, data);

            this.logger.debug({
                tnx: 'transport',
                name: this.transporter.name,
                version: this.transporter.version,
                action: 'send'
            }, 'Sending mail using %s/%s', this.transporter.name, this.transporter.version);

            this._processPlugins('compile', mail, function (err) {
                if (err) {
                    _this2.logger.error({
                        err: err,
                        tnx: 'plugin',
                        action: 'compile'
                    }, 'PluginCompile Error: %s', err.message);
                    return callback(err);
                }

                mail.message = new MailComposer(mail.data).compile();

                mail.setMailerHeader();
                mail.setPriorityHeaders();
                mail.setListHeaders();

                _this2._processPlugins('stream', mail, function (err) {
                    if (err) {
                        _this2.logger.error({
                            err: err,
                            tnx: 'plugin',
                            action: 'stream'
                        }, 'PluginStream Error: %s', err.message);
                        return callback(err);
                    }

                    if (mail.data.dkim || _this2.dkim) {
                        mail.message.processFunc(function (input) {
                            var dkim = mail.data.dkim ? new DKIM(mail.data.dkim) : _this2.dkim;
                            _this2.logger.debug({
                                tnx: 'DKIM',
                                messageId: mail.message.messageId(),
                                dkimDomains: dkim.keys.map(function (key) {
                                    return key.keySelector + '.' + key.domainName;
                                }).join(', ')
                            }, 'Signing outgoing message with %s keys', dkim.keys.length);
                            return dkim.sign(input, mail.data._dkim);
                        });
                    }

                    _this2.transporter.send(mail, function () {
                        for (var _len2 = arguments.length, args = Array(_len2), _key2 = 0; _key2 < _len2; _key2++) {
                            args[_key2] = arguments[_key2];
                        }

                        if (args[0]) {
                            _this2.logger.error({
                                err: args[0],
                                tnx: 'transport',
                                action: 'send'
                            }, 'Send Error: %s', args[0].message);
                        }
                        callback.apply(undefined, args);
                    });
                });
            });

            return promise;
        }
    }, {
        key: 'getVersionString',
        value: function getVersionString() {
            return util.format('%s (%s; +%s; %s/%s)', packageData.name, packageData.version, packageData.homepage, this.transporter.name, this.transporter.version);
        }
    }, {
        key: '_processPlugins',
        value: function _processPlugins(step, mail, callback) {
            step = (step || '').toString();

            if (!this._userPlugins.hasOwnProperty(step)) {
                return callback();
            }

            var userPlugins = this._userPlugins[step] || [];
            var defaultPlugins = this._defaultPlugins[step] || [];

            if (userPlugins.length) {
                this.logger.debug({
                    tnx: 'transaction',
                    pluginCount: userPlugins.length,
                    step: step
                }, 'Using %s plugins for %s', userPlugins.length, step);
            }

            if (userPlugins.length + defaultPlugins.length === 0) {
                return callback();
            }

            var pos = 0;
            var block = 'default';
            var processPlugins = function processPlugins() {
                var curplugins = block === 'default' ? defaultPlugins : userPlugins;
                if (pos >= curplugins.length) {
                    if (block === 'default' && userPlugins.length) {
                        block = 'user';
                        pos = 0;
                        curplugins = userPlugins;
                    } else {
                        return callback();
                    }
                }
                var plugin = curplugins[pos++];
                plugin(mail, function (err) {
                    if (err) {
                        return callback(err);
                    }
                    processPlugins();
                });
            };

            processPlugins();
        }

        /**
         * Sets up proxy handler for a Nodemailer object
         *
         * @param {String} proxyUrl Proxy configuration url
         */

    }, {
        key: 'setupProxy',
        value: function setupProxy(proxyUrl) {
            var _this3 = this;

            var proxy = urllib.parse(proxyUrl);

            // setup socket handler for the mailer object
            this.getSocket = function (options, callback) {
                var protocol = proxy.protocol.replace(/:$/, '').toLowerCase();

                if (_this3.meta.has('proxy_handler_' + protocol)) {
                    return _this3.meta.get('proxy_handler_' + protocol)(proxy, options, callback);
                }

                switch (protocol) {
                    // Connect using a HTTP CONNECT method
                    case 'http':
                    case 'https':
                        httpProxyClient(proxy.href, options.port, options.host, function (err, socket) {
                            if (err) {
                                return callback(err);
                            }
                            return callback(null, {
                                connection: socket
                            });
                        });
                        return;
                    case 'socks':
                    case 'socks5':
                    case 'socks4':
                    case 'socks4a':
                        {
                            if (!_this3.meta.has('proxy_socks_module')) {
                                return callback(new Error('Socks module not loaded'));
                            }

                            var connect = function connect(ipaddress) {
                                _this3.meta.get('proxy_socks_module').createConnection({
                                    proxy: {
                                        ipaddress: ipaddress,
                                        port: proxy.port,
                                        type: Number(proxy.protocol.replace(/\D/g, '')) || 5
                                    },
                                    target: {
                                        host: options.host,
                                        port: options.port
                                    },
                                    command: 'connect',
                                    authentication: !proxy.auth ? false : {
                                        username: decodeURIComponent(proxy.auth.split(':').shift()),
                                        password: decodeURIComponent(proxy.auth.split(':').pop())
                                    }
                                }, function (err, socket) {
                                    if (err) {
                                        return callback(err);
                                    }
                                    return callback(null, {
                                        connection: socket
                                    });
                                });
                            };

                            if (net.isIP(proxy.hostname)) {
                                return connect(proxy.hostname);
                            }

                            return dns.resolve(proxy.hostname, function (err, address) {
                                if (err) {
                                    return callback(err);
                                }
                                connect(address);
                            });
                        }
                }
                callback(new Error('Unknown proxy configuration'));
            };
        }
    }, {
        key: '_convertDataImages',
        value: function _convertDataImages(mail, callback) {
            if (!this.options.attachDataUrls && !mail.data.attachDataUrls || !mail.data.html) {
                return callback();
            }
            mail.resolveContent(mail.data, 'html', function (err, html) {
                if (err) {
                    return callback(err);
                }
                var cidCounter = 0;
                html = (html || '').toString().replace(/(<img\b[^>]* src\s*=[\s"']*)(data:([^;]+);[^"'>\s]+)/gi, function (match, prefix, dataUri, mimeType) {
                    var cid = crypto.randomBytes(10).toString('hex') + '@localhost';
                    if (!mail.data.attachments) {
                        mail.data.attachments = [];
                    }
                    if (!Array.isArray(mail.data.attachments)) {
                        mail.data.attachments = [].concat(mail.data.attachments || []);
                    }
                    mail.data.attachments.push({
                        path: dataUri,
                        cid: cid,
                        filename: 'image-' + ++cidCounter + '.' + mimeTypes.detectExtension(mimeType)
                    });
                    return prefix + 'cid:' + cid;
                });
                mail.data.html = html;
                callback();
            });
        }
    }, {
        key: 'set',
        value: function set(key, value) {
            return this.meta.set(key, value);
        }
    }, {
        key: 'get',
        value: function get(key) {
            return this.meta.get(key);
        }
    }]);

    return Mail;
}(EventEmitter);

module.exports = Mail;
