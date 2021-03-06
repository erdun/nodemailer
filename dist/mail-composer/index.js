/* eslint no-undefined: 0 */

'use strict';

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; };

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

var MimeNode = require('../mime-node');
var mimeFuncs = require('../mime-funcs');

/**
 * Creates the object for composing a MimeNode instance out from the mail options
 *
 * @constructor
 * @param {Object} mail Mail options
 */

var MailComposer = function () {
    function MailComposer(mail) {
        _classCallCheck(this, MailComposer);

        this.mail = mail || {};
        this.message = false;
    }

    /**
     * Builds MimeNode instance
     */


    _createClass(MailComposer, [{
        key: 'compile',
        value: function compile() {
            var _this = this;

            this._alternatives = this.getAlternatives();
            this._htmlNode = this._alternatives.filter(function (alternative) {
                return (/^text\/html\b/i.test(alternative.contentType)
                );
            }).pop();
            this._attachments = this.getAttachments(!!this._htmlNode);

            this._useRelated = !!(this._htmlNode && this._attachments.related.length);
            this._useAlternative = this._alternatives.length > 1;
            this._useMixed = this._attachments.attached.length > 1 || this._alternatives.length && this._attachments.attached.length === 1;

            // Compose MIME tree
            if (this.mail.raw) {
                this.message = new MimeNode().setRaw(this.mail.raw);
            } else if (this._useMixed) {
                this.message = this._createMixed();
            } else if (this._useAlternative) {
                this.message = this._createAlternative();
            } else if (this._useRelated) {
                this.message = this._createRelated();
            } else {
                this.message = this._createContentNode(false, [].concat(this._alternatives || []).concat(this._attachments.attached || []).shift() || {
                    contentType: 'text/plain',
                    content: ''
                });
            }

            // Add custom headers
            if (this.mail.headers) {
                this.message.addHeader(this.mail.headers);
            }

            // Add headers to the root node, always overrides custom headers
            ['from', 'sender', 'to', 'cc', 'bcc', 'reply-to', 'in-reply-to', 'references', 'subject', 'message-id', 'date'].forEach(function (header) {
                var key = header.replace(/-(\w)/g, function (o, c) {
                    return c.toUpperCase();
                });
                if (_this.mail[key]) {
                    _this.message.setHeader(header, _this.mail[key]);
                }
            });

            // Sets custom envelope
            if (this.mail.envelope) {
                this.message.setEnvelope(this.mail.envelope);
            }

            // ensure Message-Id value
            this.message.messageId();

            return this.message;
        }

        /**
         * List all attachments. Resulting attachment objects can be used as input for MimeNode nodes
         *
         * @param {Boolean} findRelated If true separate related attachments from attached ones
         * @returns {Object} An object of arrays (`related` and `attached`)
         */

    }, {
        key: 'getAttachments',
        value: function getAttachments(findRelated) {
            var _this2 = this;

            var icalEvent = void 0,
                eventObject = void 0;
            var attachments = [].concat(this.mail.attachments || []).map(function (attachment, i) {
                var data = void 0;
                var isMessageNode = /^message\//i.test(attachment.contentType);

                if (/^data:/i.test(attachment.path || attachment.href)) {
                    attachment = _this2._processDataUrl(attachment);
                }

                data = {
                    contentType: attachment.contentType || mimeFuncs.detectMimeType(attachment.filename || attachment.path || attachment.href || 'bin'),
                    contentDisposition: attachment.contentDisposition || (isMessageNode ? 'inline' : 'attachment'),
                    contentTransferEncoding: attachment.contentTransferEncoding
                };

                if (attachment.filename) {
                    data.filename = attachment.filename;
                } else if (!isMessageNode && attachment.filename !== false) {
                    data.filename = (attachment.path || attachment.href || '').split('/').pop() || 'attachment-' + (i + 1);
                    if (data.filename.indexOf('.') < 0) {
                        data.filename += '.' + mimeFuncs.detectExtension(data.contentType);
                    }
                }

                if (/^https?:\/\//i.test(attachment.path)) {
                    attachment.href = attachment.path;
                    attachment.path = undefined;
                }

                if (attachment.cid) {
                    data.cid = attachment.cid;
                }

                if (attachment.raw) {
                    data.raw = attachment.raw;
                } else if (attachment.path) {
                    data.content = {
                        path: attachment.path
                    };
                } else if (attachment.href) {
                    data.content = {
                        href: attachment.href
                    };
                } else {
                    data.content = attachment.content || '';
                }

                if (attachment.encoding) {
                    data.encoding = attachment.encoding;
                }

                if (attachment.headers) {
                    data.headers = attachment.headers;
                }

                return data;
            });

            if (this.mail.icalEvent) {
                if (_typeof(this.mail.icalEvent) === 'object' && (this.mail.icalEvent.content || this.mail.icalEvent.path || this.mail.icalEvent.href || this.mail.icalEvent.raw)) {
                    icalEvent = this.mail.icalEvent;
                } else {
                    icalEvent = {
                        content: this.mail.icalEvent
                    };
                }

                eventObject = {};
                Object.keys(icalEvent).forEach(function (key) {
                    eventObject[key] = icalEvent[key];
                });

                eventObject.contentType = 'application/ics';
                if (!eventObject.headers) {
                    eventObject.headers = {};
                }
                eventObject.filename = eventObject.filename || 'invite.ics';
                eventObject.headers['Content-Disposition'] = 'attachment';
                eventObject.headers['Content-Transfer-Encoding'] = 'base64';
            }

            if (!findRelated) {
                return {
                    attached: attachments.concat(eventObject || []),
                    related: []
                };
            } else {
                return {
                    attached: attachments.filter(function (attachment) {
                        return !attachment.cid;
                    }).concat(eventObject || []),
                    related: attachments.filter(function (attachment) {
                        return !!attachment.cid;
                    })
                };
            }
        }

        /**
         * List alternatives. Resulting objects can be used as input for MimeNode nodes
         *
         * @returns {Array} An array of alternative elements. Includes the `text` and `html` values as well
         */

    }, {
        key: 'getAlternatives',
        value: function getAlternatives() {
            var _this3 = this;

            var alternatives = [],
                text = void 0,
                html = void 0,
                watchHtml = void 0,
                icalEvent = void 0,
                eventObject = void 0;

            if (this.mail.text) {
                if (_typeof(this.mail.text) === 'object' && (this.mail.text.content || this.mail.text.path || this.mail.text.href || this.mail.text.raw)) {
                    text = this.mail.text;
                } else {
                    text = {
                        content: this.mail.text
                    };
                }
                text.contentType = 'text/plain' + (!text.encoding && mimeFuncs.isPlainText(text.content) ? '' : '; charset=utf-8');
            }

            if (this.mail.watchHtml) {
                if (_typeof(this.mail.watchHtml) === 'object' && (this.mail.watchHtml.content || this.mail.watchHtml.path || this.mail.watchHtml.href || this.mail.watchHtml.raw)) {
                    watchHtml = this.mail.watchHtml;
                } else {
                    watchHtml = {
                        content: this.mail.watchHtml
                    };
                }
                watchHtml.contentType = 'text/watch-html' + (!watchHtml.encoding && mimeFuncs.isPlainText(watchHtml.content) ? '' : '; charset=utf-8');
            }

            // only include the calendar alternative if there are no attachments
            // otherwise you might end up in a blank screen on some clients
            if (this.mail.icalEvent && !(this.mail.attachments && this.mail.attachments.length)) {
                if (_typeof(this.mail.icalEvent) === 'object' && (this.mail.icalEvent.content || this.mail.icalEvent.path || this.mail.icalEvent.href || this.mail.icalEvent.raw)) {
                    icalEvent = this.mail.icalEvent;
                } else {
                    icalEvent = {
                        content: this.mail.icalEvent
                    };
                }

                eventObject = {};
                Object.keys(icalEvent).forEach(function (key) {
                    eventObject[key] = icalEvent[key];
                });

                if (eventObject.content && _typeof(eventObject.content) === 'object') {
                    // we are going to have the same attachment twice, so mark this to be
                    // resolved just once
                    eventObject.content._resolve = true;
                }

                eventObject.filename = false;
                eventObject.contentType = 'text/calendar; charset="utf-8"; method=' + (eventObject.method || 'PUBLISH').toString().trim().toUpperCase();
                if (!eventObject.headers) {
                    eventObject.headers = {};
                }
            }

            if (this.mail.html) {
                if (_typeof(this.mail.html) === 'object' && (this.mail.html.content || this.mail.html.path || this.mail.html.href || this.mail.html.raw)) {
                    html = this.mail.html;
                } else {
                    html = {
                        content: this.mail.html
                    };
                }
                html.contentType = 'text/html' + (!html.encoding && mimeFuncs.isPlainText(html.content) ? '' : '; charset=utf-8');
            }

            [].concat(text || []).concat(watchHtml || []).concat(html || []).concat(eventObject || []).concat(this.mail.alternatives || []).forEach(function (alternative) {
                var data = void 0;

                if (/^data:/i.test(alternative.path || alternative.href)) {
                    alternative = _this3._processDataUrl(alternative);
                }

                data = {
                    contentType: alternative.contentType || mimeFuncs.detectMimeType(alternative.filename || alternative.path || alternative.href || 'txt'),
                    contentTransferEncoding: alternative.contentTransferEncoding
                };

                if (alternative.filename) {
                    data.filename = alternative.filename;
                }

                if (/^https?:\/\//i.test(alternative.path)) {
                    alternative.href = alternative.path;
                    alternative.path = undefined;
                }

                if (alternative.raw) {
                    data.raw = alternative.raw;
                } else if (alternative.path) {
                    data.content = {
                        path: alternative.path
                    };
                } else if (alternative.href) {
                    data.content = {
                        href: alternative.href
                    };
                } else {
                    data.content = alternative.content || '';
                }

                if (alternative.encoding) {
                    data.encoding = alternative.encoding;
                }

                if (alternative.headers) {
                    data.headers = alternative.headers;
                }

                alternatives.push(data);
            });

            return alternatives;
        }

        /**
         * Builds multipart/mixed node. It should always contain different type of elements on the same level
         * eg. text + attachments
         *
         * @param {Object} parentNode Parent for this note. If it does not exist, a root node is created
         * @returns {Object} MimeNode node element
         */

    }, {
        key: '_createMixed',
        value: function _createMixed(parentNode) {
            var _this4 = this;

            var node = void 0;

            if (!parentNode) {
                node = new MimeNode('multipart/mixed', {
                    baseBoundary: this.mail.baseBoundary,
                    textEncoding: this.mail.textEncoding,
                    boundaryPrefix: this.mail.boundaryPrefix,
                    disableUrlAccess: this.mail.disableUrlAccess,
                    disableFileAccess: this.mail.disableFileAccess
                });
            } else {
                node = parentNode.createChild('multipart/mixed', {
                    disableUrlAccess: this.mail.disableUrlAccess,
                    disableFileAccess: this.mail.disableFileAccess
                });
            }

            if (this._useAlternative) {
                this._createAlternative(node);
            } else if (this._useRelated) {
                this._createRelated(node);
            }

            [].concat(!this._useAlternative && this._alternatives || []).concat(this._attachments.attached || []).forEach(function (element) {
                // if the element is a html node from related subpart then ignore it
                if (!_this4._useRelated || element !== _this4._htmlNode) {
                    _this4._createContentNode(node, element);
                }
            });

            return node;
        }

        /**
         * Builds multipart/alternative node. It should always contain same type of elements on the same level
         * eg. text + html view of the same data
         *
         * @param {Object} parentNode Parent for this note. If it does not exist, a root node is created
         * @returns {Object} MimeNode node element
         */

    }, {
        key: '_createAlternative',
        value: function _createAlternative(parentNode) {
            var _this5 = this;

            var node = void 0;

            if (!parentNode) {
                node = new MimeNode('multipart/alternative', {
                    baseBoundary: this.mail.baseBoundary,
                    textEncoding: this.mail.textEncoding,
                    boundaryPrefix: this.mail.boundaryPrefix,
                    disableUrlAccess: this.mail.disableUrlAccess,
                    disableFileAccess: this.mail.disableFileAccess
                });
            } else {
                node = parentNode.createChild('multipart/alternative', {
                    disableUrlAccess: this.mail.disableUrlAccess,
                    disableFileAccess: this.mail.disableFileAccess
                });
            }

            this._alternatives.forEach(function (alternative) {
                if (_this5._useRelated && _this5._htmlNode === alternative) {
                    _this5._createRelated(node);
                } else {
                    _this5._createContentNode(node, alternative);
                }
            });

            return node;
        }

        /**
         * Builds multipart/related node. It should always contain html node with related attachments
         *
         * @param {Object} parentNode Parent for this note. If it does not exist, a root node is created
         * @returns {Object} MimeNode node element
         */

    }, {
        key: '_createRelated',
        value: function _createRelated(parentNode) {
            var _this6 = this;

            var node = void 0;

            if (!parentNode) {
                node = new MimeNode('multipart/related; type="text/html"', {
                    baseBoundary: this.mail.baseBoundary,
                    textEncoding: this.mail.textEncoding,
                    boundaryPrefix: this.mail.boundaryPrefix,
                    disableUrlAccess: this.mail.disableUrlAccess,
                    disableFileAccess: this.mail.disableFileAccess
                });
            } else {
                node = parentNode.createChild('multipart/related; type="text/html"', {
                    disableUrlAccess: this.mail.disableUrlAccess,
                    disableFileAccess: this.mail.disableFileAccess
                });
            }

            this._createContentNode(node, this._htmlNode);

            this._attachments.related.forEach(function (alternative) {
                return _this6._createContentNode(node, alternative);
            });

            return node;
        }

        /**
         * Creates a regular node with contents
         *
         * @param {Object} parentNode Parent for this note. If it does not exist, a root node is created
         * @param {Object} element Node data
         * @returns {Object} MimeNode node element
         */

    }, {
        key: '_createContentNode',
        value: function _createContentNode(parentNode, element) {
            element = element || {};
            element.content = element.content || '';

            var node = void 0;
            var encoding = (element.encoding || 'utf8').toString().toLowerCase().replace(/[-_\s]/g, '');

            if (!parentNode) {
                node = new MimeNode(element.contentType, {
                    filename: element.filename,
                    baseBoundary: this.mail.baseBoundary,
                    textEncoding: this.mail.textEncoding,
                    boundaryPrefix: this.mail.boundaryPrefix,
                    disableUrlAccess: this.mail.disableUrlAccess,
                    disableFileAccess: this.mail.disableFileAccess
                });
            } else {
                node = parentNode.createChild(element.contentType, {
                    filename: element.filename,
                    disableUrlAccess: this.mail.disableUrlAccess,
                    disableFileAccess: this.mail.disableFileAccess
                });
            }

            // add custom headers
            if (element.headers) {
                node.addHeader(element.headers);
            }

            if (element.cid) {
                node.setHeader('Content-Id', '<' + element.cid.replace(/[<>]/g, '') + '>');
            }

            if (element.contentTransferEncoding) {
                node.setHeader('Content-Transfer-Encoding', element.contentTransferEncoding);
            } else if (this.mail.encoding && /^text\//i.test(element.contentType)) {
                node.setHeader('Content-Transfer-Encoding', this.mail.encoding);
            }

            if (!/^text\//i.test(element.contentType) || element.contentDisposition) {
                node.setHeader('Content-Disposition', element.contentDisposition || (element.cid ? 'inline' : 'attachment'));
            }

            if (typeof element.content === 'string' && !['utf8', 'usascii', 'ascii'].includes(encoding)) {
                element.content = new Buffer(element.content, encoding);
            }

            // prefer pregenerated raw content
            if (element.raw) {
                node.setRaw(element.raw);
            } else {
                node.setContent(element.content);
            }

            return node;
        }

        /**
         * Parses data uri and converts it to a Buffer
         *
         * @param {Object} element Content element
         * @return {Object} Parsed element
         */

    }, {
        key: '_processDataUrl',
        value: function _processDataUrl(element) {
            var parts = (element.path || element.href).match(/^data:((?:[^;]*;)*(?:[^,]*)),(.*)$/i);
            if (!parts) {
                return element;
            }

            element.content = /\bbase64$/i.test(parts[1]) ? new Buffer(parts[2], 'base64') : new Buffer(decodeURIComponent(parts[2]));

            if ('path' in element) {
                element.path = false;
            }

            if ('href' in element) {
                element.href = false;
            }

            parts[1].split(';').forEach(function (item) {
                if (/^\w+\/[^\/]+$/i.test(item)) {
                    element.contentType = element.contentType || item.toLowerCase();
                }
            });

            return element;
        }
    }]);

    return MailComposer;
}();

module.exports = MailComposer;
