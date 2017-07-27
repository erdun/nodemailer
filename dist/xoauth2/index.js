'use strict';

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; };

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function _possibleConstructorReturn(self, call) { if (!self) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return call && (typeof call === "object" || typeof call === "function") ? call : self; }

function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function, not " + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass; }

var Stream = require('stream').Stream;
var fetch = require('../fetch');
var crypto = require('crypto');
var shared = require('../shared');

/**
 * XOAUTH2 access_token generator for Gmail.
 * Create client ID for web applications in Google API console to use it.
 * See Offline Access for receiving the needed refreshToken for an user
 * https://developers.google.com/accounts/docs/OAuth2WebServer#offline
 *
 * Usage for generating access tokens with a custom method using provisionCallback:
 * provisionCallback(user, renew, callback)
 *   * user is the username to get the token for
 *   * renew is a boolean that if true indicates that existing token failed and needs to be renewed
 *   * callback is the callback to run with (error, accessToken [, expires])
 *     * accessToken is a string
 *     * expires is an optional expire time in milliseconds
 * If provisionCallback is used, then Nodemailer does not try to attempt generating the token by itself
 *
 * @constructor
 * @param {Object} options Client information for token generation
 * @param {String} options.user User e-mail address
 * @param {String} options.clientId Client ID value
 * @param {String} options.clientSecret Client secret value
 * @param {String} options.refreshToken Refresh token for an user
 * @param {String} options.accessUrl Endpoint for token generation, defaults to 'https://accounts.google.com/o/oauth2/token'
 * @param {String} options.accessToken An existing valid accessToken
 * @param {String} options.privateKey Private key for JSW
 * @param {Number} options.expires Optional Access Token expire time in ms
 * @param {Number} options.timeout Optional TTL for Access Token in seconds
 * @param {Function} options.provisionCallback Function to run when a new access token is required
 */

