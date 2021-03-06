'use strict';

// FIXME:
// replace this Transform mess with a method that pipes input argument to output argument

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

var MessageParser = require('./message-parser');
var RelaxedBody = require('./relaxed-body');
var sign = require('./sign');
var PassThrough = require('stream').PassThrough;
var fs = require('fs');
var path = require('path');
var crypto = require('crypto');

var DKIM_ALGO = 'sha256';
var MAX_MESSAGE_SIZE = 128 * 1024; // buffer messages larger than this to disk

/*
// Usage:

let dkim = new DKIM({
    domainName: 'example.com',
    keySelector: 'key-selector',
    privateKey,
    cacheDir: '/tmp'
});
dkim.sign(input).pipe(process.stdout);

// Where inputStream is a rfc822 message (either a stream, string or Buffer)
// and outputStream is a DKIM signed rfc822 message
*/

var DKIMSigner = function () {
    function DKIMSigner(options, keys, input, output) {
        var _this = this;

        _classCallCheck(this, DKIMSigner);

        this.options = options || {};
        this.keys = keys;

        this.cacheTreshold = Number(this.options.cacheTreshold) || MAX_MESSAGE_SIZE;
        this.hashAlgo = this.options.hashAlgo || DKIM_ALGO;

        this.cacheDir = this.options.cacheDir || false;

        this.chunks = [];
        this.chunklen = 0;
        this.readPos = 0;
        this.cachePath = this.cacheDir ? path.join(this.cacheDir, 'message.' + Date.now() + '-' + crypto.randomBytes(14).toString('hex')) : false;
        this.cache = false;

        this.headers = false;
        this.bodyHash = false;
        this.parser = false;
        this.relaxedBody = false;

        this.input = input;
        this.output = output;
        this.output.usingCache = false;

        this.errored = false;

        this.input.on('error', function (err) {
            _this.errored = true;
            _this.cleanup();
            output.emit('error', err);
        });
    }

    _createClass(DKIMSigner, [{
        key: 'cleanup',
        value: function cleanup() {
            if (!this.cache || !this.cachePath) {
                return;
            }
            fs.unlink(this.cachePath, function () {
                return false;
            });
        }
    }, {
        key: 'createReadCache',
        value: function createReadCache() {
            var _this2 = this;

            // pipe remainings to cache file
            this.cache = fs.createReadStream(this.cachePath);
            this.cache.once('error', function (err) {
                _this2.cleanup();
                _this2.output.emit('error', err);
            });
            this.cache.once('close', function () {
                _this2.cleanup();
            });
            this.cache.pipe(this.output);
        }
    }, {
        key: 'sendNextChunk',
        value: function sendNextChunk() {
            var _this3 = this;

            if (this.errored) {
                return;
            }

            if (this.readPos >= this.chunks.length) {
                if (!this.cache) {
                    return this.output.end();
                }
                return this.createReadCache();
            }
            var chunk = this.chunks[this.readPos++];
            if (this.output.write(chunk) === false) {
                return this.output.once('drain', function () {
                    _this3.sendNextChunk();
                });
            }
            setImmediate(function () {
                return _this3.sendNextChunk();
            });
        }
    }, {
        key: 'sendSignedOutput',
        value: function sendSignedOutput() {
            var _this4 = this;

            var keyPos = 0;
            var signNextKey = function signNextKey() {
                if (keyPos >= _this4.keys.length) {
                    _this4.output.write(_this4.parser.rawHeaders);
                    return setImmediate(function () {
                        return _this4.sendNextChunk();
                    });
                }
                var key = _this4.keys[keyPos++];
                var dkimField = sign(_this4.headers, _this4.hashAlgo, _this4.bodyHash, {
                    domainName: key.domainName,
                    keySelector: key.keySelector,
                    privateKey: key.privateKey,
                    headerFieldNames: _this4.options.headerFieldNames,
                    skipFields: _this4.options.skipFields
                });
                if (dkimField) {
                    _this4.output.write(Buffer.from(dkimField + '\r\n'));
                }
                return setImmediate(signNextKey);
            };

            if (this.bodyHash && this.headers) {
                return signNextKey();
            }

            this.output.write(this.parser.rawHeaders);
            this.sendNextChunk();
        }
    }, {
        key: 'createWriteCache',
        value: function createWriteCache() {
            var _this5 = this;

            this.output.usingCache = true;
            // pipe remainings to cache file
            this.cache = fs.createWriteStream(this.cachePath);
            this.cache.once('error', function (err) {
                _this5.cleanup();
                // drain input
                _this5.relaxedBody.unpipe(_this5.cache);
                _this5.relaxedBody.on('readable', function () {
                    while (_this5.relaxedBody.read() !== null) {
                        // do nothing
                    }
                });
                _this5.errored = true;
                // emit error
                _this5.output.emit('error', err);
            });
            this.cache.once('close', function () {
                _this5.sendSignedOutput();
            });
            this.relaxedBody.pipe(this.cache);
        }
    }, {
        key: 'signStream',
        value: function signStream() {
            var _this6 = this;

            this.parser = new MessageParser();
            this.relaxedBody = new RelaxedBody({
                hashAlgo: this.hashAlgo
            });

            this.parser.on('headers', function (value) {
                _this6.headers = value;
            });

            this.relaxedBody.on('hash', function (value) {
                _this6.bodyHash = value;
            });

            this.relaxedBody.on('readable', function () {
                var chunk = void 0;
                if (_this6.cache) {
                    return;
                }
                while ((chunk = _this6.relaxedBody.read()) !== null) {
                    _this6.chunks.push(chunk);
                    _this6.chunklen += chunk.length;
                    if (_this6.chunklen >= _this6.cacheTreshold && _this6.cachePath) {
                        return _this6.createWriteCache();
                    }
                }
            });

            this.relaxedBody.on('end', function () {
                if (_this6.cache) {
                    return;
                }
                _this6.sendSignedOutput();
            });

            this.parser.pipe(this.relaxedBody);
            setImmediate(function () {
                return _this6.input.pipe(_this6.parser);
            });
        }
    }]);

    return DKIMSigner;
}();

var DKIM = function () {
    function DKIM(options) {
        _classCallCheck(this, DKIM);

        this.options = options || {};
        this.keys = [].concat(this.options.keys || {
            domainName: options.domainName,
            keySelector: options.keySelector,
            privateKey: options.privateKey
        });
    }

    _createClass(DKIM, [{
        key: 'sign',
        value: function sign(input, extraOptions) {
            var _this7 = this;

            var output = new PassThrough();
            var inputStream = input;
            var writeValue = false;

            if (Buffer.isBuffer(input)) {
                writeValue = input;
                inputStream = new PassThrough();
            } else if (typeof input === 'string') {
                writeValue = Buffer.from(input);
                inputStream = new PassThrough();
            }

            var options = this.options;
            if (extraOptions && Object.keys(extraOptions).length) {
                options = {};
                Object.keys(this.options || {}).forEach(function (key) {
                    options[key] = _this7.options[key];
                });
                Object.keys(extraOptions || {}).forEach(function (key) {
                    if (!(key in options)) {
                        options[key] = extraOptions[key];
                    }
                });
            }

            var signer = new DKIMSigner(options, this.keys, inputStream, output);
            setImmediate(function () {
                signer.signStream();
                if (writeValue) {
                    setImmediate(function () {
                        inputStream.end(writeValue);
                    });
                }
            });

            return output;
        }
    }]);

    return DKIM;
}();

module.exports = DKIM;
