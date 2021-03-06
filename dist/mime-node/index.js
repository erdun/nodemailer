/* eslint no-undefined: 0 */

'use strict';

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; };

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

var crypto = require('crypto');
var os = require('os');
var fs = require('fs');
var punycode = require('punycode');
var PassThrough = require('stream').PassThrough;

var mimeFuncs = require('../mime-funcs');
var qp = require('../qp');
var base64 = require('../base64');
var addressparser = require('../addressparser');
var fetch = require('../fetch');
var LastNewline = require('./last-newline');

/**
 * Creates a new mime tree node. Assumes 'multipart/*' as the content type
 * if it is a branch, anything else counts as leaf. If rootNode is missing from
 * the options, assumes this is the root.
 *
 * @param {String} contentType Define the content type for the node. Can be left blank for attachments (derived from filename)
 * @param {Object} [options] optional options
 * @param {Object} [options.rootNode] root node for this tree
 * @param {Object} [options.parentNode] immediate parent for this node
 * @param {Object} [options.filename] filename for an attachment node
 * @param {String} [options.baseBoundary] shared part of the unique multipart boundary
 * @param {Boolean} [options.keepBcc] If true, do not exclude Bcc from the generated headers
 * @param {String} [options.textEncoding] either 'Q' (the default) or 'B'
 */