var XOAuth2 = function (_Stream) {
    _inherits(XOAuth2, _Stream);

    function XOAuth2(options, logger) {
        _classCallCheck(this, XOAuth2);

        var _this = _possibleConstructorReturn(this, (XOAuth2.__proto__ || Object.getPrototypeOf(XOAuth2)).call(this));

        _this.options = options || {};

        if (options && options.serviceClient) {
            if (!options.privateKey || !options.user) {
                var _ret;

                return _ret = setImmediate(function () {
                    return _this.emit('error', new Error('Options "privateKey" and "user" are required for service account!'));
                }), _possibleConstructorReturn(_this, _ret);
            }

            var serviceRequestTimeout = Math.min(Math.max(Number(_this.options.serviceRequestTimeout) || 0, 0), 3600);
            _this.options.serviceRequestTimeout = serviceRequestTimeout || 5 * 60;
        }

        _this.logger = shared.getLogger({
            logger: logger
        }, {
            component: _this.options.component || 'OAuth2'
        });

        _this.provisionCallback = typeof _this.options.provisionCallback === 'function' ? _this.options.provisionCallback : false;

        _this.options.accessUrl = _this.options.accessUrl || 'https://accounts.google.com/o/oauth2/token';
        _this.options.customHeaders = _this.options.customHeaders || {};
        _this.options.customParams = _this.options.customParams || {};

        _this.accessToken = _this.options.accessToken || false;

        if (_this.options.expires && Number(_this.options.expires)) {
            _this.expires = _this.options.expires;
        } else {
            var timeout = Math.max(Number(_this.options.timeout) || 0, 0);
            _this.expires = timeout && Date.now() + timeout * 1000 || 0;
        }
        return _this;
    }

    /**
     * Returns or generates (if previous has expired) a XOAuth2 token
     *
     * @param {Boolean} renew If false then use cached access token (if available)
     * @param {Function} callback Callback function with error object and token string
     */


    _createClass(XOAuth2, [{
        key: 'getToken',
        value: function getToken(renew, callback) {
            var _this2 = this;

            if (!renew && this.accessToken && (!this.expires || this.expires > Date.now())) {
                return callback(null, this.accessToken);
            }

            var generateCallback = function generateCallback() {
                if (arguments.length <= 0 ? undefined : arguments[0]) {
                    _this2.logger.error({
                        err: arguments.length <= 0 ? undefined : arguments[0],
                        tnx: 'OAUTH2',
                        user: _this2.options.user,
                        action: 'renew'
                    }, 'Failed generating new Access Token for %s', _this2.options.user);
                } else {
                    _this2.logger.info({
                        tnx: 'OAUTH2',
                        user: _this2.options.user,
                        action: 'renew'
                    }, 'Generated new Access Token for %s', _this2.options.user);
                }
                callback.apply(undefined, arguments);
            };

            if (this.provisionCallback) {
                this.provisionCallback(this.options.user, !!renew, function (err, accessToken, expires) {
                    if (!err && accessToken) {
                        _this2.accessToken = accessToken;
                        _this2.expires = expires || 0;
                    }
                    generateCallback(err, accessToken);
                });
            } else {
                this.generateToken(generateCallback);
            }
        }

        /**
         * Updates token values
         *
         * @param {String} accessToken New access token
         * @param {Number} timeout Access token lifetime in seconds
         *
         * Emits 'token': { user: User email-address, accessToken: the new accessToken, timeout: TTL in seconds}
         */

    }, {
        key: 'updateToken',
        value: function updateToken(accessToken, timeout) {
            this.accessToken = accessToken;
            timeout = Math.max(Number(timeout) || 0, 0);
            this.expires = timeout && Date.now() + timeout * 1000 || 0;

            this.emit('token', {
                user: this.options.user,
                accessToken: accessToken || '',
                expires: this.expires
            });
        }

        /**
         * Generates a new XOAuth2 token with the credentials provided at initialization
         *
         * @param {Function} callback Callback function with error object and token string
         */

    }, {
        key: 'generateToken',
        value: function generateToken(callback) {
            var _this3 = this;

            var urlOptions = void 0;
            if (this.options.serviceClient) {
                // service account - https://developers.google.com/identity/protocols/OAuth2ServiceAccount
                var iat = Math.floor(Date.now() / 1000); // unix time
                var token = this.jwtSignRS256({
                    iss: this.options.serviceClient,
                    scope: this.options.scope || 'https://mail.google.com/',
                    sub: this.options.user,
                    aud: this.options.accessUrl,
                    iat: iat,
                    exp: iat + this.options.serviceRequestTimeout
                });

                urlOptions = {
                    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
                    assertion: token
                };
            } else {

                if (!this.options.refreshToken) {
                    return callback(new Error('Can\'t create new access token for user'));
                }

                // web app - https://developers.google.com/identity/protocols/OAuth2WebServer
                urlOptions = {
                    client_id: this.options.clientId || '',
                    client_secret: this.options.clientSecret || '',
                    refresh_token: this.options.refreshToken,
                    grant_type: 'refresh_token'
                };
            }

            Object.keys(this.options.customParams).forEach(function (key) {
                urlOptions[key] = _this3.options.customParams[key];
            });

            this.postRequest(this.options.accessUrl, urlOptions, this.options, function (error, body) {
                var data = void 0;

                if (error) {
                    return callback(error);
                }

                try {
                    data = JSON.parse(body.toString());
                } catch (E) {
                    return callback(E);
                }

                if (!data || (typeof data === 'undefined' ? 'undefined' : _typeof(data)) !== 'object') {
                    return callback(new Error('Invalid authentication response'));
                }

                if (data.error) {
                    return callback(new Error(data.error));
                }

                if (data.access_token) {
                    _this3.updateToken(data.access_token, data.expires_in);
                    return callback(null, _this3.accessToken);
                }

                return callback(new Error('No access token'));
            });
        }

        /**
         * Converts an access_token and user id into a base64 encoded XOAuth2 token
         *
         * @param {String} [accessToken] Access token string
         * @return {String} Base64 encoded token for IMAP or SMTP login
         */

    }, {
        key: 'buildXOAuth2Token',
        value: function buildXOAuth2Token(accessToken) {
            var authData = ['user=' + (this.options.user || ''), 'auth=Bearer ' + (accessToken || this.accessToken), '', ''];
            return new Buffer(authData.join('\x01'), 'utf-8').toString('base64');
        }

        /**
         * Custom POST request handler.
         * This is only needed to keep paths short in Windows – usually this module
         * is a dependency of a dependency and if it tries to require something
         * like the request module the paths get way too long to handle for Windows.
         * As we do only a simple POST request we do not actually require complicated
         * logic support (no redirects, no nothing) anyway.
         *
         * @param {String} url Url to POST to
         * @param {String|Buffer} payload Payload to POST
         * @param {Function} callback Callback function with (err, buff)
         */

    }, {
        key: 'postRequest',
        value: function postRequest(url, payload, params, callback) {
            var returned = false;

            var chunks = [];
            var chunklen = 0;

            var req = fetch(url, {
                method: 'post',
                headers: params.customHeaders,
                body: payload
            });

            req.on('readable', function () {
                var chunk = void 0;
                while ((chunk = req.read()) !== null) {
                    chunks.push(chunk);
                    chunklen += chunk.length;
                }
            });

            req.once('error', function (err) {
                if (returned) {
                    return;
                }
                returned = true;
                return callback(err);
            });

            req.once('end', function () {
                if (returned) {
                    return;
                }
                returned = true;
                return callback(null, Buffer.concat(chunks, chunklen));
            });
        }

        /**
         * Encodes a buffer or a string into Base64url format
         *
         * @param {Buffer|String} data The data to convert
         * @return {String} The encoded string
         */

    }, {
        key: 'toBase64URL',
        value: function toBase64URL(data) {
            if (typeof data === 'string') {
                data = new Buffer(data);
            }

            return data.toString('base64').replace(/=+/g, ''). // remove '='s
            replace(/\+/g, '-'). // '+' → '-'
            replace(/\//g, '_'); // '/' → '_'
        }

        /**
         * Creates a JSON Web Token signed with RS256 (SHA256 + RSA)
         *
         * @param {Object} payload The payload to include in the generated token
         * @return {String} The generated and signed token
         */

    }, {
        key: 'jwtSignRS256',
        value: function jwtSignRS256(payload) {
            var _this4 = this;

            payload = ['{"alg":"RS256","typ":"JWT"}', JSON.stringify(payload)].map(function (val) {
                return _this4.toBase64URL(val);
            }).join('.');
            var signature = crypto.createSign('RSA-SHA256').update(payload).sign(this.options.privateKey);
            return payload + '.' + this.toBase64URL(signature);
        }
    }]);

    return XOAuth2;
}(Stream);

module.exports = XOAuth2;