var MimeNode = function () {
    function MimeNode(contentType, options) {
        _classCallCheck(this, MimeNode);

        this.nodeCounter = 0;

        options = options || {};

        /**
         * shared part of the unique multipart boundary
         */
        this.baseBoundary = options.baseBoundary || crypto.randomBytes(8).toString('hex');
        this.boundaryPrefix = options.boundaryPrefix || '--_NmP';

        this.disableFileAccess = !!options.disableFileAccess;
        this.disableUrlAccess = !!options.disableUrlAccess;

        /**
         * If date headers is missing and current node is the root, this value is used instead
         */
        this.date = new Date();

        /**
         * Root node for current mime tree
         */
        this.rootNode = options.rootNode || this;

        /**
         * If true include Bcc in generated headers (if available)
         */
        this.keepBcc = !!options.keepBcc;

        /**
         * If filename is specified but contentType is not (probably an attachment)
         * detect the content type from filename extension
         */
        if (options.filename) {
            /**
             * Filename for this node. Useful with attachments
             */
            this.filename = options.filename;
            if (!contentType) {
                contentType = mimeFuncs.detectMimeType(this.filename.split('.').pop());
            }
        }

        /**
         * Indicates which encoding should be used for header strings: "Q" or "B"
         */
        this.textEncoding = (options.textEncoding || '').toString().trim().charAt(0).toUpperCase();

        /**
         * Immediate parent for this node (or undefined if not set)
         */
        this.parentNode = options.parentNode;

        /**
         * Hostname for default message-id values
         */
        this.hostname = options.hostname;

        /**
         * An array for possible child nodes
         */
        this.childNodes = [];

        /**
         * Used for generating unique boundaries (prepended to the shared base)
         */
        this._nodeId = ++this.rootNode.nodeCounter;

        /**
         * A list of header values for this node in the form of [{key:'', value:''}]
         */
        this._headers = [];

        /**
         * True if the content only uses ASCII printable characters
         * @type {Boolean}
         */
        this._isPlainText = false;

        /**
         * True if the content is plain text but has longer lines than allowed
         * @type {Boolean}
         */
        this._hasLongLines = false;

        /**
         * If set, use instead this value for envelopes instead of generating one
         * @type {Boolean}
         */
        this._envelope = false;

        /**
         * If set then use this value as the stream content instead of building it
         * @type {String|Buffer|Stream}
         */
        this._raw = false;

        /**
         * Additional transform streams that the message will be piped before
         * exposing by createReadStream
         * @type {Array}
         */
        this._transforms = [];

        /**
         * Additional process functions that the message will be piped through before
         * exposing by createReadStream. These functions are run after transforms
         * @type {Array}
         */
        this._processFuncs = [];

        /**
         * If content type is set (or derived from the filename) add it to headers
         */
        if (contentType) {
            this.setHeader('Content-Type', contentType);
        }
    }

    /////// PUBLIC METHODS

    /**
     * Creates and appends a child node.Arguments provided are passed to MimeNode constructor
     *
     * @param {String} [contentType] Optional content type
     * @param {Object} [options] Optional options object
     * @return {Object} Created node object
     */


    _createClass(MimeNode, [{
        key: 'createChild',
        value: function createChild(contentType, options) {
            if (!options && (typeof contentType === 'undefined' ? 'undefined' : _typeof(contentType)) === 'object') {
                options = contentType;
                contentType = undefined;
            }
            var node = new MimeNode(contentType, options);
            this.appendChild(node);
            return node;
        }

        /**
         * Appends an existing node to the mime tree. Removes the node from an existing
         * tree if needed
         *
         * @param {Object} childNode node to be appended
         * @return {Object} Appended node object
         */

    }, {
        key: 'appendChild',
        value: function appendChild(childNode) {

            if (childNode.rootNode !== this.rootNode) {
                childNode.rootNode = this.rootNode;
                childNode._nodeId = ++this.rootNode.nodeCounter;
            }

            childNode.parentNode = this;

            this.childNodes.push(childNode);
            return childNode;
        }

        /**
         * Replaces current node with another node
         *
         * @param {Object} node Replacement node
         * @return {Object} Replacement node
         */

    }, {
        key: 'replace',
        value: function replace(node) {
            var _this = this;

            if (node === this) {
                return this;
            }

            this.parentNode.childNodes.forEach(function (childNode, i) {
                if (childNode === _this) {

                    node.rootNode = _this.rootNode;
                    node.parentNode = _this.parentNode;
                    node._nodeId = _this._nodeId;

                    _this.rootNode = _this;
                    _this.parentNode = undefined;

                    node.parentNode.childNodes[i] = node;
                }
            });

            return node;
        }

        /**
         * Removes current node from the mime tree
         *
         * @return {Object} removed node
         */

    }, {
        key: 'remove',
        value: function remove() {
            if (!this.parentNode) {
                return this;
            }

            for (var i = this.parentNode.childNodes.length - 1; i >= 0; i--) {
                if (this.parentNode.childNodes[i] === this) {
                    this.parentNode.childNodes.splice(i, 1);
                    this.parentNode = undefined;
                    this.rootNode = this;
                    return this;
                }
            }
        }

        /**
         * Sets a header value. If the value for selected key exists, it is overwritten.
         * You can set multiple values as well by using [{key:'', value:''}] or
         * {key: 'value'} as the first argument.
         *
         * @param {String|Array|Object} key Header key or a list of key value pairs
         * @param {String} value Header value
         * @return {Object} current node
         */

    }, {
        key: 'setHeader',
        value: function setHeader(key, value) {
            var _this2 = this;

            var added = false,
                headerValue = void 0;

            // Allow setting multiple headers at once
            if (!value && key && (typeof key === 'undefined' ? 'undefined' : _typeof(key)) === 'object') {
                // allow {key:'content-type', value: 'text/plain'}
                if (key.key && 'value' in key) {
                    this.setHeader(key.key, key.value);
                }
                // allow [{key:'content-type', value: 'text/plain'}]
                else if (Array.isArray(key)) {
                        key.forEach(function (i) {
                            _this2.setHeader(i.key, i.value);
                        });
                    }
                    // allow {'content-type': 'text/plain'}
                    else {
                            Object.keys(key).forEach(function (i) {
                                _this2.setHeader(i, key[i]);
                            });
                        }
                return this;
            }

            key = this._normalizeHeaderKey(key);

            headerValue = {
                key: key,
                value: value
            };

            // Check if the value exists and overwrite
            for (var i = 0, len = this._headers.length; i < len; i++) {
                if (this._headers[i].key === key) {
                    if (!added) {
                        // replace the first match
                        this._headers[i] = headerValue;
                        added = true;
                    } else {
                        // remove following matches
                        this._headers.splice(i, 1);
                        i--;
                        len--;
                    }
                }
            }

            // match not found, append the value
            if (!added) {
                this._headers.push(headerValue);
            }

            return this;
        }

        /**
         * Adds a header value. If the value for selected key exists, the value is appended
         * as a new field and old one is not touched.
         * You can set multiple values as well by using [{key:'', value:''}] or
         * {key: 'value'} as the first argument.
         *
         * @param {String|Array|Object} key Header key or a list of key value pairs
         * @param {String} value Header value
         * @return {Object} current node
         */

    }, {
        key: 'addHeader',
        value: function addHeader(key, value) {
            var _this3 = this;

            // Allow setting multiple headers at once
            if (!value && key && (typeof key === 'undefined' ? 'undefined' : _typeof(key)) === 'object') {
                // allow {key:'content-type', value: 'text/plain'}
                if (key.key && key.value) {
                    this.addHeader(key.key, key.value);
                }
                // allow [{key:'content-type', value: 'text/plain'}]
                else if (Array.isArray(key)) {
                        key.forEach(function (i) {
                            _this3.addHeader(i.key, i.value);
                        });
                    }
                    // allow {'content-type': 'text/plain'}
                    else {
                            Object.keys(key).forEach(function (i) {
                                _this3.addHeader(i, key[i]);
                            });
                        }
                return this;
            } else if (Array.isArray(value)) {
                value.forEach(function (val) {
                    _this3.addHeader(key, val);
                });
                return this;
            }

            this._headers.push({
                key: this._normalizeHeaderKey(key),
                value: value
            });

            return this;
        }

        /**
         * Retrieves the first mathcing value of a selected key
         *
         * @param {String} key Key to search for
         * @retun {String} Value for the key
         */

    }, {
        key: 'getHeader',
        value: function getHeader(key) {
            key = this._normalizeHeaderKey(key);
            for (var i = 0, len = this._headers.length; i < len; i++) {
                if (this._headers[i].key === key) {
                    return this._headers[i].value;
                }
            }
        }

        /**
         * Sets body content for current node. If the value is a string, charset is added automatically
         * to Content-Type (if it is text/*). If the value is a Buffer, you need to specify
         * the charset yourself
         *
         * @param (String|Buffer) content Body content
         * @return {Object} current node
         */

    }, {
        key: 'setContent',
        value: function setContent(content) {
            var _this4 = this;

            this.content = content;
            if (typeof this.content.pipe === 'function') {
                // pre-stream handler. might be triggered if a stream is set as content
                // and 'error' fires before anything is done with this stream
                this._contentErrorHandler = function (err) {
                    _this4.content.removeListener('error', _this4._contentErrorHandler);
                    _this4.content = err;
                };
                this.content.once('error', this._contentErrorHandler);
            } else if (typeof this.content === 'string') {
                this._isPlainText = mimeFuncs.isPlainText(this.content);
                if (this._isPlainText && mimeFuncs.hasLongerLines(this.content, 76)) {
                    // If there are lines longer than 76 symbols/bytes do not use 7bit
                    this._hasLongLines = true;
                }
            }
            return this;
        }
    }, {
        key: 'build',
        value: function build(callback) {
            var stream = this.createReadStream();
            var buf = [];
            var buflen = 0;
            var returned = false;

            stream.on('readable', function () {
                var chunk = void 0;

                while ((chunk = stream.read()) !== null) {
                    buf.push(chunk);
                    buflen += chunk.length;
                }
            });

            stream.once('error', function (err) {
                if (returned) {
                    return;
                }
                returned = true;

                return callback(err);
            });

            stream.once('end', function (chunk) {
                if (returned) {
                    return;
                }
                returned = true;

                if (chunk && chunk.length) {
                    buf.push(chunk);
                    buflen += chunk.length;
                }
                return callback(null, Buffer.concat(buf, buflen));
            });
        }
    }, {
        key: 'getTransferEncoding',
        value: function getTransferEncoding() {
            var transferEncoding = false;
            var contentType = (this.getHeader('Content-Type') || '').toString().toLowerCase().trim();

            if (this.content) {
                transferEncoding = (this.getHeader('Content-Transfer-Encoding') || '').toString().toLowerCase().trim();
                if (!transferEncoding || !['base64', 'quoted-printable'].includes(transferEncoding)) {
                    if (/^text\//i.test(contentType)) {
                        // If there are no special symbols, no need to modify the text
                        if (this._isPlainText && !this._hasLongLines) {
                            transferEncoding = '7bit';
                        } else if (typeof this.content === 'string' || this.content instanceof Buffer) {
                            // detect preferred encoding for string value
                            transferEncoding = this._getTextEncoding(this.content) === 'Q' ? 'quoted-printable' : 'base64';
                        } else {
                            // we can not check content for a stream, so either use preferred encoding or fallback to QP
                            transferEncoding = this.transferEncoding === 'B' ? 'base64' : 'quoted-printable';
                        }
                    } else if (!/^(multipart|message)\//i.test(contentType)) {
                        transferEncoding = transferEncoding || 'base64';
                    }
                }
            }
            return transferEncoding;
        }

        /**
         * Builds the header block for the mime node. Append \r\n\r\n before writing the content
         *
         * @returns {String} Headers
         */

    }, {
        key: 'buildHeaders',
        value: function buildHeaders() {
            var _this5 = this;

            var transferEncoding = this.getTransferEncoding();
            var headers = [];

            if (transferEncoding) {
                this.setHeader('Content-Transfer-Encoding', transferEncoding);
            }

            if (this.filename && !this.getHeader('Content-Disposition')) {
                this.setHeader('Content-Disposition', 'attachment');
            }

            // Ensure mandatory header fields
            if (this.rootNode === this) {
                if (!this.getHeader('Date')) {
                    this.setHeader('Date', this.date.toUTCString().replace(/GMT/, '+0000'));
                }

                // ensure that Message-Id is present
                this.messageId();

                if (!this.getHeader('MIME-Version')) {
                    this.setHeader('MIME-Version', '1.0');
                }
            }

            this._headers.forEach(function (header) {
                var key = header.key;
                var value = header.value;
                var structured = void 0;
                var param = void 0;
                var options = {};
                var formattedHeaders = ['From', 'Sender', 'To', 'Cc', 'Bcc', 'Reply-To', 'Date', 'References'];

                if (value && (typeof value === 'undefined' ? 'undefined' : _typeof(value)) === 'object' && !formattedHeaders.includes(key)) {
                    Object.keys(value).forEach(function (key) {
                        if (key !== 'value') {
                            options[key] = value[key];
                        }
                    });
                    value = (value.value || '').toString();
                    if (!value.trim()) {
                        return;
                    }
                }

                if (options.prepared) {
                    // header value is
                    headers.push(key + ': ' + value);
                    return;
                }

                switch (header.key) {
                    case 'Content-Disposition':
                        structured = mimeFuncs.parseHeaderValue(value);
                        if (_this5.filename) {
                            structured.params.filename = _this5.filename;
                        }
                        value = mimeFuncs.buildHeaderValue(structured);
                        break;
                    case 'Content-Type':
                        structured = mimeFuncs.parseHeaderValue(value);

                        _this5._handleContentType(structured);

                        if (structured.value.match(/^text\/plain\b/) && typeof _this5.content === 'string' && /[\u0080-\uFFFF]/.test(_this5.content)) {
                            structured.params.charset = 'utf-8';
                        }

                        value = mimeFuncs.buildHeaderValue(structured);

                        if (_this5.filename) {
                            // add support for non-compliant clients like QQ webmail
                            // we can't build the value with buildHeaderValue as the value is non standard and
                            // would be converted to parameter continuation encoding that we do not want
                            param = _this5._encodeWords(_this5.filename);

                            if (param !== _this5.filename || /[\s'"\\;:\/=\(\),<>@\[\]\?]|^\-/.test(param)) {
                                // include value in quotes if needed
                                param = '"' + param + '"';
                            }
                            value += '; name=' + param;
                        }
                        break;
                    case 'Bcc':
                        if (!_this5.keepBcc) {
                            // skip BCC values
                            return;
                        }
                        break;
                }

                value = _this5._encodeHeaderValue(key, value);

                // skip empty lines
                if (!(value || '').toString().trim()) {
                    return;
                }

                headers.push(mimeFuncs.foldLines(key + ': ' + value, 76));
            });

            return headers.join('\r\n');
        }

        /**
         * Streams the rfc2822 message from the current node. If this is a root node,
         * mandatory header fields are set if missing (Date, Message-Id, MIME-Version)
         *
         * @return {String} Compiled message
         */

    }, {
        key: 'createReadStream',
        value: function createReadStream(options) {
            options = options || {};

            var stream = new PassThrough(options);
            var outputStream = stream;
            var transform = void 0;

            this.stream(stream, options, function (err) {
                if (err) {
                    outputStream.emit('error', err);
                    return;
                }
                stream.end();
            });

            for (var i = 0, len = this._transforms.length; i < len; i++) {
                transform = typeof this._transforms[i] === 'function' ? this._transforms[i]() : this._transforms[i];
                outputStream.once('error', function (err) {
                    transform.emit('error', err);
                });
                outputStream = outputStream.pipe(transform);
            }

            // ensure terminating newline after possible user transforms
            transform = new LastNewline();
            outputStream.once('error', function (err) {
                transform.emit('error', err);
            });
            outputStream = outputStream.pipe(transform);

            // dkim and stuff
            for (var _i = 0, _len = this._processFuncs.length; _i < _len; _i++) {
                transform = this._processFuncs[_i];
                outputStream = transform(outputStream);
            }

            return outputStream;
        }

        /**
         * Appends a transform stream object to the transforms list. Final output
         * is passed through this stream before exposing
         *
         * @param {Object} transform Read-Write stream
         */

    }, {
        key: 'transform',
        value: function transform(_transform) {
            this._transforms.push(_transform);
        }

        /**
         * Appends a post process function. The functon is run after transforms and
         * uses the following syntax
         *
         *   processFunc(input) -> outputStream
         *
         * @param {Object} processFunc Read-Write stream
         */

    }, {
        key: 'processFunc',
        value: function processFunc(_processFunc) {
            this._processFuncs.push(_processFunc);
        }
    }, {
        key: 'stream',
        value: function stream(outputStream, options, done) {
            var _this6 = this;

            var transferEncoding = this.getTransferEncoding();
            var contentStream = void 0;
            var localStream = void 0;

            // protect actual callback against multiple triggering
            var returned = false;
            var callback = function callback(err) {
                if (returned) {
                    return;
                }
                returned = true;
                done(err);
            };

            // for multipart nodes, push child nodes
            // for content nodes end the stream
            var finalize = function finalize() {
                var childId = 0;
                var processChildNode = function processChildNode() {
                    if (childId >= _this6.childNodes.length) {
                        outputStream.write('\r\n--' + _this6.boundary + '--\r\n');
                        return callback();
                    }
                    var child = _this6.childNodes[childId++];
                    outputStream.write((childId > 1 ? '\r\n' : '') + '--' + _this6.boundary + '\r\n');
                    child.stream(outputStream, options, function (err) {
                        if (err) {
                            return callback(err);
                        }
                        setImmediate(processChildNode);
                    });
                };

                if (_this6.multipart) {
                    setImmediate(processChildNode);
                } else {
                    return callback();
                }
            };

            // pushes node content
            var sendContent = function sendContent() {
                if (_this6.content) {

                    if (Object.prototype.toString.call(_this6.content) === '[object Error]') {
                        // content is already errored
                        return callback(_this6.content);
                    }

                    if (typeof _this6.content.pipe === 'function') {
                        _this6.content.removeListener('error', _this6._contentErrorHandler);
                        _this6._contentErrorHandler = function (err) {
                            return callback(err);
                        };
                        _this6.content.once('error', _this6._contentErrorHandler);
                    }

                    var createStream = function createStream() {

                        if (['quoted-printable', 'base64'].includes(transferEncoding)) {
                            contentStream = new (transferEncoding === 'base64' ? base64 : qp).Encoder(options);

                            contentStream.pipe(outputStream, {
                                end: false
                            });
                            contentStream.once('end', finalize);
                            contentStream.once('error', function (err) {
                                return callback(err);
                            });

                            localStream = _this6._getStream(_this6.content);
                            localStream.pipe(contentStream);
                        } else {
                            // anything that is not QP or Base54 passes as-is
                            localStream = _this6._getStream(_this6.content);
                            localStream.pipe(outputStream, {
                                end: false
                            });
                            localStream.once('end', finalize);
                        }

                        localStream.once('error', function (err) {
                            return callback(err);
                        });
                    };

                    if (_this6.content._resolve) {
                        var chunks = [];
                        var chunklen = 0;
                        var _returned = false;
                        var sourceStream = _this6._getStream(_this6.content);
                        sourceStream.on('error', function (err) {
                            if (_returned) {
                                return;
                            }
                            _returned = true;
                            callback(err);
                        });
                        sourceStream.on('readable', function () {
                            var chunk = void 0;
                            while ((chunk = sourceStream.read()) !== null) {
                                chunks.push(chunk);
                                chunklen += chunk.length;
                            }
                        });
                        sourceStream.on('end', function () {
                            if (_returned) {
                                return;
                            }
                            _returned = true;
                            _this6.content._resolve = false;
                            _this6.content._resolvedValue = Buffer.concat(chunks, chunklen);
                            setImmediate(createStream);
                        });
                    } else {
                        setImmediate(createStream);
                    }
                    return;
                } else {
                    return setImmediate(finalize);
                }
            };

            if (this._raw) {
                setImmediate(function () {
                    if (Object.prototype.toString.call(_this6._raw) === '[object Error]') {
                        // content is already errored
                        return callback(_this6._raw);
                    }

                    // remove default error handler (if set)
                    if (typeof _this6._raw.pipe === 'function') {
                        _this6._raw.removeListener('error', _this6._contentErrorHandler);
                    }

                    var raw = _this6._getStream(_this6._raw);
                    raw.pipe(outputStream, {
                        end: false
                    });
                    raw.on('error', function (err) {
                        return outputStream.emit('error', err);
                    });
                    raw.on('end', finalize);
                });
            } else {
                outputStream.write(this.buildHeaders() + '\r\n\r\n');
                setImmediate(sendContent);
            }
        }

        /**
         * Sets envelope to be used instead of the generated one
         *
         * @return {Object} SMTP envelope in the form of {from: 'from@example.com', to: ['to@example.com']}
         */

    }, {
        key: 'setEnvelope',
        value: function setEnvelope(envelope) {
            var _this7 = this;

            var list = void 0;

            this._envelope = {
                from: false,
                to: []
            };

            if (envelope.from) {
                list = [];
                this._convertAddresses(this._parseAddresses(envelope.from), list);
                list = list.filter(function (address) {
                    return address && address.address;
                });
                if (list.length && list[0]) {
                    this._envelope.from = list[0].address;
                }
            }
            ['to', 'cc', 'bcc'].forEach(function (key) {
                if (envelope[key]) {
                    _this7._convertAddresses(_this7._parseAddresses(envelope[key]), _this7._envelope.to);
                }
            });

            this._envelope.to = this._envelope.to.map(function (to) {
                return to.address;
            }).filter(function (address) {
                return address;
            });

            var standardFields = ['to', 'cc', 'bcc', 'from'];
            Object.keys(envelope).forEach(function (key) {
                if (!standardFields.includes(key)) {
                    _this7._envelope[key] = envelope[key];
                }
            });

            return this;
        }

        /**
         * Generates and returns an object with parsed address fields
         *
         * @return {Object} Address object
         */

    }, {
        key: 'getAddresses',
        value: function getAddresses() {
            var _this8 = this;

            var addresses = {};

            this._headers.forEach(function (header) {
                var key = header.key.toLowerCase();
                if (['from', 'sender', 'reply-to', 'to', 'cc', 'bcc'].includes(key)) {
                    if (!Array.isArray(addresses[key])) {
                        addresses[key] = [];
                    }

                    _this8._convertAddresses(_this8._parseAddresses(header.value), addresses[key]);
                }
            });

            return addresses;
        }

        /**
         * Generates and returns SMTP envelope with the sender address and a list of recipients addresses
         *
         * @return {Object} SMTP envelope in the form of {from: 'from@example.com', to: ['to@example.com']}
         */

    }, {
        key: 'getEnvelope',
        value: function getEnvelope() {
            var _this9 = this;

            if (this._envelope) {
                return this._envelope;
            }

            var envelope = {
                from: false,
                to: []
            };
            this._headers.forEach(function (header) {
                var list = [];
                if (header.key === 'From' || !envelope.from && ['Reply-To', 'Sender'].includes(header.key)) {
                    _this9._convertAddresses(_this9._parseAddresses(header.value), list);
                    if (list.length && list[0]) {
                        envelope.from = list[0].address;
                    }
                } else if (['To', 'Cc', 'Bcc'].includes(header.key)) {
                    _this9._convertAddresses(_this9._parseAddresses(header.value), envelope.to);
                }
            });

            envelope.to = envelope.to.map(function (to) {
                return to.address;
            });

            return envelope;
        }

        /**
         * Returns Message-Id value. If it does not exist, then creates one
         *
         * @return {String} Message-Id value
         */

    }, {
        key: 'messageId',
        value: function messageId() {
            var messageId = this.getHeader('Message-ID');
            // You really should define your own Message-Id field!
            if (!messageId) {
                messageId = this._generateMessageId();
                this.setHeader('Message-ID', messageId);
            }
            return messageId;
        }

        /**
         * Sets pregenerated content that will be used as the output of this node
         *
         * @param {String|Buffer|Stream} Raw MIME contents
         */

    }, {
        key: 'setRaw',
        value: function setRaw(raw) {
            var _this10 = this;

            this._raw = raw;

            if (this._raw && typeof this._raw.pipe === 'function') {
                // pre-stream handler. might be triggered if a stream is set as content
                // and 'error' fires before anything is done with this stream
                this._contentErrorHandler = function (err) {
                    _this10._raw.removeListener('error', _this10._contentErrorHandler);
                    _this10._raw = err;
                };
                this._raw.once('error', this._contentErrorHandler);
            }

            return this;
        }

        /////// PRIVATE METHODS

        /**
         * Detects and returns handle to a stream related with the content.
         *
         * @param {Mixed} content Node content
         * @returns {Object} Stream object
         */

    }, {
        key: '_getStream',
        value: function _getStream(content) {
            var contentStream = void 0;

            if (content._resolvedValue) {
                // pass string or buffer content as a stream
                contentStream = new PassThrough();
                setImmediate(function () {
                    return contentStream.end(content._resolvedValue);
                });
                return contentStream;
            } else if (typeof content.pipe === 'function') {
                // assume as stream
                return content;
            } else if (content && typeof content.path === 'string' && !content.href) {
                if (this.disableFileAccess) {
                    contentStream = new PassThrough();
                    setImmediate(function () {
                        return contentStream.emit('error', new Error('File access rejected for ' + content.path));
                    });
                    return contentStream;
                }
                // read file
                return fs.createReadStream(content.path);
            } else if (content && typeof content.href === 'string') {
                if (this.disableUrlAccess) {
                    contentStream = new PassThrough();
                    setImmediate(function () {
                        return contentStream.emit('error', new Error('Url access rejected for ' + content.href));
                    });
                    return contentStream;
                }
                // fetch URL
                return fetch(content.href);
            } else {
                // pass string or buffer content as a stream
                contentStream = new PassThrough();
                setImmediate(function () {
                    return contentStream.end(content || '');
                });
                return contentStream;
            }
        }

        /**
         * Parses addresses. Takes in a single address or an array or an
         * array of address arrays (eg. To: [[first group], [second group],...])
         *
         * @param {Mixed} addresses Addresses to be parsed
         * @return {Array} An array of address objects
         */

    }, {
        key: '_parseAddresses',
        value: function _parseAddresses(addresses) {
            var _this11 = this;

            return [].concat.apply([], [].concat(addresses).map(function (address) {
                // eslint-disable-line prefer-spread
                if (address && address.address) {
                    address.address = _this11._normalizeAddress(address.address);
                    address.name = address.name || '';
                    return [address];
                }
                return addressparser(address);
            }));
        }

        /**
         * Normalizes a header key, uses Camel-Case form, except for uppercase MIME-
         *
         * @param {String} key Key to be normalized
         * @return {String} key in Camel-Case form
         */

    }, {
        key: '_normalizeHeaderKey',
        value: function _normalizeHeaderKey(key) {
            return (key || '').toString().
            // no newlines in keys
            replace(/\r?\n|\r/g, ' ').trim().toLowerCase().
            // use uppercase words, except MIME
            replace(/^X\-SMTPAPI$|^(MIME|DKIM)\b|^[a-z]|\-(SPF|FBL|ID|MD5)$|\-[a-z]/ig, function (c) {
                return c.toUpperCase();
            }).
            // special case
            replace(/^Content\-Features$/i, 'Content-features');
        }

        /**
         * Checks if the content type is multipart and defines boundary if needed.
         * Doesn't return anything, modifies object argument instead.
         *
         * @param {Object} structured Parsed header value for 'Content-Type' key
         */

    }, {
        key: '_handleContentType',
        value: function _handleContentType(structured) {
            this.contentType = structured.value.trim().toLowerCase();

            this.multipart = this.contentType.split('/').reduce(function (prev, value) {
                return prev === 'multipart' ? value : false;
            });

            if (this.multipart) {
                this.boundary = structured.params.boundary = structured.params.boundary || this.boundary || this._generateBoundary();
            } else {
                this.boundary = false;
            }
        }

        /**
         * Generates a multipart boundary value
         *
         * @return {String} boundary value
         */

    }, {
        key: '_generateBoundary',
        value: function _generateBoundary() {
            return this.rootNode.boundaryPrefix + '-' + this.rootNode.baseBoundary + '-Part_' + this._nodeId;
        }

        /**
         * Encodes a header value for use in the generated rfc2822 email.
         *
         * @param {String} key Header key
         * @param {String} value Header value
         */

    }, {
        key: '_encodeHeaderValue',
        value: function _encodeHeaderValue(key, value) {
            key = this._normalizeHeaderKey(key);

            switch (key) {

                // Structured headers
                case 'From':
                case 'Sender':
                case 'To':
                case 'Cc':
                case 'Bcc':
                case 'Reply-To':
                    return this._convertAddresses(this._parseAddresses(value));

                // values enclosed in <>
                case 'Message-ID':
                case 'In-Reply-To':
                case 'Content-Id':
                    value = (value || '').toString().replace(/\r?\n|\r/g, ' ');

                    if (value.charAt(0) !== '<') {
                        value = '<' + value;
                    }

                    if (value.charAt(value.length - 1) !== '>') {
                        value = value + '>';
                    }
                    return value;

                // space separated list of values enclosed in <>
                case 'References':
                    value = [].concat.apply([], [].concat(value || '').map(function (elm) {
                        // eslint-disable-line prefer-spread
                        elm = (elm || '').toString().replace(/\r?\n|\r/g, ' ').trim();
                        return elm.replace(/<[^>]*>/g, function (str) {
                            return str.replace(/\s/g, '');
                        }).split(/\s+/);
                    })).map(function (elm) {
                        if (elm.charAt(0) !== '<') {
                            elm = '<' + elm;
                        }
                        if (elm.charAt(elm.length - 1) !== '>') {
                            elm = elm + '>';
                        }
                        return elm;
                    });

                    return value.join(' ').trim();

                case 'Date':
                    if (Object.prototype.toString.call(value) === '[object Date]') {
                        return value.toUTCString().replace(/GMT/, '+0000');
                    }

                    value = (value || '').toString().replace(/\r?\n|\r/g, ' ');
                    return this._encodeWords(value);

                default:
                    value = (value || '').toString().replace(/\r?\n|\r/g, ' ');
                    // encodeWords only encodes if needed, otherwise the original string is returned
                    return this._encodeWords(value);
            }
        }

        /**
         * Rebuilds address object using punycode and other adjustments
         *
         * @param {Array} addresses An array of address objects
         * @param {Array} [uniqueList] An array to be populated with addresses
         * @return {String} address string
         */

    }, {
        key: '_convertAddresses',
        value: function _convertAddresses(addresses, uniqueList) {
            var _this12 = this;

            var values = [];

            uniqueList = uniqueList || [];

            [].concat(addresses || []).forEach(function (address) {
                if (address.address) {
                    address.address = _this12._normalizeAddress(address.address);

                    if (!address.name) {
                        values.push(address.address);
                    } else if (address.name) {
                        values.push(_this12._encodeAddressName(address.name) + ' <' + address.address + '>');
                    }

                    if (address.address) {
                        if (!uniqueList.filter(function (a) {
                            return a.address === address.address;
                        }).length) {
                            uniqueList.push(address);
                        }
                    }
                } else if (address.group) {
                    values.push(_this12._encodeAddressName(address.name) + ':' + (address.group.length ? _this12._convertAddresses(address.group, uniqueList) : '').trim() + ';');
                }
            });

            return values.join(', ');
        }

        /**
         * Normalizes an email address
         *
         * @param {Array} address An array of address objects
         * @return {String} address string
         */

    }, {
        key: '_normalizeAddress',
        value: function _normalizeAddress(address) {
            address = (address || '').toString().trim();

            var lastAt = address.lastIndexOf('@');
            var user = address.substr(0, lastAt);
            var domain = address.substr(lastAt + 1);

            // Usernames are not touched and are kept as is even if these include unicode
            // Domains are punycoded by default
            // 'jõgeva.ee' will be converted to 'xn--jgeva-dua.ee'
            // non-unicode domains are left as is

            return user + '@' + punycode.toASCII(domain.toLowerCase());
        }

        /**
         * If needed, mime encodes the name part
         *
         * @param {String} name Name part of an address
         * @returns {String} Mime word encoded string if needed
         */

    }, {
        key: '_encodeAddressName',
        value: function _encodeAddressName(name) {
            if (!/^[\w ']*$/.test(name)) {
                if (/^[\x20-\x7e]*$/.test(name)) {
                    return '"' + name.replace(/([\\"])/g, '\\$1') + '"';
                } else {
                    return mimeFuncs.encodeWord(name, this._getTextEncoding(name), 52);
                }
            }
            return name;
        }

        /**
         * If needed, mime encodes the name part
         *
         * @param {String} name Name part of an address
         * @returns {String} Mime word encoded string if needed
         */

    }, {
        key: '_encodeWords',
        value: function _encodeWords(value) {
            return mimeFuncs.encodeWords(value, this._getTextEncoding(value), 52);
        }

        /**
         * Detects best mime encoding for a text value
         *
         * @param {String} value Value to check for
         * @return {String} either 'Q' or 'B'
         */

    }, {
        key: '_getTextEncoding',
        value: function _getTextEncoding(value) {
            value = (value || '').toString();

            var encoding = this.textEncoding;
            var latinLen = void 0;
            var nonLatinLen = void 0;

            if (!encoding) {
                // count latin alphabet symbols and 8-bit range symbols + control symbols
                // if there are more latin characters, then use quoted-printable
                // encoding, otherwise use base64
                nonLatinLen = (value.match(/[\x00-\x08\x0B\x0C\x0E-\x1F\u0080-\uFFFF]/g) || []).length; // eslint-disable-line no-control-regex
                latinLen = (value.match(/[a-z]/gi) || []).length;
                // if there are more latin symbols than binary/unicode, then prefer Q, otherwise B
                encoding = nonLatinLen < latinLen ? 'Q' : 'B';
            }
            return encoding;
        }

        /**
         * Generates a message id
         *
         * @return {String} Random Message-ID value
         */

    }, {
        key: '_generateMessageId',
        value: function _generateMessageId() {
            return '<' + [2, 2, 2, 6].reduce(
            // crux to generate UUID-like random strings
            function (prev, len) {
                return prev + '-' + crypto.randomBytes(len).toString('hex');
            }, crypto.randomBytes(4).toString('hex')) + '@' +
            // try to use the domain of the FROM address or fallback to server hostname
            (this.getEnvelope().from || this.hostname || os.hostname() || 'localhost').split('@').pop() + '>';
        }
    }]);

    return MimeNode;
}();

module.exports = MimeNode;
